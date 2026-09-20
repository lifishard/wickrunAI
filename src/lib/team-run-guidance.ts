import type { TeamRun } from './collaboration';
import type { RunState } from '../types';

export function teamPendingQuestions(run:TeamRun) {
 if(['completed','cancelled'].includes(run.status))return [];
 const latest=new Map(run.attempts.map(a=>[a.nodeId,a]));
 return [...latest.values()].filter(a=>!a.resolution).flatMap(a=>Object.entries(a.memberStates??{}).flatMap(([memberId,state])=>
  state.userQuestion&&!state.userQuestion.answers?[{attemptId:a.id,memberId,state,question:state.userQuestion}]:[]));
}

/** A crash may occur after dispatch intent was saved but before uncertainCallId was set. */
export function teamHasUnknownOperations(run:TeamRun):boolean {
 const latest=[...new Map(run.attempts.map(a=>[a.nodeId,a])).values()].filter(a=>!a.resolution);
 return latest.some(a=>[...Object.values(a.memberStates??{}),...(a.state?[a.state]:[])].some(state=>
  !!state.uncertainCallId||((['uncertain','failed','paused'].includes(run.status)||['uncertain','failed'].includes(a.status))&&
   (state.steps??[]).some(step=>step.status==='running'&&!(step.name==='request_user_input'&&step.callId===state.userQuestion?.callId)))));
}

export function teamRunGuidance(run:TeamRun) {
 const latest=[...new Map(run.attempts.map(a=>[a.nodeId,a])).values()];
 const states=latest.filter(a=>!a.resolution).flatMap(a=>Object.values(a.memberStates??{}));
 const unknown=teamHasUnknownOperations(run);
 const question=teamPendingQuestions(run)[0];
 const retry=run.status==='running'?states.find(s=>s.status==='waiting'&&s.waitKind==='quota'):undefined;
 const detail=[...run.attempts].reverse().find(a=>!a.resolution&&a.error)?.error??'';
 const result=(kind:string,title:string,next:string,state?:RunState)=>({kind,title,next,detail,retryAt:state?.nextRetryAt});
 if(run.status==='completed')return result('done','交付已验收','可以查看结果；文件修改仍需在文件与产物中检查差异并合并。');
 if(run.status==='cancelled')return result('done','运行已停止','已有记录和产物保留；重新开始请回到所属任务。');
 if(run.status==='pausing')return result('pausing','正在保存并暂停','等待当前操作停下；若结果不确定，核实后再继续。');
 if(unknown)return result('verify','有操作结果需要核实','先检查文件或外部动作是否已经生效，再决定接受结果或重试，避免重复执行。');
 if(run.pendingApproval){
  const end=run.version.graph.nodes.find(n=>n.id===run.pendingApproval?.nodeId)?.type==='end';
  return result(end?'accept':'approval',end?'交付等待你验收':'有操作等待你批准',end?'先阅读本次结果，再决定批准或拒绝。':'查看下方操作内容；批准才会执行，拒绝不会代你同意。');
 }
 if(question)return result('question','助手需要你补充信息','在下方问题卡回答；答案会保存并用于继续当前步骤。');
 if(['uncertain','failed'].includes(run.status))return result('verify','这一步需要处理后再继续','查看停止原因并填写核实依据；已成功的操作和原用量保留。');
 if(retry)return result('retry','正在等待模型恢复','系统会自动重试，无需重复开始；你可以随时暂停。',retry);
 if(run.status==='paused')return result('paused','运行已暂停','可以恢复运行；若还有待核实的步骤，先处理已有结果。');
 if(run.status==='ready')return result('ready','已经准备好','点击开始运行，使用本次已确认的任务与配置。');
 return result('working','助手正在处理任务','当前无需操作；可以查看已有结果，或暂停后调整下一步。');
}
