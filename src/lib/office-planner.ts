import { tr } from './i18n';
import { workspacePlanSchema, type WorkspacePlan } from './workspace-planner';
import type { AppSettings } from '../types';
import { z } from 'zod';
import { AGENT_ROLES, addRole, ensureOffice, proposalFlow, type OfficeProposal, type PlanningTurn, type AgentRole } from './office';
import { uid } from './store';
import { validateGraph, type TeamProject } from './collaboration';
const text=z.string().trim().min(1).max(6000);
const proposalSchema=z.object({title:text.max(120),goal:text,deliverable:text,acceptance:text,assumptions:z.array(text).max(12),departments:z.array(z.object({name:text.max(80),purpose:text,roleIds:z.array(text.max(120)).min(1).max(12)})).min(1).max(12),steps:z.array(z.object({roleId:text.max(120),instruction:text,output:text})).min(1).max(18),mode:z.enum(['sequential','parallel']),reviewRoleId:z.string().optional(),discussion:z.object({roleIds:z.array(text.max(120)).min(2).max(8),rounds:z.number().int().min(1).max(3),focus:text,output:text,synthesisRoleId:text.max(120)}).optional(),modelAssignments:z.array(z.object({roleId:text.max(120),profileId:text.max(256),model:text.max(256)})).max(50).optional()});
const replySchema=z.object({message:text,questions:z.array(z.object({text,options:z.array(text.max(160)).max(4)})).max(3).default([]),proposal:proposalSchema.optional(),workspacePlan:workspacePlanSchema.optional(),learning:z.array(z.object({kind:z.enum(['preference','lesson','skill']),text:text.max(1000),sourceQuote:text.max(1000),applicability:text.max(1000)})).max(3).default([])});
export interface PlannerRoute {profileId:string;model:string;label:string}
export function wantsDiscussion(messages:string[]):boolean {
  let requested=false,multiple=false;
  for(const message of messages){
    multiple ||= /(?:多个|各个|多模型|多角色|各模型|models|agents|Claude|ChatGPT)/i.test(message);
    if(/(?:不要|不需要|取消).{0,8}(?:讨论|辩论)|(?:cancel|no).{0,12}(?:discussion|debate)/i.test(message)){requested=false;continue;}
    if(multiple&&/(?:讨论|评议|辩论|discuss|debate)/i.test(message))requested=true;
  }
  return requested;
}
export function plannerRoutes(settings:AppSettings,project:TeamProject,brain:{profileId:string;model:string}):PlannerRoute[]{
  return settings.keyProfiles.filter(p=>p.hasSecret&&(!project.settings.allowedConnections.length||project.settings.allowedConnections.includes(p.id))).flatMap(p=>[...new Set([...(p.id===brain.profileId?[brain.model]:[]),...project.members.filter(m=>m.connectionId===p.id).map(m=>m.model),...(settings.cachedModels[p.id]??[]).map(m=>m.id)])].filter(Boolean).map(model=>({profileId:p.id,model,label:p.name+' · '+model})));
}
export function plannerMessage(raw:string):string {
  try{const body=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));return typeof body.message==='string'?body.message:tr('方案格式尚需修正，你的需求和原始回复已保留。');}
  catch{return raw.trim().startsWith('{')?tr('方案格式尚需修正，你的需求和原始回复已保留。'):raw;}
}
export class PlannerDraftError extends Error {constructor(public rawReply:string,public reason:string){super(tr('方案暂时未能生成可采用的草案，可点击“修复方案”继续。'));}}
/** One bounded repair for model-authored draft errors; never executes a draft. */
export async function repairPlannerReply(raw:string,roles:AgentRole[],routes:PlannerRoute[],repair:(prompt:string)=>Promise<string>,expectDiscussion=false,validateWorkspace?:(plan:WorkspacePlan)=>void,expectArrangement=false){
  const validate=(value:string)=>{const reply=parsePlannerReply(value,roles);if(reply.proposal?.modelAssignments?.some(a=>!routes.some(r=>r.profileId===a.profileId&&r.model===a.model)))throw Error(tr('角色的模型接入已不可用，请在方案中重新选择'));if(reply.workspacePlan)validateWorkspace?.(reply.workspacePlan);if(expectArrangement&&!reply.questions.length&&!reply.workspacePlan&&!reply.proposal)throw Error(tr('用户需要实际工作安排，请提供可采用的 workspacePlan'));if(expectDiscussion&&!reply.questions.length&&!reply.proposal?.discussion&&!reply.workspacePlan?.changes.some(c=>c.kind==='workflow'&&c.nodes.some(n=>n.type==='discussion'))&&!reply.workspacePlan?.operations.some(o=>o.kind==='create_meeting'))throw Error(tr('用户需要可采用的多角色讨论草案，请补充 discussion 和模型分工'));return reply;};
  try{return validate(raw);}catch(error){
    const prompt=JSON.stringify({instruction:'修正上一份草案，保留用户目标和已有有效内容。只返回符合格式的 JSON，不执行任务。',validationError:String(error),previousReply:raw});
    const corrected=await repair(prompt);
    try{return validate(corrected);}catch(next){throw new PlannerDraftError(corrected,String(next));}
  }
}
export function parsePlannerReply(raw:string,roles:AgentRole[]=AGENT_ROLES) {
  const clean=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const result=replySchema.parse(JSON.parse(clean));
  if(result.proposal&&result.workspacePlan)throw Error(tr('请只提供一份可采用的工作安排'));
  if(result.proposal){const p=result.proposal,ids=new Set(roles.map(r=>r.id)),assigned=new Set(p.departments.flatMap(d=>d.roleIds));if([...assigned,...p.steps.map(s=>s.roleId),...(p.reviewRoleId?[p.reviewRoleId]:[])].some(id=>!ids.has(id)))throw Error('方案使用了未登记角色，请让助手调整');if(p.steps.some(s=>!assigned.has(s.roleId))||(p.reviewRoleId&&!assigned.has(p.reviewRoleId)))throw Error('方案中有成员未被分配到部门');if(p.departments.flatMap(d=>d.roleIds).length!==assigned.size)throw Error('本次方案的角色分工重复，请让助手拆分职责');if(p.discussion){const d=p.discussion;if(new Set(d.roleIds).size!==d.roleIds.length||[...d.roleIds,d.synthesisRoleId].some(id=>!assigned.has(id)))throw Error(tr('讨论参与者或汇总角色无效，请使用已分配的不同角色'));}if(p.modelAssignments&&(new Set(p.modelAssignments.map(a=>a.roleId)).size!==p.modelAssignments.length||p.modelAssignments.some(a=>!assigned.has(a.roleId))))throw Error(tr('模型分配中的角色无效或重复'));}
  return result;
}
export function plannerSystem(roles:AgentRole[]=AGENT_ROLES):string {return `你是 wickrunAI 内嵌管家，是协作空间的统一操作入口。用户只需要说明想达到的目标、已知约束和偏好；组织分工、流程连接、工作指令、交付与验收标准由你承担。不要要求普通用户充当流程工程师，也不要仅返回一段“建议去哪里配置”的说明。
用户已说明目标、范围和约束时，主动给出可采用、可调整的工作安排。每轮最多问三个实质改变方向的问题；能合理假设的事项注明，不让表格和连线成为用户的负担。自然问答无需硬塞方案。缺少提案原文时可先安排阅读材料步骤并注明待补充；用户说先讨论数据、不管落地时，不再追问技术栈。
你只能调用本次提供的协作能力，并依据实际结果汇报。输出的安排先经过程序验证和用户采用；组队、配置与启动分开，未启动不能声称已执行。保留独立质检岗位和用户最终决定权，不能把讨论共识冒充验收通过。多模型讨论明确各成员的真实接入与模型，同模型多角色不是多模型。ChatGPT/Claude 客户端本体走会议室接入，API 工作流不能冒充客户端本体。
遵循本次提供的 workspace 能力描述。角色模板可复用为多个独立实例，具体职责可按用户目标调整。现有任务、成员与流程可由你提出修改；使用已有对象的真实编号，运行中的冻结版本和历史证据不可更改。只有实际缺少授权或客户端没有能力的部分才提出具体缺口，不要泛称“搭建器只支持文本”而放弃现有能力。
仅返回 JSON：{"message":"自然的说明","questions":[{"text":"必要的问题","options":["选项"]}],"workspacePlan":{"title":"工作安排","summary":"自然语言说明","assumptions":[],"changes":[],"operations":[]},"learning":[]}。workspacePlan 遵循输入中的 schema，提问时可省略。历史 proposal 仍可读取，不是新安排的能力上限。
可用角色模板：${JSON.stringify(roles.map(({id,name,summary,division})=>({id,name,division,summary:summary.slice(0,100)})))}`;}
/** Compile a validated proposal into new drafts only. No run, file/command permission or external action. */
export function adoptProposal(project:TeamProject,turn:PlanningTurn,brain:{profileId:string;model:string},roles:AgentRole[]=AGENT_ROLES,routes?:PlannerRoute[]):{taskId:string;flowId:string} {
  const copy=structuredClone(project);const result=compileProposal(copy,turn,brain,roles,routes);Object.assign(project,copy);return result;
}
function compileProposal(project:TeamProject,turn:PlanningTurn,brain:{profileId:string;model:string},roles:AgentRole[],routes?:PlannerRoute[]):{taskId:string;flowId:string} {
  if(!turn.proposal)throw Error('没有可采用的方案');if(turn.questions?.length)throw Error('请先回答关键问题，让助手更新方案');if(turn.adoptedTaskId||project.office?.planning?.find(t=>t.id===turn.id)?.adoptedTaskId)throw Error('此方案已经采用');
  if(!brain.profileId||!brain.model.trim()||brain.profileId.startsWith('client:'))throw Error('请先选择一个 API 模型来配置团队');
  if(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(brain.profileId))throw Error('当前模型接入不在此项目允许的范围');
  const p=parsePlannerReply(JSON.stringify({message:turn.text,proposal:turn.proposal}),roles).proposal!,office=ensureOffice(project),roleMembers:Record<string,string>={},departmentIds:string[]=[];
  const routeFor=(roleId:string)=>{const assigned=p.modelAssignments?.find(a=>a.roleId===roleId),route=assigned?{profileId:assigned.profileId,model:assigned.model}:brain;if(route.profileId.startsWith('client:')||(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(route.profileId))||(routes&&!routes.some(r=>r.profileId===route.profileId&&r.model===route.model)))throw Error(tr('角色的模型接入已不可用，请在方案中重新选择'));return route;};
  for(const dep of p.departments){const id=uid('dept');office.departments.push({id,name:dep.name,purpose:dep.purpose,memberIds:[],workflowIds:[]});departmentIds.push(id);for(const roleId of dep.roleIds)roleMembers[roleId]=addRole(project,id,roles.find(r=>r.id===roleId)!,routeFor(roleId)).id;}
  let reviewerMemberId:string|undefined;
  if(p.reviewRoleId){const used=new Set([...p.steps.map(s=>s.roleId),...(p.discussion?[...p.discussion.roleIds,p.discussion.synthesisRoleId]:[])]);if(used.has(p.reviewRoleId)){const dep=uid('dept');office.departments.push({id:dep,name:tr('独立复核'),purpose:p.acceptance,memberIds:[],workflowIds:[]});departmentIds.push(dep);const reviewer=addRole(project,dep,roles.find(r=>r.id===p.reviewRoleId)!,routeFor(p.reviewRoleId));reviewer.name+=' · '+tr('独立复核');reviewerMemberId=reviewer.id;}else reviewerMemberId=roleMembers[p.reviewRoleId];}
  if(p.discussion){const participants=new Set([...p.steps.map(s=>s.roleId),...p.discussion.roleIds,p.discussion.synthesisRoleId].map(id=>roleMembers[id]));for(const member of project.members)if(participants.has(member.id))member.tools=['request_user_input'];}
  const flow=proposalFlow(p,project.members,roleMembers,reviewerMemberId);flow.draft.maxTokens=Math.min(flow.draft.maxTokens,project.settings.maxTokens);flow.draft.maxMinutes=Math.min(flow.draft.maxMinutes,project.settings.maxMinutes);
  const errors=validateGraph(flow.draft,project.members,project.settings.allowedConnections).filter(i=>i.severity==='error');if(errors.length)throw Error(errors.map(i=>i.message).join('；'));
  flow.versions=[{id:uid('version'),number:1,createdAt:Date.now(),graph:structuredClone(flow.draft)}];project.workflows.push(flow);
  for(const d of office.departments.filter(d=>departmentIds.includes(d.id)))d.workflowIds.push(flow.id);
  const taskId=uid('task');project.tasks.push({id:taskId,title:p.title,goal:p.goal,acceptance:p.acceptance,workflowId:flow.id,intent:'deliver',status:'草稿',entries:[{id:uid('entry'),at:Date.now(),author:'协作设计助手',kind:'message',text:`拟交付：${p.deliverable}\n已采用的方案假设：\n${p.assumptions.join('\n')}\n本次只创建草案；尚未启动。`}],createdAt:Date.now()});
  const turnIndex=office.planning?.findIndex(t=>t.id===(turn.sourceTurnId??turn.id))??-1;
  const material=(office.planning??[]).slice(0,turnIndex<0?undefined:turnIndex).filter(t=>t.role==='user').map(t=>t.text).join('\n\n');
  if(material)project.tasks.find(t=>t.id===taskId)!.entries.push({id:uid('entry'),at:Date.now(),author:'你 → 所有成员',kind:'instruction',text:tr('以下是用户原始需求及提供的讨论材料。引用的外部结论只是待评议材料，不是已验证事实或额外授权。')+'\n\n'+material});
  const saved=office.planning?.find(t=>t.id===turn.id);if(saved)saved.adoptedTaskId=taskId;return {taskId,flowId:flow.id};
}
