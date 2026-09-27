import React from 'react';
import DOMPurify from 'dompurify';
import { desktop } from '../lib/transport';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy } from 'pdfjs-dist';

function PdfPages({ bytes }: { bytes: Uint8Array }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1);
  const [error, setError] = React.useState('');
  const [rendering, setRendering] = React.useState(true);
  React.useEffect(() => {
    let disposed = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    void import('pdfjs-dist').then(async lib => {
      if (disposed) return;
      lib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = lib.getDocument({ data: bytes.slice(), isEvalSupported: false });
      const doc = await task.promise;
      if (!disposed) setPdf(doc);
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; void task?.destroy(); };
  }, [bytes]);
  React.useEffect(() => {
    if (!pdf) return;
    let disposed = false;
    let task: import('pdfjs-dist').RenderTask | undefined;
    setRendering(true); setError('');
    void pdf.getPage(page).then(async p => {
      if (disposed || !canvas.current) return;
      const viewport = p.getViewport({ scale: 1.25 });
      const el = canvas.current;
      const scale = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.ceil(viewport.width * scale); el.height = Math.ceil(viewport.height * scale);
      task = p.render({ canvasContext: el.getContext('2d')!, viewport, transform: [scale, 0, 0, scale, 0, 0] });
      await task.promise;
      if (!disposed) setRendering(false);
    }).catch(e => { if (!disposed) { setError(String(e)); setRendering(false); } });
    return () => { disposed = true; task?.cancel(); };
  }, [pdf, page]);
  return <div className="artifact-document">
    <div className="artifact-editor-toolbar">
      <button className="btn sm" disabled={!pdf || page <= 1 || rendering} onClick={() => setPage(n => n - 1)}>上一页</button>
      <span>{pdf ? `${page} / ${pdf.numPages}` : '正在读取 PDF…'}</span>
      <button className="btn sm" disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => setPage(n => n + 1)}>下一页</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {rendering && !error ? <p role="status">正在绘制页面…</p> : null}
    <canvas ref={canvas} className="artifact-pdf-page" aria-label={`PDF 第 ${page} 页`} />
  </div>;
}

export default function ArtifactDocument({ path, type }: { path: string; type: string }) {
  const [bytes, setBytes] = React.useState<Uint8Array | null>(null);
  const [html, setHtml] = React.useState<string | null>(null);
  const [sheets, setSheets] = React.useState<{ name: string; rows: string[][]; clipped: boolean }[]>([]);
  const [sheet, setSheet] = React.useState(0);
  const [error, setError] = React.useState('');
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
  if (type === 'pdf' && bytes) return <PdfPages bytes={bytes} />;
  if (html !== null) return <div className="artifact-document"><p className="hint">Word 内容预览；分页和版式请用默认程序查看。</p><div className="artifact-docx md" dangerouslySetInnerHTML={{ __html: html }} /></div>;
  if (sheets.length) return <div className="artifact-document">
    <label>工作表 <select aria-label="工作表" value={sheet} onChange={e => setSheet(Number(e.target.value))}>{sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></label>
    <p className="hint">只读预览，显示已保存的单元格值。{sheets[sheet].clipped ? '当前仅显示前 200 行、50 列。' : ''}</p>
    <div className="artifact-table-scroll"><table><tbody>{sheets[sheet].rows.map((r, i) => <tr key={i}><th scope="row">{i + 1}</th>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>
  </div>;
  return <div className="empty" role="status">正在读取文档…</div>;
}
