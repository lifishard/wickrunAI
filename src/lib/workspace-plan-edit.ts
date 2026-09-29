import type { TeamProject } from './collaboration';
import type { AgentRole, PlanningTurn } from './office';
import type { WorkspacePlan } from './workspace-planner';
import { workspaceStamp, workspacePlanSchema } from './workspace-planner';
import { uid } from './store';
import { tr } from './i18n';
import { EFFORT_LEVELS } from './effort';
import type { RouteOverrides } from '../types';

export type PlanMember = Extract<WorkspacePlan['changes'][number], {kind:'member'}>;
export const planMembers = (plan:WorkspacePlan) => plan.changes.filter((c):c is PlanMember=>c.kind==='member');
export function memberReferences(member:PlanMember) { return new Set([member.ref,...(member.existingId?[member.existingId]:[])]); }

export function editableWorkspacePlan(plan:WorkspacePlan,project:TeamProject):WorkspacePlan {
  const next=structuredClone(plan),known=new Set(planMembers(next).flatMap(m=>[...memberReferences(m)]));
  const refs=next.changes.flatMap(c=>c.kind==='workflow'?c.nodes.flatMap(n=>[...(n.member?[n.member]:[]),...(n.participants??[])]):[]);
  for(const ref of refs){
    if(known.has(ref))continue;
    const m=project.members.find(m=>m.id===ref);if(!m)continue;
    next.changes.push({kind:'member',ref:m.id,existingId:m.id,name:m.name,instructions:m.instructions,profileId:m.connectionId,model:m.model,
      department:project.office?.departments.find(d=>d.memberIds.includes(m.id))?.id,effort:m.effort as PlanMember['effort'],tools:[...m.tools],skills:[...(m.skills??[])],maxTokens:m.maxTokens,maxMinutes:m.maxMinutes,enabled:m.enabled});known.add(ref);
  }
  return next;
}

/** Update an unadopted arrangement only. Editing never changes live members or runs. */
export function editPlanMember(plan:WorkspacePlan,ref:string,patch:Partial<PlanMember>):WorkspacePlan {
  const next=structuredClone(plan),member=planMembers(next).find(m=>m.ref===ref);
  if(!member)throw Error(tr('成员不存在'));
  const {kind,ref:ignoredRef,existingId,...editable}=patch;
  Object.assign(member,editable);
  return next;
}

export function addPlanMember(plan:WorkspacePlan,route:{profileId:string;model:string},role?:AgentRole):{plan:WorkspacePlan;ref:string} {
  const next=structuredClone(plan),ref=uid('position');
  next.changes.push({kind:'member',ref,name:role?.name??tr('新岗位'),instructions:role?.instructions??'',roleId:role?.id,
    department:next.changes.find(c=>c.kind==='department')?.ref,profileId:route.profileId,model:route.model,
    effort:'off',tools:[],skills:[],maxTokens:30000,maxMinutes:20,enabled:true});
  return {plan:next,ref};
}

/** Discussion membership can shrink; a required producer/reviewer must be reassigned explicitly. */
export function removePlanMember(plan:WorkspacePlan,ref:string,replacement?:string):WorkspacePlan {
  const next=structuredClone(plan),member=planMembers(next).find(m=>m.ref===ref);
  if(!member)throw Error(tr('成员不存在'));
  const refs=memberReferences(member),target=replacement?planMembers(next).find(m=>m.ref===replacement):undefined;
  if(replacement&&(!target||refs.has(replacement)))throw Error(tr('请选择其他岗位接替'));
  for(const c of next.changes){
    if(c.kind==='workflow')for(const n of c.nodes){
      if(n.member&&refs.has(n.member)){if(!target)throw Error(tr('这个岗位仍负责流程步骤，请先选择接替岗位'));n.member=target.ref;}
      if(n.participants?.some(id=>refs.has(id))){
        const remaining=n.participants.filter(id=>!refs.has(id));
        // Removing a speaker does not automatically give their speaking turn to someone else.
        if(n.type==='discussion'&&remaining.length<2)throw Error(tr('讨论至少保留两个岗位，请先增加或调整参与者'));
        n.participants=remaining;
      }
    }
    if(c.kind==='task'&&c.owner&&refs.has(c.owner))c.owner=target?.ref;
  }
  for(const op of next.operations)if(op.kind==='task_message'&&op.member&&refs.has(op.member)){
    if(!target)throw Error(tr('这个岗位仍有指定消息，请先选择接替岗位'));
    op.member=target.ref;
  }
  next.changes=next.changes.filter(c=>c.kind!=='member'||c.ref!==ref);
  return next;
}

export function assignPlanStep(plan:WorkspacePlan,flowRef:string,nodeId:string,memberRef:string,checked:boolean):WorkspacePlan {
  const next=structuredClone(plan),flow=next.changes.find(c=>c.kind==='workflow'&&c.ref===flowRef),member=planMembers(next).find(m=>m.ref===memberRef);
  if(flow?.kind!=='workflow'||!member)throw Error(tr('成员不存在'));
  const node=flow.nodes.find(n=>n.id===nodeId);if(!node)throw Error(tr('工作流不存在'));
  if(node.type==='discussion')node.participants=checked?[...new Set([...(node.participants??[]),memberRef])]:(node.participants??[]).filter(id=>!memberReferences(member).has(id));
  else if(['agent','review','handoff'].includes(node.type))node.member=checked?memberRef:undefined;
  return next;
}

/** A saved plan remains an immutable receipt. A follow-up reuses members/flows, creates new tasks. */
export function reviseWorkspacePlan(turn:PlanningTurn,project:TeamProject):PlanningTurn {
  if(!turn.workspacePlan||!turn.workspaceResult)throw Error(tr('请先采用工作安排'));
  const plan=structuredClone(turn.workspacePlan),ids=turn.workspaceResult.ids;
  plan.changes=plan.changes.filter(c=>['department','member','workflow','task'].includes(c.kind));
  for(const c of plan.changes){
    if(c.kind==='department'||c.kind==='member'||c.kind==='workflow')c.existingId=ids[c.ref]??c.existingId;
    if(c.kind==='department'){const current=project.office?.departments.find(d=>d.id===c.existingId);if(!current)throw Error(tr('成员或部门不存在'));Object.assign(c,{name:current.name,purpose:current.purpose,parent:current.parentId??null});}
    if(c.kind==='member'){
      const current=project.members.find(m=>m.id===c.existingId);if(!current)throw Error(tr('成员不存在'));
      Object.assign(c,{department:project.office?.departments.find(d=>d.memberIds.includes(current.id))?.id??null,name:current.name,instructions:current.instructions,profileId:current.connectionId,model:current.model,effort:current.effort,tools:current.tools,skills:current.skills??[]});
    }
    if(c.kind==='workflow'){
      const current=project.workflows.find(f=>f.id===c.existingId);
      // Do not overwrite a flow edited elsewhere since adoption.
      if(!current)throw Error(tr('工作流不存在'));
      const nodeRefs=new Map(current.draft.nodes.map(n=>[n.id,n.id]));
      const parsed=workspacePlanSchema.parse({title:plan.title,summary:plan.summary,changes:[{...c,name:current.name,nodes:current.draft.nodes.map(n=>({...n,member:n.memberId,participants:n.participants,inputRefs:n.inputRefs.filter(id=>nodeRefs.has(id))})),edges:current.draft.edges.map(e=>({...e,port:e.port??'next'}))}]}).changes[0];
      if(parsed.kind==='workflow'){c.name=parsed.name;c.nodes=parsed.nodes;c.edges=parsed.edges;}
      Object.assign(c,{maxSteps:current.draft.maxSteps,maxTokens:current.draft.maxTokens,maxMinutes:current.draft.maxMinutes});
    }
    if(c.kind==='task'){delete c.existingId;c.title=c.title+' · '+tr('后续任务');}
  }
  plan.operations=plan.operations.filter(o=>o.kind==='start_task');
  return {id:uid('plan'),role:'assistant',text:tr('已建立可编辑的后续安排。复用团队并保存新流程版本，任务另行创建；已有运行与会议不重复执行。'),workspacePlan:editableWorkspacePlan(plan,project),workspaceStamp:workspaceStamp(project),sourceTurnId:turn.sourceTurnId??turn.id};
}

/** Manual route choices take precedence; a probe that found only a toggle is never shown as five strengths. */
export function planEffortOptions(route:RouteOverrides):{value:PlanMember['effort'];label:string}[]{
  if(route.effortStyle&&route.effortStyle!=='mapping')return EFFORT_LEVELS.filter(l=>l.value==='off'||route.effortStyle!=='none'&&!!route.effortValues?.[l.value]).map(l=>({...l}));
  const report=route.compatibility;
  if(report?.status==='ready'){
    if(report.mode==='default')return [{value:'off',label:'使用上游默认'}];
    if(report.mode==='toggle')return [{value:'off',label:'默认 / 关闭'},{value:'high',label:'开启思考'}];
    return EFFORT_LEVELS.filter(l=>!!report.requests[l.value]);
  }
  return EFFORT_LEVELS;
}

export function normalizedPlanEffort(effort:PlanMember['effort'],route:RouteOverrides):PlanMember['effort'] {
  const manual=route.effortStyle&&route.effortStyle!=='mapping';
  if(!manual&&route.compatibility?.status==='ready'&&route.compatibility.mode==='toggle')return effort==='off'?'off':'high';
  return planEffortOptions(route).some(e=>e.value===effort)?effort:'off';
}
