import type { AcceptanceCheck, DeliveryRequirement, RunRecord } from '../types';
import type { TaskObservation } from './observations';
import { verdictOf } from './routing-memory';
import { getTransport } from './transport';
import { uid } from './store';

/* ------------------------------------------------------------------ *
 * 回归集与换题验证
 *
 * 这一层是防止前面几层自欺的安全带。路由记分、技能成败、纠错留存都会
 * 产生「看起来在变好」的数字，而验证它们的唯一办法，是拿一组**固定的**任务
 * 在不同配置下各跑一遍，比同一把尺子。
 *
 * 题目来自真实失败：观测里标了未解决或部分可用的任务，一键存成回归题。
 * 这正是 Meta 那条内部实践的最后一步 —— 通过之后，这次失败进入以后的测试集。
 *
 * 两条纪律写进了数据结构本身：
 *
 * 1. dev / holdout 分开，而且 holdout 会退化。用来调过的题目就已经是开发数据了，
 *    再拿它验收只是在量自己的过拟合。所以记 lastUsedAt，到期提醒轮换。
 * 2. preserve-and-extend（借 DarwinX）：一个候选要被采用，不只是在新题上更好，
 *    还必须在已经过的题上不退步。只看平均分会让「修好一个、弄坏两个」看起来是进步。
 * ------------------------------------------------------------------ */

export const EVALS_KEY = 'anyai:evals:v1';
/** holdout 被看过这么多次之后就该轮换了 —— 看过就不再是留出集 */
export const HOLDOUT_STALE_USES = 3;

export interface EvalCase {
  id: string;
  /** 从哪条真实任务来的，方便回头核对 */
  fromRecordId?: string;
  title: string;
  /** 原样的用户要求。不改写 —— 改写过的就不是当初那道题了 */
  task: string;
  acceptance: AcceptanceCheck[];
  split: 'dev' | 'holdout';
  createdAt: number;
  /** 被拿来跑过几次。holdout 用多了就退化成开发数据 */
  uses: number;
  lastUsedAt?: number;
  notes?: string;
  /** 原任务所在的项目：回放时放回同一个项目，项目规范和记忆才和当时一致 */
  projectId?: string | null;
}

export interface EvalResult {
  caseId: string;
  /** 这一轮用的什么配置，比分数时必须对齐 */
  config: string;
  at: number;
  done: boolean;
  activeMs: number;
  tokens: number;
  falseDone: boolean;
}

export interface EvalStore { version: 1; cases: EvalCase[]; results: EvalResult[] }

export const emptyEvals = (): EvalStore => ({ version: 1, cases: [], results: [] });

export async function loadEvals(): Promise<EvalStore> {
  try {
    const raw = await getTransport().kvGet(EVALS_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value && Array.isArray(value.cases) ? { version: 1, cases: value.cases, results: value.results ?? [] } : emptyEvals();
  } catch { return emptyEvals(); }
}

export async function saveEvals(store: EvalStore): Promise<void> {
  // 结果只留最近的，题目全留 —— 题目是资产，结果是快照
  await getTransport().kvSet(EVALS_KEY, JSON.stringify({ ...store, results: store.results.slice(-2000) }));
}

/**
 * 把一条真实的失败任务存成回归题。
 *
 * 默认进 dev：新题先用来调，攒够了再挑一部分转 holdout。一上来就进 holdout
 * 等于还没看过就宣布它是留出集，而你马上就会去看它。
 */
export function caseFromRecord(record: RunRecord, split: EvalCase['split'] = 'dev'): EvalCase {
  return {
    id: uid('eval'),
    fromRecordId: record.id,
    title: (record.question.content ?? '').trim().replace(/\s+/g, ' ').slice(0, 80) || '未命名回归题',
    task: record.question.content ?? '',
    acceptance: (record.state.requirements ?? []).map((r) => r.check),
    split, createdAt: Date.now(), uses: 0, projectId: record.projectId ?? null,
  };
}

/**
 * 跑回归题时把存下来的验收条件原样放进这一轮 —— 不让模型自己重新定验收。
 * 模型自己定的尺子，量出来的「通过」说明不了什么。
 */
export function evalRequirements(c: EvalCase, sourceId: string, now = Date.now()): DeliveryRequirement[] {
  const quote = c.task.trim().slice(0, 200);
  return c.acceptance.map((check, i) => {
    const title = `回归题验收 ${i + 1}：${check.kind}${check.path ? ` ${check.path}` : ''}`;
    return { id: `eval-${c.id}-${i + 1}`, revision: 1, title, sourceId, sourceQuote: quote, check: structuredClone(check), at: now, history: [] };
  });
}

/** holdout 看过太多次就已经是开发数据了，该换一批 */
export function staleHoldout(cases: EvalCase[]): EvalCase[] {
  return cases.filter((c) => c.split === 'holdout' && c.uses >= HOLDOUT_STALE_USES);
}

export interface ConfigReport {
  config: string;
  cases: number;
  done: number;
  /** 做成率。跟路由记分一样，样本不足就别给数字 */
  doneRate: number | null;
  medianActiveMs: number | null;
  tokensPerDone: number | null;
  falseDoneRate: number | null;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** 按配置汇总一批结果。只统计指定 split 的题，dev 和 holdout 绝不混着算 */
export function report(store: EvalStore, split: EvalCase['split']): ConfigReport[] {
  const wanted = new Set(store.cases.filter((c) => c.split === split).map((c) => c.id));
  const byConfig = new Map<string, EvalResult[]>();
  for (const r of store.results) {
    if (!wanted.has(r.caseId)) continue;
    if (!byConfig.has(r.config)) byConfig.set(r.config, []);
    byConfig.get(r.config)!.push(r);
  }
  return [...byConfig.entries()].map(([config, rs]) => {
    // 同一道题同一个配置跑过多次，只算最近一次，不然反复重跑会稀释结果
    const latest = new Map<string, EvalResult>();
    for (const r of rs) if (!latest.has(r.caseId) || latest.get(r.caseId)!.at < r.at) latest.set(r.caseId, r);
    const list = [...latest.values()], done = list.filter((r) => r.done);
    return {
      config, cases: list.length, done: done.length,
      doneRate: list.length ? done.length / list.length : null,
      medianActiveMs: median(list.map((r) => r.activeMs)),
      tokensPerDone: done.length ? Math.round(list.reduce((n, r) => n + r.tokens, 0) / done.length) : null,
      falseDoneRate: list.length ? list.filter((r) => r.falseDone).length / list.length : null,
    };
  }).sort((a, b) => (b.doneRate ?? -1) - (a.doneRate ?? -1));
}

export interface PreserveExtend {
  /** 基线过了、候选没过的题 —— 这就是退步，有一条就不该采用 */
  regressed: string[];
  /** 基线没过、候选过了的 */
  gained: string[];
  /** 两边都跑过的题目数，太少就别下结论 */
  compared: number;
  /** 能不能采用：有收益、且一条都没退步 */
  adopt: boolean;
}

/**
 * preserve-and-extend：候选要被采用，必须在已经过的题上不退步。
 *
 * 只看平均分会让「修好两个、弄坏一个」看起来是净赚，但那一个退步的
 * 恰恰是之前已经能做对的事 —— 用户会先注意到它坏了，而不是别的好了。
 */
export function compare(store: EvalStore, baseline: string, candidate: string, split: EvalCase['split']): PreserveExtend {
  const wanted = new Set(store.cases.filter((c) => c.split === split).map((c) => c.id));
  const pick = (config: string) => {
    const out = new Map<string, EvalResult>();
    for (const r of store.results) {
      if (r.config !== config || !wanted.has(r.caseId)) continue;
      if (!out.has(r.caseId) || out.get(r.caseId)!.at < r.at) out.set(r.caseId, r);
    }
    return out;
  };
  const base = pick(baseline), cand = pick(candidate);
  const shared = [...base.keys()].filter((id) => cand.has(id));
  const regressed = shared.filter((id) => base.get(id)!.done && !cand.get(id)!.done);
  const gained = shared.filter((id) => !base.get(id)!.done && cand.get(id)!.done);
  return { regressed, gained, compared: shared.length, adopt: shared.length > 0 && regressed.length === 0 && gained.length > 0 };
}

/**
 * 从一次运行的现场直接判这道题过没过。
 *
 * 判据跟路由记分那套一致：只认程序核验过且全部通过。跑回归题时没有用户反馈
 * （没人守在旁边一条条点），所以这里不能退而求其次去认模型自评 ——
 * 一旦认了，回归集就会变成「模型说自己做对了多少次」的统计。
 */
export function resultFromRun(caseId: string, config: string, state: {
  status?: string;
  requirements?: { revision: number; check: { kind: string }; verification?: { status: string; revision: number; method?: string } }[];
  requestStats?: { actualInput?: number; output?: number }[];
}, activeMs: number, fixed: AcceptanceCheck[] = []): EvalResult {
  const reqs = state.requirements ?? [];
  const current = reqs.map((r) => (r.verification?.revision === r.revision ? r.verification : undefined));
  const passed = current.filter((v) => v?.status === 'passed').length;
  const program = current.filter((v) => v?.method === 'program').length;
  // 题目自带的验收一条都不能少、不能被改掉，而且每条都要在当前版本上通过
  const key = (c: unknown) => JSON.stringify(c, Object.keys((c ?? {}) as object).sort());
  const kept = fixed.every((check) => reqs.some((r, i) => key(r.check) === key(check) && current[i]?.status === 'passed'));
  const done = state.status === 'completed' && reqs.length > 0 && passed === reqs.length && program > 0 && kept;
  return {
    caseId, config, at: Date.now(), done, activeMs,
    tokens: (state.requestStats ?? []).reduce((n, r) => n + (r.actualInput ?? 0) + (r.output ?? 0), 0),
    falseDone: state.status === 'completed' && !done,
  };
}

/** 一条观测能不能拿来当回归题：只收真实失败，成功的题目没有区分度 */
export function worthKeeping(t: TaskObservation): boolean {
  return verdictOf(t) === 'not_done';
}

/* ------------------------------------------------------------------ *
 * 组件对照（ablation）：同一批题，先按原配置跑，再去掉一个组件跑，按 preserve-and-extend 判断能不能删。
 * 见 docs/HARNESS_COMPONENTS.md 的「可删条件」。
 * ------------------------------------------------------------------ */

export type Ablation = 'harness' | 'project_memory' | 'skills';
export const ABLATIONS: { id: Ablation; label: string; hint: string }[] = [
  { id: 'harness', label: '任务引导提示', hint: '不放执行规范提示（完成检查、重复操作保护这些底线照常生效）' },
  { id: 'project_memory', label: '项目记忆', hint: '不把项目记忆放进提示词（模型仍可以用工具查）' },
  { id: 'skills', label: '技能', hint: '不注入已启用的技能' },
];
/** 结果按配置标签分组：原配置就是模型名，去掉组件的加一个后缀 */
export const ablationConfig = (model: string, ablation?: Ablation) => (ablation ? `${model} −${ablation}` : model);
/** 对照至少要这么多道两边都跑过的题，才给结论 */
export const ABLATION_MIN_CASES = 5;

export interface AblationVerdict {
  ablation: Ablation;
  model: string;
  compared: number;
  regressed: string[];
  gained: string[];
  baseRate: number | null;
  candRate: number | null;
  baseFalseDone: number | null;
  candFalseDone: number | null;
  /** insufficient 题太少；keep 去掉后有退步或错误完成变多；removable 这批题上去掉没有坏处（还要在 holdout 上确认） */
  verdict: 'insufficient' | 'keep' | 'removable';
}

export function ablationVerdict(store: EvalStore, model: string, ablation: Ablation, split: EvalCase['split']): AblationVerdict {
  const base = ablationConfig(model), cand = ablationConfig(model, ablation);
  const pe = compare(store, base, cand, split);
  const rows = new Map(report(store, split).map((r) => [r.config, r]));
  const b = rows.get(base), c = rows.get(cand);
  const baseFalseDone = b?.falseDoneRate ?? null, candFalseDone = c?.falseDoneRate ?? null;
  const worseFalse = baseFalseDone !== null && candFalseDone !== null && candFalseDone > baseFalseDone;
  const verdict = pe.compared < ABLATION_MIN_CASES ? 'insufficient' : pe.regressed.length || worseFalse ? 'keep' : 'removable';
  return { ablation, model, compared: pe.compared, regressed: pe.regressed, gained: pe.gained, baseRate: b?.doneRate ?? null, candRate: c?.doneRate ?? null, baseFalseDone, candFalseDone, verdict };
}

/** 结果里出现过的对照：按（模型, 组件）列出来 */
export function ablationRuns(store: EvalStore): { model: string; ablation: Ablation }[] {
  const out = new Map<string, { model: string; ablation: Ablation }>();
  for (const r of store.results) {
    const m = r.config.match(/^(.*) −(harness|project_memory|skills)$/);
    if (m) out.set(r.config, { model: m[1], ablation: m[2] as Ablation });
  }
  return [...out.values()];
}
