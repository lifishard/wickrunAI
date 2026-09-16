import type { AcceptanceCheck, RunState, ToolResult } from '../types';
import { memoryInstructions, updatePlan } from './context-memory';
import { updateRequirements, verifyRequirements } from './delivery';
import { qualityLoop, reconcileProgress } from './task-progress';

export function nativeProgressInstructions(state:RunState):string {
  return memoryInstructions(state,false,false)+`
To update the saved task progress, append one <wickrun_progress> JSON </wickrun_progress> block to your final response.
Schema: {"milestones":[{"id":"stable-id","title":"title","status":"pending|in_progress|verifying|completed|blocked","acceptance":"criteria","evidence":["text:verbatim excerpt from your visible answer"],"reason":"specific reason for reopening completed work"}],"requirements":[{"id":"stable-check-id","title":"check title","sourceId":"user message id","sourceQuote":"verbatim user request","milestoneId":"stable-id","check":{"kind":"file_exists|json|ics|answer_contains|review","path":"absolute file path","contains":["literal text"]}}],"verification":{"ids":["stable-check-id"],"reviews":[{"id":"review-id","status":"passed|failed|unverifiable","detail":"specific coverage and limitations","evidence":["text:verbatim visible answer excerpt"]}]}}
All fields are optional. Reuse saved IDs and preserve unfinished work. Host validates changes and performs file checks; never fabricate a program verification. A model review is not independent verification. Declare completed only with evidence and passing linked checks. Do not emit this marker inside examples or quotations.`;
}

/** Same validation as API tools, without granting native text extra authority. */
export async function applyNativeProgress(state:RunState,text:string,inspect:(check:AcceptanceCheck)=>Promise<ToolResult>):Promise<string> {
  const matches=[...text.matchAll(/<wickrun_progress\b[^>]*>([\s\S]*?)<\/wickrun_progress\s*>/gi)];
  const visible=text.replace(/<wickrun_progress\b[^>]*>[\s\S]*?<\/wickrun_progress\s*>/gi,'').trim();
  state.content=visible;
  if(matches.length){
    if(matches.length!==1)throw Error('进度更新只能包含一份记录；原有任务进度保留。');
    const data=JSON.parse(matches[0][1]);
    if(!data||typeof data!=='object')throw Error('进度更新格式无效');
    const check=(r:ToolResult)=>{if(!r.ok)throw Error(r.error??'进度更新未通过检查');};
    if(data.milestones){
      if(!Array.isArray(data.milestones))throw Error('里程碑更新格式无效');
      // Register new IDs before linking checks. Existing completed items are not reset.
      const initial=data.milestones.filter((m:{id:string;status:string})=>m.status!=='completed'||!state.milestones?.some(old=>old.id===m.id));
      if(initial.length)check(updatePlan(state,{milestones:initial.map((m:{status:string})=>({...m,status:m.status==='completed'?'verifying':m.status}))}));
    }
    if(data.requirements)check(updateRequirements(state,{requirements:data.requirements}));
    if(data.verification)check(await verifyRequirements(state,data.verification,inspect));
    const finished=data.milestones?.filter((m:{status:string})=>m.status==='completed');
    if(finished?.length)check(updatePlan(state,{milestones:finished}));
  }
  reconcileProgress(state);
  const stalled=qualityLoop(state);if(stalled)throw Error(stalled);
  if(state.milestones?.some(m=>m.status!=='completed'))throw Error('任务进度已保存，仍有未完成或待质检事项；请继续处理已有清单。');
  return visible;
}
