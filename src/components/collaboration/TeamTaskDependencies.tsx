import React from 'react';
import type { TeamProject, TeamTask, TeamRun } from '../../lib/collaboration';
import { captureTaskDependencies, dependencyBlockers } from '../../lib/team-dependencies';
import { useT } from '../../lib/i18n';
import './TeamTaskDependencies.css';

export default function TeamTaskDependencies({project, task, run, onTask}: {project: TeamProject; task: TeamTask; run?: TeamRun; onTask?: (id: string) => void}) {
 const tr = useT(), ids = run ? run.dependencyTaskIds ?? [] : task.dependsOn ?? [];
 if (!ids.length) return null;
 const blockers = run ? [] : dependencyBlockers(project, task.id);
 let inputs = run?.dependencyInputs ?? [];
 if (!run && !blockers.length) {try {inputs = captureTaskDependencies(project, task.id).dependencyInputs;} catch {/* The runtime rechecks before creating the run. */}}
 return <section className="team-task-dependencies" aria-label={tr('前置任务与产出')}>
  <h3>{tr('前置任务与产出')}</h3>
  <p>{tr(run ? '本次使用以下已验收文本快照。前置任务后来修改或重跑，不会改写这份输入。' : '前置任务全部完成并验收后才能开始；准备运行时会固定并传入这些文本产出。')}</p>
  <ul>{ids.map(id => <li key={id}>{onTask ? <button className="team-progress-link" onClick={() => onTask(id)}>{project.tasks.find(task => task.id === id)?.title ?? tr('任务已不存在')}</button> : project.tasks.find(task => task.id === id)?.title ?? tr('任务已不存在')}</li>)}</ul>
  {!!blockers.length && <p role="status">{blockers[0]}</p>}
  {!blockers.length && !!inputs.length && <details><summary>{tr('查看将传入的文本')}</summary>{inputs.map(input => <section key={input.taskId}><h4>{input.title}</h4>{input.outputs.map(output => <pre key={output.attemptId}>{output.text}</pre>)}</section>)}</details>}
 </section>;
}

/** Every arrow is an actual persisted prerequisite; provenance is deliberately separate. */
export function TeamDependencyRelations({project, onTask}: {project: TeamProject; onTask: (id: string) => void}) {
 const tr = useT(), tasks = project.tasks.filter(task => task.dependsOn?.length);
 if (!tasks.length) return null;
 return <details className="team-dependency-relations" open>
  <summary>{tr('任务先后关系')}</summary>
  <p className="team-note">{tr('箭头前的任务全部验收后，才能开始箭头后的任务。各项仍需手动开始，并受项目并发与预算限制。')}</p>
  <ul>{tasks.map(task => <li key={task.id}>
   <div>{task.dependsOn!.map(id => <button key={id} className="btn sm" onClick={() => onTask(id)}>{project.tasks.find(task => task.id === id)?.title ?? tr('任务已不存在')}</button>)}</div>
   <span className="team-dependency-arrow"><span>{tr('全部验收后')}</span><svg width="32" height="16" viewBox="0 0 32 16" aria-hidden="true"><path d="M1 8h28M23 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg></span>
   <button className="btn sm" onClick={() => onTask(task.id)}>{task.title}</button>
  </li>)}</ul>
 </details>;
}
