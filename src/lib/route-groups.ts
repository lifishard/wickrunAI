import type { FailoverConfig, RouteRef } from './failover';

/* ------------------------------------------------------------------ *
 * 路由组：用户自己命名、自己排序的一组路由。
 *
 * 比如「写代码」「免费」「稳的」各一组。选用一组等于同时定下
 * 当前路由（组里第一条）和失灵交接顺序（整组），不用每次逐条配置。
 *
 * 组怎么分、每组放什么、按什么排，全部由用户决定。程序不知道哪条路由
 * 是付费的，也不按名字猜；这里只做存取、引用和兜底。
 *
 * 引用而不是复制：接力名单里记 groupId，改了组，所有引用它的对话、
 * 项目、全局设置下次交接时都按新顺序走。组被删掉时退回选用那一刻
 * 存下的 routes 快照，不会让已经在跑的任务突然没有名单。
 * ------------------------------------------------------------------ */

export interface RouteGroup {
  id: string;
  name: string;
  /** 用户排的顺序；第一条是选用时切过去的当前路由 */
  routes: RouteRef[];
  /** 给自己看的备注，比如「只放免费额度」 */
  note?: string;
  createdAt: number;
}

const isRoute = (r: unknown): r is RouteRef =>
  Boolean(r) && typeof (r as RouteRef).profileId === 'string' && typeof (r as RouteRef).model === 'string'
  && (r as RouteRef).profileId !== '' && (r as RouteRef).model.trim() !== '';

/** 从存档读出来的东西不一定干净：丢掉坏条目、同组内重复的路由，保留用户顺序。 */
export function sanitizeRouteGroups(raw: unknown): RouteGroup[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RouteGroup[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const g = item as Partial<RouteGroup>;
    if (typeof g.id !== 'string' || !g.id || seen.has(g.id)) continue;
    seen.add(g.id);
    const keys = new Set<string>();
    const routes = (Array.isArray(g.routes) ? g.routes : []).filter(isRoute).filter((r) => {
      const key = `${r.profileId}\u0000${r.model}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    }).map((r) => ({ profileId: r.profileId, model: r.model }));
    out.push({
      id: g.id,
      name: typeof g.name === 'string' ? g.name : '',
      routes,
      ...(typeof g.note === 'string' && g.note ? { note: g.note } : {}),
      createdAt: typeof g.createdAt === 'number' ? g.createdAt : 0,
    });
  }
  return out;
}

/** 接力名单实际要走的顺序：引用了还存在的组就用组的，否则用快照。 */
export function effectiveRoutes(config: FailoverConfig | undefined, groups: RouteGroup[] | undefined): RouteRef[] {
  if (!config) return [];
  const group = config.groupId ? groups?.find((g) => g.id === config.groupId) : undefined;
  return group ? group.routes : (config.routes ?? []);
}

/** 把引用展开成普通名单，交给只认 routes 的 nextRoute。 */
export function expandFailover(config: FailoverConfig, groups: RouteGroup[] | undefined): FailoverConfig {
  return { ...config, routes: effectiveRoutes(config, groups) };
}

/** 选用一组：开启交接，名单引用这一组，同时存一份快照兜底。 */
export function failoverFromGroup(group: RouteGroup): FailoverConfig {
  return { enabled: true, groupId: group.id, routes: group.routes.map((r) => ({ ...r })) };
}

/** 这份名单引用的组已经被删掉了 —— 界面上要说清楚现在走的是快照。 */
export function orphanedGroup(config: FailoverConfig | undefined, groups: RouteGroup[] | undefined): boolean {
  return Boolean(config?.groupId) && !groups?.some((g) => g.id === config!.groupId);
}
