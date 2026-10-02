import type { ChatMessage, Conversation, RunRecord, RunState } from '../types';
import { desktop, getTransport } from './transport';
import { collectArtifacts } from './artifacts';
import { localProgress } from './task-context';
import { deliveryReport } from './delivery';
import { observeRun, reconcileObservations, removeObservations } from './observations';

const KEY = 'anyai:runs:v2';
const records = new Map<string, RunRecord>();
const forgotten = new Set<string>();
const forgottenConversations = new Set<string>();
let fallbackChain = Promise.resolve();
let revision = 0;
/** Changes whenever a run is hydrated, so memoised context previews know to recompute. */
export function runsRevision(): number { return revision; }
const hydrating = new Map<string, Promise<void>>();
const HEAVY_FIELDS = ['working', 'contextArchive', 'contextArchiveSteps', 'compactions'] as const;

/**
 * The desktop returns run summaries: everything but the model context
 * (working / contextArchive / …), which is ~95% of the bytes. Those fields are
 * read by id when a conversation is opened or a run is resumed.
 */
export async function loadRuns(): Promise<RunRecord[]> {
  const bridge = desktop();
  const list: RunRecord[] = bridge?.runList ? await bridge.runList()
    : JSON.parse(await getTransport().kvGet(KEY) || '[]');
  const previous = new Map(records);
  records.clear();
  for (const r of list) {
    if (!r.id || !r.state?.working) continue;
    // Keep a context that was already read, unless the run moved on since.
    const kept = previous.get(r.id);
    records.set(r.id, kept && !kept.state.slim && kept.state.at >= r.state.at ? kept : r);
  }
  await reconcileObservations([...records.values()]);
  return [...records.values()];
}
/** Run summaries for search and recall; does not touch the in-memory journal. */
export async function listRunRecords(): Promise<RunRecord[]> {
  const bridge = desktop();
  const list: RunRecord[] = bridge?.runList ? await bridge.runList() : JSON.parse(await getTransport().kvGet(KEY) || '[]');
  return list.filter((r) => r.id && r.state?.working);
}
/** Read the model context of these runs (no-op for runs that are already complete or unknown). */
export async function hydrateRuns(ids: string[]): Promise<void> {
  const bridge = desktop();
  if (!bridge?.runGet) return;
  const pending: Promise<void>[] = [];
  for (const id of new Set(ids)) {
    if (!id || !records.get(id)?.state.slim) continue;
    let job = hydrating.get(id);
    if (!job) {
      job = bridge.runGet(id).then((full) => {
        const current = records.get(id);
        if (full && current?.state.slim && !forgotten.has(id) && full.state.at >= current.state.at) { records.set(id, full); revision++; }
      }).finally(() => { hydrating.delete(id); });
      hydrating.set(id, job);
    }
    pending.push(job);
  }
  await Promise.all(pending);
}
/** Read the context of every run that belongs to a conversation (and its handoff source). */
export async function prepareConversationRuns(conversation: Conversation): Promise<void> {
  const ids = [...records.values()].filter((r) => r.conversationId === conversation.id).map((r) => r.id);
  if (conversation.handoffSourceRunId) ids.push(conversation.handoffSourceRunId);
  await hydrateRuns(ids);
}
/** Put a run's model context back into a summary-only state (resume, handoff). */
export async function fullRunState(state: RunState): Promise<RunState> {
  if (!state.slim) return state;
  if (!state.runId) throw new Error('这条执行记录缺少编号，无法恢复完整上下文');
  await hydrateRuns([state.runId]);
  const full = records.get(state.runId);
  if (!full || full.state.slim) throw new Error('执行记录的完整内容已不在本机，无法继续这个任务');
  return restoreHeavy(state, full.state);
}
function restoreHeavy(state: RunState, full: RunState): RunState {
  const next: RunState = { ...state };
  delete next.slim;
  for (const field of HEAVY_FIELDS) {
    if (full[field] === undefined) delete next[field];
    else (next as unknown as Record<string, unknown>)[field] = structuredClone(full[field]);
  }
  return next;
}
/** After hydration, swap summary-only states in a conversation's messages for complete ones. */
export function restoreRunStates(conversation: Conversation): Conversation {
  let changed = false;
  const messages = conversation.messages.map((m) => {
    if (!m.runState?.slim) return m;
    const full = records.get(m.runState.runId || m.taskId || '');
    if (!full || full.state.slim) return m;
    changed = true;
    return { ...m, runState: restoreHeavy(m.runState, full.state) };
  });
  return changed ? { ...conversation, messages } : conversation;
}
export async function saveRun(record: RunRecord): Promise<void> {
  if (forgotten.has(record.id) || forgottenConversations.has(record.conversationId)) return;
  const snapshot = structuredClone(record);
  const bridge = desktop();
  if (snapshot.state.slim && bridge?.runGet) {
    // Never persist a summary-only record: put the stored model context back first.
    const stored = await bridge.runGet(snapshot.id);
    if (!stored) throw new Error('执行记录的完整内容已不在本机，无法保存');
    snapshot.state = restoreHeavy(snapshot.state, stored.state);
  }
  if (bridge?.runSave) {
    await bridge.runSave(snapshot);
    if (forgotten.has(snapshot.id) || forgottenConversations.has(snapshot.conversationId)) await bridge.runRemove?.(snapshot.id);
    else {records.set(snapshot.id, snapshot);await observeRun(snapshot);}
    return;
  }
  fallbackChain = fallbackChain.catch(() => {}).then(async () => {
    if (forgotten.has(snapshot.id) || forgottenConversations.has(snapshot.conversationId)) return;
    const next=new Map(records);next.set(snapshot.id,snapshot);
    await getTransport().kvSet(KEY, JSON.stringify([...next.values()]));
    records.set(snapshot.id, snapshot);
    await observeRun(snapshot);
  });
  await fallbackChain;
}
export async function forgetRuns(conversationId: string, answerIds?: Set<string>): Promise<void> {
  if (!answerIds) forgottenConversations.add(conversationId);
  const selected = [...records.values()].filter((r) => r.conversationId === conversationId && (!answerIds || answerIds.has(r.answerId)));
  for (const r of selected) forgotten.add(r.id);
  const bridge = desktop();
  for (const r of selected) {
    if (bridge?.runRemove) await bridge.runRemove(r.id);
    records.delete(r.id);
  }
  if (!bridge?.runRemove) {
    fallbackChain = fallbackChain.catch(() => {}).then(() => getTransport().kvSet(KEY, JSON.stringify([...records.values()])));
    await fallbackChain;
  }
  await removeObservations(conversationId,answerIds);
}

export function runRecord(id:string):RunRecord|undefined {const r=records.get(id);return r?structuredClone(r):undefined;}
export function runTitle(id:string):string|undefined {const r=records.get(id);return r?(r.question.content.trim().replace(/\s+/g,' ').slice(0,96)||r.title):undefined;}
/** The run journal already owns durable checkpoints. Avoid duplicating them in every chat save. */
export function conversationsForStorage(list:Conversation[]):Conversation[]{
  return list.map(c=>({...c,messages:c.messages.map(m=>{
    const record=records.get(m.runState?.runId||m.taskId||'');
    if(!record||record.conversationId!==c.id||record.answerId!==m.id||record.state.at<(m.runState?.at??0))return m;
    return {...m,runState:undefined,subagents:m.subagents?.map(j=>({...j,checkpoint:undefined}))};
  })}));
}
/** Recover even if the conversation's debounced save had not yet happened. */
export function recoverConversations(original: Conversation[], saved: RunRecord[]): Conversation[] {
  const list = original.map((c) => ({ ...c, messages: [...c.messages] }));
  for (const r of [...saved].sort((a,b) => a.state.at-b.state.at)) {
    const state = r.state;
    let conv = list.find((c) => c.id === r.conversationId);
    if (!conv) {
      conv = { id: r.conversationId, title: r.title, config: r.config, keyProfileId: r.keyProfileId,
        projectId: r.projectId, createdAt: r.question.createdAt, updatedAt: state.at, messages: [] };
      list.push(conv);
    }
    const index = conv.messages.findIndex((m) => m.id === r.answerId);
    const existing = index >= 0 ? conv.messages[index] : undefined;
    if(existing?.cloudImported)continue;
    // The journal is authoritative for this run; ordinary chat saves may lag behind it.
    if ((existing?.runState?.at ?? 0) > state.at) continue;
    const completed = state.status === 'completed';
    const recovered = { ...state, status: completed ? 'completed' as const : 'paused' as const,
      reason: state.reason || '应用关闭或连接中断，执行记录已恢复' };
    const message: ChatMessage = {
      ...existing, id: r.answerId, role: 'assistant', createdAt: existing?.createdAt ?? r.question.createdAt,
      model: r.config.model, pending: false, content: state.content ?? existing?.content ?? '',
      reasoning: state.reasoning ?? existing?.reasoning, outputHistory:state.outputHistory??existing?.outputHistory, previousReplies:state.previousReplies??existing?.previousReplies, steps: state.steps ?? existing?.steps,
      sources: state.sources, usage: state.usage, runState: completed ? undefined : recovered,
      milestones: state.milestones, contextSnapshot: state.contextSnapshot, delivery: state.delivery ?? deliveryReport(state), taskId:r.id, supplementalInputs:state.supplementalInputs, handoff:state.handoff,
      userQuestionHistory: state.userQuestionHistory,harness:state.harness,subagents:state.subagents,
      progress: completed ? undefined : localProgress(state.steps ?? [], recovered.reason),
      artifacts: [...(existing?.artifacts ?? []), ...collectArtifacts(state.content ?? '', state.steps ?? [])]
        .filter(a=>!a.path||!(state.steps??[]).some(s=>s.codeChanges?.some(c=>c.status==='reverted'&&c.path.replace(/\\/g,'/').toLowerCase()===a.path!.replace(/\\/g,'/').toLowerCase())))
        .filter((a, i, all) => all.findIndex((b) => b.path && a.path ? b.path === a.path && b.direction === a.direction : b.id === a.id) === i),
      error: state.errorInfo?.detail, errorInfo: state.errorInfo,
    };
    if (index >= 0) conv.messages[index] = message;
    else {
      if (!conv.messages.some((m) => m.id === r.question.id)) conv.messages.push(r.question);
      conv.messages.push(message);
    }
    conv.updatedAt = Math.max(conv.updatedAt, state.at);
  }
  return list;
}

/** A saved pending bubble without an in-memory owner must never spin forever. */
export function pauseOrphanedPending(conversations: Conversation[]): Conversation[] {
  return conversations.map(conversation => {
    if (!conversation.messages.some(message => message.pending)) return conversation;
    return {...conversation, messages: conversation.messages.map(message => {
      if (!message.pending) return message;
      const reason = '连接已中断，当前输出已保留';
      // A completed checkpoint can be saved before the UI clears its spinner.
      // Do not turn that terminal result into a resumable run on restart.
      if (message.runState?.status === 'completed') return {...message, pending: false, notice: undefined, progress: undefined, runState: undefined};
      return {...message, pending: false, notice: undefined,
        progress: message.progress || reason,
        runState: message.runState ? {...message.runState, status: 'paused' as const, reason} : undefined};
    })};
  });
}
