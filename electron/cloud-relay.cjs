'use strict';
/*
 * 允许网页版使用本机 AI：桌面版登录云账号后，按用户开关把本机连着的 Claude Code / Codex / Kimi / Grok
 * 报到云端（在线状态 + 可用模型），并领取网页版派给「本机」的任务。
 *
 * 边界：
 *   - 默认关闭；只有登录了云账号且用户打开开关才会联网领取。
 *   - 只做对话：执行记录固定 toolsEnabled:false，Claude Code 关掉全部工具，Codex 用只读沙箱。
 *   - 执行记录放在独立目录（cloud-relay-runs），不进本机会话、观察记录和云端归档。
 *   - 每个任务只执行一次；桌面版中途退出的任务在下次启动时报告受阻，不自动重跑。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const KINDS = ['claude', 'codex', 'kimi', 'grok'];
const ID = /^[0-9a-f-]{36}$/;

function createCloudRelay({ userData, account, clients, runner, store, hostname = os.hostname(), now = Date.now,
  pollMs = 4000, heartbeatMs = 20000, refreshMs = 10 * 60000, log = () => {} }) {
  const file = path.join(userData, 'cloud-relay.json');
  let config = { enabled: false, device: '' };
  try { config = { ...config, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* 第一次使用 */ }
  if (!/^desktop-[0-9a-f]{12}$/.test(config.device)) config.device = 'desktop-' + randomBytes(6).toString('hex');
  const persist = () => {
    fs.mkdirSync(userData, { recursive: true });
    const temp = file + '.' + randomBytes(4).toString('hex') + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ enabled: config.enabled === true, device: config.device }), { mode: 0o600 });
    fs.renameSync(temp, file);
  };
  let timer = null, ticking = null, running = null, current = null;
  let ready = [], checkedAt = 0, beatAt = 0, lastError = '', recovered = false, lastTask = null;

  const request = (pathname, method, body) => account.relay(pathname, method, body);
  const post = (id, action, value) => request(`/api/cloud/relay/tasks/${id}/${action}`, 'POST', { device: config.device, ...(action === 'block' ? { reason: String(value).slice(0, 2000) } : { text: value }) });

  async function refreshClients() {
    const results = await clients.restore();
    ready = results.filter(r => KINDS.includes(r?.kind) && r.status === 'ready')
      .map(r => ({ kind: r.kind, ready: true, models: (r.models || []).slice(0, 50).map(m => ({ id: m.id, label: m.label || m.id, efforts: (m.efforts || []).slice(0, 8) })) }));
    checkedAt = now();
  }

  /** 上次退出时正在执行的任务：结果无法确认，报告受阻而不是重跑 */
  async function recover() {
    for (const record of store.list()) {
      const taskId = record.relayTaskId;
      if (taskId && ID.test(taskId)) await post(taskId, 'block', '桌面版在执行中退出，结果未确认；为避免重复执行，未自动重跑。请在网页版重新发送。').catch(() => {});
      store.remove(record.id);
    }
    recovered = true;
  }

  async function execute(task) {
    const kind = task.client?.kind;
    const runId = 'relay-' + task.id;
    current = { id: task.id, title: task.title, kind, startedAt: now() };
    try {
      await post(task.id, 'progress', `本机 wickrunAI 已领取，交给 ${kind}（仅对话）`).catch(() => {});
      const selection = { kind, model: typeof task.client.model === 'string' && task.client.model ? task.client.model : 'default', ...(task.client.effort ? { effort: task.client.effort } : {}) };
      store.save({ id: runId, relayTaskId: task.id, conversationId: 'cloud-relay', answerId: runId + '-answer', title: task.title,
        question: { id: runId + '-q', role: 'user', content: task.title, createdAt: now() },
        config: { client: selection, toolsEnabled: false },
        state: { version: 2, runId, working: [], status: 'running', round: 1, at: now(), stoppedBy: 'unknown', phase: 'request', content: '', steps: [], sources: [] } });
      let result;
      try { result = await runner.run({ requestId: task.id, runId, prompt: task.goal }); }
      catch (error) { result = { status: 'failed', error: error.message || String(error) }; }
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (result?.status === 'completed' && text) { await post(task.id, 'submit', text); lastTask = { ...current, status: 'completed' }; }
      else {
        const reason = result?.error || (text ? `客户端未正常结束（${result?.status || 'unknown'}）。已有输出：${text.slice(0, 1200)}` : `客户端没有返回结果（${result?.status || 'unknown'}）。`);
        await post(task.id, 'block', reason); lastTask = { ...current, status: 'blocked', reason: String(reason).slice(0, 300) };
      }
      store.remove(runId);
    } catch (error) {
      // 回传失败时保留执行记录，下次启动会报告受阻
      lastError = `回传结果失败：${error.message || error}`; log(lastError);
    } finally { current = null; }
  }

  async function tick() {
    if (!config.enabled || !account.signedIn()) return;
    try {
      if (!recovered) await recover();
      if (!checkedAt || now() - checkedAt >= refreshMs) await refreshClients();
      if (!beatAt || now() - beatAt >= heartbeatMs) {
        await request('/api/cloud/relay/devices/heartbeat', 'POST', { device: config.device, name: `wickrunAI · ${hostname}`.slice(0, 80), kind: 'desktop', clients: ready });
        beatAt = now();
      }
      if (running || !ready.length) { lastError = ''; return; }
      const { task } = await request('/api/cloud/relay/devices/claim', 'POST', { device: config.device, kinds: ready.map(c => c.kind) });
      lastError = '';
      if (task && ID.test(task.id)) running = execute(task).finally(() => { running = null; });
    } catch (error) {
      lastError = error.status === 401 ? '云账号登录已失效，请重新登录。' : error.status === 503 ? '云端暂不可用。' : String(error.message || error);
      if (error.status === 401) beatAt = 0;
    }
  }
  function loop() { if (ticking) return; ticking = tick().finally(() => { ticking = null; }); }
  function start() { if (timer || !config.enabled) return; timer = setInterval(loop, pollMs); timer.unref?.(); loop(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return {
    state() {
      return { enabled: config.enabled === true, signedIn: account.signedIn(), device: config.device, clients: ready.map(c => c.kind),
        online: Boolean(beatAt) && now() - beatAt < heartbeatMs * 3, error: lastError, current, last: lastTask };
    },
    async setEnabled(on) {
      if (on && !account.signedIn()) throw new Error('请先登录云账号，再允许网页版使用本机 AI。');
      config.enabled = on === true; persist();
      if (config.enabled) { checkedAt = 0; beatAt = 0; start(); await (ticking || Promise.resolve()); }
      else stop();
      return this.state();
    },
    start, stop, tick,
    /** 测试用：等当前任务结束 */
    idle: () => Promise.resolve(ticking).then(() => running),
    busy: () => Boolean(running),
    close: stop,
  };
}

module.exports = { createCloudRelay };
