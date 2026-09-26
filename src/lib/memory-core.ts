/* ------------------------------------------------------------------ *
 * 项目记忆内核（渲染进程与主进程共用，主进程用的是 scripts/build-native-mcp.mjs
 * 打出来的 electron/memory-core.bundle.cjs）。这里只放纯函数，不碰存储。
 *
 * 1. 条目化：原来的项目记忆是一整段文字，不能单条删、整段每轮注入、两台设备
 *    同时改会丢一边。现在每条有 id、类型、来源、时间，删除留墓碑，按条合并。
 * 2. 检索：BM25 + 中文二元切分，零依赖。用于选哪些记忆进提示词、回想过往任务、
 *    翻查上下文。不上向量模型：体积和隐私代价都大，这个规模关键词检索够用。
 * 3. 候选：从用户自己的话里按规则找「以后都…」「记住…」这类偏好和约定，
 *    只生成候选，用户批准才写入；写入前先脱敏。
 *
 * 借鉴了 agentmemory 的做法（隐私正则、按 token 预算注入、来源记录、删除留痕），
 * 但没有引入它的服务和依赖。
 * ------------------------------------------------------------------ */

export type MemoryKind = 'preference' | 'decision' | 'fact' | 'lesson' | 'note';
export type MemorySource = 'user' | 'model' | 'correction' | 'candidate' | 'legacy' | 'client';
export type MemoryStatus = 'active' | 'candidate';

export interface ProjectMemoryItem {
  id: string;
  text: string;
  kind: MemoryKind;
  /** 这条是怎么来的：用户手写、模型用工具写、纠错、批准的候选、旧版文本迁移、本机客户端提交 */
  source: MemorySource;
  /** 来源的对话 / 任务 id，便于回看 */
  sourceRef?: string;
  /** candidate 不进提示词，等用户批准 */
  status?: MemoryStatus;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  /** 删除墓碑：正文清空，只留规范化正文的哈希，防止同一句被重新提议或从别的设备复活 */
  deletedAt?: number;
  hash: string;
  /* 以下来自协作空间的经验记录（2.20.1 起两套合成一套），单人对话里也可以填 */
  /** 适用条件与失败边界 */
  applicability?: string;
  /** 验证证据与来源：实际测试或人工检查，不是模型自评 */
  evidence?: string;
  /** 只在问题 / 任务里出现这些词时才用（字面匹配）；不填就是项目通用 */
  keywords?: string[];
  /** 每改一次加一；协作运行按 id@revision 冻结快照 */
  revision?: number;
}

export const MEMORY_KINDS: MemoryKind[] = ['preference', 'decision', 'fact', 'lesson', 'note'];
export const MEMORY_KIND_LABEL: Record<MemoryKind, string> = { preference: '偏好', decision: '决定', fact: '事实', lesson: '经验', note: '备注' };
export const MEMORY_TEXT_MAX = 1000;
export const MEMORY_PROMPT_BUDGET = 6000;

/* ---------------- 基础 ---------------- */

/** FNV-1a 32 位，够做去重和确定性 id；不是安全哈希 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}

export function normalizeText(text: string): string {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[。．.，,；;！!？?、:：“”"'‘’（）()\[\]【】\s]+/g, '');
}

const CJK = /[㐀-鿿豈-﫿]/;

/** 英文按词（去掉简单的复数 s）；中文按相邻二字切，不需要分词词典 */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = String(text ?? '').normalize('NFKC').toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]+|[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (CJK.test(run[0])) {
      // 单字噪声太大（「的」「用」到处都是），只在整段只有一个字时才用单字
      if (run.length === 1) out.push(run);
      for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    } else if (run.length > 1 || /\d/.test(run)) {
      out.push(run.length > 3 && run.endsWith('s') && !run.endsWith('ss') ? run.slice(0, -1) : run);
    }
  }
  return out;
}

/* ---------------- BM25 ---------------- */

export interface SearchHit { id: string; score: number }

/** 一次性建索引再查询。k1=1.2、b=0.75 是常用默认值 */
export function createSearchIndex(docs: { id: string; text: string }[]) {
  const k1 = 1.2, b = 0.75;
  const tf = docs.map(d => {
    const counts = new Map<string, number>();
    for (const t of tokenize(d.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { id: d.id, counts, len: [...counts.values()].reduce((a, c) => a + c, 0) };
  });
  const df = new Map<string, number>();
  for (const d of tf) for (const t of d.counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = tf.reduce((a, d) => a + d.len, 0) / Math.max(1, tf.length) || 1;
  const n = tf.length;
  return {
    search(query: string, limit = 10): SearchHit[] {
      const terms = [...new Set(tokenize(query))];
      if (!terms.length) return [];
      const hits: SearchHit[] = [];
      for (const d of tf) {
        let score = 0;
        for (const t of terms) {
          const f = d.counts.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
          score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
        }
        if (score > 0) hits.push({ id: d.id, score });
      }
      return hits.sort((a, c) => c.score - a.score || a.id.localeCompare(c.id)).slice(0, Math.max(1, limit));
    },
  };
}

/* ---------------- 隐私 ---------------- */

const SECRET_PATTERNS: RegExp[] = [
  /<private>[\s\S]*?<\/private>/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
  /\b(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=：]\s*\S+/gi,
  /(?:密码|口令|密钥|令牌)\s*[:=：]\s*\S+/g,
];
export const REDACTED = '[REDACTED]';

/** 写进记忆前去掉看起来像密钥、令牌、密码的内容；返回脱敏后的文字和是否改过 */
export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let out = String(text ?? '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return { text: out, redacted: out !== String(text ?? '') };
}

/* ---------------- 条目 ---------------- */

const alive = (m: ProjectMemoryItem, now: number) => !m.deletedAt && (!m.expiresAt || m.expiresAt > now);
export const activeItems = (items: ProjectMemoryItem[], now = Date.now()) => items.filter(m => alive(m, now) && (m.status ?? 'active') === 'active');
export const candidateItems = (items: ProjectMemoryItem[], now = Date.now()) => items.filter(m => alive(m, now) && m.status === 'candidate');

export function cleanKeywords(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、]/) : [];
  return [...new Set(list.map(k => String(k ?? '').trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
}

/** 限定了关键词的条目，只在问题 / 任务里出现其中一个词时才算相关（字面匹配，不代表语义相关） */
export function keywordsMatch(m: Pick<ProjectMemoryItem, 'keywords'>, query: string): boolean {
  if (!m.keywords?.length) return true;
  const q = String(query ?? '').toLowerCase();
  return m.keywords.some(k => {
    const term = k.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_ -]*$/.test(term)) return q.includes(term);
    return new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_])`).test(q);
  });
}

function cleanItem(raw: unknown): ProjectMemoryItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[\w:-]{1,80}$/.test(r.id)) return null;
  const text = typeof r.text === 'string' ? r.text.slice(0, MEMORY_TEXT_MAX) : '';
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const item: ProjectMemoryItem = {
    id: r.id, text,
    kind: MEMORY_KINDS.includes(r.kind as MemoryKind) ? r.kind as MemoryKind : 'note',
    source: ['user', 'model', 'correction', 'candidate', 'legacy', 'client'].includes(r.source as string) ? r.source as MemorySource : 'user',
    createdAt: num(r.createdAt) ?? 0, updatedAt: num(r.updatedAt) ?? num(r.createdAt) ?? 0,
    hash: typeof r.hash === 'string' && r.hash ? r.hash : hashText(normalizeText(text)),
  };
  if (typeof r.sourceRef === 'string') item.sourceRef = r.sourceRef.slice(0, 200);
  if (r.status === 'candidate') item.status = 'candidate';
  if (r.pinned === true) item.pinned = true;
  if (num(r.expiresAt)) item.expiresAt = num(r.expiresAt);
  if (typeof r.applicability === 'string' && r.applicability.trim()) item.applicability = r.applicability.slice(0, MEMORY_TEXT_MAX);
  if (typeof r.evidence === 'string' && r.evidence.trim()) item.evidence = r.evidence.slice(0, MEMORY_TEXT_MAX);
  const keywords = cleanKeywords(r.keywords);
  if (keywords.length) item.keywords = keywords;
  if (Number.isSafeInteger(r.revision) && (r.revision as number) > 1) item.revision = r.revision as number;
  if (num(r.deletedAt)) { item.deletedAt = num(r.deletedAt); item.text = ''; }
  return item;
}

/**
 * 旧版项目记忆（一整段文字）拆成条目。按空行分段，去掉「[时间] 」前缀。
 * id 由内容决定：两台设备各自迁移同一段旧文本，得到的是同样的条目，不会重复。
 */
export function migrateLegacyMemory(text: string, now = Date.now()): ProjectMemoryItem[] {
  const out: ProjectMemoryItem[] = [];
  const seen = new Set<string>();
  for (const block of String(text ?? '').split(/\n\s*\n/)) {
    let body = block.trim();
    if (!body || body.startsWith('…（中间部分已归档')) continue;
    let at = now;
    const stamp = body.match(/^\[([^\]]{4,40})\]\s*/);
    if (stamp) {
      const parsed = Date.parse(stamp[1].replace(/\//g, '-').replace(' ', 'T'));
      if (Number.isFinite(parsed)) at = parsed;
      body = body.slice(stamp[0].length).trim();
    }
    if (!body) continue;
    const hash = hashText(normalizeText(body));
    if (seen.has(hash)) continue;
    seen.add(hash);
    const correction = /^纠错/.test(body);
    out.push({ id: `m_legacy_${hash}`, text: body.slice(0, MEMORY_TEXT_MAX), kind: correction ? 'lesson' : 'note', source: correction ? 'correction' : 'legacy', createdAt: at, updatedAt: at, hash });
  }
  return out;
}

/** 读项目上的记忆：有条目就用条目，没有就把旧文本迁移过来 */
export function memoryItemsOf(project: { memory?: string; memoryItems?: unknown }, now = Date.now()): ProjectMemoryItem[] {
  if (Array.isArray(project.memoryItems)) return project.memoryItems.map(cleanItem).filter((m): m is ProjectMemoryItem => Boolean(m));
  return migrateLegacyMemory(project.memory ?? '', now);
}

/** 旧字段 memory 保留一份可读文本，给还没升级的设备看；新版本只以条目为准 */
export function renderMemoryText(items: ProjectMemoryItem[], now = Date.now()): string {
  return activeItems(items, now).map(m => m.text).join('\n\n');
}

export interface AddMemoryInput { text: string; kind?: MemoryKind; source: MemorySource; sourceRef?: string; status?: MemoryStatus; pinned?: boolean; id?: string; applicability?: string; evidence?: string; keywords?: string[]; expiresAt?: number; createdAt?: number }
export interface AddMemoryResult { items: ProjectMemoryItem[]; item?: ProjectMemoryItem; duplicate?: boolean; redacted?: boolean; error?: string }

export function addMemory(items: ProjectMemoryItem[], input: AddMemoryInput, now = Date.now()): AddMemoryResult {
  const clean = redactSecrets(String(input.text ?? '').trim());
  const text = clean.text.trim();
  if (!text) return { items, error: '记忆内容不能为空' };
  if (text.length > MEMORY_TEXT_MAX) return { items, error: '一条记忆最多 1000 字，请拆开写' };
  const hash = hashText(normalizeText(text));
  const same = items.find(m => m.hash === hash);
  if (same && !same.deletedAt) {
    // 已有同样的：候选被正式写入时转正，其余当重复
    if (same.status === 'candidate' && input.status !== 'candidate') {
      const promoted = { ...same, status: undefined, source: input.source === 'candidate' ? 'candidate' : same.source, updatedAt: now };
      delete promoted.status;
      return { items: items.map(m => (m.id === same.id ? promoted : m)), item: promoted, redacted: clean.redacted };
    }
    return { items, item: same, duplicate: true, redacted: clean.redacted };
  }
  // 用户删掉过的同一句，不再作为候选冒出来；用户或模型明确再写则允许
  if (same?.deletedAt && input.status === 'candidate') return { items, item: same, duplicate: true };
  const item: ProjectMemoryItem = {
    id: input.id && /^[\w:-]{1,80}$/.test(input.id) ? input.id : `m_${hash}_${now.toString(36)}`,
    text, kind: input.kind && MEMORY_KINDS.includes(input.kind) ? input.kind : 'note', source: input.source,
    createdAt: now, updatedAt: now, hash,
  };
  if (input.sourceRef) item.sourceRef = String(input.sourceRef).slice(0, 200);
  if (input.status === 'candidate') item.status = 'candidate';
  if (input.pinned) item.pinned = true;
  if (input.createdAt && input.createdAt < now) item.createdAt = input.createdAt;
  if (input.applicability?.trim()) item.applicability = redactSecrets(input.applicability.trim().slice(0, MEMORY_TEXT_MAX)).text;
  if (input.evidence?.trim()) item.evidence = redactSecrets(input.evidence.trim().slice(0, MEMORY_TEXT_MAX)).text;
  const keywords = cleanKeywords(input.keywords);
  if (keywords.length) item.keywords = keywords;
  if (input.expiresAt && input.expiresAt > now) item.expiresAt = input.expiresAt;
  return { items: [...items.filter(m => m.id !== item.id), item], item, redacted: clean.redacted };
}

export type MemoryPatch = Partial<Pick<ProjectMemoryItem, 'text' | 'kind' | 'pinned' | 'expiresAt' | 'applicability' | 'evidence' | 'keywords'>> & { approve?: boolean };

export function updateMemory(items: ProjectMemoryItem[], id: string, patch: MemoryPatch, now = Date.now()): AddMemoryResult {
  const current = items.find(m => m.id === id && !m.deletedAt);
  if (!current) return { items, error: '找不到这条记忆，可能已经删除' };
  const next: ProjectMemoryItem = { ...current, updatedAt: now, revision: (current.revision ?? 1) + 1 };
  let redacted = false;
  if (patch.text !== undefined) {
    const clean = redactSecrets(String(patch.text).trim());
    if (!clean.text.trim()) return { items, error: '记忆内容不能为空' };
    if (clean.text.length > MEMORY_TEXT_MAX) return { items, error: '一条记忆最多 1000 字，请拆开写' };
    next.text = clean.text.trim(); next.hash = hashText(normalizeText(next.text)); redacted = clean.redacted;
  }
  if (patch.kind && MEMORY_KINDS.includes(patch.kind)) next.kind = patch.kind;
  if (patch.pinned !== undefined) { if (patch.pinned) next.pinned = true; else delete next.pinned; }
  if (patch.expiresAt !== undefined) { if (patch.expiresAt) next.expiresAt = patch.expiresAt; else delete next.expiresAt; }
  for (const key of ['applicability', 'evidence'] as const) {
    if (patch[key] === undefined) continue;
    const clean = redactSecrets(String(patch[key]).trim().slice(0, MEMORY_TEXT_MAX));
    if (clean.text) next[key] = clean.text; else delete next[key];
    redacted ||= clean.redacted;
  }
  if (patch.keywords !== undefined) { const k = cleanKeywords(patch.keywords); if (k.length) next.keywords = k; else delete next.keywords; }
  if (patch.approve) delete next.status;
  return { items: items.map(m => (m.id === id ? next : m)), item: next, redacted };
}

/** 删除 = 留墓碑：正文清空，保留哈希，其他设备同步后也删掉，同一句不会再被提议 */
export function forgetMemory(items: ProjectMemoryItem[], id: string, now = Date.now()): AddMemoryResult {
  const current = items.find(m => m.id === id && !m.deletedAt);
  if (!current) return { items, error: '找不到这条记忆，可能已经删除' };
  const grave: ProjectMemoryItem = { id: current.id, text: '', kind: current.kind, source: current.source, createdAt: current.createdAt, updatedAt: now, deletedAt: now, hash: current.hash, revision: (current.revision ?? 1) + 1 };
  return { items: items.map(m => (m.id === id ? grave : m)), item: grave };
}

/** 墓碑保留 180 天，之后清掉，免得无限增长 */
export function pruneMemory(items: ProjectMemoryItem[], now = Date.now()): ProjectMemoryItem[] {
  return items.filter(m => !m.deletedAt || now - m.deletedAt < 180 * 86400000);
}

/* ---------------- 进提示词 ---------------- */

export interface MemorySelection { prompt: string; selected: ProjectMemoryItem[]; omitted: number; total: number }

const line = (m: ProjectMemoryItem) => `- [${m.id}]（${MEMORY_KIND_LABEL[m.kind]}）${m.text}${m.applicability ? `（适用：${m.applicability}）` : ''}`;

/**
 * 选哪些记忆进 system prompt。
 * 放得下就全放，按创建时间排 —— 前缀稳定，上下文缓存能命中。
 * 放不下时：置顶的先放，其余按与当前问题的相关度（BM25）和新近程度排，装满预算为止；
 * 装进去的仍按创建时间输出，尽量少打乱前缀。
 */
export function selectMemoryForPrompt(items: ProjectMemoryItem[], opts: { query?: string; budget?: number; now?: number } = {}): MemorySelection {
  const now = opts.now ?? Date.now();
  const budget = opts.budget ?? MEMORY_PROMPT_BUDGET;
  // 限定了关键词的条目，问题里没出现那些词就不放
  const live = activeItems(items, now).filter(m => keywordsMatch(m, opts.query ?? '')).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const size = (list: ProjectMemoryItem[]) => list.reduce((n, m) => n + line(m).length + 1, 0);
  let chosen: ProjectMemoryItem[];
  if (size(live) <= budget) chosen = live;
  else {
    const hits = new Map(createSearchIndex(live.map(m => ({ id: m.id, text: `${m.text} ${MEMORY_KIND_LABEL[m.kind]}` }))).search(opts.query ?? '', live.length).map(h => [h.id, h.score]));
    const top = Math.max(1, ...hits.values());
    const score = (m: ProjectMemoryItem) => (m.pinned ? 100 : 0) + (hits.get(m.id) ?? 0) / top * 2 + Math.exp(-(now - m.updatedAt) / (60 * 86400000)) * 0.5 + (m.kind === 'preference' || m.kind === 'decision' ? 0.2 : 0);
    const ranked = [...live].sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt);
    chosen = [];
    let used = 0;
    for (const m of ranked) {
      const cost = line(m).length + 1;
      if (used + cost > budget) continue;
      chosen.push(m); used += cost;
    }
    chosen.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  return { prompt: chosen.map(line).join('\n'), selected: chosen, omitted: live.length - chosen.length, total: live.length };
}

/** 模型或本机客户端查记忆：有查询词按相关度，没有就按时间倒序 */
export function searchMemory(items: ProjectMemoryItem[], query: string, limit = 20, now = Date.now()): ProjectMemoryItem[] {
  const live = activeItems(items, now);
  if (!String(query ?? '').trim()) return [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const byId = new Map(live.map(m => [m.id, m]));
  return createSearchIndex(live.map(m => ({ id: m.id, text: m.text }))).search(query, limit).map(h => byId.get(h.id)!).filter(Boolean);
}

export const formatMemoryList = (list: ProjectMemoryItem[]) => list.map(line).join('\n');

/* ---------------- 合并 ---------------- */

const canon = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon((v as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(v) ?? 'null';
};
const newer = (a: ProjectMemoryItem, b: ProjectMemoryItem) => {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (Boolean(a.deletedAt) !== Boolean(b.deletedAt)) return a.deletedAt ? a : b; // 同一时刻删和改，删除优先
  return canon(a) <= canon(b) ? a : b;
};

/** 两份条目按 id 合并：新的赢，同时刻删除优先；和合并顺序无关 */
export function mergeMemoryItems(a: ProjectMemoryItem[], b: ProjectMemoryItem[]): ProjectMemoryItem[] {
  const byId = new Map<string, ProjectMemoryItem>();
  for (const m of [...a, ...b]) { const prev = byId.get(m.id); byId.set(m.id, prev ? newer(prev, m) : m); }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

/** 三方合并（云同步用）：只有一边改过就取那一边，两边都改过取新的，从不报冲突 */
export function mergeMemoryItems3(base: ProjectMemoryItem[], local: ProjectMemoryItem[], remote: ProjectMemoryItem[]): ProjectMemoryItem[] {
  const [b, l, r] = [base, local, remote].map(list => new Map(list.map(m => [m.id, m])));
  const out: ProjectMemoryItem[] = [];
  for (const id of [...new Set([...b.keys(), ...l.keys(), ...r.keys()])].sort()) {
    const x = b.get(id), y = l.get(id), z = r.get(id);
    let pick: ProjectMemoryItem | undefined;
    if (canon(y) === canon(z)) pick = y;
    else if (canon(y) === canon(x)) pick = z;
    else if (canon(z) === canon(x)) pick = y;
    else pick = y && z ? newer(y, z) : (y ?? z);
    if (pick) out.push(pick);
  }
  return out;
}

/* ---------------- 候选 ---------------- */

/*
 * 规则提炼，固定评测集见 tests/fixtures/memory-candidates.json（改规则时看召回和误报两个数）。
 * 要有「跨对话还成立」的信号（以后 / 每次 / 统一 / 一律 / always …），
 * 再排除提问、转述别人的话、这一次的临时安排、编辑指令里引用的词。
 */
const DURABLE_CUES = /(以后|今后|往后|从现在起|之后都|下次(?!再说)|每次|每个.{0,12}都|所有.{0,12}都|一律|统一|总是|始终|永远|默认(?:用|使用|是|都)|记住|记得|别再|不要再|不许|^(?:请)?禁止(?:在|使用|用|直接|提交|修改|自动)|我(?:更)?(?:喜欢|偏好|习惯)|我希望你|请始终|\b(?:always|never|from now on|going forward|by default|remember (?:that|to|:)|remember:|every time|in this project|all new|(?:i|we) (?:prefer|'d rather|would rather)|please (?:always|never|avoid)|don'?t (?:ever )?use|do not (?:ever )?use|make sure to always)\b)/i;
const DECISION_CUES = /(决定|定下来|就用|改用|统一|约定|规定|\b(?:we(?:'ll| will) use|let's use|decided|standardi[sz]e on)\b)/i;
/** 「我们决定…」「就用…」本身就是约定，不需要额外的「以后」 */
const DECISION_STRONG = /^(?:我们|咱们)?(?:决定|定下来)|^(?:就用|统一用|约定[:：])|^(?:we(?:'ve)? decided|we(?:'ll| will) use|let's use .{1,40} for (?:all|every)|standardi[sz]e on)\b/i;
const VETO = [
  /[?？]\s*$/, // 提问
  /(?:吗|呢|怎么|为什么|为啥|是不是|能不能|可不可以|多少|什么)[^，,。]*$/,
  /^(?:can|could|would|will|do|does|did|is|are|what|why|how|when|where|which|should)\b/i,
  /^(?:他们|他|她|有人|别人)|(?:用户反馈|(?:文章|文档|书|网上)(?:里|上)?(?:说|写)|(?<!其)他说|她说|有人说|别人说)|\b(?:the docs|the article|they|he|she|someone) (?:say|says|said|decided)\b|\bi think\b|\bremember when\b/i, // 转述、猜测
  /(?:这次|这回|今天|明天|刚才|刚刚|暂时|先.{0,6}(?:试试|这样|看看)|下次再说|\b(?:this time|for now|today|right now)\b)/i, // 临时
  /把.{0,30}(?:改成|换成|删掉|标出)|\b(?:change|replace|rename) .{0,30} (?:to|with)\b/i, // 编辑指令里引用的词
  /^(?:请)?(?:帮我|给我|把|运行|查一下|翻译|总结)|^(?:please )?(?:fix|show|summari[sz]e|translate|run|look at)\b|^let'?s (?!use\b)/i, // 一次性动作
];

/**
 * 从用户自己的话里找值得跨对话记住的偏好和约定。只看用户消息，不看模型回答 ——
 * 模型说的话可能是编的。只生成候选，写入要用户批准。
 */
export function memoryCandidatesFrom(userTexts: string[], limit = 3): { text: string; kind: MemoryKind }[] {
  const out: { text: string; kind: MemoryKind }[] = [];
  const seen = new Set<string>();
  for (const raw of userTexts) {
    const text = String(raw ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]{0,80}`/g, m => m.slice(1, -1)).replace(/<[^>]{1,40}>/g, ' ');
    for (const sentence of text.split(/(?<=[。！？!?\n])|(?<=[.;；])\s+/)) {
      const s = sentence.replace(/\s+/g, ' ').trim();
      if (s.length < 6 || s.length > 200) continue;
      const strong = DECISION_STRONG.test(s);
      if (!strong && !DURABLE_CUES.test(s)) continue;
      if (VETO.some(re => re.test(s))) continue;
      const kind: MemoryKind = strong || DECISION_CUES.test(s) ? 'decision' : 'preference';
      const clean = redactSecrets(s).text;
      const key = normalizeText(clean);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text: clean, kind });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
