import { z } from 'zod';
import { AGENT_ROLES, addRole, ensureOffice, proposalFlow, type OfficeProposal, type PlanningTurn, type AgentRole } from './office';
import { uid } from './store';
import { validateGraph, type TeamProject } from './collaboration';
const text=z.string().trim().min(1).max(6000);
const proposalSchema=z.object({title:text.max(120),goal:text,deliverable:text,acceptance:text,assumptions:z.array(text).max(12),departments:z.array(z.object({name:text.max(80),purpose:text,roleIds:z.array(text.max(120)).min(1).max(12)})).min(1).max(12),steps:z.array(z.object({roleId:text.max(120),instruction:text,output:text})).min(1).max(18),mode:z.enum(['sequential','parallel']),reviewRoleId:z.string().optional()});
const replySchema=z.object({message:text,questions:z.array(z.object({text,options:z.array(text.max(160)).max(4)})).max(3).default([]),proposal:proposalSchema.optional(),learning:z.array(z.object({kind:z.enum(['preference','lesson','skill']),text:text.max(1000),sourceQuote:text.max(1000),applicability:text.max(1000)})).max(3).default([])});
export function parsePlannerReply(raw:string,roles:AgentRole[]=AGENT_ROLES) {
  const clean=raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const result=replySchema.parse(JSON.parse(clean));
  if(result.proposal){const p=result.proposal,ids=new Set(roles.map(r=>r.id)),assigned=new Set(p.departments.flatMap(d=>d.roleIds));if([...assigned,...p.steps.map(s=>s.roleId),...(p.reviewRoleId?[p.reviewRoleId]:[])].some(id=>!ids.has(id)))throw Error('方案使用了未登记角色，请让助手调整');if(p.steps.some(s=>!assigned.has(s.roleId))||(p.reviewRoleId&&!assigned.has(p.reviewRoleId)))throw Error('方案中有成员未被分配到部门');if(p.departments.flatMap(d=>d.roleIds).length!==assigned.size)throw Error('本次方案的角色分工重复，请让助手拆分职责');if(p.reviewRoleId&&p.steps.some(s=>s.roleId===p.reviewRoleId))throw Error('独立复核不能由本次执行者自己担任');}
  return result;
}
export function plannerSystem(roles:AgentRole[]=AGENT_ROLES):string {return `你是 wickrunAI 的协作设计助手。面向普通用户，从他们想做成的事开始，主动承担分工、步骤、交付和验收标准的设计工作。不要要求用户自己设计流程图或填写专业表格。每轮最多问三个会实质改变方案的问题，给熟悉生活的选项。能合理假设的事项明示假设，不假装已获批准。用户的答案和修改意见优先。
你了解客户端的真实功能：角色实例拥有职责、模型、工具范围；部门是可嵌套、拆分、合并、复用的组织模块，组织关系不决定执行顺序；工作流有开始、执行、讨论、并行、汇合、条件、独立质检、人工确认、交接、结束；启动时冻结配置；会议讨论不替代质检；权限和文件范围由用户在启动前确认。你这里只提出草案，没有执行工具，也没有发布或发送消息的授权。当前快速搭建器支持顺序或并行的文本工作，独立文本复核，末尾由用户验收。涉及视频制作、文件修改、外部发布、定时或复杂依赖，应明确这些还需在原有流程编辑器和权限设置完成配置，不能承诺已经可执行。可以先拆出规划、脚本等可交付的文本阶段，并说明后续缺口。
先谈需求，准备足够时主动提出可调整的草案。复用已有方案的目标与用户确认过的选择。用户要求改变办公室现有配置时说明采用会新增独立的部门和流程，不会偷偷覆盖正在工作的团队。角色仅能来自下面的清单；同一草案内每个 roleId 只在一个部门放置。需要质检时安排未参与生产步骤的另一角色。并行仅用于步骤互不依赖的情形，否则用 sequential。不要编造资历、实测结果、费用或已经完成的动作。
仅返回 JSON（无代码围栏），格式：{"message":"自然的说明或必要的问题","questions":[{"text":"具体问题","options":["选项"]}],"proposal":{"title":"方案名","goal":"用户目标","deliverable":"交给用户的具体结果","acceptance":"由你起草的、用户容易判断的完成标准","assumptions":["待用户确认的假设"],"departments":[{"name":"部门名","purpose":"分工","roleIds":["清单内的角色 ID"]}],"steps":[{"roleId":"角色 ID","instruction":"要做的事","output":"交付什么"}],"mode":"sequential","reviewRoleId":"可选独立复核角色 ID"}}。questions 与 proposal 可以为空/省略；尚需关键答案时先提问，不强塞最终方案。
可用角色：${JSON.stringify(roles.map(({id,name,summary,division})=>({id,name,division,summary:summary.slice(0,100)})))}`;}
/** Compile a validated proposal into new drafts only. No run, tool grant or external action. */
export function adoptProposal(project:TeamProject,turn:PlanningTurn,brain:{profileId:string;model:string},roles:AgentRole[]=AGENT_ROLES):{taskId:string;flowId:string} {
  if(!turn.proposal)throw Error('没有可采用的方案');if(turn.questions?.length)throw Error('请先回答关键问题，让助手更新方案');if(turn.adoptedTaskId)throw Error('此方案已经采用');
  if(!brain.profileId||!brain.model.trim()||brain.profileId.startsWith('client:'))throw Error('请先选择一个 API 模型来配置团队');
  if(project.settings.allowedConnections.length&&!project.settings.allowedConnections.includes(brain.profileId))throw Error('当前模型接入不在此项目允许的范围');
  const p=parsePlannerReply(JSON.stringify({message:turn.text,proposal:turn.proposal}),roles).proposal!,office=ensureOffice(project),roleMembers:Record<string,string>={},departmentIds:string[]=[];
  for(const dep of p.departments){const id=uid('dept');office.departments.push({id,name:dep.name,purpose:dep.purpose,memberIds:[],workflowIds:[]});departmentIds.push(id);for(const roleId of dep.roleIds)roleMembers[roleId]=addRole(project,id,roles.find(r=>r.id===roleId)!,brain).id;}
  const flow=proposalFlow(p,project.members,roleMembers);flow.draft.maxTokens=Math.min(flow.draft.maxTokens,project.settings.maxTokens);flow.draft.maxMinutes=Math.min(flow.draft.maxMinutes,project.settings.maxMinutes);
  const errors=validateGraph(flow.draft,project.members,project.settings.allowedConnections).filter(i=>i.severity==='error');if(errors.length)throw Error(errors.map(i=>i.message).join('；'));
  flow.versions=[{id:uid('version'),number:1,createdAt:Date.now(),graph:structuredClone(flow.draft)}];project.workflows.push(flow);
  for(const d of office.departments.filter(d=>departmentIds.includes(d.id)))d.workflowIds.push(flow.id);
  const taskId=uid('task');project.tasks.push({id:taskId,title:p.title,goal:p.goal,acceptance:p.acceptance,workflowId:flow.id,intent:'deliver',status:'草稿',entries:[{id:uid('entry'),at:Date.now(),author:'协作设计助手',kind:'message',text:`拟交付：${p.deliverable}\n已采用的方案假设：\n${p.assumptions.join('\n')}\n本次只创建草案；尚未启动。`}],createdAt:Date.now()});
  const saved=office.planning?.find(t=>t.id===turn.id);if(saved)saved.adoptedTaskId=taskId;return {taskId,flowId:flow.id};
}
