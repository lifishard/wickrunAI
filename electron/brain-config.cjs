'use strict';
/*
 * Claude Code / Codex 的「大脑」配置。
 *
 * 三种来源：
 *   config        沿用用户自己的 Claude Code / Codex 配置（旧行为，默认）
 *   subscription  本机官方登录：Claude 订阅 / ChatGPT 订阅
 *   route         wickrunAI 里登记的任意一条 API 路由，经本机大脑代理转换协议
 *
 * 单次运行：只把连接信息注入这次启动的子进程，不动任何配置文件。
 * 全局应用：写进 ~/.claude/settings.json 与 ~/.codex/config.toml，
 *           终端里直接敲 claude / codex 也用同一个大脑。写之前记下原值，
 *           「还原」把被改过的键恢复成接管前的样子，其余内容一律不碰。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCES = ['config', 'subscription', 'route'];
const CLAUDE_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL', 'CLAUDE_CODE_EFFORT_LEVEL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const CODEX_TOP = ['model', 'model_provider', 'model_reasoning_effort', 'forced_login_method'];
const MARK = '# wickrunAI managed';

/** 校验渲染进程传来的大脑选择 */
function cleanBrain(value) {
  if (!value) return { source: 'config' };
  if (!SOURCES.includes(value.source)) throw Error('大脑来源无效');
  if (value.source !== 'route') return { source: value.source };
  if (typeof value.profileId !== 'string' || !value.profileId || value.profileId.length > 200) throw Error('请选择大脑使用的路由');
  const out = { source: 'route', profileId: value.profileId };
  if (value.extras !== undefined) out.extras = value.extras;
  if (value.outputField !== undefined) out.outputField = value.outputField;
  return out;
}

/** 代理会话 → Claude Code 子进程环境。所有档位别名都指到同一个模型，后台任务也不会偷偷换路由 */
function claudeBrainEnv(session) {
  const env = { ANTHROPIC_BASE_URL: session.anthropicBaseUrl, ANTHROPIC_AUTH_TOKEN: session.token, ANTHROPIC_MODEL: session.model, CLAUDE_CODE_SUBAGENT_MODEL: session.model, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
  for (const alias of ['OPUS', 'SONNET', 'HAIKU', 'FABLE']) env[`ANTHROPIC_DEFAULT_${alias}_MODEL`] = session.model;
  return env;
}

function codexBrain(session) { return { baseUrl: session.openaiBaseUrl, token: session.token }; }

/* ---------------------------- 文件读写 ---------------------------- */

function claudeSettingsFile(env = process.env) {
  const home = env.USERPROFILE || env.HOME;
  const dir = env.CLAUDE_CONFIG_DIR || (home ? path.join(home, '.claude') : null);
  if (!dir || !path.isAbsolute(dir)) throw Error('找不到 Claude Code 配置目录');
  return path.join(dir, 'settings.json');
}
function codexConfigFile(env = process.env) {
  const home = env.USERPROFILE || env.HOME;
  const dir = env.CODEX_HOME || (home ? path.join(home, '.codex') : null);
  if (!dir || !path.isAbsolute(dir)) throw Error('找不到 Codex 配置目录');
  return path.join(dir, 'config.toml');
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, text, { mode: 0o600 }); fs.renameSync(tmp, file); } finally { try { fs.unlinkSync(tmp); } catch { /* 已改名 */ } }
}
/** 第一次接管前留一份原样备份；之后的改动都能从这份找回 */
function backupOnce(file) {
  const backup = `${file}.before-wickrun`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  return fs.existsSync(backup) ? backup : null;
}

function createBrainGlobal({ userData, env = process.env }) {
  const stateFile = path.join(userData, 'brain-global.json');
  const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  const saveState = (state) => writeAtomic(stateFile, JSON.stringify(state));

  /* ---------- Claude Code：~/.claude/settings.json 的 env 段 ---------- */
  function readClaude() {
    const file = claudeSettingsFile(env);
    let data = {};
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw Error('Claude Code 的 settings.json 不是有效 JSON，未改动'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Claude Code 的 settings.json 必须是 JSON 对象，未改动');
    if (data.env !== undefined && (typeof data.env !== 'object' || Array.isArray(data.env))) throw Error('settings.json 的 env 段格式无效，未改动');
    return { file, data };
  }
  /** mode: route（需要 session）/ subscription / restore */
  function applyClaude(mode, session, effort) {
    const { file, data } = readClaude();
    const state = readState();
    const current = { ...(data.env || {}) };
    if (mode !== 'restore' && !state.claude) {
      // 只记被接管的那几个键的原值，别的键不属于我们
      state.claude = { previous: Object.fromEntries(CLAUDE_KEYS.filter((k) => k in current).map((k) => [k, current[k]])), forceLoginMethod: data.forceLoginMethod ?? null };
    }
    const backup = backupOnce(file);
    const next = { ...current };
    for (const k of CLAUDE_KEYS) delete next[k];
    if (mode === 'route') {
      Object.assign(next, claudeBrainEnv(session));
      if (effort && CLAUDE_EFFORTS.includes(effort)) next.CLAUDE_CODE_EFFORT_LEVEL = effort;
      if (data.forceLoginMethod === 'claudeai') delete data.forceLoginMethod;
    } else if (mode === 'subscription') {
      data.forceLoginMethod = 'claudeai';
    } else if (mode === 'restore') {
      if (!state.claude) return { changed: false, file, message: 'Claude Code 配置没有被 wickrunAI 接管过' };
      Object.assign(next, state.claude.previous);
      if (state.claude.forceLoginMethod === null) delete data.forceLoginMethod; else data.forceLoginMethod = state.claude.forceLoginMethod;
      delete state.claude;
    } else throw Error('未知的应用方式');
    if (Object.keys(next).length) data.env = next; else delete data.env;
    writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
    if (mode === 'restore') saveState(state); else { state.claude.mode = mode; saveState(state); }
    return { changed: true, file, backup };
  }

  /* ---------- Codex：~/.codex/config.toml 顶层三个键 + wickrun 提供方表 ---------- */
  function editToml(text, managedTop, table) {
    const lines = text.split(/\r?\n/);
    const firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
    const head = firstTable < 0 ? lines : lines.slice(0, firstTable);
    let body = firstTable < 0 ? [] : lines.slice(firstTable);
    const previous = {};
    const keep = head.filter((l) => {
      if (l.trim() === MARK) return false;
      const m = /^\s*([A-Za-z_]+)\s*=/.exec(l);
      if (m && CODEX_TOP.includes(m[1])) { previous[m[1]] = l; return false; }
      return true;
    });
    // 去掉旧的 wickrun 提供方表（从表头到下一个表头）
    const out = []; let skip = false;
    for (const l of body) {
      if (/^\s*\[/.test(l)) skip = /^\s*\[model_providers\.wickrun\]\s*$/.test(l);
      if (!skip) out.push(l);
    }
    body = out;
    while (keep.length && keep[keep.length - 1].trim() === '') keep.pop();
    const result = [...(managedTop.length ? [...managedTop, ''] : []), ...keep, ...(keep.length ? [''] : []), ...body];
    while (result.length && result[result.length - 1].trim() === '') result.pop();
    if (table.length) result.push('', ...table);
    return { text: result.join('\n').replace(/^\n+/, '') + '\n', previous };
  }
  const q = (v) => JSON.stringify(String(v));
  function applyCodex(mode, session, effort) {
    const file = codexConfigFile(env);
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw Error('无法读取 Codex config.toml'); }
    const state = readState();
    if (mode === 'restore' && !state.codex) return { changed: false, file, message: 'Codex 配置没有被 wickrunAI 接管过' };
    const backup = backupOnce(file);
    let top = [], table = [];
    if (mode === 'route') {
      top = [MARK, `model = ${q(session.model)}`, 'model_provider = "wickrun"', ...(effort && CODEX_EFFORTS.includes(effort) ? [`model_reasoning_effort = ${q(effort)}`] : [])];
      // 终端里没有 wickrunAI 注入的环境变量，所以令牌写进文件；它只是本机代理的会话令牌，不是路由密钥
      table = ['[model_providers.wickrun]', 'name = "wickrunAI"', `base_url = ${q(session.openaiBaseUrl)}`, `experimental_bearer_token = ${q(session.token)}`, 'wire_api = "responses"'];
    } else if (mode === 'subscription') {
      top = [MARK, 'model_provider = "openai"', 'forced_login_method = "chatgpt"'];
    } else if (mode === 'restore') {
      top = Object.values(state.codex.previous);
    } else throw Error('未知的应用方式');
    const { text: next, previous } = editToml(text, top, table);
    if (mode === 'restore') delete state.codex;
    else { if (!state.codex) state.codex = { previous }; state.codex.mode = mode; }
    writeAtomic(file, next);
    saveState(state);
    return { changed: true, file, backup };
  }

  function status() {
    const state = readState();
    return { claude: state.claude?.mode || null, codex: state.codex?.mode || null };
  }
  return { applyClaude, applyCodex, status };
}

module.exports = { cleanBrain, claudeBrainEnv, codexBrain, createBrainGlobal, claudeSettingsFile, codexConfigFile, CLAUDE_KEYS };
