export type ClientKind = 'codex' | 'claude' | 'kimi' | 'grok' | 'claude-desktop';
export interface ClientModel { id:string; label:string; efforts:string[]; defaultEffort?:string }
export interface ClientStatus { kind:ClientKind; status:'missing'|'installed'|'login_required'|'ready'|'error'|'waiting_login'; message:string; models:ClientModel[]; binary?:string; connection?:{type:'account'|'api_key'|'custom_api';baseUrl?:string}; /** Claude Code 自己配置的网关不通：只影响「沿用客户端配置」这个大脑 */ configIssue?:string; }
/**
 * Claude Code / Codex 的「大脑」来源。config：沿用客户端自己的配置；subscription：本机官方订阅登录；
 * route：wickrunAI 里登记的某条 API 路由，经本机大脑代理转换协议。extras 是按思考强度映射算好的请求字段。
 */
export interface ClientBrain { source:'config'|'subscription'|'route'; profileId?:string; extras?:Record<string,unknown>; outputField?:'max_tokens'|'max_completion_tokens'|'none' }
export interface ClientSelection { kind:ClientKind; model:string; effort?:string; brain?:ClientBrain }
export interface BrainGlobalStatus { applied:{claude:string|null;codex:string|null}; claude:{profileId:string;model:string;baseUrl:string}|null; codex:{profileId:string;model:string;baseUrl:string}|null; port?:number }
export const BRAIN_CLIENTS: ClientKind[] = ['claude','codex'];
export interface ClientTurnResult { codeChanges?: import('../types').CodeChange[]; codeAuditWarnings?: string[]; status:string; text:string; reasoning?:string; error?:string; sessionId?:string; }
export const CLIENT_LABELS: Record<ClientKind, string> = {
  codex: 'ChatGPT · Codex',
  claude: 'Claude Code',
  kimi: 'Kimi Code',
  grok: 'Grok · Desktop',
  'claude-desktop':'Claude Desktop',
};
