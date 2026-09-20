import React from 'react';
import type { TeamProject } from '../../lib/collaboration';
import { teamProjectProgress, type TeamProjectStage } from '../../lib/team-project-progress';
import { dependencyBlockers } from '../../lib/team-dependencies';
import { useT } from '../../lib/i18n';
import './TeamProjectProgress.css';

const stages: { id: TeamProjectStage; label: string }[] = [
 { id: 'exploring', label: '探索中' },
 { id: 'decision', label: '待你决定' },
 { id: 'ready', label: '待执行' },
 { id: 'running', label: '执行中' },
 { id: 'completed', label: '已完成' },
 { id: 'attention', label: '需要处理' },
];

/** A view of saved work, never a scheduler or an inferred dependency graph. */
export default function TeamProjectProgress({ project, onTask, onRun }: {
 project: TeamProject; onTask: (id: string) => void; onRun: (id: string) => void;
}) {
 const tr = useT();
 const progress = teamProjectProgress(project);
 const [filter, setFilter] = React.useState<TeamProjectStage | 'all'>('all');
 const visible = progress.tasks.filter(task => filter === 'all' || task.status === filter);
 const titleOf = (id: string) => project.tasks.find(task => task.id === id)?.title ?? tr('任务已不存在');
 return <section className="team-project-progress" aria-label={tr('项目进展')}>
  <div className="team-progress-heading"><h2>{tr('项目进展')}</h2>
   <p>{tr('看看每件事到了哪一步，再选择要继续的事。')}</p>
  </div>
  <div className="team-stage-filters" role="group" aria-label={tr('按阶段查看任务')}>
   <button className="btn sm" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{tr('全部任务')} <span>{progress.tasks.length}</span></button>
   {stages.map(stage => <button className="btn sm" key={stage.id} aria-pressed={filter === stage.id} onClick={() => setFilter(stage.id)}>{tr(stage.label)} <span>{progress.counts[stage.id]}</span></button>)}
  </div>
  {progress.needsAttentionCount > 0 && <p className="team-note">{tr('有 {count} 次运行需要你查看或决定。', { count: String(progress.needsAttentionCount) })}</p>}
  {!progress.tasks.length ? <p className="team-progress-empty">{tr('还没有任务。先说说你的想法，下一步会出现在这里。')}</p>
   : !visible.length ? <p className="team-progress-empty">{tr('目前没有这个阶段的任务。')} <button className="btn sm ghost" onClick={() => setFilter('all')}>{tr('查看全部任务')}</button></p>
   : <ol className="team-progress-list">{visible.map(item => <li key={item.taskId}>
    <div className="team-progress-main">
     <div className="team-progress-task-heading"><button className="team-progress-title" onClick={() => onTask(item.taskId)}>{item.title}</button><span className={`team-progress-stage ${item.status}`}>{tr(stages.find(stage => stage.id === item.status)!.label)}</span></div>
     <p className="team-progress-reason">{tr(item.reasonKey)}</p>
     {item.reasonDetail && <details className="team-progress-evidence"><summary>{tr('查看详情')}</summary><p>{item.reasonDetail}</p></details>}
     {item.liveRunCount > 1 && <p className="team-note">{tr('此任务有 {count} 次运行尚未结束。', { count: String(item.liveRunCount) })}</p>}
     {item.source.taskId && <div className="team-progress-origin">{tr('来源任务')}：{item.source.taskExists
      ? <button className="team-progress-link" onClick={() => onTask(item.source.taskId!)}>{titleOf(item.source.taskId)}</button>
      : <span>{tr('来源任务已不存在')}</span>}
      {item.source.runId && (item.source.runExists
       ? <button className="team-progress-link" onClick={() => onRun(item.source.runId!)}>{tr('查看当时的建议')}</button>
       : <span>{tr('来源运行已不存在或不匹配')}</span>)}
     </div>}
     {!!item.childTaskIds.length && <div className="team-progress-origin">{tr('后续任务')}：{item.childTaskIds.map(id => <button key={id} className="team-progress-link" onClick={() => onTask(id)}>{titleOf(id)}</button>)}</div>}
     {(()=>{const task=project.tasks.find(task=>task.id===item.taskId);if(!task?.dependsOn?.length)return null;const waiting=!item.relevantRunId&&dependencyBlockers(project,task.id).length>0;return <div className="team-progress-origin"><span>{tr(waiting?'等待前置任务验收':'前置任务')}</span>{task.dependsOn.map(id=><button key={id} className="team-progress-link" onClick={()=>onTask(id)}>{titleOf(id)}</button>)}</div>;})()}
     {item.needsAttentionRunIds.some(id => id !== item.relevantRunId) && <details className="team-progress-evidence"><summary>{tr('其他需要处理的运行')}</summary><ul>{item.needsAttentionRunIds.filter(id => id !== item.relevantRunId).map(id => {
      const run = project.runs.find(run => run.id === id)!;
      return <li key={id}><button className="team-progress-link" onClick={() => onRun(id)}>{tr('查看运行')} · {new Date(run.createdAt).toLocaleString()}</button></li>;
     })}</ul></details>}
    </div>
    <button className="btn team-progress-next" onClick={() => item.relevantRunId ? onRun(item.relevantRunId) : onTask(item.taskId)}>{tr(item.nextActionKey)}</button>
   </li>)}</ol>}
  {progress.tasks.some(item => item.source.taskId || item.childTaskIds.length > 0) && <p className="team-note">{tr('来源关系说明想法如何延续；不会自动安排任务顺序或并行执行。')}</p>}
 </section>;
}
