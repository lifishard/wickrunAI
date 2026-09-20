import type { TeamProject, TeamRun, TeamRunStatus, TeamTask } from './collaboration';
import { discoveryResult } from './team-discovery';

export type TeamProjectStage = 'exploring' | 'decision' | 'ready' | 'running' | 'completed' | 'attention';

export type TeamProjectReasonKey =
  | '想法尚未开始梳理'
  | '梳理运行等待开始'
  | '正在梳理想法'
  | '梳理运行正在暂停'
  | '梳理结果等待你决定下一步'
  | '想法梳理已完成，并已建立后续任务'
  | '梳理运行等待你的决定'
  | '梳理运行已暂停'
  | '梳理结果需要核实'
  | '梳理运行失败'
  | '梳理运行已取消'
  | '梳理运行已结束，但没有可用结果'
  | '任务还没有实际运行'
  | '运行等待开始'
  | '运行正在进行'
  | '运行正在暂停'
  | '运行等待你验收'
  | '运行等待你的决定'
  | '运行已暂停'
  | '运行结果需要核实'
  | '运行失败'
  | '运行已取消'
  | '实际交付运行已完成';

export type TeamProjectNextActionKey =
  | '打开任务，准备梳理想法'
  | '打开梳理运行'
  | '查看梳理运行'
  | '查看梳理结果'
  | '查看梳理记录'
  | '查看并处理梳理运行'
  | '检查梳理暂停原因'
  | '核实已有梳理结果'
  | '查看梳理失败原因'
  | '查看梳理取消记录'
  | '打开任务，准备开始'
  | '打开待开始运行'
  | '查看运行'
  | '查看并处理运行'
  | '检查运行暂停原因'
  | '核实已有运行结果'
  | '查看运行失败原因'
  | '查看运行取消记录'
  | '查看交付运行';

export interface TeamTaskSourceProgress {
  taskId?: string;
  runId?: string;
  taskExists: boolean;
  /** A run only exists for this provenance link when it belongs to sourceTaskId. */
  runExists: boolean;
}

export interface TeamTaskProgress {
  taskId: string;
  title: string;
  intent: 'explore' | 'deliver';
  status: TeamProjectStage;
  reasonKey: TeamProjectReasonKey;
  nextActionKey: TeamProjectNextActionKey;
  /** Original runtime evidence, never helper-authored UI copy. */
  reasonDetail?: string;
  relevantRunId?: string;
  liveRunCount: number;
  needsAttentionCount: number;
  needsAttentionRunIds: string[];
  source: TeamTaskSourceProgress;
  childTaskIds: string[];
}

export interface TeamProjectProgress {
  tasks: TeamTaskProgress[];
  counts: Record<TeamProjectStage, number>;
  liveRunCount: number;
  needsAttentionCount: number;
}

const LIVE = new Set<TeamRunStatus>(['running', 'pausing', 'waiting_user']);
const ATTENTION = new Set<TeamRunStatus>(['waiting_user', 'paused', 'uncertain', 'failed', 'cancelled']);

function newestRun(a: TeamRun, b: TeamRun): number {
  return b.createdAt - a.createdAt || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

function newestTask(a: TeamTask, b: TeamTask): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

function activeNotice(run: TeamRun): string | undefined {
  return [...run.attempts]
    .filter(item => item.status === 'running' && item.notice?.trim())
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))[0]?.notice?.trim();
}

function latestAttemptDetail(run: TeamRun): string | undefined {
  const evidence = [
    ...run.attempts.filter(item => item.error?.trim()).map(item => ({id: item.id, at: item.endedAt ?? item.startedAt, text: item.error!.trim()})),
    ...run.events.filter(item => (['failed', 'uncertain', 'paused', 'pause'].includes(item.kind) || item.kind.startsWith('recovery')) && item.text?.trim()),
  ];
  return evidence.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))[0]?.text.trim();
}

function detailOf(run: TeamRun): string | undefined {
  if (run.status === 'completed' || run.status === 'ready') return undefined;
  if (run.status === 'running' || run.status === 'pausing') return activeNotice(run);
  if (run.status === 'waiting_user') return run.pendingApproval?.text?.trim() || undefined;
  return latestAttemptDetail(run);
}

/**
 * Pick the run which describes the task now. A genuinely active run wins even
 * when a newer ready/cancelled record was appended. Paused and uncertain runs
 * remain actionable until explicitly resolved, even if another run completed.
 */
function relevantRun(runs: TeamRun[]): TeamRun | undefined {
  const ordered = [...runs].sort(newestRun);
  const live = ordered.filter(run => LIVE.has(run.status));
  if (live.length) {
    const priority: Record<string, number> = { running: 0, pausing: 1, waiting_user: 2 };
    return live.sort((a, b) => priority[a.status] - priority[b.status] || newestRun(a, b))[0];
  }
  const recoverable = ordered.filter(run => ['paused', 'uncertain'].includes(run.status));
  return recoverable[0] ?? ordered[0];
}

/** Only unresolved current runs contribute attention; old failed history does not. */
function attentionRuns(runs: TeamRun[], relevant?: TeamRun): TeamRun[] {
  const ordered = [...runs].sort(newestRun);
  const result = ordered.filter(run => {
    if (run.status === 'waiting_user') return true;
    return ['paused', 'uncertain'].includes(run.status);
  });
  if (relevant && ATTENTION.has(relevant.status) && !result.some(run => run.id === relevant.id)) result.push(relevant);
  return result.sort(newestRun);
}

function deliveryProgress(runs: TeamRun[], common: Omit<TeamTaskProgress, 'status' | 'reasonKey' | 'nextActionKey'>): TeamTaskProgress {
  const run = relevantRun(runs);
  if (!run) return {...common, status: 'ready', reasonKey: '任务还没有实际运行', nextActionKey: '打开任务，准备开始'};
  const base = {...common, relevantRunId: run.id, reasonDetail: detailOf(run)};
  switch (run.status) {
    case 'ready': return {...base, status: 'ready', reasonKey: '运行等待开始', nextActionKey: '打开待开始运行'};
    case 'running': return {...base, status: 'running', reasonKey: '运行正在进行', nextActionKey: '查看运行'};
    case 'pausing': return {...base, status: 'running', reasonKey: '运行正在暂停', nextActionKey: '查看运行'};
    case 'waiting_user': {
      const node = run.version.graph.nodes.find(item => item.id === run.pendingApproval?.nodeId);
      return {...base, status: 'decision', reasonKey: node?.type === 'end' ? '运行等待你验收' : '运行等待你的决定', nextActionKey: '查看并处理运行'};
    }
    case 'paused': return {...base, status: 'attention', reasonKey: '运行已暂停', nextActionKey: '检查运行暂停原因'};
    case 'uncertain': return {...base, status: 'attention', reasonKey: '运行结果需要核实', nextActionKey: '核实已有运行结果'};
    case 'failed': return {...base, status: 'attention', reasonKey: '运行失败', nextActionKey: '查看运行失败原因'};
    case 'cancelled': return {...base, status: 'attention', reasonKey: '运行已取消', nextActionKey: '查看运行取消记录'};
    case 'completed': return {...base, status: 'completed', reasonKey: '实际交付运行已完成', nextActionKey: '查看交付运行'};
  }
}

function explorationProgress(
  task: TeamTask,
  runs: TeamRun[],
  childTasks: TeamTask[],
  common: Omit<TeamTaskProgress, 'status' | 'reasonKey' | 'nextActionKey'>,
): TeamTaskProgress {
  const run = relevantRun(runs);
  if (!run) return {...common, status: 'exploring', reasonKey: '想法尚未开始梳理', nextActionKey: '打开任务，准备梳理想法'};

  // Only the current run can describe the current round. An adopted result
  // from an older round must not conceal a newer failure or uncertainty.
  const result = discoveryResult(task, run);
  if (result && run.status === 'completed' && childTasks.some(child => child.sourceRunId === run.id)) return {
    ...common,
    relevantRunId: run.id,
    reasonDetail: detailOf(run),
    status: 'completed',
    reasonKey: '想法梳理已完成，并已建立后续任务',
    nextActionKey: '查看梳理记录',
  };
  if (result) return {...common, relevantRunId: run.id, reasonDetail: detailOf(run), status: 'decision', reasonKey: '梳理结果等待你决定下一步', nextActionKey: '查看梳理结果'};

  const base = {...common, relevantRunId: run.id, reasonDetail: detailOf(run)};
  switch (run.status) {
    case 'ready': return {...base, status: 'exploring', reasonKey: '梳理运行等待开始', nextActionKey: '打开梳理运行'};
    case 'running': return {...base, status: 'exploring', reasonKey: '正在梳理想法', nextActionKey: '查看梳理运行'};
    case 'pausing': return {...base, status: 'exploring', reasonKey: '梳理运行正在暂停', nextActionKey: '查看梳理运行'};
    case 'waiting_user': return {...base, status: 'attention', reasonKey: '梳理运行等待你的决定', nextActionKey: '查看并处理梳理运行'};
    case 'paused': return {...base, status: 'attention', reasonKey: '梳理运行已暂停', nextActionKey: '检查梳理暂停原因'};
    case 'uncertain': return {...base, status: 'attention', reasonKey: '梳理结果需要核实', nextActionKey: '核实已有梳理结果'};
    case 'failed': return {...base, status: 'attention', reasonKey: '梳理运行失败', nextActionKey: '查看梳理失败原因'};
    case 'cancelled': return {...base, status: 'attention', reasonKey: '梳理运行已取消', nextActionKey: '查看梳理取消记录'};
    case 'completed': return {...base, status: 'attention', reasonKey: '梳理运行已结束，但没有可用结果', nextActionKey: '查看并处理梳理运行'};
  }
}

/** Derive a stable project overview solely from persisted tasks and runs. */
export function teamProjectProgress(project: Pick<TeamProject, 'tasks' | 'runs'>): TeamProjectProgress {
  const tasks = [...project.tasks].sort(newestTask);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const runById = new Map(project.runs.map(run => [run.id, run]));
  const children = new Map<string, TeamTask[]>();
  for (const task of tasks) if (task.sourceTaskId) children.set(task.sourceTaskId, [...(children.get(task.sourceTaskId) ?? []), task]);

  const progress = tasks.map(task => {
    const taskRuns = project.runs.filter(run => run.taskId === task.id);
    const relevant = relevantRun(taskRuns);
    const attention = attentionRuns(taskRuns, relevant);
    const childTasks = [...(children.get(task.id) ?? [])].sort(newestTask);
    const sourceTask = task.sourceTaskId ? taskById.get(task.sourceTaskId) : undefined;
    const sourceRun = task.sourceRunId ? runById.get(task.sourceRunId) : undefined;
    const common: Omit<TeamTaskProgress, 'status' | 'reasonKey' | 'nextActionKey'> = {
      taskId: task.id,
      title: task.title,
      intent: task.intent === 'explore' ? 'explore' : 'deliver',
      liveRunCount: taskRuns.filter(run => LIVE.has(run.status)).length,
      needsAttentionCount: attention.length,
      needsAttentionRunIds: attention.map(run => run.id),
      source: {
        taskId: task.sourceTaskId,
        runId: task.sourceRunId,
        taskExists: Boolean(sourceTask),
        runExists: Boolean(sourceTask && sourceRun && sourceRun.taskId === sourceTask.id),
      },
      childTaskIds: childTasks.map(child => child.id),
    };
    const item = task.intent === 'explore'
      ? explorationProgress(task, taskRuns, childTasks, common)
      : deliveryProgress(taskRuns, common);
    if (item.status === 'attention' && item.relevantRunId && !item.needsAttentionRunIds.includes(item.relevantRunId)) {
      item.needsAttentionRunIds = [...item.needsAttentionRunIds, item.relevantRunId];
      item.needsAttentionCount = item.needsAttentionRunIds.length;
    }
    return item;
  });

  const stageOrder: Record<TeamProjectStage, number> = {attention: 0, decision: 1, running: 2, exploring: 3, ready: 4, completed: 5};
  progress.sort((a, b) => stageOrder[a.status] - stageOrder[b.status] || newestTask(taskById.get(a.taskId)!, taskById.get(b.taskId)!));
  const counts: Record<TeamProjectStage, number> = {exploring: 0, decision: 0, ready: 0, running: 0, completed: 0, attention: 0};
  for (const item of progress) counts[item.status]++;
  return {
    tasks: progress,
    counts,
    liveRunCount: progress.reduce((sum, item) => sum + item.liveRunCount, 0),
    needsAttentionCount: progress.reduce((sum, item) => sum + item.needsAttentionCount, 0),
  };
}
