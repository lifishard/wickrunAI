import type { MemoryEntry } from './collaboration';

/** Optional metadata carried by the durable project-memory entry. */
export type TeamMemoryKind = 'fact' | 'preference' | 'experience';
export type TeamMemoryScope = 'project' | 'task';

export interface TeamMemoryMetadata {
  kind?: TeamMemoryKind;
  scope?: TeamMemoryScope;
  keywords?: string[];
  /** Unix milliseconds. An entry is expired when expiresAt <= asOf. */
  expiresAt?: number;
}

/** Structural intersection keeps this module usable before MemoryEntry grows these fields. */
export type TeamMemoryEntry = MemoryEntry & TeamMemoryMetadata;

export interface TeamMemoryTask {
  goal: string;
  acceptance: string;
}

export interface TeamMemorySelectionOptions {
  /** Timestamp used for expiry and normally frozen from run.createdAt. */
  now?: number;
  /** Maximum number of formatted prompt characters. Defaults to 6000. */
  maxChars?: number;
}

export interface TeamMemoryAudit {
  id: string;
  revision: number;
  /** A fixed, bounded explanation; it never contains memory text. */
  reason: string;
}

export interface TeamMemorySelection {
  /** Detached entries that fit in prompt, in deterministic id/revision order. */
  snapshots: TeamMemoryEntry[];
  /** Formatted prompt. totalChars is exactly prompt.length. */
  prompt: string;
  /** One row for every input entry, including omitted entries. */
  audit: TeamMemoryAudit[];
  totalChars: number;
  maxChars: number;
}

export interface TeamMemoryValidationSuccess {
  ok: true;
  /** Metadata is copied; status is intentionally not changed by this helper. */
  metadata: TeamMemoryMetadata;
  status?: MemoryEntry['status'];
}

export interface TeamMemoryValidationFailure {
  ok: false;
  error: string;
  field?: string;
}

export type TeamMemoryValidation = TeamMemoryValidationSuccess | TeamMemoryValidationFailure;

const kinds = new Set<TeamMemoryKind>(['fact', 'preference', 'experience']);
const scopes = new Set<TeamMemoryScope>(['project', 'task']);
const statuses = new Set<MemoryEntry['status']>(['candidate', 'validated', 'adopted', 'invalid']);
const DEFAULT_MAX_CHARS = 6000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateMetadata(value: Record<string, unknown>, requireText: boolean): TeamMemoryValidation {
  if (requireText && !has(value, 'text')) return { ok: false, error: 'memory text is required', field: 'text' };
  if (has(value, 'text') && !nonEmptyText(value.text)) return { ok: false, error: 'memory text must not be empty', field: 'text' };

  if (has(value, 'kind') && value.kind !== undefined && (!kinds.has(value.kind as TeamMemoryKind))) {
    return { ok: false, error: 'memory kind is invalid', field: 'kind' };
  }
  if (has(value, 'scope') && value.scope !== undefined && (!scopes.has(value.scope as TeamMemoryScope))) {
    return { ok: false, error: 'memory scope is invalid', field: 'scope' };
  }
  if (has(value, 'keywords') && value.keywords !== undefined) {
    if (!Array.isArray(value.keywords) || value.keywords.some((keyword) => !nonEmptyText(keyword))) {
      return { ok: false, error: 'memory keywords must be a string array', field: 'keywords' };
    }
  }
  if (value.scope === 'task' && (!Array.isArray(value.keywords) || value.keywords.length === 0 || value.keywords.some((keyword) => !nonEmptyText(keyword)))) {
    return { ok: false, error: 'task-scoped memory requires keywords', field: 'keywords' };
  }
  if (has(value, 'expiresAt') && value.expiresAt !== undefined &&
      (!Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= 0)) {
    return { ok: false, error: 'memory expiry must be a positive integer timestamp', field: 'expiresAt' };
  }
  if (has(value, 'status') && value.status !== undefined && !statuses.has(value.status as MemoryEntry['status'])) {
    return { ok: false, error: 'memory status is invalid', field: 'status' };
  }

  const metadata: TeamMemoryMetadata = {};
  if (value.kind !== undefined) metadata.kind = value.kind as TeamMemoryKind;
  if (value.scope !== undefined) metadata.scope = value.scope as TeamMemoryScope;
  if (value.keywords !== undefined) metadata.keywords = (value.keywords as unknown[]).map((keyword) => String(keyword));
  if (value.expiresAt !== undefined) metadata.expiresAt = value.expiresAt as number;
  return {
    ok: true,
    metadata,
    ...(value.status !== undefined ? { status: value.status as MemoryEntry['status'] } : {}),
  };
}

/**
 * Validate optional memory metadata without adopting or changing an entry.
 * If a `text` field is supplied it is checked too; use validateTeamMemoryEntry
 * when a complete UI draft must contain text.
 */
export function validateTeamMemoryMetadata(value: unknown): TeamMemoryValidation {
  if (!isRecord(value)) return { ok: false, error: 'memory entry must be an object' };
  return validateMetadata(value, false);
}

/** Validate a complete UI memory draft while preserving its candidate/adopted status. */
export function validateTeamMemoryEntry(value: unknown): TeamMemoryValidation {
  if (!isRecord(value)) return { ok: false, error: 'memory entry must be an object' };
  return validateMetadata(value, true);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function idOf(value: unknown, index: number): string {
  return isRecord(value) && typeof value.id === 'string' ? value.id : `<entry-${index}>`;
}

function revisionOf(value: unknown): number {
  return isRecord(value) && Number.isSafeInteger(value.revision) ? value.revision as number : 0;
}

function effectiveKind(memory: TeamMemoryEntry): TeamMemoryKind {
  return kinds.has(memory.kind as TeamMemoryKind) ? memory.kind as TeamMemoryKind : 'experience';
}

function effectiveScope(memory: TeamMemoryEntry): TeamMemoryScope {
  return memory.scope === undefined ? 'project' : memory.scope as TeamMemoryScope;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasLatinTermShape(keyword: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_ -]*$/.test(keyword);
}

/** Lexical matching only: CJK is a substring; ASCII Latin terms use boundaries. */
function keywordMatches(text: string, keyword: string): boolean {
  const term = keyword.trim();
  if (!term) return false;
  if (!hasLatinTermShape(term)) return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z0-9_])`, 'iu');
  return pattern.test(text);
}

function taskMatches(memory: TeamMemoryEntry, task: TeamMemoryTask): boolean {
  const haystack = `${textOf(task.goal)}\n${textOf(task.acceptance)}`;
  return (memory.keywords ?? []).some((keyword) => keywordMatches(haystack, keyword));
}

/** Return the exact bytes the caller may inject into the model prompt. */
export function formatTeamMemory(memory: TeamMemoryEntry): string {
  const id = textOf(memory.id);
  const revision = revisionOf(memory);
  const kind = effectiveKind(memory);
  const scope = effectiveScope(memory);
  const title = textOf(memory.title);
  const applicability = textOf(memory.applicability);
  const evidence = textOf(memory.evidence).replace(/\s+/g, ' ').trim();
  return `[${id}@${revision}] kind=${kind} scope=${scope} title=${title} applicability=${applicability} evidence=${evidence}\n${textOf(memory.text)}`;
}

/**
 * Wrap selected memories with their trust boundary. Selection proves status, scope and expiry only;
 * it does not prove that a memory is true or that it still agrees with the current task.
 */
export function teamMemorySystemBlock(selection: TeamMemorySelection): string {
  if (!selection.prompt) return '';
  return `已选择的项目经验仅作历史参考。当前任务目标、验收标准和本轮补充指令优先；若经验与当前要求冲突，以当前要求为准。经验的结构、检索命中和注入记录不等于模型已正确采用，也不能作为完成证据。每条经验保留 id@revision 与证据来源供核对。\n${selection.prompt}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function orderedEntries(memories: readonly TeamMemoryEntry[]): { entry: TeamMemoryEntry; index: number }[] {
  return memories.map((entry, index) => ({ entry, index })).sort((a, b) =>
    compareText(idOf(a.entry, a.index), idOf(b.entry, b.index)) ||
    revisionOf(a.entry) - revisionOf(b.entry) || a.index - b.index);
}

function auditIdentity(entry: unknown, index: number): TeamMemoryAudit {
  return { id: idOf(entry, index), revision: revisionOf(entry), reason: 'omitted: invalid memory entry' };
}

function validationReason(validation: TeamMemoryValidationFailure): string {
  if (validation.field === 'text') return 'omitted: empty text';
  if (validation.field === 'keywords' && validation.error.startsWith('task-scoped')) return 'omitted: task scope requires keywords';
  return `omitted: invalid ${validation.field ?? 'metadata'}`;
}

function maxCharsOf(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_CHARS;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('maxChars must be a non-negative safe integer');
  return value;
}

/**
 * Select a deterministic, lexical task-memory view from a frozen run snapshot.
 * The input is never mutated, and no selection implies semantic relevance.
 */
export function selectTeamMemories(
  memories: readonly TeamMemoryEntry[],
  task: TeamMemoryTask,
  options: TeamMemorySelectionOptions = {},
): TeamMemorySelection {
  if (!Array.isArray(memories)) throw new TypeError('memories must be an array');
  const maxChars = maxCharsOf(options.maxChars);
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new RangeError('now must be finite');

  const snapshots: TeamMemoryEntry[] = [];
  const audit: TeamMemoryAudit[] = [];
  const rendered: string[] = [];
  let totalChars = 0;
  for (const { entry, index } of orderedEntries(memories)) {
    const base = auditIdentity(entry, index);
    if (!isRecord(entry)) {
      audit.push(base);
      continue;
    }
    const validation = validateMetadata(entry, true);
    if (!validation.ok) {
      audit.push({ ...base, reason: validationReason(validation) });
      continue;
    }
    if (entry.status !== 'adopted') {
      audit.push({ ...base, reason: 'omitted: status is not adopted' });
      continue;
    }
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
      audit.push({ ...base, reason: 'omitted: expired at or before selection time' });
      continue;
    }
    const scope = effectiveScope(entry as TeamMemoryEntry);
    if (scope === 'task' && !taskMatches(entry as TeamMemoryEntry, task)) {
      audit.push({ ...base, reason: 'omitted: no task keyword match' });
      continue;
    }
    const formatted = formatTeamMemory(entry as TeamMemoryEntry);
    if (formatted.length > maxChars) {
      audit.push({ ...base, reason: 'omitted: memory exceeds context limit' });
      continue;
    }
    const addition = rendered.length ? `\n\n${formatted}` : formatted;
    if (totalChars + addition.length > maxChars) {
      audit.push({ ...base, reason: 'omitted: context limit reached' });
      continue;
    }
    rendered.push(formatted);
    totalChars += addition.length;
    snapshots.push(structuredClone(entry) as TeamMemoryEntry);
    audit.push({ ...base, reason: scope === 'task' ? 'selected: matching task keyword' : 'selected: project scope' });
  }
  const prompt = rendered.join('\n\n');
  return { snapshots, prompt, audit, totalChars: prompt.length, maxChars };
}

export const TEAM_MEMORY_DEFAULT_MAX_CHARS = DEFAULT_MAX_CHARS;
