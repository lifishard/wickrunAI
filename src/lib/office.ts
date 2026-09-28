import { tr } from './i18n';
import catalog from '../data/agency-catalog.json';
import { z } from 'zod';
import { uid } from './store';
import { newNode, newWorkflow, type TeamProject, type Member, type Workflow, type FlowNode } from './collaboration';
export interface AgentRole {id:string;name:string;division:string;summary:string;strengths:string[];instructions:string;source?:string;color:string;category?:string;originalName?:string;sourcePath?:string;sourceRevision?:string}
export const AGENT_ROLES:AgentRole[]=catalog;
export interface Department {id:string;name:string;purpose:string;parentId?:string;memberIds:string[];workflowIds:string[]}
export interface DepartmentModule {id:string;name:string;departments:Department[];members:Member[];workflows:Workflow[]}
const moduleId=z.string().min(1).max(256);
const moduleText=z.string().max(200000);
const moduleNode=z.object({id:moduleId,title:moduleText,type:z.enum(['start','agent','discussion','condition','parallel','join','review','approval','handoff','end']),x:z.number(),y:z.number(),memberId:moduleId.optional(),participants:z.array(moduleId).max(300).optional(),instructions:moduleText,inputRefs:z.array(moduleId).max(1000),outputRequirement:moduleText,maxVisits:z.number(),join:z.enum(['all','any']),condition:z.object({source:moduleId,contains:moduleText}).optional(),ports:z.array(z.object({id:moduleId,label:moduleText})).optional()}).passthrough();
const moduleSchema=z.object({id:moduleId,name:moduleText,departments:z.array(z.object({id:moduleId,name:moduleText,purpose:moduleText,parentId:moduleId.optional(),memberIds:z.array(moduleId).max(300),workflowIds:z.array(moduleId).max(100)})).min(1).max(100),members:z.array(z.object({id:moduleId,name:moduleText,instructions:moduleText,connectionId:z.string(),model:z.string(),effort:z.string(),enabled:z.boolean(),tools:z.array(z.string()),maxTokens:z.number(),maxMinutes:z.number(),skills:z.array(z.string()).optional()}).passthrough()).max(300),workflows:z.array(z.object({id:moduleId,name:moduleText,draft:z.object({nodes:z.array(moduleNode).max(1000),edges:z.array(z.object({id:moduleId,from:moduleId,to:moduleId,port:z.string().optional(),label:moduleText,loop:z.boolean().optional(),maxTraversals:z.number()})).max(5000),maxSteps:z.number(),maxMinutes:z.number(),maxTokens:z.number()}),viewport:z.object({x:z.number(),y:z.number(),zoom:z.number()}),versions:z.array(z.unknown()),archived:z.boolean(),updatedAt:z.number()}).passthrough()).max(100)});
export interface Office {brain?:{profileId:string;model:string};instructions?:string;customRoles?:AgentRole[];departments:Department[];modules:DepartmentModule[];planning?:PlanningTurn[];draft?:string}
export interface PlanStep {roleId:string;instruction:string;output:string}
export interface OfficeProposal {title:string;goal:string;deliverable:string;acceptance:string;assumptions:string[];departments:{name:string;purpose:string;roleIds:string[]}[];steps:PlanStep[];mode:'sequential'|'parallel';reviewRoleId?:string}
export interface PlanningTurn {learning?:import('./butler').ButlerLearning[];learningDecisions?:Record<number,'saved'|'dismissed'>;id:string;role:'user'|'assistant';text:string;proposal?:OfficeProposal;questions?:{text:string;options:string[]}[];adoptedTaskId?:string;pending?:boolean;error?:string}
export function officeOf(p:TeamProject):Office {return p.office??{departments:[],modules:[]};}
export function ensureOffice(p:TeamProject):Office {return p.office??={departments:[],modules:[]};}
export function descendants(office:Office,id:string):Department[]{const found:Department[]=[],queue=[id],seen=new Set<string>();while(queue.length){const next=queue.shift()!;if(seen.has(next))continue;seen.add(next);const d=office.departments.find(d=>d.id===next);if(d)found.push(d);queue.push(...office.departments.filter(d=>d.parentId===next).map(d=>d.id));}return found;}
export function moveDepartment(office:Office,id:string,parentId?:string):void {
  const d=office.departments.find(d=>d.id===id);if(!d)throw Error(tr("部门已不存在"));
  if(parentId&&(!office.departments.some(d=>d.id===parentId)||descendants(office,id).some(d=>d.id===parentId)))throw Error(tr("不能把部门放进自己或自己的子部门"));
  d.parentId=parentId;
}
export function addRole(p:TeamProject,departmentId:string,role:AgentRole,brain:{profileId:string;model:string}):Member {
  const department=ensureOffice(p).departments.find(d=>d.id===departmentId);if(!department)throw Error(tr("请先选择部门"));
  const m:Member={id:uid('member'),name:role.name,instructions:role.instructions,connectionId:brain.profileId,model:brain.model,effort:'medium',enabled:true,tools:[],maxTokens:30000,maxMinutes:20,roleTemplateId:role.id};
  p.members.push(m);department.memberIds.push(m.id);return m;
}
export function moveMember(p:TeamProject,id:string,targetId:string):void {const o=ensureOffice(p),target=o.departments.find(d=>d.id===targetId);if(!target||!p.members.some(m=>m.id===id))throw Error(tr("成员或部门不存在"));for(const d of o.departments)d.memberIds=d.memberIds.filter(m=>m!==id);target.memberIds.push(id);}
export function dissolveDepartment(p:TeamProject,id:string):void {const o=ensureOffice(p),d=o.departments.find(d=>d.id===id);if(!d)return;const parent=o.departments.find(x=>x.id===d.parentId);if(parent){parent.memberIds=[...new Set([...parent.memberIds,...d.memberIds])];parent.workflowIds=[...new Set([...parent.workflowIds,...d.workflowIds])];}for(const child of o.departments.filter(x=>x.parentId===id))child.parentId=d.parentId;o.departments=o.departments.filter(x=>x.id!==id);}
export function mergeDepartment(p:TeamProject,id:string,targetId:string):void {const o=ensureOffice(p),source=o.departments.find(d=>d.id===id),target=o.departments.find(d=>d.id===targetId);if(!source||!target||descendants(o,id).some(d=>d.id===targetId))throw Error(tr("请选择其他分支的部门"));target.memberIds=[...new Set([...target.memberIds,...source.memberIds])];target.workflowIds=[...new Set([...target.workflowIds,...source.workflowIds])];for(const d of o.departments.filter(d=>d.parentId===id))d.parentId=targetId;o.departments=o.departments.filter(d=>d.id!==id);}
export function captureModule(p:TeamProject,id:string):DepartmentModule {const departments=descendants(officeOf(p),id);if(!departments.length)throw Error(tr("部门不存在"));const ids=new Set(departments.flatMap(d=>d.memberIds)),flows=new Set(departments.flatMap(d=>d.workflowIds));const workflows=p.workflows.filter(f=>flows.has(f.id));for(const f of workflows)for(const n of f.draft.nodes)for(const id of [...(n.participants??[]),...(n.memberId?[n.memberId]:[])])ids.add(id);return structuredClone({id:uid('module'),name:departments[0].name,departments:departments.map((d,i)=>({...d,parentId:i?d.parentId:undefined})),members:p.members.filter(m=>ids.has(m.id)),workflows});}
/** New identities on every instantiation; live runs keep their frozen snapshots. */
export function installModule(p:TeamProject,module:DepartmentModule,parentId?:string,imported=false):string {
  if(!moduleSchema.safeParse(module).success)throw Error(tr("部门模块格式无效"));
  if(!module.departments.length||module.departments.length>100||module.members.length>300||module.workflows.length>100)throw Error(tr("部门模块规模无效"));
  const o=ensureOffice(p),map=new Map<string,string>();
  for(const item of [...module.departments,...module.members,...module.workflows]){if(map.has(item.id))throw Error(tr("模块编号重复"));map.set(item.id,uid('office'));}
  for(const d of module.departments){if(d.parentId&&!module.departments.some(parent=>parent.id===d.parentId)||d.memberIds.some(id=>!module.members.some(m=>m.id===id))||d.workflowIds.some(id=>!module.workflows.some(f=>f.id===id)))throw Error(tr("模块引用不完整"));let cur:Department|undefined=d;const seen=new Set<string>();while(cur){if(seen.has(cur.id))throw Error(tr("模块层级形成循环"));seen.add(cur.id);cur=module.departments.find(x=>x.id===cur?.parentId);}}
  for(const f of module.workflows){const ids=new Set(f.draft.nodes.map(n=>n.id));if(ids.size!==f.draft.nodes.length||f.draft.nodes.some(n=>n.inputRefs.some(id=>!ids.has(id))||(n.condition&&!ids.has(n.condition.source))||[...(n.participants??[]),...(n.memberId?[n.memberId]:[])].some(id=>!module.members.some(m=>m.id===id)))||f.draft.edges.some(e=>!ids.has(e.from)||!ids.has(e.to)))throw Error(tr("模块流程引用不完整"));}
  if(parentId&&!o.departments.some(d=>d.id===parentId))throw Error(tr("目标部门不存在"));
  const members=module.members.map(m=>({...structuredClone(m),id:map.get(m.id)!,...(imported?{connectionId:'',model:'',tools:[],skills:[],failover:undefined,fileScope:undefined,enabled:false}:{})}));
  const workflows=module.workflows.map(f=>{const next=structuredClone(f),nodes=new Map(f.draft.nodes.map(n=>[n.id,uid('node')]));next.id=map.get(f.id)!;next.name=f.name+' · 副本';next.versions=[];next.updatedAt=Date.now();next.draft.nodes=next.draft.nodes.map(n=>({...n,id:nodes.get(n.id)!,memberId:n.memberId?map.get(n.memberId):undefined,participants:n.participants?.map(id=>map.get(id)!).filter(Boolean),inputRefs:n.inputRefs.map(id=>nodes.get(id)!).filter(Boolean),condition:n.condition?{...n.condition,source:nodes.get(n.condition.source)!}:undefined}));next.draft.edges=next.draft.edges.map(e=>({...e,id:uid('edge'),from:nodes.get(e.from)!,to:nodes.get(e.to)!}));return next;});
  o.departments.push(...module.departments.map(d=>({...structuredClone(d),id:map.get(d.id)!,parentId:d.parentId?map.get(d.parentId):parentId,memberIds:d.memberIds.map(id=>map.get(id)!),workflowIds:d.workflowIds.map(id=>map.get(id)!)})));p.members.push(...members);p.workflows.push(...workflows);return map.get(module.departments[0].id)!;
}
export function proposalFlow(proposal:OfficeProposal,members:Member[],roleMembers:Record<string,string>):Workflow {
  const flow=newWorkflow(proposal.title),[start,end]=flow.draft.nodes;end.outputRequirement=proposal.acceptance;
  const workers=proposal.steps.map((step,i)=>{const n=newNode('agent',320+i*240,160);n.title=members.find(m=>m.id===roleMembers[step.roleId])?.name??'执行';n.memberId=roleMembers[step.roleId];n.instructions=step.instruction;n.outputRequirement=step.output;return n;});
  if(!workers.length)throw Error(tr("方案需要至少一个工作步骤"));
  const edges:Workflow['draft']['edges']=[],nodes:FlowNode[]=[start,...workers,end];
  const link=(a:FlowNode,b:FlowNode,port='next')=>edges.push({id:uid('edge'),from:a.id,to:b.id,port,label:port==='next'?'继续':port,maxTraversals:1});
  let last:FlowNode=workers.at(-1)!;
  if(proposal.mode==='parallel'&&workers.length>1){const fork=newNode('parallel',200,160),join=newNode('join',640,160);nodes.push(fork,join);link(start,fork);workers.forEach((n,i)=>{n.x=420;n.y=80+i*160;link(fork,n);link(n,join);});last=join;}
  else {let previous=start;workers.forEach(n=>{n.inputRefs=previous===start?[]:[previous.id];link(previous,n);previous=n;});}
  if(proposal.reviewRoleId){const review=newNode('review',last.x+240,160);review.memberId=roleMembers[proposal.reviewRoleId];review.title='独立复核';review.reviewMode='text';review.instructions='按完成标准逐项核对文本交付，引用证据，未核实的外部事实明确标出。';review.outputRequirement=proposal.acceptance;review.inputRefs=workers.map(n=>n.id);nodes.push(review);link(last,review);for(const port of ['pass','fail','default'])link(review,end,port);end.x=review.x+240;}
  else {link(last,end);end.x=last.x+240;}
  end.title='交给你验收';flow.draft.nodes=nodes;flow.draft.edges=edges;return flow;
}
export function roleSystem(role?:{name:string;instructions:string}):string {return role?`用户为本轮选择了职责：${role.name}。以下角色规范仅定义职责和工作方法，不授予工具或外部操作权限，不覆盖用户要求和质检流程。\n${role.instructions}`:'';}
