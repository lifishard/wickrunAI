import type { TeamDependencyInput, TeamProject, TeamRun, TeamTask } from './collaboration';

export const MAX_TEAM_DEPENDENCIES = 8;
export const MAX_TEAM_DEPENDENCY_TEXT = 32000;
const WORK_NODES = new Set(['agent', 'discussion', 'review', 'handoff']);

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const idsOf = (task: TeamTask): string[] => task.dependsOn ?? [];
const newestRun = (a: TeamRun, b: TeamRun) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);

/** Validate the saved direct-dependency graph without requiring dependencies to have run yet. */
export function validateTaskDependencies(project: Pick<TeamProject, 'tasks'>): void {
  const tasks = new Map(project.tasks.map(task => [task.id, task]));
  for (const task of project.tasks) {
    if (task.dependsOn !== undefined && !Array.isArray(task.dependsOn)) throw Error(`任务「${task.title}」的前置任务格式无效`);
    const ids = idsOf(task);
    if (ids.length > MAX_TEAM_DEPENDENCIES) throw Error(`任务「${task.title}」最多只能有 ${MAX_TEAM_DEPENDENCIES} 个前置任务`);
    if (ids.some(id => typeof id !== 'string' || !id)) throw Error(`任务「${task.title}」的前置任务编号无效`);
    if (new Set(ids).size !== ids.length) throw Error(`任务「${task.title}」不能重复引用同一个前置任务`);
    for (const id of ids) {
      if (id === task.id) throw Error(`任务「${task.title}」不能依赖自身`);
      const source = tasks.get(id);
      if (!source) throw Error(`任务「${task.title}」引用的前置任务不存在：${id}`);
      if (source.intent === 'explore') throw Error(`任务「${task.title}」不能把想法梳理任务「${source.title}」作为执行前置`);
    }
  }
  const indegree = new Map(project.tasks.map(task => [task.id, idsOf(task).length]));
  const children = new Map<string, string[]>();
  for (const task of project.tasks) for (const id of idsOf(task)) children.set(id, [...(children.get(id) ?? []), task.id]);
  const queue = [...project.tasks].filter(task => indegree.get(task.id) === 0).map(task => task.id).sort();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!; visited++;
    for (const child of (children.get(id) ?? []).sort()) {
      const next = indegree.get(child)! - 1; indegree.set(child, next);
      if (next === 0) queue.push(child);
    }
    queue.sort();
  }
  if (visited !== project.tasks.length) throw Error('任务之间的前置关系不能形成循环');
}

function approvedEnd(run: TeamRun): boolean {
  const nodes = new Map(run.version.graph.nodes.map(node => [node.id, node]));
  const latest = new Map<string, TeamRun['attempts'][number]>();
  for (const attempt of run.attempts) latest.set(attempt.nodeId, attempt);
  const ends = [...latest.values()].filter(attempt => nodes.get(attempt.nodeId)?.type === 'end');
  return ends.length > 0 && ends.every(attempt =>
    attempt.status === 'completed' && attempt.outcome === 'pass' && run.events.some(event =>
      event.kind === 'approval' && event.nodeId === attempt.nodeId && event.at >= attempt.startedAt
      && (event.approved === true || (event.approved === undefined && event.text === '用户确认验收'))));
}

function outputsFromAcceptedRun(title: string, run: TeamRun): TeamDependencyInput['outputs'] {
  if (run.intent === 'explore') throw Error(`想法梳理运行不能作为执行前置：${title}`);
  if (run.status !== 'completed') throw Error(`前置任务「${title}」尚无已完成的验收运行`);
  if (run.queue?.length || run.pendingApproval || run.approvalQueue?.length || Object.keys(run.reservations ?? {}).length) throw Error(`前置任务「${title}」仍有执行、审批或预留状态`);
  if (run.attempts.some(attempt => ['running', 'waiting_user', 'uncertain'].includes(attempt.status))) throw Error(`前置任务「${title}」仍有未核实步骤`);
  const latest = new Map<string, TeamRun['attempts'][number]>();
  for (const attempt of run.attempts) latest.set(attempt.nodeId, attempt);
  if ([...latest.values()].some(attempt => attempt.status !== 'completed')) throw Error(`前置任务「${title}」仍有失败或未完成步骤`);
  if (!approvedEnd(run)) throw Error(`前置任务「${title}」尚未经过结束节点的明确验收`);
  if (run.attempts.some(attempt => (attempt.artifacts?.length ?? 0) > 0)) throw Error(`前置任务「${title}」包含文件产物，本批只支持文本依赖`);
  const outputs = run.version.graph.nodes
    .filter(node => WORK_NODES.has(node.type))
    .map(node => latest.get(node.id))
    .filter((attempt): attempt is TeamRun['attempts'][number] => typeof attempt?.output === 'string' && Boolean(attempt.output.trim()))
    .map(attempt => ({attemptId: attempt.id, nodeId: attempt.nodeId, text: attempt.output}));
  if (!outputs.length) throw Error(`前置任务「${title}」缺少实际完成的文本产出`);
  return outputs;
}

function inputFromRun(task: TeamTask, run: TeamRun): TeamDependencyInput {
  if (task.intent === 'explore') throw Error(`想法梳理任务「${task.title}」不能作为执行前置`);
  if (![task.title, task.goal, task.acceptance].every(value => typeof value === 'string')) throw Error('前置任务文本格式无效');
  if (run.taskId !== task.id) throw Error(`前置任务「${task.title}」的运行身份不匹配`);
  if (run.goal !== task.goal || run.acceptance !== task.acceptance) throw Error(`前置任务「${task.title}」的目标或验收标准已变化，请重新运行`);
  const outputs = outputsFromAcceptedRun(task.title, run);
  return {taskId: task.id, runId: run.id, title: task.title, goal: task.goal, acceptance: task.acceptance, outputs};
}

function assertTextLimit(inputs: TeamDependencyInput[]): void {
  const size = inputs.reduce((total, input) => total + input.title.length + input.goal.length + input.acceptance.length
    + input.outputs.reduce((sum, output) => sum + output.text.length, 0), 0);
  if (size > MAX_TEAM_DEPENDENCY_TEXT) throw Error(`前置任务文本共 ${size} 个字符，超过 ${MAX_TEAM_DEPENDENCY_TEXT} 字符上限；请缩小前置范围`);
}

/** Freeze the newest accepted textual run of every direct dependency. */
export function captureTaskDependencies(project: Pick<TeamProject, 'tasks' | 'runs'>, taskId: string): {dependencyTaskIds:string[];dependencyInputs:TeamDependencyInput[]} {
  validateTaskDependencies(project);
  const task = project.tasks.find(item => item.id === taskId);
  if (!task) throw Error('任务不存在');
  const dependencyTaskIds = [...idsOf(task)];
  const dependencyInputs = dependencyTaskIds.map(id => {
    const source = project.tasks.find(item => item.id === id)!;
    const latest = project.runs.filter(run => run.taskId === id).sort(newestRun)[0];
    if (!latest) throw Error(`前置任务「${source.title}」还没有运行`);
    return inputFromRun(source, latest);
  });
  assertTextLimit(dependencyInputs);
  return {dependencyTaskIds, dependencyInputs};
}

/**
 * Authenticate a run's frozen dependency text against the exact accepted runs
 * it names. A newer source run does not replace an already frozen snapshot.
 */
export function validateFrozenDependencies(project: Pick<TeamProject, 'tasks' | 'runs'>, run: TeamRun): void {
  validateTaskDependencies(project);
  const task = project.tasks.find(item => item.id === run.taskId);
  if (!task) throw Error('运行引用的任务不存在');
  const ids = run.dependencyTaskIds, inputs = run.dependencyInputs;
  if (ids === undefined && inputs === undefined) {
    if (idsOf(task).length) throw Error('运行缺少前置任务冻结快照');
    return; // old runs without dependencies remain valid
  }
  if (!Array.isArray(ids) || !Array.isArray(inputs) || !same(ids, idsOf(task)) || inputs.length !== ids.length) throw Error('运行的前置任务冻结清单与任务不一致');
  if (ids.length > MAX_TEAM_DEPENDENCIES || new Set(ids).size !== ids.length) throw Error('运行的前置任务冻结清单无效');
  for (let index = 0; index < ids.length; index++) {
    const source = project.tasks.find(item => item.id === ids[index]);
    const input = inputs[index];
    if (!source || !input || input.taskId !== ids[index]) throw Error('运行的前置任务冻结身份无效');
    if (![input.title, input.goal, input.acceptance].every(value => typeof value === 'string')) throw Error('运行的前置任务冻结文本格式无效');
    const sourceRun = project.runs.find(item => item.id === input.runId);
    if (!sourceRun) throw Error(`前置任务「${source.title}」的冻结运行已不存在`);
    if (sourceRun.taskId !== source.id) throw Error('运行的前置任务冻结身份无效');
    const expected = {taskId: source.id, runId: sourceRun.id, title: input.title, goal: sourceRun.goal, acceptance: sourceRun.acceptance,
      outputs: outputsFromAcceptedRun(input.title, sourceRun)};
    if (!same(input, expected)) throw Error(`前置任务「${source.title}」的冻结文本不可改写`);
  }
  assertTextLimit(inputs);
}

/** UI-friendly readiness check; saving an incomplete plan remains allowed. */
export function dependencyBlockers(project: Pick<TeamProject, 'tasks' | 'runs'>, taskId: string): string[] {
  try { captureTaskDependencies(project, taskId); return []; }
  catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}
