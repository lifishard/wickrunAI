/* ------------------------------------------------------------------
 * 把一条对话导出成文件。
 *
 * 两种格式，各自有各自的用处，不互相替代：
 *   Markdown —— 给人看的。贴进笔记、发给别人、存档，打开就能读。
 *   JSON     —— 完整的。消息、用量、工具步骤、附件元信息都在，
 *               将来要做「导入回来」或者外部分析时靠它。
 *
 * 一条硬规矩：导出的东西会离开这台机器（发给别人、传进网盘、贴进 issue），
 * 所以凭据形状的字段一律不出门。这里复用 sync-policy 的那张网 ——
 * 同一个判断只写一份，跨设备同步和导出共用，放宽了两边一起变。
 *
 * 附件只导出元信息（名字、类型、大小），不导出正文和图片本体：
 * 一条带几张图的对话导出来会有几十兆，而绝大多数人要的是文字。
 * ------------------------------------------------------------------ */

import type { Conversation, ChatMessage, ToolStep } from '../types';
import { scrubSensitive } from './sync-policy';

export type ExportFormat = 'markdown' | 'json';

export interface ExportOptions {
  /** 带上工具调用与执行步骤。默认不带 —— 多数人要的是对话本身。 */
  includeSteps?: boolean;
  /** 带上模型的思考过程（如果这条回答记了的话）。默认不带。 */
  includeReasoning?: boolean;
  /** 导出时刻，用来生成文件名。测试里固定它。 */
  now?: number;
  /** 界面语言的翻译函数；没取名的对话用它拿默认标题。 */
  t?: (text: string) => string;
}

/** 文件名里不能出现的字符，以及各平台的保留名。 */
function safeSlug(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (!cleaned || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) return fallback;
  return cleaned.length > 40 ? cleaned.slice(0, 40).trim() : cleaned;
}

function stamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function exportFileName(conv: Conversation, format: ExportFormat, opts: ExportOptions = {}): string {
  const fallback = opts.t ? opts.t('对话') : '对话';
  const slug = safeSlug(conv.title, fallback);
  return `wickrunAI-${slug}-${stamp(opts.now ?? Date.now())}.${format === 'json' ? 'json' : 'md'}`;
}

function when(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ROLE_LABEL: Record<string, string> = {
  user: '你',
  assistant: '模型',
  system: '系统',
  tool: '工具',
};

/** 只有 user / assistant 进 Markdown。system 是内部指令，tool 归到步骤里。 */
function readableMessages(messages: ChatMessage[]): ChatMessage[] {
  return (messages ?? []).filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
}

function stepLine(s: ToolStep): string {
  const detail = s.filePath ? ` — ${s.filePath}` : '';
  // summary 是「给人看的一句话」，正是导出该用的那一句；没有就退回工具名。
  const what = s.summary || s.name;
  const failed = s.error ? `：${s.error}` : '';
  return `- \`${s.name}\`（${s.status}）${what === s.name ? '' : ` ${what}`}${detail}${failed}`;
}

export function toMarkdown(conv: Conversation, opts: ExportOptions = {}): string {
  const t = opts.t ?? ((x: string) => x);
  const title = conv.title || t('新对话');
  const out: string[] = [];

  out.push(`# ${title}`, '');
  out.push(`> 由 wickrunAI 导出于 ${when(opts.now ?? Date.now())}`);
  out.push(`> 创建于 ${when(conv.createdAt)}，最后更新 ${when(conv.updatedAt)}`);
  if (conv.config?.model) out.push(`> 模型：${conv.config.model}`);
  out.push('>');
  out.push('> 不含 API 密钥。附件只列出名字和大小，正文与图片本体没有导出。');
  out.push('');

  for (const m of readableMessages(conv.messages)) {
    out.push(`## ${ROLE_LABEL[m.role] ?? m.role}${m.model ? `（${m.model}）` : ''}`);
    out.push('');
    if (m.attachments?.length) {
      out.push(...m.attachments.map((a) => `*附件：${a.name}${a.size ? `（${a.size} 字节）` : ''}*`));
      out.push('');
    }
    if (m.skillNames?.length) {
      out.push(`*唤起技能：${m.skillNames.join('、')}*`, '');
    }
    if (opts.includeReasoning && m.reasoning) {
      out.push('<details><summary>思考过程</summary>', '', m.reasoning, '', '</details>', '');
    }
    out.push(m.content || '*（空）*', '');
    if (opts.includeSteps && m.steps?.length) {
      out.push('<details><summary>执行步骤</summary>', '');
      out.push(...m.steps.map(stepLine));
      out.push('', '</details>', '');
    }
    if (m.error) out.push(`> ⚠ ${m.error}`, '');
    if (m.stopReason && m.stopReason !== 'stop') out.push(`> 结束原因：${m.stopReason}`, '');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export interface ExportedConversation {
  format: 'wickrunAI-conversation';
  schemaVersion: 1;
  exportedAt: string;
  appVersion?: string;
  conversation: Record<string, unknown>;
}

export function toJson(conv: Conversation, opts: ExportOptions & { appVersion?: string } = {}): string {
  const messages = (conv.messages ?? []).map((m) => {
    const {
      // runState 是断线保护用的现场，动辄几百 KB，而且导出没人会去读它
      runState: _runState,
      steps,
      reasoning,
      toolCalls: _toolCalls,
      attachments,
      ...rest
    } = m as ChatMessage & { runState?: unknown };
    return {
      ...rest,
      ...(opts.includeReasoning && reasoning ? { reasoning } : {}),
      ...(opts.includeSteps && steps?.length ? { steps } : {}),
      // 附件只留元信息：正文和图片本体不导出
      ...(attachments?.length
        ? { attachments: attachments.map((a) => ({ name: a.name, kind: a.kind, size: a.size })) }
        : {}),
    };
  });

  const payload: ExportedConversation = {
    format: 'wickrunAI-conversation',
    schemaVersion: 1,
    exportedAt: new Date(opts.now ?? Date.now()).toISOString(),
    ...(opts.appVersion ? { appVersion: opts.appVersion } : {}),
    conversation: {
      id: conv.id,
      title: conv.title,
      projectId: conv.projectId ?? null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      // 配置带出去（换台机器能照着复现），但先过一遍凭据过滤
      config: scrubSensitive(conv.config),
      messages,
    },
  };
  // keyProfileId 是本机凭据记录的编号，对别人没有意义，反而透露你配了几条路由
  return JSON.stringify(payload, null, 2);
}

export function renderExport(conv: Conversation, format: ExportFormat, opts: ExportOptions & { appVersion?: string } = {}): string {
  return format === 'json' ? toJson(conv, opts) : toMarkdown(conv, opts);
}
