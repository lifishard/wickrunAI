import React from 'react';
import type { AppSettings } from '../../types';
import { useT } from '../../lib/i18n';
import { collaborationCall, type SharedItem, type SharedSpace } from '../../lib/shared-resources';
import {
  readBoard, newTask, editTask, taskVerdicts, taskState, boardProgress, verdictPermissions,
  aiVerdictPrompt, parseAiVerdict, AI_VERDICT_SYSTEM, breakdownPrompt, parseBreakdown, BREAKDOWN_SYSTEM,
  STATUS_LABELS, type BoardPayload, type BoardTask, type BoardVerdict, type BoardStatus, type VerdictRole,
} from '../../lib/project-board';

type ModelChoice = { profileId: string; model: string };
type BoardItem = SharedItem & { verdicts?: BoardVerdict[] };
type View = { item: BoardItem; role: string };
type Me = { id: string; email?: string; name?: string } | null | undefined;
type Props = {
  settings: AppSettings; me: Me; spaces: SharedSpace[]; items: SharedItem[];
  onRefresh: () => Promise<void>;
  onAI?: (prompt: string, system: string, signal: AbortSignal, choice: ModelChoice) => Promise<string>;
};

const STATE_LABEL = { done: '已完成 · 双人确认', 'awaiting-reviewer': '待验收人确认', 'awaiting-assignee': '待负责人确认', returned: '已退回', open: '' } as const;
const VERDICT_LABEL: Record<string, string> = { pass: '通过', fail: '未通过', unverifiable: '无法判断', reject: '退回' };
const ROLE_LABEL: Record<VerdictRole, string> = { ai: 'AI 判定', assignee: '负责人确认', reviewer: '验收人确认' };
const day = (ms?: number | null) => ms ? new Date(ms).toLocaleDateString() : '';
const when = (ms?: number) => ms ? new Date(ms).toLocaleString() : '';
const errText = (e: unknown) => e instanceof Error ? e.message : String(e);
const toDateInput = (ms?: number | null) => ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';
const fromDateInput = (value: string) => value ? new Date(`${value}T18:00:00`).getTime() : null;
const email = (value: string) => value.trim().toLowerCase();

function VerdictCell({ verdict, empty }: { verdict?: BoardVerdict; empty: string }) {
  const t = useT();
  if (!verdict) return <span className="board-verdict none">{t(empty)}</span>;
  return <span className={`board-verdict ${verdict.verdict}`} title={`${verdict.actorName ?? ''}${verdict.model ? ` · ${verdict.model}` : ''} · ${when(verdict.at)}${verdict.note ? `\n${verdict.note}` : ''}`}>
    {t(VERDICT_LABEL[verdict.verdict] ?? verdict.verdict)}<small>{verdict.role === 'ai' ? verdict.model : verdict.actorName}</small>
  </span>;
}

export default function ProjectBoards({ settings, me, spaces, items, onRefresh, onAI }: Props) {
  const t = useT();
  const boards = items.filter(i => i.kind === ('board' as SharedItem['kind']));
  const [selectedId, setSelectedId] = React.useState('');
  const [view, setView] = React.useState<View | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [newTitle, setNewTitle] = React.useState('');
  const [newGoal, setNewGoal] = React.useState('');
  const [newSpace, setNewSpace] = React.useState('');
  const [taskTitle, setTaskTitle] = React.useState('');
  const [openTask, setOpenTask] = React.useState('');
  const [draft, setDraft] = React.useState<BoardTask | null>(null);
  const [note, setNote] = React.useState('');
  const [delivered, setDelivered] = React.useState('');
  const [proposals, setProposals] = React.useState<{ title: string; acceptance: string }[]>([]);
  const [goalDraft, setGoalDraft] = React.useState<string | null>(null);
  const models = React.useMemo(() => settings.keyProfiles.filter(p => p.hasSecret !== false).flatMap(profile => {
    const known = [...(settings.cachedModels[profile.id] ?? []), ...(settings.customModels[profile.id] ?? [])].map(m => m.id);
    if (profile.id === settings.activeKeyProfileId && settings.defaultConfig.model) known.unshift(settings.defaultConfig.model);
    return [...new Set(known)].map(model => ({ profileId: profile.id, model, label: `${model} · ${profile.name}` }));
  }), [settings]);
  const [modelKey, setModelKey] = React.useState('');
  const choice: ModelChoice | null = modelKey ? JSON.parse(modelKey) : models[0] ? { profileId: models[0].profileId, model: models[0].model } : null;
  const ai = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => ai.current?.abort(), []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const open = React.useCallback(async (id: string) => {
    const result = await collaborationCall<View>('get', { itemId: id });
    setView(result); setSelectedId(id); setGoalDraft(null);
  }, []);
  React.useEffect(() => { if (!selectedId && boards[0]) void open(boards[0].id).catch(e => setError(errText(e))); }, [boards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const board: BoardPayload = view ? readBoard(view.item.payload) : { goal: '', tasks: [] };
  const verdicts = view?.item.verdicts ?? [];
  const progress = boardProgress(board, verdicts);
  const canEdit = !!view && ['editor', 'owner', 'admin'].includes(view.role);

  async function save(next: BoardPayload) {
    if (!view) return;
    try {
      const result = await collaborationCall<View>('update', { itemId: view.item.id, expectedRevision: view.item.revision, title: view.item.title, payload: next });
      setView(result);
    } catch (e) {
      if (/changed|已改变|409/.test(errText(e))) { await open(view.item.id); throw Error(t('项目刚被其他人更新，已载入最新内容，请再操作一次。')); }
      throw e;
    }
  }
  async function create() {
    const space = spaces.find(s => s.id === newSpace);
    const result = await collaborationCall<{ item: SharedItem }>('create', { kind: 'board', title: newTitle.trim() || t('新项目'), payload: { goal: newGoal.trim(), tasks: [] }, encrypt: false, ...(space ? { spaceId: space.id } : {}) });
    setCreating(false); setNewTitle(''); setNewGoal('');
    await onRefresh(); await open(result.item.id);
  }
  async function addTasks(rows: { title: string; acceptance?: string }[]) {
    const now = Date.now();
    const added = rows.filter(r => r.title.trim()).map((r, i) => ({ ...newTask(r.title, now + i), ...(r.acceptance ? { acceptance: r.acceptance } : {}), ...(me?.email ? { reviewer: email(me.email), reviewerName: me.name } : {}), order: board.tasks.length + i }));
    if (added.length) await save({ ...board, tasks: [...board.tasks, ...added] });
  }
  async function saveTask(task: BoardTask) {
    const old = board.tasks.find(x => x.id === task.id);
    if (!old) return;
    const next = editTask(old, task);
    await save({ ...board, tasks: board.tasks.map(x => x.id === task.id ? next : x) });
    setDraft(null);
  }
  async function verdict(task: BoardTask, role: VerdictRole, value: string, extra: { note?: string; model?: string; evidence?: string[] } = {}) {
    if (!view) return;
    const result = await collaborationCall<View>('boardVerdict', { itemId: view.item.id, verdict: { taskId: task.id, taskRev: task.rev, role, verdict: value, ...(extra.note?.trim() ? { note: extra.note.trim() } : {}), ...(extra.model ? { model: extra.model } : {}), ...(extra.evidence?.length ? { evidence: extra.evidence } : {}) } });
    setView(result); setNote('');
    // Both people approved: show it as done for everyone.
    const fresh = readBoard(result.item.payload).tasks.find(x => x.id === task.id);
    if (fresh && taskState(fresh, (result.item as BoardItem).verdicts) === 'done' && fresh.status !== 'done' && ['editor', 'owner', 'admin'].includes(result.role)) {
      const latest = readBoard(result.item.payload);
      const updated = await collaborationCall<View>('update', { itemId: result.item.id, expectedRevision: result.item.revision, title: result.item.title, payload: { ...latest, tasks: latest.tasks.map(x => x.id === task.id ? { ...x, status: 'done', progress: 100 } : x) } });
      setView(updated);
    }
  }
  async function aiJudge(task: BoardTask) {
    if (!onAI || !choice) throw Error(t('请先在设置里配置一个可用的 API 模型。'));
    const evidenceText = [delivered.trim(), ...(task.links ?? []).map(l => l.kind === 'text' ? l.ref : `${l.label ?? l.kind}: ${l.ref}`)].filter(Boolean).join('\n\n');
    if (!evidenceText) throw Error(t('先写下交付内容或附上成果链接，AI 才有依据判断。'));
    ai.current?.abort(); const controller = new AbortController(); ai.current = controller;
    const raw = await onAI(aiVerdictPrompt(board.goal, task, evidenceText), AI_VERDICT_SYSTEM, controller.signal, choice);
    const parsed = parseAiVerdict(raw);
    if (delivered.trim() && !(task.links ?? []).some(l => l.kind === 'text' && l.ref === delivered.trim())) {
      const withEvidence = editTask(task, { links: [...(task.links ?? []), { kind: 'text', ref: delivered.trim().slice(0, 20000), label: t('交付说明') }] });
      await save({ ...board, tasks: board.tasks.map(x => x.id === task.id ? withEvidence : x) });
      // Adding evidence does not change what the task asks for, so the revision is unchanged.
      task = withEvidence;
    }
    await verdict(task, 'ai', parsed.verdict, { note: parsed.note, model: choice.model, evidence: parsed.evidence });
    setDelivered('');
  }
  async function breakdown() {
    if (!onAI || !choice) throw Error(t('请先在设置里配置一个可用的 API 模型。'));
    if (!board.goal.trim()) throw Error(t('先写下项目目标。'));
    ai.current?.abort(); const controller = new AbortController(); ai.current = controller;
    setProposals(parseBreakdown(await onAI(breakdownPrompt(board), BREAKDOWN_SYSTEM, controller.signal, choice)));
  }

  const log = [...verdicts].sort((a, b) => b.at - a.at).slice(0, 40);
  return <div className="board-layout">
    <aside className="board-rail">
      <div className="share-rail-head"><h2>{t('项目')}</h2><button className="btn sm" onClick={() => setCreating(v => !v)}>{t('新建项目')}</button></div>
      {creating && <form className="board-create" onSubmit={e => { e.preventDefault(); void run(create); }}>
        <input placeholder={t('项目名称')} value={newTitle} onChange={e => setNewTitle(e.target.value)} />
        <textarea placeholder={t('目标：这个项目要达成什么、怎样算完成')} rows={3} value={newGoal} onChange={e => setNewGoal(e.target.value)} />
        <label>{t('放在空间')}<select value={newSpace} onChange={e => setNewSpace(e.target.value)}><option value="">{t('仅自己（之后可邀请）')}</option>{spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <small className="share-muted">{t('项目看板由服务器校验谁能验收，因此不做端到端加密；不要写入密钥或密码。')}</small>
        <button className="btn primary" disabled={busy}>{t('创建')}</button>
      </form>}
      <div className="share-item-list">{boards.map(b => <button key={b.id} className={selectedId === b.id ? 'active' : ''} onClick={() => void run(() => open(b.id))}><strong>{b.title}</strong><small>{spaces.find(s => s.id === b.spaceId)?.name ?? t('仅自己')}</small></button>)}
        {!boards.length && !creating && <p className="share-muted">{t('还没有项目。新建一个，写下目标，把它拆成任务，邀请成员一起推进。')}</p>}</div>
    </aside>
    <section className="board-main">
      {error && <p role="alert" className="board-error">{error}</p>}
      {!view ? <div className="share-empty"><h2>{t('选择或新建一个项目')}</h2><p>{t('每个任务都有负责人和验收人：AI 可以给出判定，完成要由两个人确认。')}</p></div> : <>
        <header className="board-head">
          <div><h2>{view.item.title}</h2>
            {goalDraft === null
              ? <p className="board-goal" onClick={() => canEdit && setGoalDraft(board.goal)}>{board.goal || t(canEdit ? '点这里写下项目目标' : '还没有写目标')}</p>
              : <div className="board-goal-edit"><textarea rows={3} value={goalDraft} onChange={e => setGoalDraft(e.target.value)} /><div className="share-actions"><button className="btn sm primary" disabled={busy} onClick={() => void run(async () => { await save({ ...board, goal: goalDraft.trim() }); setGoalDraft(null); })}>{t('保存')}</button><button className="btn sm ghost" onClick={() => setGoalDraft(null)}>{t('取消')}</button></div></div>}
          </div>
          <div className="board-progress" title={t('{done}/{total} 项已由两人确认完成；AI 判定通过 {ai} 项', { done: String(progress.done), total: String(progress.total), ai: String(progress.aiPassed) })}>
            <strong>{progress.percent}%</strong><span>{t('{done}/{total} 已完成', { done: String(progress.done), total: String(progress.total) })}</span>
            <div className="board-bar"><i style={{ width: `${progress.percent}%` }} /></div>
            <small>{t('AI 判定通过 {n} 项', { n: String(progress.aiPassed) })}</small>
          </div>
        </header>
        <div className="board-tools">
          {onAI && models.length > 0 && <label className="board-model">{t('AI 模型')}<select value={modelKey || (choice ? JSON.stringify(choice) : '')} onChange={e => setModelKey(e.target.value)}>{models.map(m => <option key={JSON.stringify([m.profileId, m.model])} value={JSON.stringify({ profileId: m.profileId, model: m.model })}>{m.label}</option>)}</select></label>}
          {canEdit && onAI && <button className="btn sm" disabled={busy || !choice} onClick={() => void run(breakdown)}>{t('让 AI 拆解目标')}</button>}
          <button className="btn sm ghost" disabled={busy} onClick={() => void run(() => open(view.item.id))}>{t('刷新')}</button>
        </div>
        {proposals.length > 0 && <div className="board-proposals"><strong>{t('AI 建议的任务（选中后加入）')}</strong>
          {proposals.map((p, i) => <label key={i}><input type="checkbox" defaultChecked data-index={i} /> <span>{p.title}</span><small>{p.acceptance}</small></label>)}
          <div className="share-actions"><button className="btn sm primary" disabled={busy} onClick={e => { const box = (e.currentTarget.closest('.board-proposals') as HTMLElement); const picked = proposals.filter((_, i) => (box.querySelector(`input[data-index="${i}"]`) as HTMLInputElement)?.checked); void run(async () => { await addTasks(picked); setProposals([]); }); }}>{t('加入选中的任务')}</button><button className="btn sm ghost" onClick={() => setProposals([])}>{t('不要了')}</button></div>
        </div>}
        <table className="board-table">
          <thead><tr><th>{t('任务')}</th><th>{t('负责人')}</th><th>{t('验收人')}</th><th>{t('截止')}</th><th>{t('状态')}</th><th>{t('AI 判定')}</th><th>{t('负责人确认')}</th><th>{t('验收人确认')}</th></tr></thead>
          <tbody>{board.tasks.map(task => {
            const v = taskVerdicts(task, verdicts), state = taskState(task, verdicts), overdue = !!task.dueAt && task.dueAt < Date.now() && state !== 'done';
            const allowed = verdictPermissions(task, verdicts, me, view.role);
            const expanded = openTask === task.id;
            return <React.Fragment key={task.id}>
              <tr className={`board-row state-${state}${expanded ? ' expanded' : ''}`} aria-expanded={expanded} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }} onClick={() => { setOpenTask(expanded ? '' : task.id); setDraft(null); setNote(''); setDelivered(''); }}>
                <td><strong>{task.title}</strong>{task.agent && <small className="board-agent">{t('由 {agent} 执行', { agent: task.agent })}</small>}</td>
                <td data-label={t('负责人')}>{task.assigneeName || task.assignee || <span className="share-muted">{t('未指定')}</span>}</td>
                <td data-label={t('验收人')}>{task.reviewerName || task.reviewer || <span className="share-muted">{t('未指定')}</span>}</td>
                <td data-label={t('截止')} className={overdue ? 'board-overdue' : ''}>{day(task.dueAt) || '—'}</td>
                <td data-label={t('状态')}>{state === 'open' ? t(STATUS_LABELS[task.status]) : t(STATE_LABEL[state])}{typeof task.progress === 'number' && state !== 'done' ? <small> · {task.progress}%</small> : null}</td>
                <td data-label={t('AI 判定')}><VerdictCell verdict={v.ai} empty="未判定" /></td>
                <td data-label={t('负责人确认')}><VerdictCell verdict={v.assignee} empty="待确认" /></td>
                <td data-label={t('验收人确认')}><VerdictCell verdict={v.reviewer} empty="待验收" /></td>
              </tr>
              {expanded && <tr className="board-detail"><td colSpan={8}>
                {draft?.id === task.id && canEdit ? <form className="board-edit" onSubmit={e => { e.preventDefault(); void run(() => saveTask(draft)); }}>
                  <label>{t('任务')}<input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
                  <label>{t('说明')}<textarea rows={2} value={draft.detail ?? ''} onChange={e => setDraft({ ...draft, detail: e.target.value })} /></label>
                  <label>{t('验收标准')}<textarea rows={2} value={draft.acceptance ?? ''} onChange={e => setDraft({ ...draft, acceptance: e.target.value })} /></label>
                  <div className="board-edit-row">
                    <label>{t('负责人邮箱')}<input type="email" value={draft.assignee ?? ''} onChange={e => setDraft({ ...draft, assignee: email(e.target.value) })} /></label>
                    <label>{t('负责人名称')}<input value={draft.assigneeName ?? ''} onChange={e => setDraft({ ...draft, assigneeName: e.target.value })} /></label>
                    <label>{t('执行的 AI（可选）')}<input value={draft.agent ?? ''} placeholder={t('例如 grok-4.7 或 Agent 团队')} onChange={e => setDraft({ ...draft, agent: e.target.value })} /></label>
                  </div>
                  <div className="board-edit-row">
                    <label>{t('验收人邮箱')}<input type="email" value={draft.reviewer ?? ''} onChange={e => setDraft({ ...draft, reviewer: email(e.target.value) })} /></label>
                    <label>{t('验收人名称')}<input value={draft.reviewerName ?? ''} onChange={e => setDraft({ ...draft, reviewerName: e.target.value })} /></label>
                    <label>{t('截止日期')}<input type="date" value={toDateInput(draft.dueAt)} onChange={e => setDraft({ ...draft, dueAt: fromDateInput(e.target.value) })} /></label>
                  </div>
                  <div className="board-edit-row">
                    <label>{t('状态')}<select value={draft.status === 'done' ? 'review' : draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as BoardStatus })}>{(['todo', 'doing', 'review', 'blocked'] as BoardStatus[]).map(s => <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>)}</select></label>
                    <label>{t('进度')}<input type="number" min={0} max={100} value={draft.progress ?? 0} onChange={e => setDraft({ ...draft, progress: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} /></label>
                  </div>
                  <small className="share-muted">{t('修改任务内容、负责人或验收人后，之前的确认只对旧版本有效，需要重新确认。')}</small>
                  <div className="share-actions"><button className="btn primary" disabled={busy}>{t('保存任务')}</button><button type="button" className="btn ghost" onClick={() => setDraft(null)}>{t('取消')}</button>
                    <button type="button" className="btn ghost danger" disabled={busy} onClick={() => void run(async () => { if (!window.confirm(t('删除这个任务？它的确认记录仍保留在修改历史里。'))) return; await save({ ...board, tasks: board.tasks.filter(x => x.id !== task.id) }); setOpenTask(''); })}>{t('删除任务')}</button></div>
                </form> : <div className="board-task-view">
                  {task.detail && <p>{task.detail}</p>}
                  <p><strong>{t('验收标准')}：</strong>{task.acceptance || t('（未写，默认以任务名称为准）')}</p>
                  {(task.links ?? []).length > 0 && <ul className="board-links">{task.links!.map((l, i) => <li key={i}>{l.kind === 'url' ? <a href={l.ref} target="_blank" rel="noreferrer">{l.label || l.ref}</a> : <><strong>{t(l.label || '交付说明')}</strong><span>{l.ref.slice(0, 400)}{l.ref.length > 400 ? '…' : ''}</span></>}</li>)}</ul>}
                  {canEdit && <div className="share-actions"><button className="btn sm" onClick={() => setDraft({ ...task })}>{t('编辑任务')}</button></div>}
                </div>}
                <div className="board-verdict-actions">
                  {allowed.ai && onAI && <div className="board-ai"><textarea rows={3} placeholder={t('交付内容：粘贴成果、说明做了什么，或附上链接（AI 只依据这里和已附的成果判断）')} value={delivered} onChange={e => setDelivered(e.target.value)} />
                    <button className="btn sm" disabled={busy || !choice} onClick={() => void run(() => aiJudge(task))}>{t('让 AI 判定')}</button></div>}
                  {(allowed.assignee || allowed.reviewer) && <div className="board-human">
                    <input placeholder={t('说明（可选）')} value={note} onChange={e => setNote(e.target.value)} />
                    {allowed.assignee && <><button className="btn sm primary" disabled={busy} onClick={() => void run(() => verdict(task, 'assignee', 'pass', { note }))}>{t('负责人：确认完成')}</button><button className="btn sm ghost" disabled={busy} onClick={() => void run(() => verdict(task, 'assignee', 'reject', { note }))}>{t('负责人：撤回')}</button></>}
                    {allowed.reviewer && <><button className="btn sm primary" disabled={busy || v.assignee?.verdict !== 'pass'} title={v.assignee?.verdict !== 'pass' ? t('负责人确认后才能验收') : ''} onClick={() => void run(() => verdict(task, 'reviewer', 'pass', { note }))}>{t('验收人：通过')}</button><button className="btn sm ghost" disabled={busy} onClick={() => void run(() => verdict(task, 'reviewer', 'reject', { note }))}>{t('验收人：退回修改')}</button></>}
                  </div>}
                  {!allowed.ai && !allowed.assignee && !allowed.reviewer && <p className="share-muted">{t('只有负责人、验收人和有编辑权限的成员能对这个任务给出判定。')}</p>}
                </div>
                {v.history.length > 0 && <ol className="board-history">{[...v.history].reverse().map(h => <li key={h.id} className={h.taskRev !== task.rev ? 'stale' : ''}>
                  <span>{when(h.at)}</span><strong>{t(ROLE_LABEL[h.role])} · {t(VERDICT_LABEL[h.verdict] ?? h.verdict)}</strong>
                  <span>{h.actorName}{h.actorEmail ? ` <${h.actorEmail}>` : ''}{h.model ? ` · ${t('模型')} ${h.model}` : ''}{h.taskRev !== task.rev ? ` · ${t('针对旧版本')}` : ''}</span>
                  {h.note && <p>{h.note}</p>}</li>)}</ol>}
              </td></tr>}
            </React.Fragment>;
          })}
          {!board.tasks.length && <tr><td colSpan={8} className="share-muted">{t('还没有任务。写下目标后，可以手动添加，或让 AI 拆解。')}</td></tr>}
          </tbody>
        </table>
        {canEdit && <form className="board-add" onSubmit={e => { e.preventDefault(); const value = taskTitle; setTaskTitle(''); void run(() => addTasks([{ title: value }])); }}>
          <input placeholder={t('添加任务，回车保存')} value={taskTitle} onChange={e => setTaskTitle(e.target.value)} /><button className="btn sm" disabled={busy || !taskTitle.trim()}>{t('添加')}</button>
        </form>}
        {log.length > 0 && <details className="board-log"><summary>{t('判定记录（{n}）', { n: String(verdicts.length) })}</summary><ol>{log.map(h => <li key={h.id}><span>{when(h.at)}</span><strong>{board.tasks.find(x => x.id === h.taskId)?.title ?? t('已删除的任务')}</strong><span>{t(ROLE_LABEL[h.role])} · {t(VERDICT_LABEL[h.verdict] ?? h.verdict)} · {h.actorName}{h.model ? ` · ${h.model}` : ''}</span></li>)}</ol></details>}
      </>}
    </section>
  </div>;
}
