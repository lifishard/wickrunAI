// 由 scripts/build-native-mcp.mjs 从 src/lib/memory-core.ts 生成，请勿手改
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lib/memory-core.ts
var memory_core_exports = {};
__export(memory_core_exports, {
  MEMORY_KINDS: () => MEMORY_KINDS,
  MEMORY_KIND_LABEL: () => MEMORY_KIND_LABEL,
  MEMORY_PROMPT_BUDGET: () => MEMORY_PROMPT_BUDGET,
  MEMORY_TEXT_MAX: () => MEMORY_TEXT_MAX,
  REDACTED: () => REDACTED,
  activeItems: () => activeItems,
  addMemory: () => addMemory,
  candidateItems: () => candidateItems,
  cleanKeywords: () => cleanKeywords,
  createSearchIndex: () => createSearchIndex,
  forgetMemory: () => forgetMemory,
  formatMemoryList: () => formatMemoryList,
  hashText: () => hashText,
  keywordsMatch: () => keywordsMatch,
  memoryCandidatesFrom: () => memoryCandidatesFrom,
  memoryItemsOf: () => memoryItemsOf,
  mergeMemoryItems: () => mergeMemoryItems,
  mergeMemoryItems3: () => mergeMemoryItems3,
  migrateLegacyMemory: () => migrateLegacyMemory,
  normalizeText: () => normalizeText,
  pruneMemory: () => pruneMemory,
  redactSecrets: () => redactSecrets,
  renderMemoryText: () => renderMemoryText,
  searchMemory: () => searchMemory,
  selectMemoryForPrompt: () => selectMemoryForPrompt,
  tokenize: () => tokenize,
  updateMemory: () => updateMemory
});
module.exports = __toCommonJS(memory_core_exports);
var MEMORY_KINDS = ["preference", "decision", "fact", "lesson", "note"];
var MEMORY_KIND_LABEL = { preference: "\u504F\u597D", decision: "\u51B3\u5B9A", fact: "\u4E8B\u5B9E", lesson: "\u7ECF\u9A8C", note: "\u5907\u6CE8" };
var MEMORY_TEXT_MAX = 1e3;
var MEMORY_PROMPT_BUDGET = 6e3;
function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36).padStart(7, "0");
}
function normalizeText(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase().replace(/[。．.，,；;！!？?、:：“”"'‘’（）()\[\]【】\s]+/g, "");
}
var CJK = /[㐀-鿿豈-﫿]/;
function tokenize(text) {
  const out = [];
  const lower = String(text ?? "").normalize("NFKC").toLowerCase();
  for (const m of lower.matchAll(/[a-z0-9_]+|[㐀-鿿豈-﫿]+/g)) {
    const run = m[0];
    if (CJK.test(run[0])) {
      if (run.length === 1) out.push(run);
      for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
    } else if (run.length > 1 || /\d/.test(run)) {
      out.push(run.length > 3 && run.endsWith("s") && !run.endsWith("ss") ? run.slice(0, -1) : run);
    }
  }
  return out;
}
function createSearchIndex(docs) {
  const k1 = 1.2, b = 0.75;
  const tf = docs.map((d) => {
    const counts = /* @__PURE__ */ new Map();
    for (const t of tokenize(d.text)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { id: d.id, counts, len: [...counts.values()].reduce((a, c) => a + c, 0) };
  });
  const df = /* @__PURE__ */ new Map();
  for (const d of tf) for (const t of d.counts.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avg = tf.reduce((a, d) => a + d.len, 0) / Math.max(1, tf.length) || 1;
  const n = tf.length;
  return {
    search(query, limit = 10) {
      const terms = [...new Set(tokenize(query))];
      if (!terms.length) return [];
      const hits = [];
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
    }
  };
}
var SECRET_PATTERNS = [
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
  /(?:密码|口令|密钥|令牌)\s*[:=：]\s*\S+/g
];
var REDACTED = "[REDACTED]";
function redactSecrets(text) {
  let out = String(text ?? "");
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return { text: out, redacted: out !== String(text ?? "") };
}
var alive = (m, now) => !m.deletedAt && (!m.expiresAt || m.expiresAt > now);
var activeItems = (items, now = Date.now()) => items.filter((m) => alive(m, now) && (m.status ?? "active") === "active");
var candidateItems = (items, now = Date.now()) => items.filter((m) => alive(m, now) && m.status === "candidate");
function cleanKeywords(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、]/) : [];
  return [...new Set(list.map((k) => String(k ?? "").trim().slice(0, 60)).filter(Boolean))].slice(0, 20);
}
function keywordsMatch(m, query) {
  if (!m.keywords?.length) return true;
  const q = String(query ?? "").toLowerCase();
  return m.keywords.some((k) => {
    const term = k.toLowerCase();
    if (!/^[a-z0-9][a-z0-9_ -]*$/.test(term)) return q.includes(term);
    return new RegExp(`(?<![a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`).test(q);
  });
}
function cleanItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw;
  if (typeof r.id !== "string" || !/^[\w:-]{1,80}$/.test(r.id)) return null;
  const text = typeof r.text === "string" ? r.text.slice(0, MEMORY_TEXT_MAX) : "";
  const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
  const item = {
    id: r.id,
    text,
    kind: MEMORY_KINDS.includes(r.kind) ? r.kind : "note",
    source: ["user", "model", "correction", "candidate", "legacy", "client"].includes(r.source) ? r.source : "user",
    createdAt: num(r.createdAt) ?? 0,
    updatedAt: num(r.updatedAt) ?? num(r.createdAt) ?? 0,
    hash: typeof r.hash === "string" && r.hash ? r.hash : hashText(normalizeText(text))
  };
  if (typeof r.sourceRef === "string") item.sourceRef = r.sourceRef.slice(0, 200);
  if (r.status === "candidate") item.status = "candidate";
  if (r.pinned === true) item.pinned = true;
  if (num(r.expiresAt)) item.expiresAt = num(r.expiresAt);
  if (typeof r.applicability === "string" && r.applicability.trim()) item.applicability = r.applicability.slice(0, MEMORY_TEXT_MAX);
  if (typeof r.evidence === "string" && r.evidence.trim()) item.evidence = r.evidence.slice(0, MEMORY_TEXT_MAX);
  const keywords = cleanKeywords(r.keywords);
  if (keywords.length) item.keywords = keywords;
  if (Number.isSafeInteger(r.revision) && r.revision > 1) item.revision = r.revision;
  if (num(r.deletedAt)) {
    item.deletedAt = num(r.deletedAt);
    item.text = "";
  }
  return item;
}
function migrateLegacyMemory(text, now = Date.now()) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const block of String(text ?? "").split(/\n\s*\n/)) {
    let body = block.trim();
    if (!body || body.startsWith("\u2026\uFF08\u4E2D\u95F4\u90E8\u5206\u5DF2\u5F52\u6863")) continue;
    let at = now;
    const stamp = body.match(/^\[([^\]]{4,40})\]\s*/);
    if (stamp) {
      const parsed = Date.parse(stamp[1].replace(/\//g, "-").replace(" ", "T"));
      if (Number.isFinite(parsed)) at = parsed;
      body = body.slice(stamp[0].length).trim();
    }
    if (!body) continue;
    const hash = hashText(normalizeText(body));
    if (seen.has(hash)) continue;
    seen.add(hash);
    const correction = /^纠错/.test(body);
    out.push({ id: `m_legacy_${hash}`, text: body.slice(0, MEMORY_TEXT_MAX), kind: correction ? "lesson" : "note", source: correction ? "correction" : "legacy", createdAt: at, updatedAt: at, hash });
  }
  return out;
}
function memoryItemsOf(project, now = Date.now()) {
  if (Array.isArray(project.memoryItems)) return project.memoryItems.map(cleanItem).filter((m) => Boolean(m));
  return migrateLegacyMemory(project.memory ?? "", now);
}
function renderMemoryText(items, now = Date.now()) {
  return activeItems(items, now).map((m) => m.text).join("\n\n");
}
function addMemory(items, input, now = Date.now()) {
  const clean = redactSecrets(String(input.text ?? "").trim());
  const text = clean.text.trim();
  if (!text) return { items, error: "\u8BB0\u5FC6\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" };
  if (text.length > MEMORY_TEXT_MAX) return { items, error: "\u4E00\u6761\u8BB0\u5FC6\u6700\u591A 1000 \u5B57\uFF0C\u8BF7\u62C6\u5F00\u5199" };
  const hash = hashText(normalizeText(text));
  const same = items.find((m) => m.hash === hash);
  if (same && !same.deletedAt) {
    if (same.status === "candidate" && input.status !== "candidate") {
      const promoted = { ...same, status: void 0, source: input.source === "candidate" ? "candidate" : same.source, updatedAt: now };
      delete promoted.status;
      return { items: items.map((m) => m.id === same.id ? promoted : m), item: promoted, redacted: clean.redacted };
    }
    return { items, item: same, duplicate: true, redacted: clean.redacted };
  }
  if (same?.deletedAt && input.status === "candidate") return { items, item: same, duplicate: true };
  const item = {
    id: input.id && /^[\w:-]{1,80}$/.test(input.id) ? input.id : `m_${hash}_${now.toString(36)}`,
    text,
    kind: input.kind && MEMORY_KINDS.includes(input.kind) ? input.kind : "note",
    source: input.source,
    createdAt: now,
    updatedAt: now,
    hash
  };
  if (input.sourceRef) item.sourceRef = String(input.sourceRef).slice(0, 200);
  if (input.status === "candidate") item.status = "candidate";
  if (input.pinned) item.pinned = true;
  if (input.createdAt && input.createdAt < now) item.createdAt = input.createdAt;
  if (input.applicability?.trim()) item.applicability = redactSecrets(input.applicability.trim().slice(0, MEMORY_TEXT_MAX)).text;
  if (input.evidence?.trim()) item.evidence = redactSecrets(input.evidence.trim().slice(0, MEMORY_TEXT_MAX)).text;
  const keywords = cleanKeywords(input.keywords);
  if (keywords.length) item.keywords = keywords;
  if (input.expiresAt && input.expiresAt > now) item.expiresAt = input.expiresAt;
  return { items: [...items.filter((m) => m.id !== item.id), item], item, redacted: clean.redacted };
}
function updateMemory(items, id, patch, now = Date.now()) {
  const current = items.find((m) => m.id === id && !m.deletedAt);
  if (!current) return { items, error: "\u627E\u4E0D\u5230\u8FD9\u6761\u8BB0\u5FC6\uFF0C\u53EF\u80FD\u5DF2\u7ECF\u5220\u9664" };
  const next = { ...current, updatedAt: now, revision: (current.revision ?? 1) + 1 };
  let redacted = false;
  if (patch.text !== void 0) {
    const clean = redactSecrets(String(patch.text).trim());
    if (!clean.text.trim()) return { items, error: "\u8BB0\u5FC6\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A" };
    if (clean.text.length > MEMORY_TEXT_MAX) return { items, error: "\u4E00\u6761\u8BB0\u5FC6\u6700\u591A 1000 \u5B57\uFF0C\u8BF7\u62C6\u5F00\u5199" };
    next.text = clean.text.trim();
    next.hash = hashText(normalizeText(next.text));
    redacted = clean.redacted;
  }
  if (patch.kind && MEMORY_KINDS.includes(patch.kind)) next.kind = patch.kind;
  if (patch.pinned !== void 0) {
    if (patch.pinned) next.pinned = true;
    else delete next.pinned;
  }
  if (patch.expiresAt !== void 0) {
    if (patch.expiresAt) next.expiresAt = patch.expiresAt;
    else delete next.expiresAt;
  }
  for (const key of ["applicability", "evidence"]) {
    if (patch[key] === void 0) continue;
    const clean = redactSecrets(String(patch[key]).trim().slice(0, MEMORY_TEXT_MAX));
    if (clean.text) next[key] = clean.text;
    else delete next[key];
    redacted ||= clean.redacted;
  }
  if (patch.keywords !== void 0) {
    const k = cleanKeywords(patch.keywords);
    if (k.length) next.keywords = k;
    else delete next.keywords;
  }
  if (patch.approve) delete next.status;
  return { items: items.map((m) => m.id === id ? next : m), item: next, redacted };
}
function forgetMemory(items, id, now = Date.now()) {
  const current = items.find((m) => m.id === id && !m.deletedAt);
  if (!current) return { items, error: "\u627E\u4E0D\u5230\u8FD9\u6761\u8BB0\u5FC6\uFF0C\u53EF\u80FD\u5DF2\u7ECF\u5220\u9664" };
  const grave = { id: current.id, text: "", kind: current.kind, source: current.source, createdAt: current.createdAt, updatedAt: now, deletedAt: now, hash: current.hash, revision: (current.revision ?? 1) + 1 };
  return { items: items.map((m) => m.id === id ? grave : m), item: grave };
}
function pruneMemory(items, now = Date.now()) {
  return items.filter((m) => !m.deletedAt || now - m.deletedAt < 180 * 864e5);
}
var line = (m) => `- [${m.id}]\uFF08${MEMORY_KIND_LABEL[m.kind]}\uFF09${m.text}${m.applicability ? `\uFF08\u9002\u7528\uFF1A${m.applicability}\uFF09` : ""}`;
function selectMemoryForPrompt(items, opts = {}) {
  const now = opts.now ?? Date.now();
  const budget = opts.budget ?? MEMORY_PROMPT_BUDGET;
  const live = activeItems(items, now).filter((m) => keywordsMatch(m, opts.query ?? "")).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const size = (list) => list.reduce((n, m) => n + line(m).length + 1, 0);
  let chosen;
  if (size(live) <= budget) chosen = live;
  else {
    const hits = new Map(createSearchIndex(live.map((m) => ({ id: m.id, text: `${m.text} ${MEMORY_KIND_LABEL[m.kind]}` }))).search(opts.query ?? "", live.length).map((h) => [h.id, h.score]));
    const top = Math.max(1, ...hits.values());
    const score = (m) => (m.pinned ? 100 : 0) + (hits.get(m.id) ?? 0) / top * 2 + Math.exp(-(now - m.updatedAt) / (60 * 864e5)) * 0.5 + (m.kind === "preference" || m.kind === "decision" ? 0.2 : 0);
    const ranked = [...live].sort((a, b) => score(b) - score(a) || b.updatedAt - a.updatedAt);
    chosen = [];
    let used = 0;
    for (const m of ranked) {
      const cost = line(m).length + 1;
      if (used + cost > budget) continue;
      chosen.push(m);
      used += cost;
    }
    chosen.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  return { prompt: chosen.map(line).join("\n"), selected: chosen, omitted: live.length - chosen.length, total: live.length };
}
function searchMemory(items, query, limit = 20, now = Date.now()) {
  const live = activeItems(items, now);
  if (!String(query ?? "").trim()) return [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  const byId = new Map(live.map((m) => [m.id, m]));
  return createSearchIndex(live.map((m) => ({ id: m.id, text: m.text }))).search(query, limit).map((h) => byId.get(h.id)).filter(Boolean);
}
var formatMemoryList = (list) => list.map(line).join("\n");
var canon = (v) => {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v) ?? "null";
};
var newer = (a, b) => {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (Boolean(a.deletedAt) !== Boolean(b.deletedAt)) return a.deletedAt ? a : b;
  return canon(a) <= canon(b) ? a : b;
};
function mergeMemoryItems(a, b) {
  const byId = /* @__PURE__ */ new Map();
  for (const m of [...a, ...b]) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? newer(prev, m) : m);
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}
function mergeMemoryItems3(base, local, remote) {
  const [b, l, r] = [base, local, remote].map((list) => new Map(list.map((m) => [m.id, m])));
  const out = [];
  for (const id of [.../* @__PURE__ */ new Set([...b.keys(), ...l.keys(), ...r.keys()])].sort()) {
    const x = b.get(id), y = l.get(id), z = r.get(id);
    let pick;
    if (canon(y) === canon(z)) pick = y;
    else if (canon(y) === canon(x)) pick = z;
    else if (canon(z) === canon(x)) pick = y;
    else pick = y && z ? newer(y, z) : y ?? z;
    if (pick) out.push(pick);
  }
  return out;
}
var DURABLE_CUES = /(以后|今后|往后|从现在起|之后都|下次(?!再说)|每次|每个.{0,12}都|所有.{0,12}都|一律|统一|总是|始终|永远|默认(?:用|使用|是|都)|记住|记得|别再|不要再|不许|^(?:请)?禁止(?:在|使用|用|直接|提交|修改|自动)|我(?:更)?(?:喜欢|偏好|习惯)|我希望你|请始终|\b(?:always|never|from now on|going forward|by default|remember (?:that|to|:)|remember:|every time|in this project|all new|(?:i|we) (?:prefer|'d rather|would rather)|please (?:always|never|avoid)|don'?t (?:ever )?use|do not (?:ever )?use|make sure to always)\b)/i;
var DECISION_CUES = /(决定|定下来|就用|改用|统一|约定|规定|\b(?:we(?:'ll| will) use|let's use|decided|standardi[sz]e on)\b)/i;
var DECISION_STRONG = /^(?:我们|咱们)?(?:决定|定下来)|^(?:就用|统一用|约定[:：])|^(?:we(?:'ve)? decided|we(?:'ll| will) use|let's use .{1,40} for (?:all|every)|standardi[sz]e on)\b/i;
var VETO = [
  /[?？]\s*$/,
  // 提问
  /(?:吗|呢|怎么|为什么|为啥|是不是|能不能|可不可以|多少|什么)[^，,。]*$/,
  /^(?:can|could|would|will|do|does|did|is|are|what|why|how|when|where|which|should)\b/i,
  /^(?:他们|他|她|有人|别人)|(?:用户反馈|(?:文章|文档|书|网上)(?:里|上)?(?:说|写)|(?<!其)他说|她说|有人说|别人说)|\b(?:the docs|the article|they|he|she|someone) (?:say|says|said|decided)\b|\bi think\b|\bremember when\b/i,
  // 转述、猜测
  /(?:这次|这回|今天|明天|刚才|刚刚|暂时|先.{0,6}(?:试试|这样|看看)|下次再说|\b(?:this time|for now|today|right now)\b)/i,
  // 临时
  /把.{0,30}(?:改成|换成|删掉|标出)|\b(?:change|replace|rename) .{0,30} (?:to|with)\b/i,
  // 编辑指令里引用的词
  /^(?:请)?(?:帮我|给我|把|运行|查一下|翻译|总结)|^(?:please )?(?:fix|show|summari[sz]e|translate|run|look at)\b|^let'?s (?!use\b)/i
  // 一次性动作
];
function memoryCandidatesFrom(userTexts, limit = 3) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw of userTexts) {
    const text = String(raw ?? "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]{0,80}`/g, (m) => m.slice(1, -1)).replace(/<[^>]{1,40}>/g, " ");
    for (const sentence of text.split(/(?<=[。！？!?\n])|(?<=[.;；])\s+/)) {
      const s = sentence.replace(/\s+/g, " ").trim();
      if (s.length < 6 || s.length > 200) continue;
      const strong = DECISION_STRONG.test(s);
      if (!strong && !DURABLE_CUES.test(s)) continue;
      if (VETO.some((re) => re.test(s))) continue;
      const kind = strong || DECISION_CUES.test(s) ? "decision" : "preference";
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MEMORY_KINDS,
  MEMORY_KIND_LABEL,
  MEMORY_PROMPT_BUDGET,
  MEMORY_TEXT_MAX,
  REDACTED,
  activeItems,
  addMemory,
  candidateItems,
  cleanKeywords,
  createSearchIndex,
  forgetMemory,
  formatMemoryList,
  hashText,
  keywordsMatch,
  memoryCandidatesFrom,
  memoryItemsOf,
  mergeMemoryItems,
  mergeMemoryItems3,
  migrateLegacyMemory,
  normalizeText,
  pruneMemory,
  redactSecrets,
  renderMemoryText,
  searchMemory,
  selectMemoryForPrompt,
  tokenize,
  updateMemory
});
