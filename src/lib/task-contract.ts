import type {
  AcceptanceCheck,
  ChatMessage,
  DeliveryRequirement,
  Milestone,
  RequirementVerification,
  RunState,
  StepStatus,
  ToolCall,
  ToolStep,
} from '../types';

/**
 * The portable task contract is a small, source-addressed view of a RunState.
 *
 * It is deliberately a view rather than another source of truth.  A caller can
 * serialize it at a compression or handoff boundary, but the live state keeps
 * owning the next action, requirement revision, and evidence details.
 */

export interface TaskSource {
  id: string;
  content: string;
  createdAt: number;
}

export interface TaskRequirementRevision {
  revision: number;
  title: string;
  sourceId: string;
  sourceQuote: string;
  check: AcceptanceCheck;
  at: number;
}

export interface TaskRequirement {
  id: string;
  revision: number;
  title: string;
  sourceId: string;
  sourceQuote: string;
  check: AcceptanceCheck;
  milestoneId?: string;
  at: number;
  history: TaskRequirementRevision[];
  verification?: RequirementVerification;
  verificationHistory: RequirementVerification[];
}

export interface TaskMilestone {
  id: string;
  title: string;
  status: Milestone['status'];
  acceptance?: string;
  evidence: string[];
  note?: string;
}

export type TaskEvidenceOutcome = 'succeeded' | 'failed' | 'unknown' | 'pending';

export interface TaskEvidenceRef {
  id: string;
  callId: string;
  name: string;
  status: StepStatus;
  outcome: TaskEvidenceOutcome;
  summary: string;
  resultRef?: string;
  error?: string;
  sourceIds: string[];
  filePaths: string[];
}

export interface TaskPendingAction {
  id: string;
  name: string;
  arguments: string;
  cursor: number;
}

export interface TaskUncertainAction {
  callId: string;
  name?: string;
  outcome: 'unknown';
}

export interface PortableTaskContract {
  version: 1;
  runId?: string;
  runStatus: RunState['status'] | 'unknown';
  requirements: TaskRequirement[];
  milestones: TaskMilestone[];
  evidence: TaskEvidenceRef[];
  pending: TaskPendingAction[];
  uncertain?: TaskUncertainAction;
  /** User messages after the first source, kept verbatim for corrections. */
  corrections: TaskSource[];
  /** All source messages needed to resolve requirement sourceId/sourceQuote. */
  sources: TaskSource[];
  summary: {
    available: boolean;
    semanticStatus: 'unverifiable';
  };
  limitations: string[];
}

export const TASK_CONTRACT_SEMANTIC_LIMITATION =
  '摘要与来源之间的语义蕴含只能做结构核对，不能自动证明；未知状态不得推断为完成。';

const milestoneStatuses = new Set<Milestone['status']>(['pending', 'in_progress', 'verifying', 'completed', 'blocked']);
const stepStatuses = new Set<StepStatus>(['running', 'ok', 'error', 'denied']);
const outcomes = new Set<TaskEvidenceOutcome>(['succeeded', 'failed', 'unknown', 'pending']);

const clone = <T>(value: T): T => structuredClone(value);

function messageSources(state: RunState): Map<string, ChatMessage> {
  return new Map([...(state.contextArchive ?? []), ...(state.working ?? [])]
    .filter((m): m is ChatMessage => Boolean(m && typeof m.id === 'string'))
    .map((m) => [m.id, m]));
}

function sourceOf(message: ChatMessage): TaskSource {
  return { id: message.id, content: typeof message.content === 'string' ? message.content : '', createdAt: Number.isFinite(message.createdAt) ? message.createdAt : 0 };
}

function sourceMessages(state: RunState, byId: Map<string, ChatMessage>): TaskSource[] {
  const requirementIds = new Set([
    ...(state.requirements ?? []).flatMap((item) => [item.sourceId, ...(item.history ?? []).map((history) => history.sourceId)]),
  ]);
  const original = [...byId.values()].find((m) => m.role === 'user' && !m.contextKind && !m.id.startsWith('screens-'));
  if (original) requirementIds.add(original.id);
  const supplemental: ChatMessage[] = (state.supplementalInputs ?? []).map((input) => ({ ...input, role: 'user' as const }));
  const active: ChatMessage[] = [...(state.working ?? []), ...(state.pendingInputMessages ?? []), ...supplemental]
    .filter((m): m is ChatMessage => Boolean(m && m.role === 'user' && !m.contextKind && !m.id.startsWith('screens-')));
  const recentIds = new Set(active.slice(-12).map((m) => m.id));
  if (active[0]) recentIds.add(active[0].id);
  const fallback = [...byId.values()].filter((m) => m.role === 'user' && requirementIds.has(m.id));
  const messages = [original, ...active.filter((m) => recentIds.has(m.id) || requirementIds.has(m.id)), ...fallback]
    .filter((m): m is ChatMessage => Boolean(m))
    .filter((m, index, all) => all.findIndex((candidate) => candidate.id === m.id) === index);
  const converted = messages.map(sourceOf);
  if (converted.length <= 120) return converted;
  return [converted[0], ...converted.slice(-119)];
}

function requirementRevision(value: DeliveryRequirement['history'][number]): TaskRequirementRevision {
  return {
    revision: value.revision,
    title: value.title,
    sourceId: value.sourceId,
    sourceQuote: value.sourceQuote,
    check: clone(value.check),
    at: value.at,
  };
}

function requirement(value: DeliveryRequirement): TaskRequirement {
  return {
    id: value.id,
    revision: value.revision,
    title: value.title,
    sourceId: value.sourceId,
    sourceQuote: value.sourceQuote,
    check: clone(value.check),
    ...(value.milestoneId ? { milestoneId: value.milestoneId } : {}),
    at: value.at,
    history: (value.history ?? []).map(requirementRevision),
    ...(value.verification ? { verification: clone(value.verification) } : {}),
    verificationHistory: clone(value.verificationHistory ?? []),
  };
}

function milestone(value: Milestone): TaskMilestone {
  return {
    id: value.id,
    title: value.title,
    status: value.status,
    ...(value.acceptance !== undefined ? { acceptance: value.acceptance } : {}),
    evidence: [...(value.evidence ?? [])],
    ...(value.note !== undefined ? { note: value.note } : {}),
  };
}

function evidenceRef(step: ToolStep, uncertainCallId?: string): TaskEvidenceRef {
  const status: StepStatus = stepStatuses.has(step.status) ? step.status : 'running';
  return {
    id: step.id,
    callId: typeof step.callId === 'string' && step.callId ? step.callId : `unknown-${step.id}`,
    name: typeof step.name === 'string' && step.name ? step.name : 'unknown',
    status,
    outcome: step.callId === uncertainCallId ? 'unknown' : status === 'ok' ? 'succeeded' : status === 'error' || status === 'denied' ? 'failed' : 'unknown',
    summary: typeof step.summary === 'string' ? step.summary : '',
    ...(step.resultRef ? { resultRef: step.resultRef } : {}),
    ...(step.error ? { error: step.error } : {}),
    sourceIds: (step.sources ?? []).map((source) => String(source.n)),
    filePaths: (step.files ?? []).map((file) => file.path),
  };
}

function pendingAction(call: ToolCall, cursor: number): TaskPendingAction {
  return { id: typeof call?.id === 'string' && call.id ? call.id : `pending-${cursor}`, name: typeof call?.name === 'string' && call.name ? call.name : 'unknown', arguments: typeof call?.arguments === 'string' ? call.arguments : '', cursor };
}

/** Build a portable, source-addressed view without mutating the live RunState. */
export function taskContractFromState(state: RunState): PortableTaskContract {
  const byId = messageSources(state);
  const sources = sourceMessages(state, byId);
  const firstSourceId = sources[0]?.id;
  const corrections = sources.filter((source) => source.id !== firstSourceId).slice(-12);
  const uncertainCallId = typeof state.uncertainCallId === 'string' && state.uncertainCallId ? state.uncertainCallId : undefined;
  const evidence = [...(state.contextArchiveSteps ?? []), ...(state.steps ?? [])]
    .filter((step): step is ToolStep => Boolean(step && typeof step.id === 'string' && typeof step.callId === 'string'))
    .filter((step, index, all) => all.findIndex((candidate) => candidate.id === step.id) === index)
    .map((step) => evidenceRef(step, uncertainCallId)).slice(-120);
  const cursor = Number.isSafeInteger(state.toolCursor) && (state.toolCursor ?? 0) >= 0 ? state.toolCursor ?? 0 : 0;
  const pending = (state.pendingCalls ?? []).slice(cursor).map((call, index) => pendingAction(call, cursor + index));
  const uncertainCall = uncertainCallId
    ? [...(state.pendingCalls ?? [])].find((call) => call.id === uncertainCallId)
      ?? [...(state.steps ?? []), ...(state.contextArchiveSteps ?? [])].find((step) => step.callId === uncertainCallId)
    : undefined;
  return {
    version: 1,
    ...(state.runId ? { runId: state.runId } : {}),
    runStatus: state.status ?? 'unknown',
    requirements: (state.requirements ?? []).map(requirement),
    milestones: (state.milestones ?? []).map(milestone),
    evidence,
    pending,
    ...(uncertainCallId ? { uncertain: { callId: uncertainCallId, ...(uncertainCall && 'name' in uncertainCall ? { name: uncertainCall.name } : {}), outcome: 'unknown' as const } } : {}),
    corrections,
    sources,
    summary: { available: Boolean(state.compactions?.length), semanticStatus: 'unverifiable' },
    limitations: [TASK_CONTRACT_SEMANTIC_LIMITATION],
  };
}

const clip = (value: unknown, limit: number): string => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= limit) return text;
  const head = Math.max(1, Math.ceil(limit * 0.65));
  const tail = Math.max(1, limit - head);
  return `${text.slice(0, head)}…（已省略，原文按来源 ID取回）…${text.slice(-tail)}`;
};

function compactCheck(check: AcceptanceCheck, limit: number): Record<string, unknown> {
  return {
    kind: check.kind,
    ...(check.path ? { path: clip(check.path, limit) } : {}),
    ...(check.contains ? { contains: check.contains.slice(0, 3).map((item) => clip(item, limit)) } : {}),
    ...(check.requiredKeys ? { requiredKeys: check.requiredKeys.slice(0, 3).map((item) => clip(item, limit)) } : {}),
    ...(check.count !== undefined ? { count: check.count } : {}),
  };
}

function promptSources(contract: PortableTaskContract, requirementRows: PortableTaskContract['requirements'], corrections: TaskSource[], sourceLimit: number): { rows: { id: string; excerpt: string; retrieve: string }[]; ids: string[] } {
  const ids = [
    contract.sources[0]?.id,
    ...requirementRows.flatMap((item) => [item.sourceId, item.history.at(-1)?.sourceId]),
    ...corrections.map((item) => item.id),
  ].filter((id): id is string => Boolean(id));
  const sourceMap = new Map(contract.sources.map((item) => [item.id, item]));
  const uniqueIds = [...new Set(ids)];
  return {
    ids: uniqueIds,
    rows: uniqueIds.slice(0, sourceLimit).map((id) => {
      const item = sourceMap.get(id);
      return { id, excerpt: item ? clip(item.content, 220) : '原文未随契约携带；请按 ID 取回后核对', retrieve: `read_context(id=${id})` };
    }),
  };
}

/**
 * Bounded request-facing projection. Full source text stays in the portable
 * contract/archive; this view carries IDs and short excerpts plus an explicit
 * omission count so omitted material is never mistaken for checked evidence.
 */
export function taskContractPrompt(source: PortableTaskContract | RunState, maxChars = 10000): string {
  const contract = source && typeof source === 'object' && 'summary' in source && (source as PortableTaskContract).version === 1
    ? source as PortableTaskContract : taskContractFromState(source as RunState);
  const limit = Number.isSafeInteger(maxChars) && maxChars >= 256 ? maxChars : 10000;
  const referencedEvidence = new Set([
    ...contract.milestones.flatMap((item) => item.evidence),
    ...contract.requirements.flatMap((item) => item.verification?.evidence ?? []),
  ]);
  const importantEvidence = contract.evidence.filter((item) => item.outcome !== 'succeeded' || referencedEvidence.has(item.id) || referencedEvidence.has(item.callId));
  const omittedHistory = contract.requirements.reduce((sum, item) => sum + item.history.length, 0);
  const variants = [
    { requirements: 12, milestones: 8, evidence: 10, corrections: 8, sources: 16, quote: 260 },
    { requirements: 8, milestones: 6, evidence: 8, corrections: 6, sources: 12, quote: 180 },
    { requirements: 6, milestones: 5, evidence: 6, corrections: 5, sources: 10, quote: 140 },
    { requirements: 4, milestones: 4, evidence: 5, corrections: 4, sources: 8, quote: 100 },
  ];
  for (const variant of variants) {
    const requirementRows = [...contract.requirements]
      .sort((a, b) => b.revision - a.revision || b.at - a.at)
      .slice(0, variant.requirements)
      .map((item) => ({
        id: item.id, revision: item.revision, title: clip(item.title, 100), sourceId: item.sourceId,
        sourceQuote: clip(item.sourceQuote, variant.quote), milestoneId: item.milestoneId,
        check: compactCheck(item.check, Math.min(variant.quote, 140)),
        verification: item.verification ? { revision: item.verification.revision, status: item.verification.status, method: item.verification.method, detail: clip(item.verification.detail, 180), evidence: item.verification.evidence.slice(0, 4) } : undefined,
        historyCount: item.history.length,
      }));
    const correctionRows = contract.corrections.slice(-variant.corrections).map((item) => ({ id: item.id, excerpt: clip(item.content, variant.quote), retrieve: `read_context(id=${item.id})` }));
    const sources = promptSources(contract, contract.requirements, contract.corrections.slice(-variant.corrections), variant.sources);
    const evidenceRows = [...importantEvidence, ...contract.evidence.slice(-variant.evidence)]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .slice(0, variant.evidence)
      .map((item) => ({ id: item.id, callId: item.callId, name: item.name, outcome: item.outcome, summary: clip(item.summary, 140), ...(item.error ? { error: clip(item.error, 180) } : {}), ...(item.resultRef ? { resultRef: item.resultRef } : {}) }));
    const body = {
      version: 1, runStatus: contract.runStatus,
      requirements: requirementRows,
      milestones: contract.milestones.slice(-variant.milestones).map((item) => ({ id: item.id, title: clip(item.title, 100), status: item.status, acceptance: item.acceptance ? clip(item.acceptance, 140) : undefined, evidence: item.evidence.slice(-5), note: item.note ? clip(item.note, 180) : undefined })),
      evidence: evidenceRows,
      pending: contract.pending.slice(0, 12).map((item) => ({ id: item.id, name: item.name, arguments: clip(item.arguments, 160), cursor: item.cursor })),
      uncertain: contract.uncertain,
      corrections: correctionRows,
      sources: sources.rows,
      summary: contract.summary,
      limitations: contract.limitations,
      retrieval: '未列出的原文、历史和证据没有被核验；用 source ID 调用 read_context，用 resultRef 调用 read_tool_result。',
      omitted: {
        requirements: Math.max(0, contract.requirements.length - requirementRows.length),
        requirementHistory: omittedHistory,
        milestones: Math.max(0, contract.milestones.length - Math.min(contract.milestones.length, variant.milestones)),
        evidence: Math.max(0, contract.evidence.length - evidenceRows.length),
        pending: Math.max(0, contract.pending.length - 12),
        corrections: Math.max(0, contract.corrections.length - correctionRows.length),
        sources: Math.max(0, sources.ids.length - sources.rows.length),
      },
    };
    const text = JSON.stringify(body);
    if (text.length <= limit) return text;
  }
  const fallback = JSON.stringify({ version: 1, runStatus: contract.runStatus, uncertain: contract.uncertain, sourceIds: contract.sources.slice(0, 12).map((item) => item.id), pendingIds: contract.pending.slice(0, 12).map((item) => item.id), omitted: true, retrieval: '未列出的原文和证据没有被核验；请按 ID 取回。', limitations: contract.limitations });
  if (fallback.length <= limit) return fallback;
  const compact = JSON.stringify({ version: 1, runStatus: contract.runStatus, omitted: true, retrieval: '按 ID 取回；未列出的内容没有被核验。' });
  return compact.length <= limit ? compact : JSON.stringify({ version: 1 });
}

function requiredString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 无效`);
}

/** Structural validation only; it intentionally does not claim summary entailment. */
export function validateTaskContract(raw: unknown): PortableTaskContract {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('任务契约结构无效');
  const value = raw as Partial<PortableTaskContract>;
  if (value.version !== 1) throw new Error('任务契约版本无效');
  if (!['running', 'waiting', 'paused', 'completed', 'unknown', undefined].includes(value.runStatus)) throw new Error('任务契约状态无效');
  for (const [key, max] of [['requirements', 20], ['milestones', 20], ['evidence', 120], ['pending', 30], ['corrections', 12], ['sources', 120]] as const) {
    if (!Array.isArray(value[key]) || value[key]!.length > max) throw new Error(`任务契约 ${key} 无效`);
  }
  const ids = new Set<string>();
  for (const item of value.requirements!) {
    if (!item || typeof item !== 'object') throw new Error('任务契约要求无效');
    requiredString(item.id, '要求 id');
    if (ids.has(item.id)) throw new Error('任务契约要求 id 重复');
    ids.add(item.id);
    if (!Number.isSafeInteger(item.revision) || item.revision < 1) throw new Error('要求 revision 无效');
    requiredString(item.title, '要求标题'); requiredString(item.sourceId, '要求来源'); requiredString(item.sourceQuote, '要求原文');
    if (!item.check || typeof item.check !== 'object' || typeof item.check.kind !== 'string') throw new Error('要求检查无效');
    if (!Array.isArray(item.history) || item.history.some((history) => !history || typeof history.sourceId !== 'string' || typeof history.sourceQuote !== 'string')) throw new Error('要求历史无效');
    if (!Array.isArray(item.verificationHistory)) throw new Error('要求核验历史无效');
  }
  const milestoneIds = new Set<string>();
  for (const item of value.milestones!) {
    if (!item || typeof item !== 'object') throw new Error('任务契约里程碑无效');
    requiredString(item.id, '里程碑 id');
    if (milestoneIds.has(item.id)) throw new Error('任务契约里程碑 id 重复');
    milestoneIds.add(item.id);
    requiredString(item.title, '里程碑标题');
    if (!milestoneStatuses.has(item.status!) || !Array.isArray(item.evidence) || item.evidence.some((e) => typeof e !== 'string')) throw new Error('里程碑状态或证据无效');
  }
  const evidenceIds = new Set<string>();
  for (const item of value.evidence!) {
    if (!item || typeof item !== 'object') throw new Error('任务契约证据无效');
    requiredString(item.id, '证据 id'); requiredString(item.callId, '证据 callId'); requiredString(item.name, '证据工具名');
    if (evidenceIds.has(item.id) || !stepStatuses.has(item.status!) || !outcomes.has(item.outcome!) || !Array.isArray(item.sourceIds) || !Array.isArray(item.filePaths)) throw new Error('任务契约证据引用无效');
    evidenceIds.add(item.id);
  }
  const pendingIds = new Set<string>();
  for (const item of value.pending!) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string' || !Number.isSafeInteger(item.cursor) || item.cursor < 0 || pendingIds.has(item.id)) throw new Error('任务契约待办无效');
    pendingIds.add(item.id);
  }
  if (value.uncertain !== undefined && (!value.uncertain || typeof value.uncertain.callId !== 'string' || !value.uncertain.callId || value.uncertain.outcome !== 'unknown')) throw new Error('任务契约未知操作无效');
  for (const collection of [value.sources!, value.corrections!]) {
    for (const source of collection) {
      if (!source || typeof source.id !== 'string' || !source.id || typeof source.content !== 'string' || !Number.isFinite(source.createdAt)) throw new Error('任务契约原始来源无效');
    }
  }
  if (!value.summary || value.summary.available === undefined || value.summary.semanticStatus !== 'unverifiable') throw new Error('任务契约摘要状态无效');
  if (!Array.isArray(value.limitations) || !value.limitations.includes(TASK_CONTRACT_SEMANTIC_LIMITATION)) throw new Error('任务契约限制说明缺失');
  return clone(value as PortableTaskContract);
}

/** Merge portable snapshots without treating an older snapshot as new execution. */
export function mergeTaskContracts(previous: PortableTaskContract | undefined, next: PortableTaskContract | undefined): PortableTaskContract | undefined {
  if (!previous) return next ? clone(next) : undefined;
  if (!next) return clone(previous);
  const byRequirement = new Map(previous.requirements.map((item) => [item.id, item]));
  for (const item of next.requirements) {
    const old = byRequirement.get(item.id);
    if (!old || item.revision >= old.revision) byRequirement.set(item.id, item);
  }
  const byMilestone = new Map(previous.milestones.map((item) => [item.id, item]));
  for (const item of next.milestones) byMilestone.set(item.id, item);
  const evidence = [...new Map([...previous.evidence, ...next.evidence].map((item) => [item.id, item])).values()];
  const sources = [...new Map([...previous.sources, ...next.sources].map((item) => [item.id, item])).values()];
  const corrections = [...new Map([...previous.corrections, ...next.corrections].map((item) => [item.id, item])).values()].slice(-12);
  const merged: PortableTaskContract = {
    version: 1,
    ...(next.runId ?? previous.runId ? { runId: next.runId ?? previous.runId } : {}),
    runStatus: next.runStatus,
    requirements: [...byRequirement.values()],
    milestones: [...byMilestone.values()],
    evidence,
    pending: next.pending,
    ...(next.uncertain ? { uncertain: next.uncertain } : {}),
    corrections,
    sources,
    summary: { available: previous.summary.available || next.summary.available, semanticStatus: 'unverifiable' },
    limitations: [TASK_CONTRACT_SEMANTIC_LIMITATION],
  };
  return validateTaskContract(merged);
}
