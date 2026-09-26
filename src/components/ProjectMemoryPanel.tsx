import React from 'react';
import { useT } from '../lib/i18n';
import {
  MEMORY_KINDS, MEMORY_KIND_LABEL, activeItems, addMemory, candidateItems, forgetMemory, searchMemory, updateMemory,
  type MemoryKind, type MemorySource, type ProjectMemoryItem,
} from '../lib/memory-core';

const SOURCE_LABEL: Record<MemorySource, string> = {
  user: '你写的', model: '模型记的', correction: '来自纠错', candidate: '你批准的候选', legacy: '旧版记忆', client: '本机客户端提交',
};

/**
 * 项目记忆：一条一条管。可以加、改、换类型、置顶、删除；候选（从你的话里提炼的、
 * 本机客户端提交的）要你批准才会用到。删除会同步到其他设备，同一句不会再被提议。
 */
export default function ProjectMemoryPanel({ items, onChange, detailed }: { items: ProjectMemoryItem[]; onChange: (next: ProjectMemoryItem[]) => void; /** 协作空间里默认展开适用条件与证据 */ detailed?: boolean }) {
  const t = useT();
  const [draft, setDraft] = React.useState('');
  const [kind, setKind] = React.useState<MemoryKind>('note');
  const [query, setQuery] = React.useState('');
  const [note, setNote] = React.useState('');
  const live = activeItems(items);
  const candidates = candidateItems(items);
  const shown = query.trim() ? searchMemory(items, query, 200) : [...live].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt);
  const apply = (result: { items: ProjectMemoryItem[]; error?: string; duplicate?: boolean; redacted?: boolean }) => {
    if (result.error) { setNote(t(result.error)); return false; }
    if (result.duplicate) { setNote(t('已经有这条记忆了。')); return false; }
    setNote(result.redacted ? t('像密钥或密码的内容已替换成 [REDACTED]。') : '');
    onChange(result.items);
    return true;
  };
  const add = () => { if (apply(addMemory(items, { text: draft, kind, source: 'user' }))) setDraft(''); };

  return <div className="project-memory">
    {candidates.length ? <div className="project-memory-candidates">
      <div className="field-label">{t('待你确认的记忆候选（{n}）', { n: candidates.length })}</div>
      <p className="hint">{t('从你说过的话里提炼的偏好和约定，或本机客户端提交的。批准后才会在对话里用到；忽略的不会再提。')}</p>
      {candidates.map(m => <MemoryRow key={m.id} item={m} candidate onChange={apply} items={items} detailed={detailed} />)}
    </div> : null}
    <div className="row project-memory-tools">
      <input type="search" value={query} placeholder={t('搜索记忆')} aria-label={t('搜索记忆')} onChange={e => setQuery(e.target.value)} />
      <span className="chip">{t('{n} 条', { n: live.length })}</span>
    </div>
    {shown.length ? shown.map(m => <MemoryRow key={m.id} item={m} onChange={apply} items={items} detailed={detailed} />) : <p className="hint">{t(query.trim() ? '没有匹配的记忆。' : '还没有记忆。')}</p>}
    <div className="project-memory-add">
      <textarea rows={2} value={draft} maxLength={1000} placeholder={t('记一条跨对话还成立的结论、约定或偏好')} aria-label={t('新记忆')} onChange={e => setDraft(e.target.value)} />
      <div className="row">
        <select value={kind} aria-label={t('记忆类型')} onChange={e => setKind(e.target.value as MemoryKind)}>
          {MEMORY_KINDS.map(k => <option key={k} value={k}>{t(MEMORY_KIND_LABEL[k])}</option>)}
        </select>
        <button className="btn sm" disabled={!draft.trim()} onClick={add}>{t('添加')}</button>
      </div>
    </div>
    {note ? <p className="hint" role="status">{note}</p> : null}
  </div>;
}

/** 回答下面的小卡片：这一轮从你的话里提炼出的候选，就地批准、改写或忽略 */
export function MemoryCandidateCard({ ids, items, onChange }: { ids: string[]; items: ProjectMemoryItem[]; onChange: (next: ProjectMemoryItem[]) => void }) {
  const t = useT();
  const [note, setNote] = React.useState('');
  const pending = candidateItems(items).filter(m => ids.includes(m.id));
  if (!pending.length) return note ? <p className="hint memory-candidate-card" role="status">{note}</p> : null;
  const apply = (result: { items: ProjectMemoryItem[]; error?: string; duplicate?: boolean; redacted?: boolean }) => {
    if (result.error) { setNote(t(result.error)); return false; }
    setNote(t('已更新项目记忆。'));
    onChange(result.items);
    return true;
  };
  return <div className="card memory-candidate-card">
    <div className="field-label">{t('要记进项目记忆吗？')}</div>
    <p className="hint">{t('从你这次说的话里发现的偏好或约定。批准后，这个项目以后的对话都会用到；不批准就不会用。')}</p>
    {pending.map(m => <MemoryRow key={m.id} item={m} candidate onChange={apply} items={items} />)}
  </div>;
}

function MemoryRow({ item, items, candidate, onChange, detailed }: {
  item: ProjectMemoryItem; items: ProjectMemoryItem[]; candidate?: boolean; detailed?: boolean;
  onChange: (result: { items: ProjectMemoryItem[]; error?: string; duplicate?: boolean; redacted?: boolean }) => boolean;
}) {
  const t = useT();
  const [text, setText] = React.useState(item.text);
  React.useEffect(() => setText(item.text), [item.text]);
  const date = new Date(item.updatedAt || item.createdAt).toLocaleDateString();
  return <div className={`card project-memory-item${item.pinned ? ' pinned' : ''}${candidate ? ' candidate' : ''}`}>
    <textarea rows={Math.min(4, Math.max(1, Math.ceil(text.length / 60)))} value={text} maxLength={1000} aria-label={t('记忆内容')}
      onChange={e => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== item.text) onChange(updateMemory(items, item.id, { text })); }} />
    <div className="row project-memory-meta">
      <select value={item.kind} aria-label={t('记忆类型')} onChange={e => onChange(updateMemory(items, item.id, { kind: e.target.value as MemoryKind }))}>
        {MEMORY_KINDS.map(k => <option key={k} value={k}>{t(MEMORY_KIND_LABEL[k])}</option>)}
      </select>
      <span className="hint">{t(SOURCE_LABEL[item.source])} · {date}{item.revision ? ` · v${item.revision}` : ''}{item.keywords?.length ? ` · ${t('限关键词')}` : ''}</span>
      <span className="spacer" />
      {candidate ? <>
        <button className="btn sm" onClick={() => onChange(updateMemory(items, item.id, { approve: true, text }))}>{t('批准')}</button>
        <button className="btn sm ghost" onClick={() => onChange(forgetMemory(items, item.id))}>{t('忽略')}</button>
      </> : <>
        <button className={`btn sm ghost${item.pinned ? ' active' : ''}`} aria-pressed={Boolean(item.pinned)} title={t('置顶的记忆总会放进对话')}
          onClick={() => onChange(updateMemory(items, item.id, { pinned: !item.pinned }))}>{t(item.pinned ? '已置顶' : '置顶')}</button>
        <button className="btn sm danger" onClick={() => onChange(forgetMemory(items, item.id))}>{t('删除')}</button>
      </>}
    </div>
    <MemoryDetails item={item} open={detailed && Boolean(item.applicability || item.evidence || item.keywords?.length)} onSave={patch => onChange(updateMemory(items, item.id, patch))} />
  </div>;
}

/** 适用条件、验证证据、关键词：写清楚的经验更可靠；关键词让这条只在相关任务里出现 */
function MemoryDetails({ item, open, onSave }: { item: ProjectMemoryItem; open?: boolean; onSave: (patch: { applicability?: string; evidence?: string; keywords?: string[] }) => boolean }) {
  const t = useT();
  const [applicability, setApplicability] = React.useState(item.applicability ?? '');
  const [evidence, setEvidence] = React.useState(item.evidence ?? '');
  const [keywords, setKeywords] = React.useState((item.keywords ?? []).join('，'));
  React.useEffect(() => { setApplicability(item.applicability ?? ''); setEvidence(item.evidence ?? ''); setKeywords((item.keywords ?? []).join('，')); }, [item.applicability, item.evidence, item.keywords]);
  const filled = [item.applicability, item.evidence, item.keywords?.length].filter(Boolean).length;
  return <details className="project-memory-details" open={open || undefined}>
    <summary>{t('适用条件、证据与关键词')}{filled ? ` · ${filled}/3` : ''}</summary>
    <label className="field-label">{t('适用条件与失败边界')}
      <textarea rows={2} value={applicability} maxLength={1000} onChange={e => setApplicability(e.target.value)}
        onBlur={() => { if (applicability.trim() !== (item.applicability ?? '')) onSave({ applicability }); }} /></label>
    <label className="field-label">{t('验证证据与来源')}
      <textarea rows={2} value={evidence} maxLength={1000} placeholder={t('实际测试或人工检查的结果；模型自评不算')} onChange={e => setEvidence(e.target.value)}
        onBlur={() => { if (evidence.trim() !== (item.evidence ?? '')) onSave({ evidence }); }} /></label>
    <label className="field-label">{t('只在出现这些词时使用（逗号分隔，留空为项目通用）')}
      <input value={keywords} onChange={e => setKeywords(e.target.value)}
        onBlur={() => { if (keywords.trim() !== (item.keywords ?? []).join('，')) onSave({ keywords: keywords.split(/[,，、]/) }); }} /></label>
  </details>;
}
