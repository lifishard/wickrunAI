import { freeFlowGraph, reviewFlowGraph, validateGraph, type TeamProject, type Member, type TeamFileScope } from './collaboration';
import { uid } from './store';
import { DISCOVERY_PLAN_INSTRUCTIONS } from './team-discovery';
import { tr } from './i18n';
import { teamFileTools, validateTeamFileScope, validateTeamFileSnapshot } from './team-file-scope';

export type QuickWorkStyle='direct'|'discuss'|'review'|'explore';
export type QuickRoleId='executor'|'partner';
export interface QuickRoleChoice { memberId?:string;profileId:string;model:string;instructions:string }
export interface QuickTaskChoice { profileId:string;model:string;style:QuickWorkStyle;roles?:Partial<Record<QuickRoleId,QuickRoleChoice>>;fileScope?:TeamFileScope }
export interface QuickTeamPreset { id:string;name:string;createdAt:number;choice:QuickTaskChoice }

const STYLES:QuickWorkStyle[]=['direct','discuss','review','explore'];
const ROLES:QuickRoleId[]=['executor','partner'];
const EXECUTOR_INSTRUCTIONS='按任务目标交付文本，依据验收标准检查结果。';
const DISCUSS_INSTRUCTIONS='提出可行方案、风险和不同意见，帮助执行成员形成交付。';
const REVIEW_INSTRUCTIONS='独立核对文本与验收条件，引用原文并指出具体缺口。';
const EXPLORE_INSTRUCTIONS='帮助没有具体计划的人探索想法。提出至少两个方向和取舍，明确未知事项；最多提出三个关键问题。只提出建议，不执行实际任务。';
const PLAN_INSTRUCTIONS='整理可选方向、关键问题和下一步建议，实际任务由用户决定。';

export function quickTaskRoles(style:QuickWorkStyle,fileScope?:TeamFileScope):{id:QuickRoleId;title:string;instructions:string}[] {
 if(!STYLES.includes(style))throw Error(tr('请选择工作方式'));
 const execute=fileScope?(fileScope.capability==='read'?'读取允许目录中的材料，按目标交付分析结论；不得修改文件。':'在隔离副本中完成文件任务，按验收条件检查，并说明修改和待核实事项。'):EXECUTOR_INSTRUCTIONS;
 const review=fileScope&&fileScope.capability!=='read'?'读取收到的文件产物，按验收条件独立检查并引用实际证据；不得修改文件。':REVIEW_INSTRUCTIONS;
 if(style==='direct')return [{id:'executor',title:'执行',instructions:execute}];
 if(style==='explore')return [
  {id:'partner',title:'方向探索',instructions:EXPLORE_INSTRUCTIONS},
  {id:'executor',title:'方案整理',instructions:PLAN_INSTRUCTIONS},
 ];
 return [
  {id:'executor',title:'执行',instructions:execute},
  {id:'partner',title:style==='review'?'复核':'讨论',instructions:style==='review'?review:DISCUSS_INSTRUCTIONS},
 ];
}

interface ResolvedRole { id:QuickRoleId;title:string;profileId:string;model:string;instructions:string;source?:Member }

function validateRoute(profileId:unknown,model:unknown,project:TeamProject,availableProfiles:string[]){
 if(typeof profileId!=='string'||!availableProfiles.includes(profileId)||profileId.startsWith('client:')||typeof model!=='string'||!model.trim()||model.trim().length>200)throw Error(tr('请选择可用的 API 接入和模型'));
 if(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(profileId))throw Error(tr('此接入不在项目允许范围内，请选择其他接入'));
 return {profileId,model:model.trim()};
}

/** Resolve every role before callers mutate the project. */
function resolveRoles(project:TeamProject,choice:QuickTaskChoice,availableProfiles:string[]):ResolvedRole[]{
 if(!choice||!STYLES.includes(choice.style))throw Error(tr('请选择工作方式'));
 validateRoute(choice.profileId,choice.model,project,availableProfiles);
 if(choice.roles!==undefined&&(!choice.roles||typeof choice.roles!=='object'||Array.isArray(choice.roles)))throw Error(tr('角色设置格式无效'));
 const requested=Object.keys(choice.roles??{});
 if(requested.some(id=>!ROLES.includes(id as QuickRoleId)))throw Error(tr('包含未知角色设置'));
 const definitions=quickTaskRoles(choice.style,choice.fileScope),needed=new Set(definitions.map(role=>role.id));
 if(requested.some(id=>!needed.has(id as QuickRoleId)))throw Error(tr('当前工作方式不使用此角色'));
 return definitions.map(definition=>{
  const selected=choice.roles?.[definition.id];
  if(selected!==undefined&&(!selected||typeof selected!=='object'||Array.isArray(selected)))throw Error(tr('「{title}」的设置格式无效',{title:tr(definition.title)}));
  const route=validateRoute(selected?selected.profileId:choice.profileId,selected?selected.model:choice.model,project,availableProfiles);
  const instructions=selected?selected.instructions:definition.instructions;
  if(typeof instructions!=='string'||!instructions.trim())throw Error(tr('请填写「{title}」的职责',{title:tr(definition.title)}));
  if(instructions.length>12000)throw Error(tr('「{title}」的职责不能超过 12000 个字符',{title:tr(definition.title)}));
  let source:Member|undefined;
  if(selected?.memberId!==undefined){
   if(typeof selected.memberId!=='string'||!(source=project.members.find(member=>member.id===selected.memberId))||!source.enabled||typeof source.connectionId!=='string'||source.connectionId.startsWith('client:')||!availableProfiles.includes(source.connectionId)||!source.model?.trim())throw Error(tr('「{title}」引用的成员已失效或不可用于 API 协作',{title:tr(definition.title)}));
   if(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(source.connectionId))throw Error(tr('「{title}」引用的成员不在项目允许范围内',{title:tr(definition.title)}));
  }
  return {...definition,...route,instructions:instructions.trim(),source};
 });
}

function memberFromRole(taskTitle:string,role:ResolvedRole,project:TeamProject):Member {
 return {id:uid('member'),name:`${taskTitle} · ${role.title}`,instructions:role.instructions,
  connectionId:role.profileId,model:role.model,effort:'medium',enabled:true,
  tools:[],skills:[],maxTokens:Math.min(30000,project.settings.maxTokens),maxMinutes:Math.min(20,project.settings.maxMinutes),
  failover:{enabled:false,routes:[]}};
}

function keepRequired(custom:string,required:string){return custom.trim()===required.trim()?required:`${custom.trim()}\n\n${required}`;}

/** Prepare an ordinary editable workflow. No request, permission change, or run is started here. */
export function prepareQuickTask(project:TeamProject,taskId:string,choice:QuickTaskChoice,availableProfiles:string[]){
 const task=project.tasks.find(t=>t.id===taskId);
 if(!task?.goal.trim()||!task.acceptance.trim())throw Error(tr('请先填写目标和验收标准'));
 if(task.workflowId)throw Error(tr('此任务已有流程，请在高级设置中调整'));
 if(task.ownerId)throw Error(tr('此任务已指定负责人，请通过高级设置准备流程'));
 const roles=resolveRoles(project,choice,availableProfiles);
 const scope=choice.fileScope;
 if(scope){
  if(!['direct','review'].includes(choice.style)||task.intent==='explore')throw Error(tr('文件任务请选择直接完成或完成后独立复核'));
  if(scope.root==='')throw Error(tr('请先选择工作目录'));
  validateTeamFileScope(scope,[...project.settings.roots,scope.root]);
 }
 if((task.intent==='explore')!==(choice.style==='explore'))throw Error(tr('请使用与当前任务匹配的工作方式'));
 const roleMembers=new Map<QuickRoleId,Member>();
 for(const role of roles)roleMembers.set(role.id,memberFromRole(task.title,role,project));
 const executor=roleMembers.get('executor')!,partner=roleMembers.get('partner');
 const members=[executor,...(partner?[partner]:[])];
 if(scope){
  for(const member of members)member.fileScope=structuredClone(scope);
  executor.tools=teamFileTools(scope.capability);
  if(partner)partner.tools=teamFileTools(scope.capability,true);
 }
 const localTask={...task,ownerId:executor.id};
 const fileReview=!!scope&&scope.capability!=='read';
 const workflow=choice.style==='review'?reviewFlowGraph(localTask,members,`${task.title} · ${fileReview?'文件复核':'文本复核'}`,fileReview?'files':'text'):
  freeFlowGraph(localTask,members,`${task.title} · ${choice.style==='direct'?'直接完成':'讨论后完成'}`);
 if(choice.style==='explore'){
  workflow.name=`${task.title} · 理清想法`;
  const [start,explore,plan,end]=workflow.draft.nodes;
  start.title='你的想法';
  explore.type='agent';explore.title='探索可选方向';explore.memberId=partner!.id;delete explore.participants;
  explore.instructions=roles.find(role=>role.id==='partner')!.instructions;explore.outputRequirement='可选方向、取舍、假设与待确认问题';
  plan.title='整理下一步建议';plan.instructions=keepRequired(roles.find(role=>role.id==='executor')!.instructions,DISCOVERY_PLAN_INSTRUCTIONS);plan.inputRefs=[explore.id];
  plan.outputRequirement=task.acceptance;end.title='由你决定下一步';
 }else if(choice.style==='review'){
  const execute=workflow.draft.nodes.find(node=>node.type==='agent')!,review=workflow.draft.nodes.find(node=>node.type==='review')!;
  execute.instructions=roles.find(role=>role.id==='executor')!.instructions;
  review.instructions=keepRequired(roles.find(role=>role.id==='partner')!.instructions,review.instructions);
 }else{
  const execute=workflow.draft.nodes.find(node=>node.type==='agent')!;execute.instructions=roles.find(role=>role.id==='executor')!.instructions;
  const discussion=workflow.draft.nodes.find(node=>node.type==='discussion');if(discussion)discussion.instructions=roles.find(role=>role.id==='partner')!.instructions;
 }
 workflow.draft.maxTokens=Math.min(workflow.draft.maxTokens,project.settings.maxTokens);
 workflow.draft.maxMinutes=Math.min(workflow.draft.maxMinutes,project.settings.maxMinutes);
 const errors=validateGraph(workflow.draft,members,project.settings.allowedConnections).filter(x=>x.severity==='error');
 if(errors.length)throw Error(errors.map(x=>x.message).join('\n'));
 validateTeamFileSnapshot(scope,task.intent,workflow.draft,members);
 workflow.versions=[{id:uid('flowversion'),number:1,createdAt:Date.now(),graph:structuredClone(workflow.draft)}];
 // Append only after all checks pass; existing members, flows, permissions and runs stay intact.
 project.members.push(...members);project.workflows.push(workflow);
 task.workflowId=workflow.id;task.ownerId=executor.id;
 if(scope){task.fileScope=structuredClone(scope);if(!project.settings.roots.includes(scope.root))project.settings.roots.push(scope.root);}
 else delete task.fileScope;
 return {flowId:workflow.id,versionId:workflow.versions[0].id,taskId};
}

export function saveQuickPreset(project:TeamProject,name:string,choice:QuickTaskChoice,availableProfiles:string[]):string {
 if(typeof name!=='string'||!name.trim()||name.trim().length>80)throw Error(tr('方案名称需为 1–80 个字符'));
 if(project.quickPresets!==undefined&&!Array.isArray(project.quickPresets))throw Error(tr('团队方案格式无效'));
 if((project.quickPresets?.length??0)>=20)throw Error(tr('最多保存 20 个团队方案'));
 const normalizedName=name.trim().toLocaleLowerCase();
 if(project.quickPresets?.some(preset=>typeof preset?.name==='string'&&preset.name.trim().toLocaleLowerCase()===normalizedName))throw Error(tr('已有同名团队方案，请换一个名称'));
 const roles=resolveRoles(project,choice,availableProfiles);
 const expanded:Partial<Record<QuickRoleId,QuickRoleChoice>>={};
 for(const role of roles)expanded[role.id]={profileId:role.profileId,model:role.model,instructions:role.instructions};
 const id=uid('quickpreset'),preset:QuickTeamPreset={id,name:name.trim(),createdAt:Date.now(),choice:{profileId:choice.profileId,model:choice.model.trim(),style:choice.style,roles:expanded}};
 (project.quickPresets??=[]).push(structuredClone(preset));
 return id;
}

export function removeQuickPreset(project:TeamProject,id:string):void {
 if(!Array.isArray(project.quickPresets))throw Error(tr('团队方案不存在'));
 const index=project.quickPresets.findIndex(preset=>preset.id===id);
 if(index<0)throw Error(tr('团队方案不存在'));
 project.quickPresets.splice(index,1);
}
