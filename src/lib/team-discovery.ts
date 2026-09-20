import type { TeamTask, TeamRun, TeamProject } from './collaboration';
import { uid } from './store';

export const DISCOVERY_ACCEPTANCE='给出至少两个可选方向及取舍、最多三个需要用户决定的问题，以及一份可修改的下一步任务建议。明确区分已知信息和假设。本轮只梳理想法，不执行建议中的实际任务。';
export const DISCOVERY_PLAN_INSTRUCTIONS='依据用户的原始想法、前一步探索和补充回答，整理可读的建议。先用日常语言解释可选方向、取舍、假设、需要用户决定的问题，再建议一个范围较小的下一步及步骤。不要把假设当成用户已经同意的要求，不执行建议中的任务。最后附一个 ```wickrun-plan 代码块，内含 JSON {"title":"建议任务名称","goal":"建议目标","acceptance":"建议的完成标准"}。这只是可编辑建议，用户确认后才成为另一项任务。';

export function normalizeTaskDraft(task:TeamTask):TeamTask {
 const draft=structuredClone(task);
 if(!draft.goal.trim())throw Error('先写下一句你想做的事');
 draft.title=draft.title.trim()||draft.goal.trim().slice(0,40);
 if(draft.intent==='explore')draft.acceptance=DISCOVERY_ACCEPTANCE;
 return draft;
}

/** Treat generated content as editable text only. Never import models, tools or graphs. */
export function readDiscoveryProposal(text:string){
 const blocks=[...text.matchAll(/```wickrun-plan\s*\n([\s\S]*?)```/g)];
 if(blocks.length!==1)return null;
 try{
  const value=JSON.parse(blocks[0][1]);
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  for(const key of ['title','goal','acceptance'])if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>(key==='title'?200:12000))return null;
  return {title:value.title.trim() as string,goal:value.goal.trim() as string,acceptance:value.acceptance.trim() as string,body:text.replace(blocks[0][0],'').trim()};
 }catch{return null;}
}

export function discoveryResult(task:TeamTask,run:TeamRun){
 if(task.intent!=='explore'||run.intent!=='explore'||run.taskId!==task.id||!['waiting_user','completed'].includes(run.status)||run.queue?.length)return null;
 // Only the final planning step counts; an early approval or partial exploration is not a plan.
 if(run.status==='waiting_user'&&run.version.graph.nodes.find(n=>n.id===run.pendingApproval?.nodeId)?.type!=='end')return null;
 if(run.attempts.some(a=>a.status!=='completed'&&!(a.status==='waiting_user'&&a.nodeId===run.pendingApproval?.nodeId)))return null;
 const attempt=[...run.attempts].reverse().find(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='agent');
 if(!attempt||attempt.status!=='completed'||!attempt.output.trim())return null;
 return {text:attempt.output,proposal:readDiscoveryProposal(attempt.output)};
}

export function taskFromDiscovery(task:TeamTask,run:TeamRun):TeamTask {
 const result=discoveryResult(task,run);
 if(!result)throw Error('请等待本轮想法梳理完成');
 return {id:uid('teamtask'),title:result.proposal?.title??'',goal:result.proposal?.goal??'',acceptance:result.proposal?.acceptance??'',
  intent:'deliver',sourceTaskId:task.id,sourceRunId:run.id,status:'草稿',entries:[],createdAt:Date.now()};
}

/** A user's next-step action closes the planning deliverable before opening another run. */
export async function finishDiscoveryRound(runtime:{project:(id:string)=>TeamProject;approve:(projectId:string,runId:string,ok:boolean)=>Promise<void>},projectId:string,taskId:string,runId:string){
 const p=runtime.project(projectId),task=p.tasks.find(t=>t.id===taskId),run=p.runs.find(r=>r.id===runId);
 if(!task||!run||!discoveryResult(task,run))throw Error('请等待本轮想法梳理完成');
 if(run.status==='waiting_user')await runtime.approve(projectId,runId,true);
 const current=runtime.project(projectId).runs.find(r=>r.id===runId)!;
 if(current.status!=='completed')throw Error('请先结束本轮梳理，再开始下一步');
 return {task,run:current};
}
