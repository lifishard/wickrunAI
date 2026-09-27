import React from 'react';
import DOMPurify from 'dompurify';
import { desktop } from '../lib/transport';
import ArtifactPdf from './ArtifactPdf';
import ArtifactOfficeEditor from './ArtifactOfficeEditor';
import type { ProposeArtifactEdit } from './ArtifactAiEdit';

function DocumentPreview({ path, type }: { path: string; type: string }) {
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [sheets, setSheets] = React.useState<{ name: string; rows: string[][]; clipped: boolean }[]>([]);
  const [sheet, setSheet] = React.useState(0);
  const [error, setError] = React.useState('');
  const [wordPdf, setWordPdf] = React.useState<Uint8Array | null>(null);
  const [layoutMode, setLayoutMode] = React.useState(false);
  const [layoutBusy, setLayoutBusy] = React.useState(false);
  const [layoutError, setLayoutError] = React.useState('');
  const generation = React.useRef(0);
  React.useEffect(() => () => { generation.current++; }, []);
  React.useEffect(() => {
    let disposed = false;
    setBytes(null); setHtml(null); setSheets([]); setSheet(0); setError('');
    void (async () => {
      const bridge = desktop();
      if (!bridge) throw Error('请在保存该文件的桌面端打开。');
      const data = await bridge.artifactDocument(path);
      if (disposed) return;
      if (type === 'pdf') { setBytes(data); return; }
      if (type === 'docx') {
        const mammoth = await import('mammoth');
        const result = await mammoth.convertToHtml({ arrayBuffer: data.slice().buffer as ArrayBuffer });
        if (!disposed) setHtml(DOMPurify.sanitize(result.value, { FORBID_TAGS: ['style', 'script', 'iframe', 'form'], FORBID_ATTR: ['style'] }));
      } else {
        const XLSX = await import('xlsx');
        const book = XLSX.read(data, { type: 'array', sheetRows: 201, cellHTML: false, cellStyles: false, bookVBA: false });
        const tables = book.SheetNames.map(name => {
          const ws = book.Sheets[name];
          const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
          const full = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref'] || 'A1');
          range.s = { r: 0, c: 0 }; range.e.r = Math.min(range.e.r, 199); range.e.c = Math.min(range.e.c, 49);
          const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', range });
          return { name, rows, clipped: full.e.r > 199 || full.e.c > 49 };
        });
        if (!disposed) setSheets(tables);
      }
    })().catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [path, type]);
  if (error) return <div className="picker-error" role="alert">预览失败：{error}。可使用下方的默认程序打开。</div>;
  if (type === 'pdf' && bytes) return <ArtifactPdf bytes={bytes} />;
  if (html !== null) return <div className="artifact-document">
    <div className="artifact-editor-toolbar"><button className="btn sm" aria-pressed={!layoutMode} onClick={() => setLayoutMode(false)}>内容预览</button>
      <button className="btn sm" disabled={layoutBusy} aria-pressed={layoutMode} onClick={() => {
        if (wordPdf) { setLayoutMode(true); return; }
        setLayoutBusy(true); setLayoutError(''); const current = generation.current;
        void desktop()!.artifactWordPreview(path).then(data => { if (generation.current === current) { setWordPdf(data); setLayoutMode(true); } })
          .catch(e => { if (generation.current === current) setLayoutError(String(e)); }).finally(() => { if (generation.current === current) setLayoutBusy(false); });
      }}>{layoutBusy ? '正在排版…' : '精确分页'}</button></div>
    {layoutError ? <p role="alert">{layoutError}</p> : null}
    {layoutMode && wordPdf ? <ArtifactPdf bytes={wordPdf} /> : <><p className="hint">内容预览；精确分页使用本机 Word 或 LibreOffice 排版。</p><div className="artifact-docx md" dangerouslySetInnerHTML={{ __html: html }} /></>}
  </div>;
  if (sheets.length) return <div className="artifact-document">
    <label>工作表 <select aria-label="工作表" value={sheet} onChange={e => setSheet(Number(e.target.value))}>{sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></label>
    <p className="hint">只读预览，显示已保存的单元格值。{sheets[sheet].clipped ? '当前仅显示前 200 行、50 列。' : ''}</p>
    <div className="artifact-table-scroll"><table><tbody>{sheets[sheet].rows.map((r, i) => <tr key={i}><th scope="row">{i + 1}</th>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
  </div>;
  return <div className="empty" role="status">正在读取文档…</div>;
}

export default function ArtifactDocument({ path, type, busy, onPropose }: { path: string; type: string; busy: boolean; onPropose: ProposeArtifactEdit }) {
  const [editing, setEditing] = React.useState(false);
  const [opened, setOpened] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  return <><div className="artifact-editor-toolbar" style={{ padding: 12 }}><button className="btn sm" aria-pressed={!editing} onClick={() => setEditing(false)}>预览文档</button><button className="btn sm" aria-pressed={editing} onClick={() => { setOpened(true); setEditing(true); }}>编辑文档</button></div>
    <div hidden={editing}><DocumentPreview key={revision} path={path} type={type} /></div>
    {opened ? <div hidden={!editing}><ArtifactOfficeEditor path={path} type={type} busy={busy} onPropose={onPropose} onSaved={() => setRevision(n => n + 1)} /></div> : null}</>;
}
