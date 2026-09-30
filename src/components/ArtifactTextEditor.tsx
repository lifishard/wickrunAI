import React from 'react';
import { desktop } from '../lib/transport';
import { replaceArtifactSelection, artifactSourceOffset, applyArtifactTextareaChange, type ArtifactSnapshot } from '../lib/artifact-edit';
import Markdown from './Markdown';
import ArtifactAiEdit, { type ProposeArtifactEdit } from './ArtifactAiEdit';
import { findArtifactSelection } from '../lib/artifact-proposal';
import CopyablePre from './CopyablePre';

// Keep unsaved edits when the user closes or switches the preview within this session.
const drafts = new Map<string, { text: string; hash: string }>();
export default function ArtifactTextEditor({ path, markdown, busy, onRequestEdit, onPropose }: {
  path: string; markdown: boolean; busy: boolean; onRequestEdit: (prompt: string) => void; onPropose: ProposeArtifactEdit;
}) {
  const [snapshot, setSnapshot] = React.useState<ArtifactSnapshot | null>(null);
  const [draft, setDraft] = React.useState(drafts.get(path)?.text ?? '');
  const [baseHash, setBaseHash] = React.useState(drafts.get(path)?.hash ?? '');
  const [mode, setMode] = React.useState<'preview' | 'edit' | 'history'>('preview');
  const [selected, setSelected] = React.useState({ start: 0, end: 0 });
  const [replacement, setReplacement] = React.useState('');
  const [version, setVersion] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [error, setError] = React.useState('');
  const editor = React.useRef<HTMLTextAreaElement>(null);
  const [undo, setUndo] = React.useState<{ before: string; after: string } | null>(null);
  const blocks = React.useMemo(() => [{start:0,raw:draft}], [draft]);
  const captureSelection = (root: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const blockOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-artifact-block]');
    const first = blockOf(range.startContainer), last = blockOf(range.endContainer);
    if (!first || first !== last || !root.contains(first)) { setStatus('跨段选区请在「编辑文本」中选择，以准确限定修改范围。'); return; }
    const block = blocks[Number(first.dataset.artifactBlock)];
    const found = findArtifactSelection(block.raw, selection.toString());
    if (!found) { setStatus('这段选区含重复文字或跨越格式标记，请在「编辑文本」中精确选择。'); return; }
    setSelected({ start: block.start + found.start, end: block.start + found.end }); setStatus('已选中预览文字，可在下方提出修改要求。');
  };
  const dirty = snapshot ? draft !== snapshot.text : drafts.has(path);
  const conflict = !!snapshot && baseHash !== snapshot.hash;
  const setContent = (text: string) => { setDraft(text); drafts.set(path, { text, hash: baseHash }); setStatus(''); };
  const accept = (s: ArtifactSnapshot) => { setSnapshot(s); setDraft(s.text); setBaseHash(s.hash); drafts.delete(path); setSelected({ start: 0, end: 0 }); setVersion(''); };
  React.useEffect(() => {
    let disposed = false;
    void desktop()!.artifactEdit('read', { path }).then(s => {
      if (disposed) return;
      setSnapshot(s);
      if (!drafts.has(path)) { setDraft(s.text); setBaseHash(s.hash); }
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; };
  }, [path]);
  const action = async (fn: () => Promise<void>) => {
    setWorking(true); setError(''); setStatus('');
    try { await fn(); } catch (e) { setError(String(e)); } finally { setWorking(false); }
  };
  const chosen = snapshot?.versions.find(v => v.hash === version);
  return <div className="artifact-editor">
    <div className="artifact-editor-toolbar">
      {(['preview', 'edit', 'history'] as const).map((m, i) => <button key={m} className={`btn sm ${mode === m ? 'primary' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>{['预览', '编辑文本', '历史版本'][i]}</button>)}
      <span className="hint">{dirty ? '未保存 · 草稿保留到退出应用' : snapshot ? '已保存' : '读取中…'}</span>
    </div>
    {error ? <p className="picker-error" role="alert">{error}</p> : null}
    {status ? <p role="status">{status}</p> : null}
    {conflict ? <p role="alert">磁盘内容已变化。草稿保留如下，请对照最新内容，合并后再保存。</p> : null}
    {mode === 'preview' ? <div className="artifact-md" onMouseUp={e => captureSelection(e.currentTarget)} onKeyUp={e => captureSelection(e.currentTarget)}>{blocks.map((block, i) => <div key={i} data-artifact-block={i}>{markdown ? <Markdown text={block.raw} copyText /> : <CopyablePre className="artifact-source" text={block.raw} />}</div>)}</div> : null}
    {mode === 'edit' ? <>
      <label className="hint" htmlFor="artifact-text-editor">可直接编辑全文，或选中文字后在下方替换。</label>
      <textarea id="artifact-text-editor" ref={editor} className="artifact-textarea" value={draft} disabled={!snapshot || working} onChange={e => { setContent(applyArtifactTextareaChange(draft, e.target.value)); setSelected({ start: 0, end: 0 }); }} onSelect={e => setSelected({ start: artifactSourceOffset(draft, e.currentTarget.selectionStart), end: artifactSourceOffset(draft, e.currentTarget.selectionEnd) })} spellCheck={false} />
      <label className="hint" htmlFor="artifact-replacement">{selected.end > selected.start ? `已选中 ${selected.end - selected.start} 个字符` : '请先在上方选中要修改的文字'}</label>
      <textarea id="artifact-replacement" aria-label="替换内容" className="artifact-replacement" value={replacement} onChange={e => setReplacement(e.target.value)} placeholder="输入替换内容；留空表示删除选中部分" />
      <div className="artifact-editor-toolbar">
        <button className="btn sm" disabled={working || selected.end <= selected.start} onClick={() => { setContent(replaceArtifactSelection(draft, selected.start, selected.end, replacement)); setSelected({ start: 0, end: 0 }); setReplacement(''); setStatus('已替换到草稿，保存后才会修改文件。'); }}>替换选中内容</button>
        <button className="btn sm" disabled={working || dirty || conflict || selected.end <= selected.start} title={dirty ? '请先保存草稿，再让 AI 修改文件' : '将选中文字带入对话，补充要求后发送'} onClick={() => onRequestEdit(`请局部修改文件 ${snapshot!.path}。先读取文件核对内容，只修改下列选中段落，保留其余内容。\n\n选中内容：\n${draft.slice(selected.start, selected.end)}\n\n修改要求：`)}>带入对话修改</button>
      </div>
    </> : null}
    {mode !== 'history' && selected.end > selected.start ? <ArtifactAiEdit key={`${selected.start}:${selected.end}`} source={draft} start={selected.start} end={selected.end} onPropose={onPropose} onApply={text => { setUndo({ before: draft, after: text }); setContent(text); setSelected({ start: 0, end: 0 }); setStatus('已应用到草稿。检查预览后保存，AI 修改会和其他编辑一样保留历史版本。'); }} /> : null}
    {undo && draft === undo.after ? <button className="btn sm" onClick={() => { setContent(undo.before); setUndo(null); setSelected({ start: 0, end: 0 }); }}>撤销本次 AI 草稿修改</button> : null}
    {mode === 'history' ? <div className="artifact-history">
      <p className="hint">保留最近 20 个不同内容版本（含当前文件），手动和 AI 建议在这里保存后都会留下记录。</p>
      <select aria-label="历史版本" value={version} onChange={e => setVersion(e.target.value)}><option value="">当前文件</option>{snapshot?.versions.map(v => <option value={v.hash} key={v.hash}>{new Date(v.at).toLocaleString()} · {v.hash.slice(0, 6)}</option>)}</select>
      <CopyablePre className="artifact-source" text={chosen?.text ?? snapshot?.text ?? ''} />
      <button className="btn sm" disabled={!chosen || working || busy || dirty || conflict} onClick={() => void action(async () => { accept(await desktop()!.artifactEdit('restore', { path: snapshot!.path, expectedHash: snapshot!.hash, version })); setStatus('已恢复。恢复前的内容仍可在历史版本中找回。'); })}>恢复此版本</button>
      {dirty ? <p className="hint">请先保存或放弃草稿，再恢复版本。</p> : null}
    </div> : null}
    <div className="artifact-editor-toolbar">
      <button className="btn sm primary" disabled={!snapshot || !dirty || working || busy || conflict} onClick={() => void action(async () => { accept(await desktop()!.artifactEdit('save', { path: snapshot!.path, expectedHash: baseHash, text: draft })); setStatus('已保存文件，原内容已保留在历史版本中。'); })}>保存文件</button>
      <button className="btn sm" disabled={working} onClick={() => void action(async () => { const s = await desktop()!.artifactEdit('read', { path }); setSnapshot(s); if (!dirty) accept(s); setMode('history'); setVersion(''); setStatus(dirty ? '已读取磁盘内容。草稿保留在「编辑文本」中。' : '已重新读取文件。'); })}>重新读取</button>
      {dirty && snapshot ? <button className="btn sm" disabled={working} onClick={() => { accept(snapshot); setStatus('已放弃草稿，显示最近读取的文件内容。'); }}>放弃草稿</button> : null}
      {conflict ? <button className="btn sm" disabled={working} onClick={() => { setBaseHash(snapshot!.hash); drafts.set(path, { text: draft, hash: snapshot!.hash }); setStatus('已确认合并；请检查草稿后保存。'); }}>已对照，使用合并后的草稿</button> : null}
      {busy ? <span className="hint">任务运行期间可编辑草稿，结束后再保存。</span> : null}
    </div>
  </div>;
}
