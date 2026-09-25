import { dispatchable } from './health';
import type { ErrorInfo, ModelHealthMap } from '../types';

/* ------------------------------------------------------------------ *
 * 失灵即交接
 *
 * 分清三件事，这个模块只做中间那件：
 *
 *   策略（换成谁、免费的先上还是贵的先上）  归用户 —— 代码不知道哪条路由是
 *                                          付费的，也不该知道
 *   触发（这次失败该不该换人）              归程序 —— errors.ts 已经把依据分好了，
 *                                          这里不含用户偏好
 *   执行（换人时带什么过去）                归程序 —— 幂等键与交接包，在别处
 *
 * 所以这里不排序、不打分、不挑「最好的」模型。名单是用户自己排的顺序，
 * 程序只负责按那个顺序往下走，并且跳过已知坏掉的。名单为空就什么都不做。
 * ------------------------------------------------------------------ */

export interface RouteRef { profileId: string; model: string }
export interface FailoverConfig {
  enabled: boolean;
  routes: RouteRef[];
  /** 引用的路由组。组还在就按组的顺序走，routes 是选用那一刻的快照，组被删掉时兜底 */
  groupId?: string;
}
export interface FailoverDecision { route: RouteRef; reason: string }

export const sameRoute = (a: RouteRef, b: RouteRef): boolean =>
  a.profileId === b.profileId && a.model === b.model;

export type FailoverScope = 'session' | 'project' | 'app';

/**
 * 三层继承：会话 > 项目 > 应用全局。
 *
 * 只有「没设置」（undefined）才继承上层。已经设置的即便是空名单或明确关掉也算数 ——
 * 「我这一次不想自动交接」和「我这一层没意见」是两件不同的话，必须能分开说，
 * 否则用户一旦设了全局，就再也没办法为单次任务关掉它。
 */
export function resolveFailover(
  session?: FailoverConfig,
  project?: FailoverConfig,
  app?: FailoverConfig,
): { config: FailoverConfig; from: FailoverScope | 'none' } {
  if (session) return { config: session, from: 'session' };
  if (project) return { config: project, from: 'project' };
  if (app) return { config: app, from: 'app' };
  return { config: { enabled: false, routes: [] }, from: 'none' };
}

/**
 * 这次失败值不值得换人。返回换人的理由，或者 null 表示换了也没用。
 *
 * 判断只看错误本身。换人解决不了的三类刻意留在原地：请求本身写错了（bad_param）、
 * 跟模型无关的行为问题（loop_detected）、以及说不清原因的（unknown）——
 * 对说不清的错误自动换人，只会把整张名单挨个烧一遍，还让人以为已经尽力了。
 */
export function shouldHandOff(info: ErrorInfo): string | null {
  if (info.blameModel) return '这条路由自己坏了';
  switch (info.kind) {
    case 'rate_limit':
    case 'quota': return '这条路由的额度暂时用完了';
    case 'auth':
    case 'route_unavailable':
    case 'routing_policy': return '这条路由当前不可用';
    case 'tools_unsupported': return '这条路由不支持本次任务要用的工具调用';
    case 'multimodal': return '这条路由看不了图';
    case 'context_too_long': return '这条路由的上下文窗口装不下';
    case 'network':
    case 'timeout': return '连接反复不通';
    default: return null;
  }
}

/**
 * 按用户排的名单找下一位。
 *
 * 从当前这条的下一位开始，绕一圈回到它前面为止。已经试过的不再试，
 * 所以一次任务里最多把名单走一遍，不会来回打转。
 */
export function nextRoute(args: {
  current: RouteRef;
  order: RouteRef[];
  tried?: RouteRef[];
  health: ModelHealthMap;
  info: ErrorInfo;
}): FailoverDecision | null {
  const reason = shouldHandOff(args.info);
  if (!reason || !args.order.length) return null;
  const skip = [args.current, ...(args.tried ?? [])];
  const at = args.order.findIndex((r) => sameRoute(r, args.current));
  const ordered = at < 0 ? args.order : [...args.order.slice(at + 1), ...args.order.slice(0, at)];
  const route = ordered.find(
    (r) => !skip.some((s) => sameRoute(s, r)) && dispatchable(args.health[r.profileId]?.[r.model]),
  );
  return route ? { route, reason } : null;
}
