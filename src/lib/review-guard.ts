import type { RunAgentArgs } from './agent';

/**
 * 「逐项修改前确认」开着时，本机客户端能不能进工作模式。
 *
 * 只有 Grok 可以：它每处改动都带完整内容来申请，批准前能算出差异给用户看（命令不运行）。
 * 其他客户端自己直接写文件，wickrunAI 拦不下来，这一轮不进工作模式，并先弹窗说明原因和可行的办法。
 */
export const REVIEW_CAPABLE_CLIENTS = ['grok'];

const REASONS: Record<string, string> = {
  claude: 'Claude Code 会直接写文件和运行命令，改动不会先交给 wickrunAI 审核',
  codex: 'Codex 在沙箱里可以直接改工作目录里的文件、运行命令，改动不会先交给 wickrunAI 审核',
  kimi: 'Kimi 申请修改时只给出文件路径、不带修改内容，无法在批准前展示差异',
  'claude-desktop': 'Claude Desktop 在它自己的应用里改文件，改动不会先交给 wickrunAI 审核',
};

export function reviewBlockReason(kind: string): string {
  return REASONS[kind] || '这个客户端的改动无法在写入前审核';
}

/** 需要拦下时返回暂停原因，否则 null。拦下前先弹窗说明，弹窗关掉后才返回 */
export async function reviewGuard(args: RunAgentArgs, kind: string): Promise<string | null> {
  if (!args.config.toolsEnabled || !args.toolCtx?.().reviewCodeChanges || REVIEW_CAPABLE_CLIENTS.includes(kind)) return null;
  const id = `review-blocked-${args.requestId}`;
  // 弹窗只是说明；弹不出来（没有界面、被关掉）也照样拦下
  await Promise.resolve().then(() => args.confirm?.({ id, callId: id, name: 'native_review_blocked', args: { kind, reason: reviewBlockReason(kind) }, status: 'running', summary: '逐项修改前确认已开启', startedAt: Date.now() })).catch(() => false);
  return `已开启「逐项修改前确认」：${reviewBlockReason(kind)}，本轮没有进入工作模式。可以改用对话模式、API 模型或 Grok，或在设置 → 工具里关闭「逐项修改前确认」。`;
}
