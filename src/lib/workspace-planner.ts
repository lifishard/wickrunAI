import { z } from 'zod';
import type { AppSettings } from '../types';
import type { TeamProject, FlowNode } from './collaboration';
import { newNode, newWorkflow, validateGraph } from './collaboration';
import { ensureOffice, addRole, moveDepartment, moveMember, mergeDepartment, dissolveDepartment, captureModule, installModule, type AgentRole } from './office';
import { departmentTemplates, assembleDepartment } from './office-library';
import { validateTaskDependencies } from './team-dependencies';
import { validateTeamFileScope, validateTeamFileSnapshot } from './team-file-scope';
import { TOOLS } from './tools/registry';
import { uid } from './store';
import type { Skill } from './skills';
import { tr } from './i18n';

const id=z.string().min(1).max(160).regex(/^(?!(?:__proto__|prototype|constructor)$).+/),text=z.string().trim().min(1).max(12000),name=text.max(160);
const scope=z.object({root:text,capability:z.enum(['read','edit','command'])});
const node=z.object({id,type:z.enum(['start','agent','discussion','condition','parallel','join','review','approval','handoff','end']),title:name,instructions:z.string().max(12000).default(''),outputRequirement:z.string().max(12000).default(''),member:id.optional(),participants:z.array(id).max(30).optional(),inputRefs:z.array(id).max(100).default([]),condition:z.object({source:id,contains:text}).optional(),reviewMode:z.enum(['text','files']).optional(),join:z.enum(['all','any']).default('all'),maxVisits:z.number().int().min(1).max(20).default(3)});
const edge=z.object({from:id,to:id,port:z.enum(['next','pass','fail','default']).default('next'),label:z.string().max(160).default(''),loop:z.boolean().default(false),maxTraversals:z.number().int().min(1).max(20).default(1)});
const change=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('project_settings'),maxConcurrent:z.number().int().min(1).max(16).optional(),maxTokens:z.number().int().min(1000).max(10000000).optional(),maxMinutes:z.number().min(1).max(1440).optional(),allowedConnections:z.array(id).max(100).optional(),approvalMode:z.enum(['ask','auto','all']).optional()}),
 z.object({kind:z.literal('department'),ref:id,existingId:id.optional(),name,purpose:text,parent:id.nullable().optional()}),
 z.object({kind:z.literal('member'),ref:id,existingId:id.optional(),department:id.optional(),roleId:id.optional(),name:name.optional(),instructions:text.optional(),profileId:id,model:id,effort:z.enum(['off','low','medium','high','xhigh']).default('medium'),tools:z.array(id).max(100).default([]),skills:z.array(id).max(30).default([]),maxTokens:z.number().int().min(1000).max(1000000).default(30000),maxMinutes:z.number().min(1).max(1440).default(20),enabled:z.boolean().default(true)}),
 z.object({kind:z.literal('workflow'),ref:id,existingId:id.optional(),name,nodes:z.array(node).min(2).max(100),edges:z.array(edge).min(1).max(300),maxSteps:z.number().int().min(2).max(1000).default(100),maxTokens:z.number().int().min(1000).max(1000000).default(50000),maxMinutes:z.number().min(1).max(1440).default(30)}),
 z.object({kind:z.literal('task'),ref:id,existingId:id.optional(),title:name,goal:text,acceptance:text,workflow:id,owner:id.optional(),dependsOn:z.array(id).max(8).default([]),fileScope:scope.optional()}),
 z.object({kind:z.literal('schedule'),ref:id,existingId:id.optional(),name,workflow:id,goal:text,acceptance:text,timezone:id,hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),catchUp:z.boolean().default(false),overlap:z.enum(['skip','queue']).default('skip')}),
 z.object({kind:z.literal('department_operation'),operation:z.enum(['move','merge','dissolve','copy','save_module','install_module','assemble_template']),department:id.optional(),target:id.optional(),moduleId:id.optional(),templateId:id.optional(),ref:id.optional()}),
 z.object({kind:z.literal('archive_workflow'),workflow:id,archived:z.boolean()}),
]);
export const workspaceOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('start_task'),task:id}),
 z.object({kind:z.literal('run_control'),run:id,action:z.enum(['pause','resume','cancel'])}),
 z.object({kind:z.literal('schedule_control'),schedule:id,enabled:z.boolean()}),
 z.object({kind:z.literal('task_message'),task:id,text,member:id.optional()}),
 z.object({kind:z.literal('create_meeting'),ref:id,title:name,purpose:text,material:z.string().max(30000),participants:z.array(z.enum(['claude-desktop','chatgpt'])).min(1).max(2)}),
 z.object({kind:z.literal('meeting_control'),room:id,action:z.enum(['auto_start','auto_pause','invite','phase']),rounds:z.number().int().min(1).max(5).optional(),focus:text.max(2000).optional(),provider:z.enum(['claude-desktop','chatgpt']).optional(),phase:z.enum(['preparation','perspectives','discussion','convergence','decision']).optional()}),
 z.object({kind:z.literal('inspect_files'),session:id}),
 z.object({kind:z.literal('open'),page:z.enum(['overview','office','tasks','meetings','members','workflows','files','memory','schedules','settings','runs']),target:id.optional()}),
]);
export const workspacePlanSchema=z.object({title:name,summary:text,assumptions:z.array(text).max(12).default([]),changes:z.array(change).max(100).default([]),operations:z.array(workspaceOperationSchema).max(30).default([])});
export type WorkspacePlan=z.infer<typeof workspacePlanSchema>;
export type WorkspaceOperation=z.infer<typeof workspaceOperationSchema>;
export interface WorkspaceResult {ids:Record<string,string>;appliedAt:number;operationReceipts?:Record<number,{status:'pending'|'done'|'failed';text:string}>}
export interface WorkspaceEnvironment {settings:AppSettings;roles:AgentRole[];skills:Skill[]}

/** Only configuration contributes to the stamp: conversation updates cannot invalidate their own draft. */
export function workspaceStamp(p:TeamProject):string {
 const source=JSON.stringify({members:p.members,departments:p.office?.departments,modules:p.office?.modules,workflows:p.workflows,tasks:p.tasks.map(({entries,...t})=>t),schedules:p.schedules,settings:p.settings});
 let a=2166136261,b=5381;for(let i=0;i<source.length;i++){a=Math.imul(a^source.charCodeAt(i),16777619);b=Math.imul(b,33)^source.charCodeAt(i);}return `${source.length}:${a>>>0}:${b>>>0}`;
}
export function workspaceContext(p:TeamProject,env:WorkspaceEnvironment){return {
 schema:z.toJSONSchema(workspacePlanSchema),
 project:{id:p.id,settings:p.settings,departments:p.office?.departments??[],members:p.members,workflows:p.workflows.map(f=>({id:f.id,name:f.name,archived:f.archived,draft:f.draft,versions:f.versions.map(v=>({id:v.id,number:v.number}))})),tasks:p.tasks.map(({entries,...t})=>t),schedules:p.schedules,files:p.files,runs:p.runs.map(r=>({id:r.id,taskId:r.taskId,status:r.status,goal:r.goal,tokens:r.tokens,pendingApproval:r.pendingApproval,latest:r.attempts.slice(-3).map(a=>({nodeId:a.nodeId,status:a.status,output:a.output.slice(-3000),error:a.error}))}))},
 tools:TOOLS.map(t=>({name:t.name,description:t.description.slice(0,180),group:t.group})),skills:env.skills.filter(s=>s.enabled).map(s=>({name:s.name,description:s.description})),
 departmentTemplates:departmentTemplates(env.roles),savedModules:[...(p.office?.modules??[]),...(env.settings.officeLibrary?.departments??[])].map(m=>({id:m.id,name:m.name})),
 humanActions:['approve or reject QA/delivery','answer pending questions','grant a new directory','inspect and merge files','confirm meeting minutes','import/export/restore data'],
 };}

/** Compile all configuration changes in a private copy; the caller persists it once. Never starts work. */
export function prepareWorkspacePlan(original:TeamProject,raw:WorkspacePlan,env:WorkspaceEnvironment,material=''):{project:TeamProject;result:WorkspaceResult}{
 const plan=workspacePlanSchema.parse(raw),p=structuredClone(original),o=ensureOffice(p),ids:Record<string,string>=Object.create(null),changedFlows=new Set<string>();
 if(!plan.changes.length&&!plan.operations.length)throw Error(tr('工作安排需要至少一项配置或操作'));
 const resolve=(value:string)=>Object.prototype.hasOwnProperty.call(ids,value)?ids[value]:value;
 const register=(ref:string,value:string)=>{if(Object.prototype.hasOwnProperty.call(ids,ref))throw Error(tr('安排中的引用名称重复'));ids[ref]=value;};
 const requireItem=<T extends {id:string}>(items:T[],value:string)=>{const found=items.find(x=>x.id===resolve(value));if(!found)throw Error(tr('安排引用的对象不存在：{id}',{id:value}));return found;};
 for(const c of plan.changes)if(c.kind==='project_settings'){
   if(c.allowedConnections?.some(id=>!env.settings.keyProfiles.some(k=>k.id===id)&&!['client:codex','client:claude'].includes(id)))throw Error(tr('安排使用了未配置的模型或技能'));
   const {kind,...settings}=c;Object.assign(p.settings,settings);
 }
 // Reserve identities so forward references (task dependencies, hierarchy) are supported.
 for(const c of plan.changes)if('ref'in c&&c.ref&&c.kind!=='department_operation')register(c.ref,'existingId'in c&&c.existingId?c.existingId:uid(c.kind));
 for(const c of plan.changes)if(c.kind==='department'){
   let d=c.existingId?requireItem(o.departments,c.existingId):undefined;
   if(!d){d={id:resolve(c.ref),name:c.name,purpose:c.purpose,memberIds:[],workflowIds:[]};o.departments.push(d);}d.name=c.name;d.purpose=c.purpose;
 }
 for(const c of plan.changes)if(c.kind==='department'&&c.parent!==undefined)moveDepartment(o,resolve(c.ref),c.parent===null?undefined:resolve(c.parent));
 for(const c of plan.changes)if(c.kind==='member'){
   const profile=env.settings.keyProfiles.find(k=>k.id===c.profileId&&k.hasSecret),native=['client:codex','client:claude'].includes(c.profileId)&&p.members.some(m=>m.connectionId===c.profileId&&m.model===c.model);
   if((!profile&&!native)||(p.settings.allowedConnections.length&&!p.settings.allowedConnections.includes(c.profileId)))throw Error(tr('角色的模型接入已不可用，请在方案中重新选择'));
   const knownModels=[...(env.settings.cachedModels[c.profileId]??[]).map(m=>m.id),...p.members.filter(m=>m.connectionId===c.profileId).map(m=>m.model),...(o.brain?.profileId===c.profileId?[o.brain.model]:[]),...(env.settings.activeKeyProfileId===c.profileId?[env.settings.defaultConfig.model]:[])];
   if(!knownModels.includes(c.model))throw Error(tr('安排使用了未配置的模型或技能'));
   if(c.tools.some(t=>!TOOLS.some(tool=>tool.name===t))||c.skills.some(s=>!env.skills.some(skill=>skill.name===s&&skill.enabled)))throw Error(tr('安排使用了未配置的模型或技能'));
   const role=c.roleId?env.roles.find(r=>r.id===c.roleId):undefined;if(c.roleId&&!role)throw Error(tr('安排使用了未登记角色'));
   let member=c.existingId?requireItem(p.members,c.existingId):undefined;
   if(!member){member={id:resolve(c.ref),name:c.name??role?.name??'',instructions:c.instructions??role?.instructions??'',connectionId:c.profileId,model:c.model,effort:c.effort,tools:[],enabled:c.enabled,maxTokens:c.maxTokens,maxMinutes:c.maxMinutes};p.members.push(member);}
   if(!member.name&&!c.name||!member.instructions&&!role&&!c.instructions)throw Error(tr('请为成员安排职责和名称'));
   Object.assign(member,{name:c.name??role?.name??member.name,instructions:c.instructions??role?.instructions??member.instructions,roleTemplateId:c.roleId??member.roleTemplateId,connectionId:c.profileId,model:c.model,effort:c.effort,tools:c.tools,skills:c.skills,enabled:c.enabled,maxTokens:c.maxTokens,maxMinutes:c.maxMinutes});
   if(c.department)moveMember(p,member.id,resolve(c.department));
 }
 for(const c of plan.changes)if(c.kind==='workflow'){
   let f=c.existingId?requireItem(p.workflows,c.existingId):undefined;if(!f){f=newWorkflow(c.name);f.id=resolve(c.ref);p.workflows.push(f);}f.name=c.name;
   const nodeIds=new Map(c.nodes.map(n=>[n.id,uid('node')]));if(nodeIds.size!==c.nodes.length)throw Error(tr('安排中的引用名称重复'));
   const nodeId=(id:string)=>{const next=nodeIds.get(id);if(!next)throw Error(tr('安排引用的对象不存在：{id}',{id}));return next;};
   const nodes:FlowNode[]=c.nodes.map((n,i)=>({...newNode(n.type,80+(i%5)*240,80+Math.floor(i/5)*180),...n,id:nodeId(n.id),memberId:n.member?requireItem(p.members,n.member).id:undefined,participants:n.participants?.map(id=>requireItem(p.members,id).id),inputRefs:n.inputRefs.map(nodeId),condition:n.condition?{source:nodeId(n.condition.source),contains:n.condition.contains}:undefined}));
   // Reusing a role in a review never reuses the producing member identity.
   const producers=new Set(nodes.filter(n=>['agent','handoff','discussion'].includes(n.type)).flatMap(n=>[...(n.participants??[]),...(n.memberId?[n.memberId]:[])]));
   for(const n of nodes)if(n.type==='review'&&n.memberId&&producers.has(n.memberId)){const original=requireItem(p.members,n.memberId),reviewer={...structuredClone(original),id:uid('reviewer'),name:original.name+' · '+tr('独立复核'),tools:n.reviewMode==='text'?[]:original.tools.filter(t=>['read_file','read_document','list_dir','search_files'].includes(t))};p.members.push(reviewer);for(const d of o.departments)if(d.memberIds.includes(original.id))d.memberIds.push(reviewer.id);n.memberId=reviewer.id;}
   f.draft={nodes,edges:c.edges.map(e=>({...e,id:uid('edge'),from:nodeId(e.from),to:nodeId(e.to)})),maxSteps:c.maxSteps,maxTokens:c.maxTokens,maxMinutes:c.maxMinutes};
   if(c.maxTokens>p.settings.maxTokens||c.maxMinutes>p.settings.maxMinutes)throw Error(tr('流程预算超过项目上限'));
   const errors=validateGraph(f.draft,p.members,p.settings.allowedConnections).filter(i=>i.severity==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('\n'));
   f.versions.push({id:uid('version'),number:(f.versions.at(-1)?.number??0)+1,createdAt:Date.now(),graph:structuredClone(f.draft)});f.updatedAt=Date.now();changedFlows.add(f.id);
   for(const d of o.departments)if(nodes.some(n=>d.memberIds.includes(n.memberId??'')||n.participants?.some(id=>d.memberIds.includes(id))))d.workflowIds=[...new Set([...d.workflowIds,f.id])];
 }
 for(const c of plan.changes)if(c.kind==='task'){
   const f=requireItem(p.workflows,c.workflow);if(f.archived)throw Error(tr('安排引用的工作流已归档'));
   let t=c.existingId?requireItem(p.tasks,c.existingId):undefined;if(t&&p.runs.some(r=>r.taskId===t!.id&&!['completed','cancelled','failed'].includes(r.status)))throw Error(tr('任务正在运行或等待处理，请先暂停并另建后续任务'));
   if(!t){t={id:resolve(c.ref),title:c.title,goal:c.goal,acceptance:c.acceptance,status:'草稿',entries:[],createdAt:Date.now()};p.tasks.push(t);}
   Object.assign(t,{title:c.title,goal:c.goal,acceptance:c.acceptance,workflowId:f.id,ownerId:c.owner?requireItem(p.members,c.owner).id:undefined,dependsOn:c.dependsOn.map(resolve),fileScope:c.fileScope,intent:'deliver',status:'草稿'});
   validateTeamFileScope(t.fileScope,p.settings.roots);const used=new Set(f.draft.nodes.flatMap(n=>[...(n.participants??[]),...(n.memberId?[n.memberId]:[])]));validateTeamFileSnapshot(t.fileScope,t.intent,f.draft,p.members.filter(m=>used.has(m.id)));
   if(material)t.entries.push({id:uid('entry'),at:Date.now(),author:'你 → 所有成员',kind:'instruction',text:material});
 }
 validateTaskDependencies(p);
 for(const c of plan.changes)if(c.kind==='schedule'){
   new Intl.DateTimeFormat('en',{timeZone:c.timezone}).format();const f=requireItem(p.workflows,c.workflow),version=f.versions.at(-1);if(!version||f.archived)throw Error(tr('安排引用的工作流尚无可用版本'));
   let s=c.existingId?requireItem(p.schedules,c.existingId):undefined;if(!s){s={id:resolve(c.ref),name:c.name,workflowId:f.id,versionId:version.id,goal:c.goal,acceptance:c.acceptance,timezone:c.timezone,hour:c.hour,minute:c.minute,catchUp:c.catchUp,overlap:c.overlap,enabled:false,nextAt:0,triggers:[]};p.schedules.push(s);}
   Object.assign(s,{name:c.name,workflowId:f.id,versionId:version.id,goal:c.goal,acceptance:c.acceptance,timezone:c.timezone,hour:c.hour,minute:c.minute,catchUp:c.catchUp,overlap:c.overlap,enabled:false,nextAt:0});
 }
 for(const c of plan.changes){
   if(c.kind==='archive_workflow')requireItem(p.workflows,c.workflow).archived=c.archived;
   if(c.kind!=='department_operation')continue;
   const dep=c.department?requireItem(o.departments,c.department).id:undefined,target=c.target?requireItem(o.departments,c.target).id:undefined;let result:string|undefined;
   if(['move','merge','dissolve','copy','save_module'].includes(c.operation)&&!dep)throw Error(tr('请指定要调整的部门'));
   if(c.operation==='move')moveDepartment(o,dep!,target);
   if(c.operation==='merge'){if(!target)throw Error(tr('请指定目标部门'));mergeDepartment(p,dep!,target);}
   if(c.operation==='dissolve')dissolveDepartment(p,dep!);
   if(c.operation==='copy')result=installModule(p,captureModule(p,dep!),target);
   if(c.operation==='save_module'){const module=captureModule(p,dep!);o.modules.push(module);result=module.id;}
   if(c.operation==='install_module'){const module=[...o.modules,...(env.settings.officeLibrary?.departments??[])].find(m=>m.id===c.moduleId);if(!module)throw Error(tr('安排引用的部门模块不存在'));result=installModule(p,module,target);}
   if(c.operation==='assemble_template'){const template=departmentTemplates(env.roles).find(t=>t.id===c.templateId);if(!template)throw Error(tr('安排引用的部门模板不存在'));result=assembleDepartment(p,template,env.roles,o.brain??{profileId:env.settings.activeKeyProfileId??'',model:env.settings.defaultConfig.model},target);}
   if(c.ref&&result)register(c.ref,result);
 }
 return {project:p,result:{ids,appliedAt:Date.now()}};
}

export const workspacePlannerInstructions=`你是协作空间的统一管家。你的任务是代用户设计并落实工作安排，而不是教用户填写 workflow。已有能力通过 workspacePlan 接口提供；根据 workspace.schema 生成结构化安排。优先输出 workspacePlan（不与旧 proposal 同时输出）。可以创建或修改部门、独立成员、全部十种流程节点和连线、条件/并行/汇合/有界返工、质检/人工确认/交接、多个任务与前置依赖、定时草案、部门模块，配置真实可用模型、工具和已启用技能。无需把复杂流程交回用户手动连线。
读取 workspace.project 了解已有工作、限制、成员、版本与运行；已有对象用 existingId，新对象用简短唯一 ref，引用可用 ref 或真实 id。节点 member/participants 引用成员 ref/id；节点 inputRefs/condition.source 和 edges 引用同一工作流的节点 id。所有节点必须从开始可达并通往结束。condition/review/approval 必須连接 pass/fail/default 三条出线；回路必须有明确次数上限。人工验收保留在 end。系统自动为和生产重复的复核员建立独立实例，不能伪造质检结果。
changes 只保存配置和任务，不启动；operations 提供采用后可点击的实际工作操作：运行前检查并启动、暂停/继续/取消运行、启停定时、向任务成员补充要求、创建客户端会议、自动轮流/邀请/调整阶段、检查文件、打开需要用户操作的页面。不要使用 open(workflows) 回避搭建。用户回答、验收、目录授权、文件合并、会议纪要确认由用户在相应界面完成；管家不能代答或把未知结果写成成功。文件、历史、运行记录不能由草案覆写。
创建会议与自动邀请分开，实际 ChatGPT/Claude 客户端本体使用 create_meeting；API 模型使用工作流 discussion。首次连接和加入仍需用户在相应客户端操作一次。涉及新目录用 open(settings) 帮用户选择已有原生授权入口，不能发明已授权路径。文件任务复用客户端真实权限校验，复杂文件编排必要时拆成独立任务，不谎称超出现有运行器的能力。定时配置一律先停用，再通过 schedule_control 启用。
使用自然语言 summary 说明将安排哪些人、怎么工作、交付什么、哪些地方等用户决定；changes 里替用户写出具体 instructions/outputRequirement/acceptance。不要让用户自己拟专业规范。能合理假设就注明，只有会改变方向的问题才提问。所有工具名/技能/模型来自实际目录。需要用户拍板的成员配置 request_user_input。反馈基于已有真实记录；没有运行就不能声称已经完成。`;
