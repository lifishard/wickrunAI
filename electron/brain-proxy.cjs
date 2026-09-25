'use strict';
/*
 * 本机 AI「大脑」代理：只监听 127.0.0.1。
 *
 * Claude Code / Codex 把它当成自己的服务端：
 *   POST /v1/messages              Anthropic Messages（Claude Code）
 *   POST /v1/messages/count_tokens 粗估，只用于客户端决定何时压缩
 *   POST /v1/responses             OpenAI Responses（Codex）
 *   GET  /v1/models                只列出会话选定的那个模型
 *
 * 客户端拿到的「API Key」只是会话令牌。真正的路由密钥留在 wickrunAI 的密钥库里，
 * 每次请求现取，不写进客户端配置、环境变量或命令行。
 *
 * 会话分两种：单次运行（跑完即撤销）和全局（写进 Claude Code / Codex 配置后，
 * 终端里直接用 claude / codex 也走这里；令牌落盘，重启后仍有效，端口尽量固定）。
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tr = require('./brain-translate.cjs');

const PREFERRED_PORT = 18765;
const MAX_BODY = 32 * 1024 * 1024;

function normalizeBase(url) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('路由地址无效');
  return u.href.replace(/\/+$/, '');
}

/** 会话里允许下发的额外字段：思考强度映射的结果，体积受限，不能改写模型、消息和工具 */
function cleanExtras(value) {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('思考参数格式无效');
  const text = JSON.stringify(value);
  if (text.length > 4096) throw Error('思考参数过长');
  return JSON.parse(text);
}

function cleanOutputField(v) { return ['max_tokens', 'max_completion_tokens', 'none'].includes(v) ? v : 'max_tokens'; }

function createBrainProxy({ userData, getSettings, secretGet, deps = {} }) {
  const request = deps.fetch || fetch;
  const file = path.join(userData, 'brain-sessions.json');
  const sessions = new Map(); // token → session
  let server, starting, port = 0;

  function loadPersistent() {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const s of Array.isArray(saved.sessions) ? saved.sessions : []) {
        if (typeof s.token === 'string' && /^[a-f0-9]{64}$/.test(s.token) && ['claude', 'codex'].includes(s.scope)) sessions.set(s.token, { ...s, persistent: true });
      }
      if (Number.isInteger(saved.port)) port = saved.port;
    } catch { /* 没有或损坏：当作没有全局会话 */ }
  }
  function savePersistent() {
    const list = [...sessions.values()].filter((s) => s.persistent).map(({ token, scope, profileId, model, extras, outputField }) => ({ token, scope, profileId, model, extras, outputField }));
    if (!list.length) { try { fs.unlinkSync(file); } catch { /* 本来就没有 */ } return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, port, sessions: list }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  function profileOf(id) {
    const profile = (getSettings().keyProfiles || []).find((p) => p.id === id);
    if (!profile) throw Error('这条路由的凭据已删除，请重新选择大脑');
    return profile;
  }

  function sessionFor(req) {
    const header = String(req.headers['x-api-key'] || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!/^[a-f0-9]{64}$/.test(header)) return null;
    for (const [token, s] of sessions) {
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(header))) return s;
    }
    return null;
  }

  async function readBody(req) {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw Object.assign(Error('请求过大'), { status: 413 }); chunks.push(chunk); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  async function upstream(session, pathName, body, signal, anthropic = false) {
    const profile = profileOf(session.profileId);
    const secret = await secretGet(profile.id);
    let base = normalizeBase(profile.baseUrl);
    if (anthropic) base = base.replace(/\/v1$/, '') + '/v1';
    const headers = { 'Content-Type': 'application/json', ...(profile.extraHeaders || {}) };
    if (secret) {
      if (anthropic) { headers['x-api-key'] = secret; headers['anthropic-version'] = headers['anthropic-version'] || '2023-06-01'; }
      else headers.Authorization = `Bearer ${secret}`;
    }
    return request(base + pathName, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
  }

  function sendJson(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
  function anthropicError(res, status, message) { sendJson(res, status, { type: 'error', error: { type: status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'api_error', message } }); }
  function openaiError(res, status, message) { sendJson(res, status, { error: { message, type: status === 401 ? 'invalid_request_error' : 'api_error' } }); }

  async function relayError(up, fail) {
    let message = `上游 HTTP ${up.status}`;
    try { const text = await up.text(); const v = JSON.parse(text); message = v?.error?.message || v?.message || text.slice(0, 500) || message; } catch { /* 保留状态码说明 */ }
    fail(up.status >= 400 && up.status < 600 ? up.status : 502, message);
  }

  async function pump(up, onChunk, onDone) {
    const parse = tr.createSseParser(onChunk, () => {});
    const decoder = new TextDecoder();
    const reader = up.body.getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; parse(decoder.decode(value, { stream: true })); }
    onDone();
  }

  function sseWriter(res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  async function handleMessages(session, body, res, signal) {
    const fail = (s, m) => anthropicError(res, s, m);
    const profile = profileOf(session.profileId);
    if (profile.protocol === 'anthropic') {
      // 原生 Anthropic 端点：只换模型、换密钥，请求原样转发
      const { thinking: _t, output_config: _o, ...rest } = body;
      const forwarded = { ...rest, model: session.model, ...tr.applySession({}, { extras: session.extras }) };
      const up = await upstream(session, '/messages', forwarded, signal, true);
      if (!up.ok) return relayError(up, fail);
      res.writeHead(200, { 'Content-Type': up.headers.get('content-type') || 'application/json' });
      const reader = up.body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); }
      return res.end();
    }
    const chat = tr.anthropicToChat(body, session);
    const up = await upstream(session, '/chat/completions', chat, signal);
    if (!up.ok) return relayError(up, fail);
    const id = `msg_${crypto.randomBytes(12).toString('hex')}`;
    if (!chat.stream) return sendJson(res, 200, tr.chatToAnthropic(await up.json(), session.model, id));
    const stream = tr.createAnthropicStream(sseWriter(res), session.model, id);
    await pump(up, (c) => stream.push(c), () => stream.end());
    res.end();
  }

  async function handleResponses(session, body, res, signal) {
    const fail = (s, m) => openaiError(res, s, m);
    if (profileOf(session.profileId).protocol === 'anthropic') return fail(400, '这条路由设为 Anthropic 原生协议，不能给 Codex 当大脑；请换一条 OpenAI 兼容路由');
    const { body: chat, custom } = tr.responsesToChat(body, session);
    const up = await upstream(session, '/chat/completions', chat, signal);
    if (!up.ok) return relayError(up, fail);
    const id = `resp_${crypto.randomBytes(12).toString('hex')}`;
    if (!chat.stream) return sendJson(res, 200, tr.chatToResponses(await up.json(), session.model, custom, id));
    const stream = tr.createResponsesStream(sseWriter(res), session.model, custom, id);
    await pump(up, (c) => stream.push(c), () => stream.end());
    res.end();
  }

  async function handle(req, res) {
    const host = String(req.headers.host || '');
    // 浏览器页面不该能打到这里：拒绝带 Origin 的请求和非回环 Host（防 DNS 重绑定）
    if (req.headers.origin || ![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return sendJson(res, 403, { error: { message: 'Forbidden' } });
    const url = new URL(req.url, `http://${host}`);
    const route = url.pathname.replace(/\/+$/, '');
    const session = sessionFor(req);
    const isResponses = route === '/v1/responses';
    if (!session) return (isResponses ? openaiError : anthropicError)(res, 401, 'wickrunAI 大脑会话无效或已结束');
    if (req.method === 'GET' && route === '/v1/models') return sendJson(res, 200, { object: 'list', data: [{ id: session.model, object: 'model', type: 'model', display_name: session.model, created_at: new Date(0).toISOString() }] });
    if (req.method !== 'POST') return sendJson(res, 404, { error: { message: 'Not found' } });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const body = await readBody(req);
      if (route === '/v1/messages/count_tokens') return sendJson(res, 200, { input_tokens: tr.estimateTokens(body) });
      if (route === '/v1/messages') return await handleMessages(session, body, res, controller.signal);
      if (isResponses) return await handleResponses(session, body, res, controller.signal);
      return sendJson(res, 404, { error: { message: 'Not found' } });
    } catch (error) {
      if (res.headersSent) { try { res.end(); } catch { /* 客户端已断开 */ } return; }
      (isResponses ? openaiError : anthropicError)(res, error.status || 502, controller.signal.aborted ? '请求已取消' : String(error.message || error).slice(0, 500));
    }
  }

  async function start() {
    if (server?.listening) return port;
    if (starting) return starting;
    starting = (async () => {
      loadPersistent();
      server = http.createServer((req, res) => { void handle(req, res); });
      server.requestTimeout = 0; server.headersTimeout = 15000;
      const listen = (p) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(p, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
      const wanted = deps.port ?? (port || PREFERRED_PORT);
      try { await listen(wanted); } catch { await listen(0); }
      port = server.address().port;
      server.unref();
      if ([...sessions.values()].some((s) => s.persistent)) savePersistent();
      return port;
    })();
    try { return await starting; } finally { starting = null; }
  }

  function describe(session) {
    const origin = `http://127.0.0.1:${port}`;
    return { token: session.token, scope: session.scope, profileId: session.profileId, model: session.model, anthropicBaseUrl: origin, openaiBaseUrl: `${origin}/v1` };
  }

  /** 为一次运行开会话；返回的 token 只在这次运行里有效 */
  async function openSession({ profileId, model, extras, scope, outputField }) {
    await start();
    profileOf(profileId);
    if (typeof model !== 'string' || !/^[\w./:@+-]{1,200}$/.test(model)) throw Error('模型 ID 格式无效');
    const session = { token: crypto.randomBytes(32).toString('hex'), scope: scope || 'run', profileId, model, extras: cleanExtras(extras), outputField: cleanOutputField(outputField) };
    sessions.set(session.token, session);
    return describe(session);
  }
  function closeSession(token) { const s = sessions.get(token); if (s && !s.persistent) sessions.delete(token); }

  /** 全局会话：每种客户端一个，令牌落盘。换路由时沿用同一个令牌，客户端配置不用改 */
  async function setGlobal(scope, value) {
    await start();
    const old = [...sessions.values()].find((s) => s.persistent && s.scope === scope);
    if (!value) { if (old) sessions.delete(old.token); savePersistent(); return null; }
    profileOf(value.profileId);
    if (typeof value.model !== 'string' || !/^[\w./:@+-]{1,200}$/.test(value.model)) throw Error('模型 ID 格式无效');
    const session = { token: old?.token || crypto.randomBytes(32).toString('hex'), scope, profileId: value.profileId, model: value.model, extras: cleanExtras(value.extras), outputField: cleanOutputField(value.outputField), persistent: true };
    sessions.set(session.token, session);
    savePersistent();
    return describe(session);
  }
  function getGlobal(scope) { const s = [...sessions.values()].find((x) => x.persistent && x.scope === scope); return s ? describe(s) : null; }

  function close() { server?.close(); }
  return { start, openSession, closeSession, setGlobal, getGlobal, close, port: () => port };
}

module.exports = { createBrainProxy, PREFERRED_PORT };
