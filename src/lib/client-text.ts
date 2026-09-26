import type { Translate } from './i18n';

/**
 * 本机客户端的状态说明和模型名来自主进程（或网页版里其他设备的上报），写死的是简体。
 * 固定的句子直接查词典；带地址、模型 ID 的几种句式先拆出变量再翻译，拆不开就原样显示。
 */
const PATTERNS: [RegExp, (t: Translate, m: RegExpMatchArray) => string][] = [
  [/^Claude Code CLI 已就绪。连接来源：(.+?)。(已配置的本机网关已响应。)?尚未发送模型请求；可用模型以你的服务配置为准。$/,
    (t, m) => t('Claude Code CLI 已就绪。连接来源：{source}。{gateway}尚未发送模型请求；可用模型以你的服务配置为准。', { source: clientText(t, m[1]), gateway: m[2] ? t(m[2]) : '' })],
  [/^Claude Code CLI 可用。Claude Code 自己配置的本机网关 (\S+) 需要检查：(.+)。这只影响「沿用 Claude Code 自己的配置」这个大脑；选本机订阅或 wickrunAI 路由不受影响。$/,
    (t, m) => t('Claude Code CLI 可用。Claude Code 自己配置的本机网关 {url} 需要检查：{reason}。这只影响「沿用 Claude Code 自己的配置」这个大脑；选本机订阅或 wickrunAI 路由不受影响。', { url: m[1], reason: clientText(t, m[2] + '。').replace(/[。.]$/, '') })],
  [/^自定义 API：(.+)$/, (t, m) => t('自定义 API：{url}', { url: m[1] })],
  [/^未找到 (.+) 官方原生客户端，请安装后重新检测，或选择程序位置。$/, (t, m) => t('未找到 {client} 官方原生客户端，请安装后重新检测，或选择程序位置。', { client: m[1] })],
  [/^OmniRoute 已响应，但模型接口返回 HTTP (\d+)。请查看网关状态；未重复启动。$/, (t, m) => t('OmniRoute 已响应，但模型接口返回 HTTP {status}。请查看网关状态；未重复启动。', { status: m[1] })],
  [/^OmniRoute 启动进程退出（(.+)），请检查网关日志。$/, (t, m) => t('OmniRoute 启动进程退出（{code}），请检查网关日志。', { code: m[1] })],
  [/^Claude Code 配置的本机服务需要检查。(.+)$/, (t, m) => t('Claude Code 配置的本机服务需要检查。') + clientText(t, m[1])],
  // 模型名：`sonnet · 配置别名 → claude-sonnet-x`
  [/^(\S+) · 配置别名(?: → (.+))?$/, (t, m) => t('{id} · 配置别名', { id: m[1] }) + (m[2] ? ` → ${m[2]}` : '')],
];

export function clientText(t: Translate, text: string | undefined): string {
  if (!text) return '';
  if (!/[一-鿿]/.test(text)) return text;
  for (const [pattern, render] of PATTERNS) {
    const m = text.match(pattern);
    if (m) return render(t, m);
  }
  return t(text);
}
