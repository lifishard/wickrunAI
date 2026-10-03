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
  let timer = null, ticking = null, running = null, current = null, execution = null;
  let stopped = false, epoch = 0, claiming = false;
  // reported：报给网页版的全部客户端（未登录的 ready:false，网页版据此提示去登录）；ready：能领任务的
  let reported = [], ready = [], checkedAt = 0, beatAt = 0, lastError = '', recovered = false, lastTask = null;

  const request = (pathname, method, body) => account.relay(pathname, method, body);
  const post = (id, action, value) => request(`/api/cloud/relay/tasks/${id}/${action}`, 'POST', { device: config.device, ...(action === 'block' ? { reason: String(value).slice(0, 2000) } : { text: value }) });
  const taskState = async id => {
    let response;
    try { response = await request(`/api/cloud/relay/tasks/${id}`, 'GET'); }
    catch (error) {
      // The existing task route returns 404 when a cancelled task was removed.
      if (error.status === 404) return { id, status: 'cancelled', removed: true };
      throw error;
    }
    const task = response?.task;
    if (task?.id !== id || !['waiting', 'working', 'completed', 'blocked', 'cancelled'].includes(task.status)) throw Error('云端任务状态无效，未继续派发或回传结果。');
    return task;
  };
  async function finishRemote(id, action, reason) {
    try { await post(id, action, reason); }
    catch (error) {
      // A cancellation can race a terminal update. Only a verified terminal
      // state permits discarding the recovery record; network failures do not.
      if (error.status !== 409 && error.status !== 404) throw error;
      const task = await taskState(id);
      if (!['completed', 'blocked', 'cancelled'].includes(task.status)) throw error;
    }
  }

  function cancelExecution(run, reason, remoteTerminal = false) {
    if (remoteTerminal) run.remoteTerminal = true;
    if (run.cancelled) return run.cancellation;
    run.cancelled = true;
    run.reason = reason;
    if (execution === run) current = { ...run.view, status: 'stopping' };
    // This journal is separate from the runner's streaming checkpoints.
    try { store.saveJob(run.runId, 'relay-cancel', { reason, at: now() }); }
    catch (error) { lastError = `取消记录保存失败：${error.message || error}`; log(lastError); }
    if (run.started) {
      try { runner.abort(run.runId); }
      catch (error) { lastError = `已请求停止，但客户端尚未确认停止：${error.message || error}`; log(lastError); }
    }
    run.cancellation = (async () => {
      if (run.remoteTerminal) return;
      try { await finishRemote(run.task.id, 'cancel'); run.remoteTerminal = true; }
      catch (error) { lastError = `本机已请求停止，云端取消尚未确认：${error.message || error}`; log(lastError); }
    })();
    return run.cancellation;
  }

  async function checkCancellation(run) {
    if (run.cancelled) return;
    const task = await taskState(run.task.id);
    if (execution !== run || run.cancelled) return;
    if (['cancelled', 'completed', 'blocked'].includes(task.status)) {
      await cancelExecution(run, task.removed ? '任务已从云端移除。' : task.status === 'cancelled' ? '任务已在云端取消。' : '云端任务已结束，停止本机执行。', true);
    } else if (task.status !== 'working' || (task.claimedBy && task.claimedBy !== `device:${config.device}`)) {
      throw Error('云端任务不再由这台电脑执行，未继续派发或回传结果。');
    }
  }

  async function refreshClients() {
    const results = await clients.restore();
    reported = results.filter(r => KINDS.includes(r?.kind) && ['ready', 'login_required', 'waiting_login'].includes(r.status))
      .map(r => ({ kind: r.kind, ready: r.status === 'ready', models: r.status === 'ready' ? (r.models || []).slice(0, 50).map(m => ({ id: m.id, label: m.label || m.id, efforts: (m.efforts || []).slice(0, 8) })) : [] }));
    ready = reported.filter(c => c.ready);
    checkedAt = now();
  }

  /** 上次退出时正在执行的任务：结果无法确认，报告受阻而不是重跑 */
  async function recover() {
    let complete = true;
    for (const record of store.list()) {
      const taskId = record.relayTaskId;
      try {
        if (taskId && ID.test(taskId)) {
          const cancelled = store.job(record.id, 'relay-cancel');
          await finishRemote(taskId, cancelled ? 'cancel' : 'block', '桌面版在执行中退出，结果未确认；为避免重复执行，未自动重跑。请在网页版重新发送。');
        }
        store.remove(record.id);
      } catch (error) {
        complete = false;
        lastError = `上次任务状态尚未同步，记录已保留：${error.message || error}`; log(lastError);
      }
    }
    recovered = complete;
  }

  async function execute(task, claimedEpoch) {
    const kind = task.client?.kind;
    const runId = 'relay-' + task.id;
    current = { id: task.id, title: task.title, kind, startedAt: now() };
    const run = { task, runId, view: current, started: false, cancelled: false, remoteTerminal: false, cancellation: null };
    execution = run;
    try {
      const selection = { kind, model: typeof task.client.model === 'string' && task.client.model ? task.client.model : 'default', ...(task.client.effort ? { effort: task.client.effort } : {}) };
      store.save({ id: runId, relayTaskId: task.id, conversationId: 'cloud-relay', answerId: runId + '-answer', title: task.title,
        question: { id: runId + '-q', role: 'user', content: task.title, createdAt: now() },
        config: { client: selection, toolsEnabled: false },
        state: { version: 2, runId, working: [], status: 'running', round: 1, at: now(), stoppedBy: 'unknown', phase: 'request', content: '', steps: [], sources: [] } });
      if (stopped || !config.enabled || claimedEpoch !== epoch) cancelExecution(run, '本机中继已关闭，未派发客户端任务。');
      let result;
      if (!run.cancelled) {
        await checkCancellation(run);
        if (!run.cancelled) {
          if (typeof runner.abort !== 'function') throw Error('当前客户端不支持停止任务，未开始执行。');
          await post(task.id, 'progress', `本机 wickrunAI 已领取，交给 ${kind}（仅对话）`);
          if (!run.cancelled) {
            run.started = true;
            try { result = await runner.run({ requestId: task.id, runId, prompt: task.goal }); }
            catch (error) { result = { status: 'failed', error: error.message || String(error) }; }
          }
        }
      }
      // Check again even for a fast run that ended before the next poll.
      if (!run.cancelled) await checkCancellation(run);
      if (run.cancelled) {
        await run.cancellation;
        lastTask = { ...run.view, status: 'cancelled', reason: run.reason };
        if (run.remoteTerminal) store.remove(runId);
        else recovered = false;
        return;
      }
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      if (result?.status === 'completed' && text) { await post(task.id, 'submit', text); if (!run.cancelled) lastTask = { ...run.view, status: 'completed' }; }
      else {
        const reason = result?.error || (text ? `客户端未正常结束（${result?.status || 'unknown'}）。已有输出：${text.slice(0, 1200)}` : `客户端没有返回结果（${result?.status || 'unknown'}）。`);
        await post(task.id, 'block', reason); lastTask = { ...current, status: 'blocked', reason: String(reason).slice(0, 300) };
      }
      if (run.cancelled) await run.cancellation;
      if (!run.cancelled || run.remoteTerminal) store.remove(runId);
      else recovered = false;
    } catch (error) {
      // 回传失败时保留执行记录，下次启动会报告受阻
      lastError = `回传结果失败：${error.message || error}`; log(lastError);
      recovered = false;
    } finally {
      // stop() may race the final HTTP response. It must never publish a late
      // local "completed" status, and pending cancellation keeps us busy.
      if (run.cancelled) {
        await run.cancellation;
        lastTask = { ...run.view, status: 'cancelled', reason: run.reason };
      }
      current = null; execution = null;
    }
  }

  async function tick() {
    if (stopped || !config.enabled || !account.signedIn()) return;
    const tickEpoch = epoch;
    try {
      if (execution) await checkCancellation(execution);
      else {
        if (!recovered) { await recover(); if (!recovered) return; }
        if (!checkedAt || now() - checkedAt >= refreshMs) await refreshClients();
      }
      if (stopped || !config.enabled || tickEpoch !== epoch) return;
      if (!beatAt || now() - beatAt >= heartbeatMs) {
        await request('/api/cloud/relay/devices/heartbeat', 'POST', { device: config.device, name: `wickrunAI · ${hostname}`.slice(0, 80), kind: 'desktop', clients: reported });
        beatAt = now();
      }
      if (running || !ready.length || stopped || !config.enabled || tickEpoch !== epoch) return;
      claiming = true;
      try {
        const { task } = await request('/api/cloud/relay/devices/claim', 'POST', { device: config.device, kinds: ready.map(c => c.kind) });
        lastError = '';
        if (task && ID.test(task.id)) running = execute(task, tickEpoch).finally(() => { running = null; });
      } finally { claiming = false; }
    } catch (error) {
      lastError = error.status === 401 ? '云账号登录已失效，请重新登录。' : error.status === 503 ? '云端暂不可用。' : String(error.message || error);
      if (error.status === 401) beatAt = 0;
    }
  }
  function loop() { if (ticking) return; ticking = tick().finally(() => { ticking = null; }); }
  function start() { if (timer || !config.enabled) return; stopped = false; timer = setInterval(loop, pollMs); timer.unref?.(); loop(); }
  // Stop means stop active work too. busy() stays true until the runner settles.
  function stop() {
    stopped = true; epoch += 1;
    if (timer) clearInterval(timer); timer = null;
    if (execution) void cancelExecution(execution, '本机中继已关闭，已请求停止当前任务。');
  }

  return {
    state() {
      return { enabled: config.enabled === true, signedIn: account.signedIn(), device: config.device, clients: ready.map(c => c.kind),
        online: Boolean(beatAt) && now() - beatAt < heartbeatMs * 3, error: lastError, current, last: lastTask };
    },
    async setEnabled(on) {
      if (on && !account.signedIn()) throw new Error('请先登录云账号，再允许网页版使用本机 AI。');
      config.enabled = on === true;
      if (!config.enabled) stop();
      persist();
      if (config.enabled) { checkedAt = 0; beatAt = 0; start(); await (ticking || Promise.resolve()); }
      return this.state();
    },
    start, stop, tick,
    /** 测试用：等当前任务结束 */
    idle: () => Promise.resolve(ticking).then(() => running),
    busy: () => Boolean(running || claiming),
    close: stop,
  };
}

module.exports = { createCloudRelay };
