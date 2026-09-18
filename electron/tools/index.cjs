'use strict';
/**
 * 工具分发器。渲染进程只发 (name, args, ctx)，密钥由这里自己从安全存储取 ——
 * Tavily / Brave / GitHub 的 token 一律不进渲染进程。
 */
const store = require('../store.cjs');
const { fail } = require('./common.cjs');
const web = require('./web.cjs');
const files = require('./files.cjs');
const shell = require('./shell.cjs');
const chrome = require('./chrome.cjs');
const github = require('./github.cjs');
const claudecode = require('./claudecode.cjs');
const knowledge = require('./knowledge.cjs');
const documents = require('./documents.cjs');
const computer = require('./computer.cjs');
const { runtimeStore } = require('../run-store.cjs');
const { verifyFiles } = require('../file-records.cjs');
const crypto = require('node:crypto');
const { inspectDeliverable, recoverExactWrite } = require('./verification.cjs');
const { runHooks } = require('../hooks.cjs');

/**
 * 操作编号：从「做了什么」派生，不从「在对话的哪个位置发起」派生。
 *
 * 账本原来只有一把键：runId:${round}-${i}-${call.id} —— 轮次、批内序号、模型自己
 * 生成的调用 id。换个模型接手，这三样全变，同一件事在账本里就成了一件新事，
 * 「这个操作做过没有」于是永远答「没做过」。自动交接建立在这个答案上，
 * 答错一次就是重复推送、重复建 issue。
 *
 * 所以另存一份按内容派生的编号：做的是同一件事，不管谁在哪一轮发起，编号都一样。
 * 参数先递归按键排序再哈希 —— 不同模型序列化同一组参数时字段顺序可能不同，
 * 不排序就等于白记。数组保持原序，顺序在数组里是有意义的。
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}
function opKeyOf(name, args) {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ name, args: canonical(args && typeof args === 'object' ? args : {}) }))
    .digest('hex');
}

/**
 * 重复发起要拦下来的操作。
 *
 * 刻意只有两项。`run_command` 不在里面：同一条 `npm test` 本来就该重跑，
 * 拦住它、把上一次的旧结果当成这一次的答案，比重复执行更危险。
 * `write_file` / `edit_file` 也不在里面：同样内容写第二遍是幂等的，没有害处。
 * 留下的是「同样参数发第二遍就是多了一件事」的那两类。
 */
function onceOnly(name, args) {
  if (name === 'github_api') return String(args.method || 'GET').toUpperCase() !== 'GET';
  if (name === 'project_memory_write') return args.mode !== 'replace';
  return false;
}

/** 按 id 取密钥。工具模块通过这个函数拿，拿不到就返回 null */
async function secrets(id) {
  try {
    return store.secretGet(`tool:${id}`);
  } catch {
    return null;
  }
}

const HANDLERS = {
  reconcile_operation: async (a,c) => {
    const runId=String(a.runId || ''),callId=String(a.callId || ''),name=String(a.name || '');
    const input=a.args && typeof a.args==='object'?a.args:{};
    const job=runtimeStore().job(runId,callId);
    if(!job){
      // 位置键落空，多半是换了模型或换了轮次。按操作编号再查一次：
      // 「这件事本次任务里做过没有」不该因为换了执行者就答不上来。
      const prior=runtimeStore().op(runId,opKeyOf(name,input));
      if(prior?.callId&&prior.callId!==callId){
        const earlier=runtimeStore().job(runId,prior.callId);
        if(earlier?.result)return {...earlier.result,operationStatus:'completed',
          summary:`此操作本次任务里已由调用 ${prior.callId} 完成，返回当时的结果`};
        if(prior.status==='started')return {ok:false,uncertain:true,operationStatus:'uncertain',content:'',
          error:`此操作本次任务里已由调用 ${prior.callId} 发起，但没有可靠的完成记录。请先核实外部结果，再决定跳过还是重做。`};
      }
      return {ok:false,operationStatus:'not_started',content:'这项旧计划尚未开始；用户补充要求后已取消派发。',summary:'取消尚未执行的旧计划'};
    }
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({name,args:input})).digest('hex');
    if(job.fingerprint!==fingerprint)return {ok:false,uncertain:true,operationStatus:'uncertain',content:'',error:'原操作记录与参数不一致，需要核实'};
    if(job.result)return {...job.result,operationStatus:'completed'};
    const active=activeJobs.get(`${runId}:${callId}`);
    if(active){const result=await active.promise;return {...result,operationStatus:result.uncertain?'uncertain':'completed'};}
    const recovered=name==='write_file'?recoverExactWrite(input,c):null;
    if(recovered){recovered.files=verifyFiles([recovered.filePath],c.workspaceRoots).files;runtimeStore().saveJob(runId,callId,{fingerprint,name,status:'completed',result:recovered,at:Date.now(),recovered:true});return {...recovered,operationStatus:'completed'};}
    return {ok:false,uncertain:true,operationStatus:'uncertain',content:'',error:'旧操作已经开始，但没有可靠结果；先核实该操作，随后按补充信息重新规划。'};
  },
  inspect_deliverable: inspectDeliverable,
  read_tool_result: (a) => {
    const r = runtimeStore().readResult(String(a.id || ''), a.offset, a.limit);
    return { ok: true, content: JSON.stringify(r), summary: '读取已保存的工具结果' };
  },
  register_outputs: (a, c) => {
    const r = verifyFiles(Array.isArray(a.paths) ? a.paths : [], c.workspaceRoots);
    return { ok: r.errors.length === 0 && r.files.length > 0, content: JSON.stringify(r),
      files: r.files, error: r.errors.map((x) => x.error).join('\n') || undefined,
      summary: `核实 ${r.files.length} 个交付文件` };
  },
  web_search: (a, c) => web.webSearch(a, c, secrets),
  fetch_url: (a, c) => web.fetchUrl(a, c),

  list_dir: (a, c) => files.listDir(a, c),
  read_file: (a, c) => files.readFile(a, c),
  read_document: (a, c) => documents.readDocument(a, c),
  write_document: (a, c) => documents.writeDocument(a, c),
  write_file: (a, c) => files.writeFile(a, c),
  edit_file: (a, c) => files.editFile(a, c),
  search_files: (a, c) => files.searchFiles(a, c),

  run_command: (a, c) => shell.runCommand(a, c),

  computer_screenshot: (a, c) => computer.screenshot(a, c),
  computer_click: (a, c) => computer.click(a, c),
  computer_move: (a, c) => computer.moveMouse(a, c),
  computer_scroll: (a, c) => computer.scroll(a, c),
  computer_type: (a, c) => computer.typeText(a, c),
  computer_key: (a, c) => computer.pressKey(a, c),

  chrome_tabs: (a, c) => chrome.chromeTabs(a, c),
  chrome_navigate: (a, c) => chrome.chromeNavigate(a, c),
  chrome_read_page: (a, c) => chrome.chromeReadPage(a, c),
  chrome_click: (a, c) => chrome.chromeClick(a, c),
  chrome_eval: (a, c) => chrome.chromeEval(a, c),
  chrome_fetch_json: (a, c) => chrome.chromeFetchJson(a, c),

  github_api: (a, c) => github.githubApi(a, c, secrets),
  github_search: (a, c) => github.githubSearch(a, c, secrets),

  claude_code: (a, c) => claudecode.claudeCode(a, c),

  project_memory_read: (a, c) => knowledge.projectMemoryRead(a, c),
  project_memory_write: (a, c) => knowledge.projectMemoryWrite(a, c),
  project_doc_read: (a, c) => knowledge.projectDocRead(a, c),
  project_doc_write: (a, c) => knowledge.projectDocWrite(a, c),
  skill_list: (a, c) => knowledge.skillList(a, c),
  skill_write: (a, c) => knowledge.skillWrite(a, c),
};

const DEFAULT_CTX = {
  workspaceRoots: [],
  searchProvider: 'tavily',
  searxngUrl: '',
  chromePort: 9222,
  claudeBin: '',
  claudeExtraArgs: '',
  claudeTimeoutMs: 600000,
  toolTimeoutMs: 120000,
  projectId: null,
};

async function executeTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return fail(`没有这个工具：${name}`);

  const merged = Object.assign({}, DEFAULT_CTX, ctx || {});
  if (!Array.isArray(merged.workspaceRoots)) merged.workspaceRoots = [];

  const input = args && typeof args === 'object' ? args : {};
  const execution = merged.execution;
  const journal = execution?.runId && execution?.callId ? runtimeStore() : null;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ name, args: input })).digest('hex');
  const readOnly = new Set(['inspect_deliverable', 'read_tool_result', 'register_outputs', 'web_search', 'fetch_url', 'list_dir',
    'read_file', 'read_document', 'search_files', 'chrome_tabs', 'chrome_read_page', 'chrome_fetch_json', 'github_search',
    'project_memory_read', 'project_doc_read', 'skill_list']);
  const opKey = journal && !readOnly.has(name) ? opKeyOf(name, input) : null;
  if (journal) {
    const previous = journal.job(execution.runId, execution.callId);
    if (previous && previous.fingerprint !== fingerprint) return fail('同一工具调用编号对应了不同参数，已停止执行');
    if (previous?.result) return previous.result;
    if (previous?.status === 'started' && !readOnly.has(name) && !execution.retryUncertain) {
      const recovered = name === 'write_file' ? recoverExactWrite(input,merged) : null;
      if (recovered) {
        recovered.files = verifyFiles([recovered.filePath],merged.workspaceRoots).files;
        journal.saveJob(execution.runId,execution.callId,{fingerprint,name,status:'completed',result:recovered,at:Date.now(),recovered:true});
        return recovered;
      }
      return { ok: false, content: '', uncertain: true,
        error: '这一步在中断前已开始，但没有可靠的完成记录。请先核实外部结果，再选择跳过或明确允许重试，避免重复操作。' };
    }
    if (opKey) {
      const done = journal.op(execution.runId, opKey);
      if (done && done.callId !== execution.callId && onceOnly(name, input)) {
        if (done.status === 'completed') return { ok: false, content: '', repeated: { at: done.at, callId: done.callId },
          error: `这次任务里已经做过完全相同的操作（调用 ${done.callId}），本次没有重复执行。需要那次的结果就去读它；确实要再做一遍，请改变参数或说明理由，由用户确认。` };
        return { ok: false, content: '', uncertain: true,
          error: `这次任务里已由调用 ${done.callId} 发起过完全相同的操作，但没有可靠的完成记录。请先核实外部结果，再决定跳过还是重做。` };
      }
      journal.saveOp(execution.runId, opKey, { name, status: 'started', callId: execution.callId, at: Date.now() });
    }
    journal.saveJob(execution.runId, execution.callId, { fingerprint, name, status: 'started', at: Date.now() });
  }
  try {
    const res = (await handler(input, merged)) || fail(`${name} 没有返回结果`);
    const outputPaths = [res.filePath, ...(Array.isArray(input.output_files) ? input.output_files : [])].filter(Boolean);
    const inputPaths = ['read_file', 'read_document'].includes(name) && input.path ? [input.path] : [];
    const outputs = verifyFiles(outputPaths, merged.workspaceRoots);
    const inputs = verifyFiles(inputPaths, merged.workspaceRoots, 'input');
    res.files = [...(res.files || []), ...outputs.files, ...inputs.files];
    if (outputs.errors.length) {
      res.content += `\n文件核实失败：${outputs.errors.map((x) => x.error).join('; ')}`;
      if (res.filePath) delete res.filePath;
    }
    if (journal && String(res.content).length > 12000) {
      const raw = String(res.content);
      res.resultRef = journal.saveResult(execution.runId, execution.callId, raw);
      res.content = `${raw.slice(0, 8000)}\n\n[完整结果已保存，${raw.length} 字符；用 read_tool_result(id="${res.resultRef}", offset=8000) 分页读取，不必重新查询。]\n\n${raw.slice(-2000)}`;
    }
    // 护栏在工具真的改了东西之后才跑。失败的调用没有可检查的后果，不触发。
    if (res.ok !== false && !readOnly.has(name)) {
      try {
        const note = await runHooks({ name, result: res, ctx: merged });
        if (note) { res.content = `${res.content ?? ''}${note}`; res.hookFailed = true; }
      } catch (error) {
        res.content = `${res.content ?? ''}\n\n【护栏无法运行】${error.message}。这次操作的自动检查没有执行，不代表它通过了。`;
      }
    }
    if (journal) journal.saveJob(execution.runId, execution.callId, { fingerprint, name, status: 'completed', result: res, at: Date.now() });
    // 只记「做过、什么时候、哪次调用」，不在这里存结果本体。
    // 存了就会引出自动重放，而把旧结果当成这一次的答案，是比重复执行更隐蔽的错误。
    if (opKey) journal.saveOp(execution.runId, opKey, { name, status: 'completed', callId: execution.callId, at: Date.now() });
    return res;
  } catch (e) {
    if (journal) return { ok: false, content: '', uncertain: true,
      error: `操作执行或完成记录写入时中断，需要核实结果：${e.message}` };
    return fail(e);
  }
}

// A paused renderer can reconnect while the original native operation still runs.
// Join that operation even when retry was explicitly allowed; never execute it twice concurrently.
const activeJobs = new Map();
async function runTool(name, args, ctx) {
  const execution = ctx?.execution;
  if (!execution?.runId || !execution?.callId) return executeTool(name, args, ctx);
  const key = `${execution.runId}:${execution.callId}`;
  const fingerprint = JSON.stringify({ name, args });
  const active = activeJobs.get(key);
  if (active) return active.fingerprint === fingerprint ? active.promise : fail('同一工具调用编号对应了不同参数，已停止执行');
  const promise = executeTool(name, args, ctx);
  activeJobs.set(key, { fingerprint, promise });
  try { return await promise; }
  finally { if (activeJobs.get(key)?.promise === promise) activeJobs.delete(key); }
}
module.exports = { runTool, TOOL_NAMES: Object.keys(HANDLERS) };
