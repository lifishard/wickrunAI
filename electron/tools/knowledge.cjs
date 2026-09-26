'use strict';
/**
 * 项目记忆 / 项目文档 / 技能 的读写工具。
 *
 * 这些数据存在跟渲染进程同一份 kv 里（store.cjs 的 kv 段），所以两边看到的
 * 永远是同一份，不需要再造一套同步。渲染进程通过 transport.kvGet/kvSet 读写，
 * 主进程这边直接 store.kvGet/kvSet。
 */
const store = require('../store.cjs');
const { ok, fail, clip } = require('./common.cjs');

const K_PROJECTS = 'snc:projects:v1';
const K_SKILLS = 'snc:skills:v1';

function readList(key) {
  try {
    const raw = store.kvGet(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  return store.kvSet(key, JSON.stringify(list));
}

function currentProject(ctx) {
  if (!ctx.projectId) return null;
  return readList(K_PROJECTS).find((p) => p.id === ctx.projectId) ?? null;
}

const NO_PROJECT = '当前对话不属于任何项目。把对话放进一个项目里，这个工具才有东西可读写。';

/* ---------------- 项目记忆 ---------------- */
// 记忆是一条一条的（src/lib/memory-core.ts，主进程用打包版）。旧的整段文字第一次读到时迁移成条目。
const memory = require('../memory-core.bundle.cjs');
const KINDS = new Set(['preference', 'decision', 'fact', 'lesson', 'note']);

function saveMemory(list, i, items) {
  const kept = memory.pruneMemory(items);
  list[i] = { ...list[i], memoryItems: kept, memory: memory.renderMemoryText(kept) };
  return writeList(K_PROJECTS, list);
}

function projectMemoryRead(args, ctx) {
  const p = currentProject(ctx);
  if (!p) return fail(NO_PROJECT);
  const items = memory.memoryItemsOf(p);
  const live = memory.activeItems(items);
  if (!live.length) return ok(`项目「${p.name}」还没有记忆内容。`, { summary: '读项目记忆：空' });
  const query = String(args?.query || '').trim();
  const found = memory.searchMemory(items, query, Math.max(1, Math.min(50, Number(args?.limit) || 30)));
  if (!found.length) return ok(`项目「${p.name}」的 ${live.length} 条记忆里没有和「${clip(query, 40)}」相关的。`, { summary: `查项目记忆：没有匹配` });
  return ok(memory.formatMemoryList(found), {
    summary: query ? `查项目记忆「${clip(query, 20)}」（${found.length} 条）` : `读项目记忆（${found.length}/${live.length} 条）`,
  });
}

async function projectMemoryWrite(args, ctx) {
  const p = currentProject(ctx);
  if (!p) return fail(NO_PROJECT);
  if (args.mode === 'replace' && !args.id) return fail('不再支持整段覆盖。要改某一条，传那条的 id；要删，用 project_memory_forget。');
  const text = String(args.text || '').trim();
  if (!text) return fail('text 不能为空');
  const list = readList(K_PROJECTS);
  const i = list.findIndex((x) => x.id === p.id);
  if (i < 0) return fail('项目不见了，可能刚被删掉');
  const items = memory.memoryItemsOf(list[i]);
  const kind = KINDS.has(args.kind) ? args.kind : undefined;
  const extra = {};
  for (const key of ['applicability', 'evidence']) if (typeof args[key] === 'string') extra[key] = args[key];
  if (Array.isArray(args.keywords)) extra.keywords = args.keywords;
  const result = args.id
    ? memory.updateMemory(items, String(args.id), { text, ...(kind ? { kind } : {}), ...extra })
    : memory.addMemory(items, { text, kind, source: 'model', sourceRef: ctx.conversationId || undefined, ...extra });
  if (result.error) return fail(result.error);
  if (result.duplicate) return ok(`项目「${p.name}」已经有这条记忆（${result.item.id}），没有重复记录。`, { summary: '写项目记忆：已存在' });
  await saveMemory(list, i, result.items);
  const note = result.redacted ? '其中像密钥或密码的内容已替换成 [REDACTED]。' : '';
  return ok(`已${args.id ? '更新' : '记下'}项目「${p.name}」的记忆 ${result.item.id}。${note}`, {
    summary: `${args.id ? '更新' : '写'}项目记忆（${text.length} 字）`,
  });
}

async function projectMemoryForget(args, ctx) {
  const p = currentProject(ctx);
  if (!p) return fail(NO_PROJECT);
  const id = String(args.id || '').trim();
  if (!id) return fail('需要要删除的那条记忆的 id（project_memory_read 的结果里有）');
  const list = readList(K_PROJECTS);
  const i = list.findIndex((x) => x.id === p.id);
  if (i < 0) return fail('项目不见了，可能刚被删掉');
  const result = memory.forgetMemory(memory.memoryItemsOf(list[i]), id);
  if (result.error) return fail(result.error);
  await saveMemory(list, i, result.items);
  return ok(`已删除项目「${p.name}」的记忆 ${id}。`, { summary: `删除项目记忆 ${id}` });
}

/*
 * 本机客户端（Claude Desktop 等，经 wickrun_ai 连接器）用的两个入口。
 * 只认任务上带的项目；查询只读；提交只能生成候选，要用户在 wickrunAI 里批准才会用到。
 */
const nativeMemory = {
  search(projectId, query, limit) {
    const p = projectId ? readList(K_PROJECTS).find((x) => x.id === projectId) : null;
    if (!p) throw Error('这个任务不属于任何项目，没有项目记忆可查');
    const items = memory.memoryItemsOf(p);
    const found = memory.searchMemory(items, String(query || ''), Math.max(1, Math.min(30, Number(limit) || 10)));
    return { project: p.name, total: memory.activeItems(items).length, items: found.map((m) => ({ id: m.id, kind: m.kind, text: m.text, pinned: Boolean(m.pinned) })) };
  },
  async propose(projectId, { text, kind, sourceRef }) {
    const list = readList(K_PROJECTS);
    const i = projectId ? list.findIndex((x) => x.id === projectId) : -1;
    if (i < 0) throw Error('这个任务不属于任何项目，没有地方放记忆候选');
    const result = memory.addMemory(memory.memoryItemsOf(list[i]), {
      text: String(text || ''), kind: KINDS.has(kind) ? kind : undefined, source: 'client', status: 'candidate', sourceRef,
    });
    if (result.error) throw Error(result.error);
    if (result.duplicate) return { ok: true, duplicate: true, id: result.item.id, message: '项目里已经有这条（或用户删过它），没有重复提交。' };
    await saveMemory(list, i, result.items);
    return { ok: true, id: result.item.id, redacted: Boolean(result.redacted), message: '已作为候选提交，用户在 wickrunAI 里批准后才会用到。' };
  },
};

/* ---------------- 项目文档 ---------------- */

function projectDocRead(args, ctx) {
  const p = currentProject(ctx);
  if (!p) return fail(NO_PROJECT);

  const docs = p.docs || [];
  if (!docs.length) return fail(`项目「${p.name}」里没有文档。`);

  const name = String(args.name || '').trim();
  if (!name) {
    return ok(docs.map((d) => `- ${d.name}（${d.text.length} 字）`).join('\n'), {
      summary: `列出项目文档（${docs.length} 篇）`,
    });
  }

  const lower = name.toLowerCase();
  const hit =
    docs.find((d) => d.name.toLowerCase() === lower) ||
    docs.find((d) => d.name.toLowerCase().includes(lower));

  if (!hit) {
    return fail(`没有叫「${name}」的文档。现有的：${docs.map((d) => d.name).join('、')}`);
  }

  const maxChars = Math.min(80000, Math.max(500, Number(args.max_chars) || 20000));
  return ok(`# ${hit.name}\n\n${clip(hit.text, maxChars)}`, {
    summary: `读文档《${hit.name}》`,
    sources: [{ title: hit.name, path: `项目文档 / ${p.name} / ${hit.name}` }],
  });
}

async function projectDocWrite(args, ctx) {
  const p = currentProject(ctx);
  if (!p) return fail(NO_PROJECT);

  const name = String(args.name || '').trim();
  const text = String(args.text || '');
  if (!name) return fail('name 不能为空');

  const list = readList(K_PROJECTS);
  const i = list.findIndex((x) => x.id === p.id);
  if (i < 0) return fail('项目不见了');

  const docs = list[i].docs || [];
  const j = docs.findIndex((d) => d.name.toLowerCase() === name.toLowerCase());
  const now = Date.now();

  if (j >= 0) {
    docs[j] = { ...docs[j], text, updatedAt: now };
  } else {
    docs.push({ id: `d-${now}-${Math.random().toString(36).slice(2, 8)}`, name, text, updatedAt: now });
  }
  list[i].docs = docs;
  await writeList(K_PROJECTS, list);

  return ok(`已${j >= 0 ? '更新' : '新建'}文档《${name}》（${text.length} 字）。`, {
    summary: `${j >= 0 ? '更新' : '新建'}文档《${name}》`,
  });
}

/* ---------------- 技能 ---------------- */

function slugify(name) {
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^\w一-龥-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill'
  );
}

function skillList(_args) {
  const list = readList(K_SKILLS);
  if (!list.length) return ok('还没有任何技能。', { summary: '技能：0 个' });
  return ok(
    list.map((s) => `/${s.name}${s.enabled ? '' : '（已停用）'} — ${s.description || '无描述'}`).join('\n'),
    { summary: `列出技能（${list.length} 个）` },
  );
}

async function skillWrite(args) {
  const name = slugify(args.name);
  const body = String(args.body || '').trim();
  if (!body) return fail('body 不能为空 —— 技能的正文就是要注入的那段指令');

  const list = readList(K_SKILLS);
  const i = list.findIndex((s) => s.name === name);
  const now = Date.now();

  const rec = {
    id: i >= 0 ? list[i].id : `sk-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: String(args.description || (i >= 0 ? list[i].description : '') || '').slice(0, 200),
    body,
    source: i >= 0 ? list[i].source : '模型创建',
    enabled: true,
    installedAt: i >= 0 ? list[i].installedAt : now,
    uses: i >= 0 ? list[i].uses : 0,
  };

  if (i >= 0) list[i] = rec;
  else list.push(rec);
  await writeList(K_SKILLS, list);

  return ok(
    `已${i >= 0 ? '更新' : '创建'}技能 /${name}。用户在输入框里打 /${name} 就能唤起。`,
    { summary: `${i >= 0 ? '更新' : '创建'}技能 /${name}` },
  );
}

module.exports = {
  nativeMemory,
  projectMemoryForget,
  projectMemoryRead,
  projectMemoryWrite,
  projectDocRead,
  projectDocWrite,
  skillList,
  skillWrite,
};
