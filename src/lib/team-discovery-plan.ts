import type { TeamProject, TeamRun, TeamTask } from './collaboration';
import { discoveryResult } from './team-discovery';
import { validateTaskDependencies } from './team-dependencies';
import { uid } from './store';
import { tr } from './i18n';

export interface DiscoveryPlanItem {
 id: string; title: string; goal: string; acceptance: string;
 dependsOn: string[]; choiceGroup?: string; selected: boolean;
}
export interface DiscoveryPlanDraft { sourceTaskId: string; sourceRunId: string; items: DiscoveryPlanItem[] }
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const isText = (value: unknown, limit: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= limit;

function checkItems(items: DiscoveryPlanItem[]) {
 if (!Array.isArray(items) || !items.length || items.length > 8) throw Error(tr('一次请选择一至八项任务建议'));
 const ids = new Set<string>();
 for (const item of items) {
  if (!item || typeof item.id !== 'string' || !identifier.test(item.id) || ids.has(item.id)) throw Error(tr('任务建议编号无效或重复'));
  ids.add(item.id);
  if (!Array.isArray(item.dependsOn) || item.dependsOn.length > 8 || new Set(item.dependsOn).size !== item.dependsOn.length || item.dependsOn.some(id => typeof id !== 'string' || !identifier.test(id))) throw Error(tr('任务建议的前置关系无效'));
  if (item.choiceGroup !== undefined && (typeof item.choiceGroup !== 'string' || !identifier.test(item.choiceGroup))) throw Error(tr('备选方向分组无效'));
 }
 const active = new Set<string>(), done = new Set<string>();
 const visit = (id: string) => {
  if (active.has(id)) throw Error(tr('任务之间不能循环等待，请调整前置关系'));
  if (done.has(id)) return;
  active.add(id);
  for (const before of items.find(item => item.id === id)!.dependsOn) {
   if (!ids.has(before) || before === id) throw Error(tr('前置任务缺失，或任务依赖了自己'));
   visit(before);
  }
  active.delete(id); done.add(id);
 };
 items.forEach(item => visit(item.id));
}

/** Model JSON is text advice only. Every executable setting is discarded. */
export function readDiscoveryPlan(text: string): { items: DiscoveryPlanItem[]; body: string } | null {
 if (text.length > 160000 || [...text.matchAll(/^```wickrun-plan\b/gm)].length !== 1) return null;
 const blocks = [...text.matchAll(/^```wickrun-plan[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
 if (blocks.length !== 1) return null;
 try {
  const value = JSON.parse(blocks[0][1]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rows = value.tasks === undefined ? [{ ...value, id: 'next', dependsOn: [] }] : value.version === 1 ? value.tasks : null;
  if (!Array.isArray(rows) || !rows.length || rows.length > 8) return null;
  const chosenGroups = new Set<string>();
  const items: DiscoveryPlanItem[] = rows.map(row => {
   if (!row || !isText(row.title, 200) || !isText(row.goal, 12000) || !isText(row.acceptance, 12000)) throw Error('invalid');
   const item: DiscoveryPlanItem = {id: row.id, title: row.title.trim(), goal: row.goal.trim(), acceptance: row.acceptance.trim(), dependsOn: row.dependsOn ?? [], selected: true};
   if (row.choiceGroup !== undefined) { item.choiceGroup = row.choiceGroup; item.selected = !chosenGroups.has(row.choiceGroup); chosenGroups.add(row.choiceGroup); }
   return item;
  });
  checkItems(items);
  return {items, body: text.replace(blocks[0][0], '').trim()};
 } catch { return null; }
}

export function discoveryPlanDraft(task: TeamTask, run: TeamRun): DiscoveryPlanDraft | null {
 const result = discoveryResult(task, run), plan = result && readDiscoveryPlan(result.text);
 return plan ? {sourceTaskId: task.id, sourceRunId: run.id, items: plan.items} : null;
}

export function adoptedPlanTasks(project: TeamProject, draft: DiscoveryPlanDraft): Map<string, TeamTask> {
 const fromSource = project.tasks.filter(task => task.sourceTaskId === draft.sourceTaskId && task.sourceRunId === draft.sourceRunId);
 const result = new Map(fromSource.filter(task => task.sourceProposalId).map(task => [task.sourceProposalId!, task]));
 if (draft.items.length === 1 && draft.items[0].id === 'next' && !result.has('next')) {
  const legacy = fromSource.find(task => !task.sourceProposalId);
  if (legacy) result.set('next', legacy);
 }
 return result;
}

export function discoverySelectionIssues(project: TeamProject, draft: DiscoveryPlanDraft): string[] {
 try {
  checkItems(draft.items);
  const source = project.tasks.find(task => task.id === draft.sourceTaskId), run = project.runs.find(run => run.id === draft.sourceRunId);
  if (!source || !run || !discoveryResult(source, run)) throw Error(tr('原始梳理结果已不可用，请返回任务重新检查'));
  const selected = draft.items.filter(item => item.selected), existing = adoptedPlanTasks(project, draft);
  if (!selected.length) throw Error(tr('请至少选择一项尚未建立的任务'));
  const selectedIds = new Set(selected.map(item => item.id)), groups = new Set<string>();
  for (const item of draft.items) if (existing.has(item.id) && item.choiceGroup) groups.add(item.choiceGroup);
  for (const item of selected) {
   if (existing.has(item.id)) throw Error(tr('这项建议已经建立为任务：{title}', {title: item.title}));
   if (!isText(item.title, 200) || !isText(item.goal, 12000) || !isText(item.acceptance, 12000)) throw Error(tr('请补全任务名称、目标和完成标准，并缩短过长内容'));
   if (item.choiceGroup && groups.has(item.choiceGroup)) throw Error(tr('同一备选方向只能采用一项，请取消多余选择'));
   if (item.choiceGroup) groups.add(item.choiceGroup);
   for (const before of item.dependsOn) if (!selectedIds.has(before) && !existing.has(before)) throw Error(tr('请同时选择前置任务：{title}', {title: draft.items.find(item => item.id === before)!.title}));
  }
  return [];
 } catch (error) { return [error instanceof Error ? error.message : String(error)]; }
}

/** Atomic, repeat-safe import. The caller persists this single project update; no run is created. */
export function importDiscoveryTasks(project: TeamProject, draft: DiscoveryPlanDraft): string[] {
 const issues = discoverySelectionIssues(project, draft); if (issues.length) throw Error(issues[0]);
 const run = project.runs.find(run => run.id === draft.sourceRunId)!;
 if (run.status !== 'completed') throw Error(tr('请先结束本轮梳理，再保存后续任务'));
 const existing = adoptedPlanTasks(project, draft), selected = draft.items.filter(item => item.selected);
 const taskIds = new Map([...existing].map(([id, task]) => [id, task.id]));
 for (const item of selected) taskIds.set(item.id, uid('teamtask'));
 const tasks: TeamTask[] = selected.map(item => ({id: taskIds.get(item.id)!, title: item.title.trim(), goal: item.goal.trim(), acceptance: item.acceptance.trim(), intent: 'deliver', status: '草稿', entries: [], createdAt: Date.now(), sourceTaskId: draft.sourceTaskId, sourceRunId: draft.sourceRunId, sourceProposalId: item.id, dependsOn: item.dependsOn.map(id => taskIds.get(id)!)}));
 validateTaskDependencies({...project, tasks: [...project.tasks, ...tasks]});
 project.tasks.push(...tasks);
 return tasks.map(task => task.id);
}
