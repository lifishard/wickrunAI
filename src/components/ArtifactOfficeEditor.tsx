import React from 'react';
import { desktop } from '../lib/transport';
import { readOfficeDraft, patchOfficeDraft, type OfficeDraft, type BinarySnapshot } from '../lib/office-edit';
import ArtifactPdf from './ArtifactPdf';
import ArtifactAiEdit, { type ProposeArtifactEdit } from './ArtifactAiEdit';

const sessionDrafts=new Map<string,{snapshot:BinarySnapshot;draft:OfficeDraft|null;sheet:number;target:string;text:string;changed:Uint8Array|null}>();
export default function ArtifactOfficeEditor({ path, type, busy, onPropose, onSaved }: { path: string; type: string; busy: boolean; onPropose: ProposeArtifactEdit; onSaved: () => void }) {
  const [snapshot, setSnapshot] = React.useState<BinarySnapshot | null>(null);
  const [draft, setDraft] = React.useState<OfficeDraft | null>(null);
  const [sheet, setSheet] = React.useState(0);
  const [target, setTarget] = React.useState('');
  const [text, setText] = React.useState('');
  const [changed, setChanged] = React.useState<Uint8Array | null>(null);
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [version, setVersion] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [note, setNote] = React.useState('');
  const [x, setX] = React.useState(10), [y, setY] = React.useState(10);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; const cached=sessionDrafts.get(path);if(cached){setSnapshot(cached.snapshot);setDraft(cached.draft);setSheet(cached.sheet);setTarget(cached.target);setText(cached.text);setChanged(cached.changed);}else void load(); return () => { mounted.current = false; }; }, [path]);
  async function accept(s: BinarySnapshot) {
    const parsed = type === 'pdf' ? null : await readOfficeDraft(s.bytes, type === 'docx' ? 'docx' : 'xlsx');
    if (!mounted.current) return;
    setSnapshot(s); setDraft(parsed); setChanged(null); setTarget(''); setText(''); setVersion(''); setSheet(0);
  }
  async function action(fn: () => Promise<void>) { setWorking(true); setError(''); setStatus(''); try { await fn(); } catch (e) { if (mounted.current) setError(String(e)); } finally { if (mounted.current) setWorking(false); } }
  async function load() { await action(async () => accept(await desktop()!.artifactBinary('read', { path }))); }
  const entries = draft?.kind === 'docx' ? draft.paragraphs : draft?.sheets[sheet]?.cells ?? [];
  const entry = entries.find(e => e.id === target);
  const dirty = !!changed || (!!entry && text !== entry.text);
  React.useEffect(()=>{if(!snapshot)return;if(dirty)sessionDrafts.set(path,{snapshot,draft,sheet,target,text,changed});else sessionDrafts.delete(path);},[path,snapshot,draft,sheet,target,text,changed,dirty]);
  const previewChanges = () => action(async () => {
    if (!draft || !entry) return;
    const bytes = await patchOfficeDraft(draft, { id: entry.id, sheet: draft.sheets[sheet]?.path, before: entry.text, after: text });
    setChanged(bytes); setStatus('已生成修改草稿，尚未写入文件。');
  });
  const pdfEdit = (rotate: boolean) => action(async () => {
    if (!snapshot) return;
    const { PDFDocument, degrees } = await import('pdf-lib');
    const pdf = await PDFDocument.load(changed ?? snapshot.bytes);
    if (!Number.isInteger(page) || page < 1 || page > pdf.getPageCount()) throw Error('页码超出范围。');
    const p = pdf.getPage(page - 1);
    if (rotate) p.setRotation(degrees((p.getRotation().angle + 90) % 360));
    else {
      if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('请输入有效的批注位置。');
      if (!note.trim() || note.length > 500) throw Error('批注请输入 1–500 个字符。');
      const lines = note.split('\n').flatMap(s => Array.from(s.matchAll(/.{1,24}/gu), m => m[0]));
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = Math.max(56, lines.length * 38 + 20);
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff7c2'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#222'; ctx.font = '28px sans-serif';
      lines.forEach((line, i) => ctx.fillText(line, 12, 36 + i * 38));
      const png = await pdf.embedPng(canvas.toDataURL('image/png'));
      const w = Math.min(p.getWidth() * 0.65, 360), h = png.height * w / png.width;
      const left = Math.max(0, Math.min(p.getWidth() - w, p.getWidth() * x / 100));
      const bottom = Math.max(0, Math.min(p.getHeight() - h, p.getHeight() * (1 - y / 100) - h));
      p.drawImage(png, { x: left, y: bottom, width: w, height: h });
    }
    setChanged(await pdf.save()); setStatus('PDF 修改已进入预览，保存后才会写入文件。');
  });
  return <div className="artifact-editor">
    {dirty?<p className="hint">未保存 · 文档草稿保留到退出应用</p>:null}
    {error ? <p role="alert">{error}</p> : null}{status ? <p role="status">{status}</p> : null}
    {draft ? <>
      <p className="hint">{type === 'docx' ? '编辑正文段落，保留其他段落、图片和文档结构；新增文字沿用修改起点格式。复杂域、图形段落只读。' : '编辑已有单元格的文字或数值，保留工作表和样式。公式与受保护单元格只读，依赖公式在默认程序中重新计算。'}</p>
      {draft.kind === 'xlsx' ? <label>工作表 <select aria-label="编辑工作表" disabled={dirty || working} value={sheet} onChange={e => { setSheet(Number(e.target.value)); setTarget(''); setText(''); }}>{draft.sheets.map((s, i) => <option value={i} key={s.path}>{s.name}</option>)}</select></label> : null}
      <label>{type === 'docx' ? '段落' : '单元格'} <select aria-label="编辑位置" value={target} disabled={working || dirty} onChange={e => { const found = entries.find(v => v.id === e.target.value); setTarget(e.target.value); setText(found?.text ?? ''); }}><option value="">选择修改位置</option>{entries.map(e => <option key={e.id} value={e.id}>{e.label} · {e.text.slice(0, 40)}{e.editable ? '' : '（只读）'}</option>)}</select></label>
      {entry ? <><textarea className="artifact-textarea" aria-label="文档编辑内容" value={text} disabled={!entry.editable || working || !!changed} onChange={e => setText(e.target.value)} />
        {entry.editable && !changed ? <><button className="btn sm" disabled={working || text === entry.text} onClick={() => void previewChanges()}>查看修改对照</button><ArtifactAiEdit key={`${sheet}:${target}`} source={text} start={0} end={text.length} onPropose={onPropose} onApply={setText} /></> : null}
        {changed ? <div className="artifact-change"><div className="artifact-change-before"><strong>修改前</strong><pre>{entry.text}</pre></div><div className="artifact-change-after"><strong>修改后</strong><pre>{text}</pre></div></div> : null}
      </> : null}
    </> : type === 'pdf' && snapshot ? <>
      <p className="hint">添加可见文字批注或旋转页面。批注不会删除原文，不能用于涂黑敏感信息；原有正文的替换请使用专业 PDF 编辑器。</p>
      <div className="artifact-editor-toolbar"><label>页码 <input aria-label="编辑 PDF 页码" type="number" min={1} value={page} onChange={e => setPage(Number(e.target.value))} /></label><button className="btn sm" disabled={working} onClick={() => void pdfEdit(true)}>顺时针旋转 90°</button></div>
      <textarea aria-label="PDF 批注文字" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="输入批注文字" />
      <div className="artifact-editor-toolbar"><label>距左侧 % <input aria-label="批注横向位置" type="number" min={0} max={100} value={x} onChange={e => setX(Number(e.target.value))} /></label><label>距顶部 % <input aria-label="批注纵向位置" type="number" min={0} max={100} value={y} onChange={e => setY(Number(e.target.value))} /></label><button className="btn sm" disabled={working || !note.trim()} onClick={() => void pdfEdit(false)}>添加批注到草稿</button></div>
      <ArtifactPdf key={changed ? 'changed' : snapshot.hash} bytes={changed ?? snapshot.bytes} />
    </> : <p>正在读取文档…</p>}
    <div className="artifact-editor-toolbar"><button className="btn sm primary" disabled={!changed || working || busy} onClick={() => void action(async () => { await accept(await desktop()!.artifactBinary('save', { path: snapshot!.path, expectedHash: snapshot!.hash, bytes: changed! })); onSaved(); setStatus('文档已保存，原文件可在历史版本中恢复。'); })}>接受并保存文档</button>
      <button className="btn sm" disabled={!dirty || working} onClick={() => { setChanged(null); setText(entry?.text ?? ''); }}>放弃文档草稿</button>
      <button className="btn sm" disabled={working || dirty} onClick={() => void load()}>重新读取文档</button></div>
    {busy ? <p className="hint">请等待任务结束后保存文档。</p> : null}
    {snapshot?.versions.length ? <div className="artifact-editor-toolbar"><select aria-label="文档历史版本" value={version} onChange={e => setVersion(e.target.value)}><option value="">选择历史版本</option>{snapshot.versions.map(v => <option key={v.hash} value={v.hash}>{new Date(v.at).toLocaleString()} · {v.hash.slice(0, 6)}</option>)}</select><button className="btn sm" disabled={!version || dirty || working || busy} onClick={() => void action(async () => { await accept(await desktop()!.artifactBinary('restore', { path: snapshot.path, expectedHash: snapshot.hash, version })); onSaved(); setStatus('已恢复文档版本。'); })}>恢复文档版本</button><span className="hint">保留最近 10 个内容版本</span></div> : null}
  </div>;
}
