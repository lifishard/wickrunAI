import React from 'react';
import { parseArtifactProposal, applyArtifactProposals, type ArtifactProposal } from '../lib/artifact-proposal';
export type ProposeArtifactEdit = (content: string, instruction: string, signal: AbortSignal) => Promise<string>;
export default function ArtifactAiEdit({ source, start, end, onPropose, onApply }: {
  source: string; start: number; end: number; onPropose: ProposeArtifactEdit; onApply: (text: string) => void;
}) {
  const [instruction, setInstruction] = React.useState('');
  const [edits, setEdits] = React.useState<ArtifactProposal[]>([]);
  const [decisions, setDecisions] = React.useState<Record<number, boolean>>({});
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const controller = React.useRef<AbortController | null>(null);
  const origin = React.useRef('');
  const selected = source.slice(start, end);
  React.useEffect(() => () => controller.current?.abort(), []);
  const generate = async () => {
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    setLoading(true); setError(''); setEdits([]); setDecisions({}); origin.current = source;
    try {
      const raw = await onPropose(selected, instruction, abort.signal);
      if (abort.signal.aborted) return;
      setEdits(parseArtifactProposal(raw, selected).map(e => ({ ...e, start: start + e.start, end: start + e.end })));
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); }
    finally { if (controller.current === abort) setLoading(false); }
  };
  return <section className="artifact-ai-edit" aria-label="AI 局部修改">
    <p className="hint">已选中 {selected.length} 个字符。AI 只提出建议，由你逐项决定。</p>
    <textarea aria-label="局部修改要求" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例如：更简洁，保留数字与结论" />
    <div className="artifact-editor-toolbar"><button className="btn sm" disabled={loading || !selected || !instruction.trim()} onClick={() => void generate()}>生成修改建议</button>{loading ? <button className="btn sm" onClick={() => { controller.current?.abort(); setLoading(false); }}>取消生成</button> : null}</div>
    {error ? <p role="alert">{error}</p> : null}
    {edits.map((e, i) => <div className="artifact-change" key={i}><div className="artifact-change-before"><strong>修改前</strong><pre>{e.before}</pre></div><div className="artifact-change-after"><strong>修改后</strong><pre>{e.after}</pre></div>
      <div className="artifact-editor-toolbar"><button className="btn sm" aria-pressed={decisions[i] === true} onClick={() => setDecisions(d => ({ ...d, [i]: true }))}>接受第 {i + 1} 项</button><button className="btn sm" aria-pressed={decisions[i] === false} onClick={() => setDecisions(d => ({ ...d, [i]: false }))}>拒绝第 {i + 1} 项</button></div></div>)}
    {edits.length ? <button className="btn sm primary" disabled={loading || !edits.some((_, i) => decisions[i] === true) || source !== origin.current} onClick={() => {
      try { onApply(applyArtifactProposals(source, edits.filter((_, i) => decisions[i] === true))); setEdits([]); setDecisions({}); } catch (e) { setError(String(e)); }
    }}>应用已接受的修改到草稿</button> : null}
    {edits.length > 0 && source !== origin.current ? <p role="alert">草稿已变化，请重新生成建议。</p> : null}
  </section>;
}
