import type { FlowEdge, FlowNode, Member, TeamProject, TeamRun } from './collaboration';
import { tr } from './i18n';

/*
 * 运行里实际生效的上限。运行快照冻结了开始时的上限；停下后你在运行页调高，
 * 追加一条 limitRaises 记录，之后按“最后一次调高的值”执行。electron/team-limits.cjs
 * 是主进程里的同一份规则，由测试保证一致。
 */
export type LimitKind = 'visits' | 'traversals' | 'memberTokens' | 'runTokens' | 'runSteps' | 'runMinutes';
export interface LimitRaise { kind: LimitKind; target?: string; value: number; at: number }
export const LIMIT_CAPS: Record<LimitKind, number> = { visits: 1000, traversals: 1000, memberTokens: 10_000_000, runTokens: 100_000_000, runSteps: 10_000, runMinutes: 43_200 };

type Raises = { limitRaises?: LimitRaise[] };
const latest = (run: Raises, kind: LimitKind, target?: string) =>
  [...(run.limitRaises ?? [])].reverse().find((r) => r.kind === kind && (r.target ?? '') === (target ?? ''))?.value;
export const maxVisitsOf = (run: Raises, node: FlowNode) => latest(run, 'visits', node.id) ?? node.maxVisits;
export const maxTraversalsOf = (run: Raises, edge: FlowEdge) => latest(run, 'traversals', edge.id) ?? edge.maxTraversals;
export const memberTokensOf = (run: Raises, member: Member) => latest(run, 'memberTokens', member.id) ?? member.maxTokens;
export const runTokensOf = (run: Raises & Pick<TeamRun, 'version'>) => latest(run, 'runTokens') ?? run.version.graph.maxTokens;
export const runStepsOf = (run: Raises & Pick<TeamRun, 'version'>) => latest(run, 'runSteps') ?? run.version.graph.maxSteps;
export const runMinutesOf = (run: Raises & Pick<TeamRun, 'version'>) => latest(run, 'runMinutes') ?? run.version.graph.maxMinutes;

export function currentLimit(run: TeamRun, kind: LimitKind, target?: string): number {
  if (kind === 'visits') { const n = run.version.graph.nodes.find((x) => x.id === target); if (!n) throw Error('limit target'); return maxVisitsOf(run, n); }
  if (kind === 'traversals') { const e = run.version.graph.edges.find((x) => x.id === target); if (!e) throw Error('limit target'); return maxTraversalsOf(run, e); }
  if (kind === 'memberTokens') { const m = run.members.find((x) => x.id === target); if (!m) throw Error('limit target'); return memberTokensOf(run, m); }
  return kind === 'runTokens' ? runTokensOf(run) : kind === 'runSteps' ? runStepsOf(run) : runMinutesOf(run);
}

/** 给人看的上限名称：「独立忠实度复核」最多执行次数、本次运行总 tokens…… */
export function limitLabel(run: TeamRun, kind: LimitKind, target?: string): string {
  if (kind === 'visits') return tr('「{name}」最多执行次数', { name: run.version.graph.nodes.find((n) => n.id === target)?.title ?? target ?? '' });
  if (kind === 'traversals') { const e = run.version.graph.edges.find((x) => x.id === target); return tr('连线「{name}」最多往返次数', { name: e?.label || e?.id || '' }); }
  if (kind === 'memberTokens') return tr('{name} 每步 tokens 上限', { name: run.members.find((m) => m.id === target)?.name ?? target ?? '' });
  return tr(kind === 'runTokens' ? '本次运行总 tokens' : kind === 'runSteps' ? '本次运行总步数' : '本次运行总分钟');
}

const STOP_EVENTS = new Set(['pause', 'paused', 'uncertain', 'failed', 'recovery']);
/**
 * 这次运行实际在跑的分钟数：各步骤执行时段合并后的总长。停下、等你处理、关机的时间都不算，
 * 所以停了一夜再接着跑，不会一恢复就撞上时间上限。中断时没记下结束时间的步骤，
 * 按它开始之后第一条停机事件的时间算。
 */
export function activeMinutes(run: Pick<TeamRun, 'attempts' | 'events'>, now = Date.now()): number {
  const endOf = (a: TeamRun['attempts'][number]) => a.endedAt ?? (a.status === 'running' ? now
    : run.events.find((e) => e.at >= a.startedAt && STOP_EVENTS.has(e.kind))?.at ?? a.startedAt);
  const spans = run.attempts.filter((a) => Number.isFinite(a.startedAt)).map((a) => [a.startedAt, Math.max(a.startedAt, endOf(a))] as const).sort((x, y) => x[0] - y[0]);
  let total = 0, from = 0, to = -Infinity;
  for (const [start, end] of spans) {
    if (start > to) { if (to > from) total += to - from; from = start; to = end; } else to = Math.max(to, end);
  }
  if (to > from) total += to - from;
  return total / 60_000;
}

/** 这一步从检查点接着跑（重试或续跑），仍算同一次执行，不占“最多执行几次”。 */
export const continuesVisit = (prior?: { resolution?: string }) => !!prior?.resolution?.startsWith('retry:');

export interface LimitStop { kind: LimitKind; target?: string; current: number; used: number; design?: number; need?: number }

/** 「剩余阶段预算不足」里记下的这一轮约需多少 tokens；旧版本的记录没有这个数，返回 0。 */
export const stageNeed = (error?: string) => Number(/这一轮约需 (\d+)/.exec(error ?? '')?.[1]) || 0;

/** 停下的运行被哪些上限卡住，以及流程设计或项目设置里已经改过的更高值。 */
export function limitStops(run: TeamRun, project?: TeamProject, now = Date.now()): LimitStop[] {
  if (!['paused', 'failed', 'uncertain'].includes(run.status) || run.pendingApproval) return [];
  const graph = run.version.graph, stops: LimitStop[] = [];
  const flow = project?.workflows.find((f) => f.id === run.workflowId);
  const design = flow ? [...flow.versions].sort((a, b) => a.number - b.number).at(-1)?.graph : undefined;
  const higher = (value: number | undefined, current: number) => value !== undefined && value > current ? value : undefined;
  // 设计里的值没超过已经用掉的量，采用它也会一恢复就再停，这种就不推荐。
  const add = (kind: LimitKind, target: string | undefined, current: number, used: number, planned?: number) => stops.push({ kind, target, current, used, design: higher(planned, Math.max(current, used)) });
  if (run.attempts.length >= runStepsOf(run)) add('runSteps', undefined, runStepsOf(run), run.attempts.length, design?.maxSteps);
  const open = [...run.attempts].reverse().find((a) => !a.resolution && ['failed', 'uncertain'].includes(a.status));
  if (run.tokens >= runTokensOf(run) || /不足以再开一段/.test(open?.error ?? '')) add('runTokens', undefined, runTokensOf(run), run.tokens, design?.maxTokens);
  const minutes = activeMinutes(run, now);
  if (minutes > runMinutesOf(run)) add('runMinutes', undefined, runMinutesOf(run), Math.ceil(minutes), design?.maxMinutes);
  for (const id of run.queue) {
    const node = graph.nodes.find((n) => n.id === id), prior = [...run.attempts].reverse().find((a) => a.nodeId === id);
    if (node && !continuesVisit(prior) && (run.visits[id] ?? 0) >= maxVisitsOf(run, node))
      add('visits', id, maxVisitsOf(run, node), run.visits[id] ?? 0, design?.nodes.find((n) => n.id === id)?.maxVisits);
  }
  const edgeStop = [...run.events].reverse().find((e) => e.kind === 'limit' && e.edgeId);
  const edge = edgeStop && graph.edges.find((e) => e.id === edgeStop.edgeId);
  if (edge && (run.traversals[edge.id] ?? 0) >= maxTraversalsOf(run, edge) && !run.queue.includes(edge.to))
    add('traversals', edge.id, maxTraversalsOf(run, edge), run.traversals[edge.id] ?? 0, design?.edges.find((e) => e.id === edge.id)?.maxTraversals);
  if (open && /剩余阶段预算不足|本阶段轮次已到/.test(open.error ?? '')) {
    const node = graph.nodes.find((n) => n.id === open.nodeId);
    const members = run.members.filter((m) => node?.type === 'discussion' ? node.participants?.includes(m.id) : m.id === node?.memberId);
    const budget = /剩余阶段预算不足/.test(open.error ?? ''), need = stageNeed(open.error);
    const left = runTokensOf(run) - run.tokens - Object.values(run.reservations ?? {}).reduce((n, v) => n + v, 0);
    // 一段的预算取「成员每步上限」和「本次运行还剩多少」里的小者。剩下的总量比成员上限少，
    // 或者不够发一轮，卡住的是本次运行总量，只调成员上限没用。
    if (budget && (need > left || members.some((m) => left < memberTokensOf(run, m)))) {
      const total = stops.find((s) => s.kind === 'runTokens');
      if (total) total.need = need; else { add('runTokens', undefined, runTokensOf(run), run.tokens, design?.maxTokens); stops[stops.length - 1].need = need; }
    }
    for (const m of members) if (!budget || memberTokensOf(run, m) <= left || need > memberTokensOf(run, m))
      add('memberTokens', m.id, memberTokensOf(run, m), 0, project?.members.find((x) => x.id === m.id)?.maxTokens);
  }
  return stops;
}
