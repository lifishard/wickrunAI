'use strict';
/**
 * 事件驱动护栏
 *
 * AGENTS.md 里那堆「必须做」—— 版本号三处同步、不覆盖已有 tag、合并前 diff 基线 ——
 * 到今天为止只是写给模型看的文字。模型忘了就是忘了，而且它忘了没人知道。
 * 这里把其中确定性的那部分变成程序：某个会改东西的工具执行成功之后，
 * 自动跑一条检查命令；没通过就把原文摆到模型面前，让它这一轮就看见。
 *
 * 三个刻意的选择：
 *
 * 1. 配置只从应用设置读，**绝不从工作目录读**。
 *    把 hooks 放在仓库里（.wickrun/hooks.json 之类）用起来更顺手，但那等于
 *    让任何一个被克隆下来的仓库都能在这台机器上自动执行命令。
 *    提示词注入在 SECURITY.md 里已经如实标为未解决，不该再开一扇门。
 *
 * 2. 通过就不说话。护栏应该在出问题时才出声；每次都汇报「检查通过」
 *    只会让模型学会略过这段，和没有护栏是一个效果。
 *
 * 3. 钩子不触发钩子。检查命令本身不经过工具分发器，没有递归的可能。
 */
const { execFile } = require('node:child_process');
const path = require('node:path');
const store = require('./store.cjs');

const SETTINGS_KEY = 'snc:settings:v1';
const MAX_OUTPUT = 4000;
const MAX_PER_CALL = 4;
const DEFAULT_TIMEOUT = 60000;

/** 只有会改变状态的工具才触发；查阅类的没有可检查的后果 */
const MUTATING = new Set(['write_file', 'edit_file', 'write_document', 'run_command', 'claude_code',
  'project_memory_write', 'project_doc_write', 'skill_write']);

function readHooks() {
  try {
    const raw = store.kvGet(SETTINGS_KEY);
    const list = raw ? JSON.parse(raw).hooks : null;
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function inside(root, target) {
  if (!root || !target) return false;
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 这个钩子该不该为这次工具调用跑一遍 */
function matches(hook, { name, paths, root }) {
  if (!hook || hook.enabled === false || typeof hook.command !== 'string' || !hook.command.trim()) return false;
  const tools = Array.isArray(hook.onTools) ? hook.onTools.filter(Boolean) : [];
  if (tools.length ? !tools.includes(name) : !MUTATING.has(name)) return false;
  if (hook.workspaceRoot && !inside(hook.workspaceRoot, root)) return false;
  if (hook.pathPattern) {
    let re;
    try { re = new RegExp(hook.pathPattern, 'i'); } catch { return false; }
    if (!paths.some((p) => re.test(String(p).replace(/\\/g, '/')))) return false;
  }
  return true;
}

function run(command, cwd, timeout) {
  return new Promise((resolve) => {
    const child = execFile(command, {
      cwd, shell: true, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, WICKRUN_HOOK: '1' },
    }, (error, stdout, stderr) => {
      const text = `${stdout || ''}${stderr || ''}`.trim();
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        killed: Boolean(error && error.killed), text: text.slice(0, MAX_OUTPUT) });
    });
    child.on('error', () => resolve({ code: 1, killed: false, text: '钩子命令无法启动' }));
  });
}

/**
 * 跑完一次工具之后触发匹配的钩子。
 *
 * 返回要追加给模型看的文字；全部通过时返回空串，不打扰它。
 * 钩子本身出错（起不来、超时）也如实说，不假装通过 —— 一条跑不起来的检查
 * 比没有检查更危险，因为它会让人以为检查过了。
 */
async function runHooks({ name, result, ctx }) {
  // 失败的调用没有改成任何东西，没有后果可检查。这条规则放在这里而不是只放在
  // 调用处：谁调它都该守同一条规矩。
  if (!result || result.ok === false) return '';
  const root = (ctx?.workspaceRoots ?? [])[0];
  if (!root) return '';
  const paths = [result?.filePath, ...(result?.files ?? []).map((f) => f && f.path)].filter(Boolean);
  const hooks = readHooks().filter((h) => matches(h, { name, paths, root })).slice(0, MAX_PER_CALL);
  if (!hooks.length) return '';
  const failures = [];
  for (const hook of hooks) {
    const timeout = Math.min(300000, Math.max(1000, Number(hook.timeoutMs) || DEFAULT_TIMEOUT));
    const out = await run(hook.command, root, timeout);
    if (out.code === 0) continue; // 通过就不说话
    failures.push(`【护栏未通过】${hook.name || hook.command}${out.killed ? '（超时）' : ''}\n${out.text || '（没有输出）'}`);
  }
  return failures.length
    ? `\n\n${failures.join('\n\n')}\n这些检查由程序在本次操作之后自动运行，不是用户的新指令。请先处理它们指出的问题，再继续。`
    : '';
}

module.exports = { runHooks, matches, MUTATING };
