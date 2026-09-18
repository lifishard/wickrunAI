import type { CollaborationData } from './collaboration';

export interface TeamNotification {
  kind: 'question' | 'paused' | 'error' | 'completed';
  runId: string;
  projectId: string;
  status: string;
  title: string;
  body: string;
}

/** 协作空间的运行状态 → 通知；和单 Agent 共用同一条通道和同一组 kind。 */
const TITLES: Record<string, { kind: TeamNotification['kind']; title: string }> = {
  waiting_user: { kind: 'question', title: '协作任务需要你的确认' },
  paused: { kind: 'paused', title: '协作任务已暂停' },
  uncertain: { kind: 'paused', title: '协作任务待核实' },
  failed: { kind: 'error', title: '协作任务失败' },
  completed: { kind: 'completed', title: '协作任务已完成' },
};

/**
 * 对比上一次看到的状态，算出这一轮该发哪些通知，并把 seen 更新为现状。
 * seen 为空表示第一次观察：只记录现状，不为历史运行补发通知。
 */
export function teamNotifications(seen: Map<string, string>, data: CollaborationData | null, seeding = false): TeamNotification[] {
  const out: TeamNotification[] = [];
  if (!data) return out;
  for (const project of Object.values(data.projects)) {
    for (const run of project.runs) {
      const previous = seen.get(run.id);
      seen.set(run.id, run.status);
      if (seeding || previous === run.status) continue;
      const mapped = TITLES[run.status];
      if (!mapped) continue;
      const task = project.tasks.find((t) => t.id === run.taskId);
      const last = run.events[run.events.length - 1]?.text ?? '';
      const name = task?.title || run.goal || '协作任务';
      out.push({ ...mapped, runId: run.id, projectId: project.id, status: run.status, body: last ? `${name}：${last}` : name });
    }
  }
  return out;
}
