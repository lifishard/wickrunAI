import type { ObservationStore, TaskObservation } from './observations';
import type { TaskKind } from './harness';

/* ------------------------------------------------------------------ *
 * 路由记分
 *
 * 观测到今天为止是只写不读的：九十天、几百条任务、带用户反馈的完整轨迹，
 * 没有一条路径回到下一次决策。这里把它聚合成三个数，就是技能清单最后
 * 那把尺子：做成率、端到端耗时、每成功单位成本。**照搬，不自造指标。**
 *
 * 三条取数约束，每一条都是真实测试里踩出来的：
 *
 * A. 统计单元是「路由别名」而不是模型名。别名由 model + 凭据 + baseUrl 派生，
 *    所以 `auto/best-coding` 这种网关逻辑路由算它自己一条 —— 网关背后随时可能
 *    换实际执行者，把成绩归到某个底座模型头上是错的。
 *
 * B. 「做成」「没做成」「不知道」是三件事，不是两件。把「不知道」算进任何一边
 *    都会造出假数字：现场数据里只有四分之一的任务有用户反馈，剩下的四分之三
 *    既不能算成功也不能算失败。doneRate 的分母只含前两者，unknown 单独报。
 *
 * C. 样本不足就不给数字，而不是给一个小样本算出来的数字。
 * ------------------------------------------------------------------ */

/** 低于这个样本量不排名：拿三次调用报一个做成率是这类系统最容易翻的车 */
export const MIN_RANK_SAMPLES = 8;
/** 成本数字更不稳，门槛更高 */
export const MIN_COST_SAMPLES = 20;

export type Verdict = 'done' | 'not_done' | 'unknown';

/**
 * 这一条任务到底算不算做成。
 *
 * 用户反馈最硬，有就听它的。没有反馈时只认「声明了验收、全部通过、而且至少有
 * 一条是程序核验的」—— 模型自己复核通过不算独立验证，这条在下发给模型的指令里
 * 就写着，统计时不能又把它算成功。其余一律 unknown，不猜。
 */
export function verdictOf(t: TaskObservation): Verdict {
  const fb = t.feedback?.outcome;
  if (fb === 'usable') return 'done';
  if (fb === 'partial' || fb === 'unresolved') return 'not_done';
  const a = t.acceptance;
  if (a.failed > 0) return 'not_done';
  if (t.status === 'completed' && a.total > 0 && a.passed === a.total && a.program > 0) return 'done';
  return 'unknown';
}

/** 声称完成，但验收里还有没过、没核验或核验不了的 */
export function falseDone(t: TaskObservation): boolean {
  return t.status === 'completed' && t.acceptance.total > 0 &&
    (t.acceptance.failed > 0 || t.acceptance.unchecked > 0 || t.acceptance.unverifiable > 0);
}

export interface RouteScore {
  /** 统计单元：路由别名。同一个模型挂在两份凭据下是两条 */
  route: string;
  /** 给人看的标签，取这条路由上最近一次用的模型名 */
  model: string;
  kind: TaskKind | 'unknown' | 'all';
  samples: number;
  done: number;
  notDone: number;
  unknown: number;
  /** 做成率。分母只有 done + notDone；样本不足时是 null，不是 0 */
  doneRate: number | null;
  /** 端到端活跃耗时的中位数。用中位数不用均值，长尾任务会把均值拉废 */
  medianActiveMs: number | null;
  /** 每做成一次花的 token。样本不足或用量有缺口时是 null */
  tokensPerDone: number | null;
  /** 声称完成里有多少是虚的 */
  falseDoneRate: number | null;
  toolFailRate: number | null;
  /** 有请求没记到用量，成本数字不完整 */
  costIncomplete: boolean;
  /** 够不够格参与排名 */
  rankable: boolean;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

function score(route: string, kind: RouteScore['kind'], tasks: TaskObservation[]): RouteScore {
  const verdicts = tasks.map(verdictOf);
  const done = verdicts.filter((v) => v === 'done').length;
  const notDone = verdicts.filter((v) => v === 'not_done').length;
  const judged = done + notDone;
  const completed = tasks.filter((t) => t.status === 'completed');
  const active = tasks.flatMap((t) => t.attempts.map((a) => a.activeMs)).filter((n) => n > 0);
  const tokens = tasks.reduce((n, t) => n + t.requests.actualInput + t.requests.actualOutput, 0);
  const costIncomplete = tasks.some((t) => t.requests.missingInput > 0 || t.requests.missingOutput > 0);
  const tools = tasks.reduce((n, t) => n + t.tools.total, 0);
  const toolFails = tasks.reduce((n, t) => n + t.tools.failed, 0);
  const rankable = judged >= MIN_RANK_SAMPLES;
  return {
    route, kind, model: tasks.at(-1)?.attempts.at(-1)?.model ?? route,
    samples: tasks.length, done, notDone, unknown: verdicts.filter((v) => v === 'unknown').length,
    doneRate: rankable ? done / judged : null,
    medianActiveMs: median(active),
    tokensPerDone: done > 0 && judged >= MIN_COST_SAMPLES && !costIncomplete ? Math.round(tokens / done) : null,
    falseDoneRate: completed.length >= MIN_RANK_SAMPLES ? completed.filter(falseDone).length / completed.length : null,
    toolFailRate: tools > 0 ? toolFails / tools : null,
    costIncomplete, rankable,
  };
}

/**
 * 按路由（可选再按任务类型）聚合。
 *
 * kind 传 'all' 时不分任务类型；传具体类型时只统计那一类，旧记录没有 kind，
 * 归进 'unknown'，不会被算进任何一个具体类型里。
 */
export function routeScores(store: ObservationStore, kind: RouteScore['kind'] = 'all'): RouteScore[] {
  const groups = new Map<string, TaskObservation[]>();
  for (const t of store.tasks) {
    if (kind !== 'all' && (t.kind ?? 'unknown') !== kind) continue;
    for (const route of new Set(t.attempts.map((a) => a.route))) {
      if (!groups.has(route)) groups.set(route, []);
      groups.get(route)!.push(t);
    }
  }
  return [...groups.entries()]
    .map(([route, tasks]) => score(route, kind, tasks))
    // 能排名的按做成率降序在前；不能排名的按样本量降序排在后面，等着攒够
    .sort((a, b) => (b.rankable ? 1 : 0) - (a.rankable ? 1 : 0)
      || (b.doneRate ?? -1) - (a.doneRate ?? -1) || b.samples - a.samples);
}
