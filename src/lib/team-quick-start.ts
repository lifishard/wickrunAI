import { freeFlowGraph, reviewFlowGraph, validateGraph, type TeamProject, type Member } from './collaboration';
import { uid } from './store';
import { DISCOVERY_PLAN_INSTRUCTIONS } from './team-discovery';

export type QuickWorkStyle='direct'|'discuss'|'review'|'explore';
export interface QuickTaskChoice { profileId:string;model:string;style:QuickWorkStyle }

/** Prepare an ordinary editable workflow. No request, permission change, or run is started here. */
export function prepareQuickTask(project:TeamProject,taskId:string,choice:QuickTaskChoice,availableProfiles:string[]){
 const task=project.tasks.find(t=>t.id===taskId);
 if(!task?.goal.trim()||!task.acceptance.trim())throw Error('请先填写目标和验收标准');
 if(task.workflowId)throw Error('此任务已有流程，请在高级设置中调整');
 if(task.ownerId)throw Error('此任务已指定负责人，请通过高级设置准备流程');
 if(!['direct','discuss','review','explore'].includes(choice.style))throw Error('请选择工作方式');
 if((task.intent==='explore')!==(choice.style==='explore'))throw Error('请使用与当前任务匹配的工作方式');
 if(!availableProfiles.includes(choice.profileId)||choice.profileId.startsWith('client:')||!choice.model.trim())throw Error('请选择可用的 API 接入和模型');
 if(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(choice.profileId))throw Error('此接入不在项目允许范围内，请选择其他接入');
 const member=(role:string,instructions:string):Member=>({id:uid('member'),name:`${task.title} · ${role}`,instructions,
  connectionId:choice.profileId,model:choice.model.trim(),effort:'medium',enabled:true,tools:[],skills:[],
  maxTokens:Math.min(30000,project.settings.maxTokens),maxMinutes:Math.min(20,project.settings.maxMinutes),failover:{enabled:false,routes:[]}});
 const executor=choice.style==='explore'?member('方案整理',DISCOVERY_PLAN_INSTRUCTIONS):member('执行','按任务目标交付文本，依据验收标准检查结果。');
 const members=[executor];
 if(choice.style!=='direct')members.push(choice.style==='explore'?member('方向探索','帮助没有具体计划的人探索想法。提出至少两个方向和取舍，明确未知事项；最多提出三个关键问题。只提出建议，不执行实际任务。'):member(choice.style==='review'?'复核':'讨论',choice.style==='review'?'独立核对文本与验收条件，引用原文并指出具体缺口。':'提出可行方案、风险和不同意见，帮助执行成员形成交付。'));
 const localTask={...task,ownerId:executor.id};
 const workflow=choice.style==='review'?reviewFlowGraph(localTask,members,`${task.title} · 文本复核`,'text'):
  freeFlowGraph(localTask,members,`${task.title} · ${choice.style==='direct'?'直接完成':'讨论后完成'}`);
 if(choice.style==='explore'){
  workflow.name=`${task.title} · 理清想法`;
  const [start,explore,plan,end]=workflow.draft.nodes;
  start.title='你的想法';
  explore.type='agent';explore.title='探索可选方向';explore.memberId=members[1].id;delete explore.participants;
  explore.instructions=members[1].instructions;explore.outputRequirement='可选方向、取舍、假设与待确认问题';
  plan.title='整理下一步建议';plan.instructions=DISCOVERY_PLAN_INSTRUCTIONS;plan.inputRefs=[explore.id];
  plan.outputRequirement=task.acceptance;end.title='由你决定下一步';
 }
 workflow.draft.maxTokens=Math.min(workflow.draft.maxTokens,project.settings.maxTokens);
 workflow.draft.maxMinutes=Math.min(workflow.draft.maxMinutes,project.settings.maxMinutes);
 const errors=validateGraph(workflow.draft,members,project.settings.allowedConnections).filter(x=>x.severity==='error');
 if(errors.length)throw Error(errors.map(x=>x.message).join('\n'));
 workflow.versions=[{id:uid('flowversion'),number:1,createdAt:Date.now(),graph:structuredClone(workflow.draft)}];
 // Append only after all checks pass; existing members, flows, permissions and runs stay intact.
 project.members.push(...members);project.workflows.push(workflow);
 task.workflowId=workflow.id;task.ownerId=executor.id;
 return {flowId:workflow.id,versionId:workflow.versions[0].id,taskId};
}
