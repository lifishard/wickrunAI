import { classifyError } from './errors';
import type { ErrorInfo } from '../types';
import type { Member, NodeAttempt, RouteAttempt, TeamRun } from './collaboration';
import { teamHasUnknownOperations } from './team-run-guidance';

/** 这位成员在本次运行里实际要用的路由：运行停下后改过，就用最后一次改的。 */
export function activeRoute(run: Pick<TeamRun, 'routeOverrides'>, member: Member): { profileId: string; model: string; effort: string } {
  const changed = [...(run.routeOverrides ?? [])].reverse().find((o) => o.memberId === member.id);
  return changed ? { profileId: changed.profileId, model: changed.model, effort: changed.effort }
    : { profileId: member.connectionId, model: member.model, effort: member.effort };
}

/*
 * 换一条路由能解决的错误。限流和网络会自动等待重试；说不清原因的错误不假装换模型就能好，
 * 仍走核实面板。
 */
const SWITCHABLE = new Set(['route_unavailable', 'routing_policy', 'model_missing', 'model_broken', 'auth', 'quota', 'bad_param', 'tools_unsupported', 'multimodal', 'context_too_long']);
const isClient = (id: string) => id.startsWith('client:');

export interface RouteFailure { memberId: string; name: string; profileId: string; model: string; effort: string; error: string; info: ErrorInfo }
export interface RouteFix {
  attemptId: string; nodeId: string; nodeTitle: string;
  failures: RouteFailure[];
  /** 本步骤里还没跑到、路由也没验证过的成员 */
  untested: Member[];
  /** 出错的尝试没有执行任何工具步骤：换路由后可直接重试，不必先核实 */
  sideEffectFree: boolean;
}

function noSteps(attempt: NodeAttempt): boolean {
  return !attempt.state?.steps?.length && Object.values(attempt.memberStates ?? {}).every((s) => !s?.steps?.length);
}

/** 停下的运行里，哪些成员因为路由出错，以及还能怎么修。没有换路由能解决的错误就返回 null。 */
export function teamRouteFix(run: TeamRun): RouteFix | null {
  if (!['failed', 'uncertain'].includes(run.status)) return null;
  const attempt = [...run.attempts].reverse().find((a) => !a.resolution && ['failed', 'uncertain'].includes(a.status) && a.error);
  const node = attempt && run.version.graph.nodes.find((n) => n.id === attempt.nodeId);
  if (!attempt || !node) return null;
  const members = run.members.filter((m) => node.type === 'discussion' ? node.participants?.includes(m.id) : m.id === node.memberId);
  const last = new Map<string, RouteAttempt>();
  for (const entry of attempt.routeLog ?? []) last.set(entry.memberId, entry);
  const failures: RouteFailure[] = [];
  for (const member of members) {
    const entry = last.get(member.id);
    // 旧记录没有 routeLog：单人步骤按当前路由认定出错成员
    const route = entry ?? (!attempt.routeLog?.length && members.length === 1 ? { ...activeRoute(run, member), status: 'failed' as const } : undefined);
    if (route?.status !== 'failed' || isClient(route.profileId)) continue;
    const error = ((entry?.error ?? attempt.error) || '').replace(/^Error:\s*/, '').trim();
    const info = classifyError(error, entry?.httpStatus, { model: route.model });
    if (SWITCHABLE.has(info.kind)) failures.push({ memberId: member.id, name: member.name, profileId: route.profileId, model: route.model, effort: activeRoute(run, member).effort, error, info });
  }
  if (!failures.length) return null;
  const untested = members.filter((m) => !last.has(m.id) && attempt.memberOutputs?.[m.id] === undefined && !isClient(activeRoute(run, m).profileId));
  return { attemptId: attempt.id, nodeId: node.id, nodeTitle: node.title, failures, untested, sideEffectFree: noSteps(attempt) && !teamHasUnknownOperations(run) };
}
