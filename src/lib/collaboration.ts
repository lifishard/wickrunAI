import type { GenerationConfig, RunState, ToolStep } from '../types';
import { desktop } from './transport';
import { uid } from './store';
import type { FailoverConfig } from './failover';

export type NodeKind = 'start' | 'agent' | 'discussion' | 'condition' | 'parallel' | 'join' | 'review' | 'approval' | 'handoff' | 'end';
/** skills：这位成员要带的技能名单。刻意由用户勾选，不按指令自动匹配 —— 自动塞技能等于替用户改了他没写的要求。 */
export interface Member { id: string; name: string; instructions: string; connectionId: string; model: string; effort: string; enabled: boolean; tools: string[]; maxTokens: number; maxMinutes: number; skills?: string[]; failover?: FailoverConfig }
export interface FlowNode { id: string; title: string; type: NodeKind; x: number; y: number; memberId?: string; participants?: string[]; instructions: string; inputRefs: string[]; outputRequirement: string; maxVisits: number; join: 'all' | 'any'; condition?: { source: string; contains: string }; ports?: { id: string; label: string }[] }
export interface FlowEdge { id: string; from: string; to: string; port?: string; label: string; loop?: boolean; maxTraversals: number }
export interface Graph { nodes: FlowNode[]; edges: FlowEdge[]; maxSteps: number; maxMinutes: number; maxTokens: number }
export interface FlowVersion { id: string; number: number; createdAt: number; graph: Graph }
export interface Workflow { editorView?:'canvas'|'list'; id: string; name: string; draft: Graph; viewport: {x:number;y:number;zoom:number}; versions: FlowVersion[]; archived: boolean; updatedAt: number }
export interface DiscussionEntry { id: string; at: number; author: string; kind: 'message'|'decision'|'instruction'|'handoff'; text: string; runId?: string }
export interface TeamTask { id: string; title: string; goal: string; acceptance: string; workflowId?: string; ownerId?: string; status: string; entries: DiscussionEntry[]; createdAt: number; sourceConversationId?: string }
export type TeamRunStatus = 'ready'|'running'|'pausing'|'paused'|'waiting_user'|'uncertain'|'failed'|'cancelled'|'completed';
/**
 * routeLog：这次尝试里，每位成员实际用过哪几条路由，以及那一条是失败还是做完。
 *
 * 中途换过人之后，成员记录上只剩最后那条路由。没有这份流水，观测会把整段成绩
 * 记到接手的那条路由头上，失败的那条反而干干净净 —— 记分表从此是错的。
 */
export interface RouteAttempt { memberId:string; profileId:string; model:string; at:number; status:'failed'|'done' }
export interface NodeAttempt { routeLog?:RouteAttempt[]; memberStates?:Record<string,RunState>; memberOutputs?:Record<string,string>; resolution?:string; id: string; nodeId: string; visit: number; status: 'running'|'completed'|'failed'|'uncertain'|'waiting_user'; startedAt: number; endedAt?: number; output: string; steps: ToolStep[]; state?: RunState; error?: string; outcome?: string }
export interface RunEvent { approved?:boolean; id: string; at: number; kind: string; text: string; nodeId?: string }
export interface TeamRun { approvalQueue?:{nodeId:string;text:string}[]; projectSettings:TeamProject["settings"]; memorySnapshot:MemoryEntry[]; reservations:Record<string,number>; id: string; taskId: string; workflowId: string; version: FlowVersion; members: Member[]; config: GenerationConfig; status: TeamRunStatus; goal: string; acceptance: string; queue: string[]; arrivals: Record<string,string[]>; visits: Record<string,number>; traversals: Record<string,number>; attempts: NodeAttempt[]; events: RunEvent[]; tokens: number; createdAt: number; updatedAt: number; owner?: string; pendingApproval?: { nodeId:string; text:string }; scheduleKey?: string; memoryIds: string[] }
export interface MemoryEntry { id: string; title: string; text: string; applicability: string; evidence: string; status: 'candidate'|'validated'|'adopted'|'invalid'; revision: number; history: {at:number;text:string;status:string}[]; sourceRunId?: string }
export interface TeamSchedule { id:string; name:string; workflowId:string; versionId:string; goal:string; acceptance:string; timezone:string; hour:number; minute:number; catchUp:boolean; overlap:'skip'|'queue'; enabled:boolean; nextAt:number; triggers:{key:string;at:number;runId?:string;reason?:string}[] }
export interface FileChange { path:string; beforeHash:string|null; afterHash:string|null; status:string }
export interface FileSession { recoveryRequired?:boolean; recoveryReason?:string; id:string; taskId:string; memberId:string; root:string; isolatedRoot:string; status:'isolated'|'pending'|'conflict'|'merged'; files:FileChange[]; createdAt:number }
export interface TeamProject { drafts?:{member?:Member;task?:TeamTask;memory?:MemoryEntry;schedule?:TeamSchedule;message?:string}; id:string; members:Member[]; workflows:Workflow[]; tasks:TeamTask[]; runs:TeamRun[]; memories:MemoryEntry[]; schedules:TeamSchedule[]; files:FileSession[]; preferences:{mode:'single'|'team';page:string;workflowId?:string;taskId?:string;runId?:string;draft:string}; settings:{roots:string[];allowedConnections:string[];maxConcurrent:number;maxTokens:number;maxMinutes:number;approvalMode:'ask'|'auto'|'all'} }
export interface CollaborationData { schemaVersion:1; revision:number; updatedAt:number; projects:Record<string,TeamProject> }
export function emptyTeamProject(id:string):TeamProject { return {id,members:[],workflows:[],tasks:[],runs:[],memories:[],schedules:[],files:[],preferences:{mode:'single',page:'overview',draft:''},settings:{roots:[],allowedConnections:[],maxConcurrent:1,maxTokens:100000,maxMinutes:60,approvalMode:'ask'}}; }
export function newNode(type:NodeKind,x=100,y=100):FlowNode { return {id:uid('node'),type,title:nodeLabels[type],x,y,instructions:'',inputRefs:[],outputRequirement:'',maxVisits:3,
 join:'all',ports: type==='condition'||type==='review'||type==='approval' ? [{id:'pass',label:'通过'},{id:'fail',label:'不通过'},{id:'default',label:'其他'}] : [{id:'next',label:'继续'}]}; }
export const nodeLabels: Record<NodeKind,string> = {
 start:'输入 / 开始',
 agent:'Agent 执行',
 discussion:'讨论 / 决策',
 condition:'条件',
 parallel:'并行',
 join:'汇合',
 review:'质检',
 approval:'人工确认',
 handoff:'交接',
 end:'结束'};
export function newWorkflow(name='新 Workflow'):Workflow { const start=newNode('start',70,150),end=newNode('end',430,150); return {id:uid('flow'),name,draft:{nodes:[start,end],edges:[],maxSteps:50,maxMinutes:30,maxTokens:50000},viewport:{x:0,y:0,zoom:1},versions:[],archived:false,updatedAt:Date.now()}; }
export interface FlowIssue { severity:'error'|'warning'; message:string; nodeId?:string; edgeId?:string }
/** Cycles are valid, provided bounded traversal and a reachable exit exist. */
export function validateGraph(graph:Graph,members:Member[],allowedConnections?:string[]):FlowIssue[] {
 const out:FlowIssue[]=[]; const error=(message:string,nodeId?:string,edgeId?:string)=>out.push({severity:'error',message,nodeId,edgeId});
 const ids=new Set(graph.nodes.map(n=>n.id));
 if(ids.size!==graph.nodes.length)error('节点 ID 重复');
 const starts=graph.nodes.filter(n=>n.type==='start'),ends=graph.nodes.filter(n=>n.type==='end');
 if(!starts.length)error('需要开始节点'); if(!ends.length)error('需要结束节点');
 if(!Number.isInteger(graph.maxSteps)||graph.maxSteps<1||graph.maxSteps>10000)error('总步骤上限需为 1–10000');
 if(!Number.isFinite(graph.maxMinutes)||graph.maxMinutes<=0)error('需要总时间上限');
 if(!Number.isFinite(graph.maxTokens)||graph.maxTokens<=0)error('需要总用量上限');
 for(const edge of graph.edges){ if(!ids.has(edge.from)||!ids.has(edge.to))error('连线引用的节点不存在',undefined,edge.id); if(edge.loop&&(!Number.isInteger(edge.maxTraversals)||edge.maxTraversals<1))error('回路需要次数上限',edge.from,edge.id); }
 const reach=(seeds:string[],reverse=false)=>{const seen=new Set(seeds),q=[...seeds];while(q.length){const id=q.shift()!;for(const e of graph.edges){if((reverse?e.to:e.from)!==id)continue;const next=reverse?e.from:e.to;if(!seen.has(next)){seen.add(next);q.push(next);}}}return seen;};
 const reachable=reach(starts.map(n=>n.id)),exits=reach(ends.map(n=>n.id),true);
 for(const n of graph.nodes){
  if(!reachable.has(n.id))error('节点无法从开始到达',n.id); if(!exits.has(n.id))error('节点没有通向结束的退出路径',n.id);
  if(!Number.isInteger(n.maxVisits)||n.maxVisits<1)error('需要节点执行次数上限',n.id);
  if(['agent','review','handoff','discussion'].includes(n.type)){
   const selected=n.type==='discussion'?(n.participants??[]):[n.memberId];
   if(!selected.length)error('请选择讨论参与者',n.id);
   for(const id of selected){const member=members.find(m=>m.id===id);if(!member?.enabled)error('成员未配置或已停用',n.id);else if(!member.connectionId||!member.model||(allowedConnections?.length&&!allowedConnections.includes(member.connectionId)))error('成员没有允许的模型接入',n.id);}
   if(!n.instructions.trim())error('需要步骤指令',n.id);
   if(['agent','review'].includes(n.type)&&!n.outputRequirement.trim())error('需要输出或验收要求',n.id);
  }
  for(const ref of n.inputRefs)if(!ids.has(ref))error('输入引用不存在',n.id);
  const edges=graph.edges.filter(e=>e.from===n.id);
  if(n.type==='end'&&edges.length)error('结束节点不能继续派发；返工请连接条件或质检节点',n.id);
  if(n.type!=='end'&&!edges.length)error('节点缺少后继',n.id);
  if(['condition','review','approval'].includes(n.type))for(const port of ['pass','fail','default'])if(!edges.some(e=>e.port===port))error('需要通过、不通过及其他结果去向',n.id);
  if(n.type==='condition'&&(!n.condition?.source||!ids.has(n.condition.source)||!n.condition.contains))error('条件需要来源节点和匹配文字',n.id);
  if(n.type==='parallel'&&!graph.nodes.some(j=>j.type==='join'&&reach([n.id]).has(j.id)))error('并行分支需要汇合节点',n.id);
  if(n.type==='end'&&!n.outputRequirement.trim())error('结束节点需要交付要求',n.id);
 }
 return out;
}
export function teamBridge(){const bridge=desktop();if(!bridge?.collaborationRead)throw new Error('协作空间需要桌面版的本地存储');return bridge;}
export async function loadCollaboration():Promise<CollaborationData>{return teamBridge().collaborationRead();}

/* ------------------------------------------------------------------ *
 * 配置模板的导入
 *
 * 导出一直都有，导入没有 —— 于是一套跑通的流程没法在另一台机器、另一个项目
 * 重来一遍，只能照着截图重新点一遍。
 *
 * 三条刻意的规矩：
 *   1. 全部换新编号。模板是拿来复制的，不是拿来覆盖现有配置的：同名同 id
 *      直接盖掉别人正在用的成员，是这类功能最容易造成的事故。
 *   2. 导入的成员一律先停用。模板里的模型 ID 和凭据是另一台机器上的，
 *      直接可运行等于替用户决定了用哪条路由花谁的钱。
 *   3. 不导入运行记录、任务、经验和文件。它们是证据，不是配置。
 * ------------------------------------------------------------------ */
export const TEMPLATE_FORMAT='wickrunAI-project-template';
export function importTemplate(raw:unknown,newId:(prefix:string)=>string=uid):{members:Member[];workflows:Workflow[]}{
 const data=raw as {format?:string;version?:number;members?:Member[];workflows?:Workflow[]};
 if(!data||data.format!==TEMPLATE_FORMAT||data.version!==1||!Array.isArray(data.members)||!Array.isArray(data.workflows))throw Error('这不是 wickrunAI 的成员与流程配置模板');
 const memberIds=new Map<string,string>();
 const members=data.members.map(m=>{
  if(!m||typeof m.name!=='string'||!m.name.trim())throw Error('模板里的成员缺少名称');
  const id=newId('member');memberIds.set(m.id,id);
  return {...m,id,enabled:false,tools:Array.isArray(m.tools)?m.tools:[],
   maxTokens:Number.isFinite(m.maxTokens)&&m.maxTokens>0?m.maxTokens:30000,
   maxMinutes:Number.isFinite(m.maxMinutes)&&m.maxMinutes>0?m.maxMinutes:20};
 });
 const remapGraph=(graph:Graph):Graph=>{
  const nodeIds=new Map(graph.nodes.map(n=>[n.id,newId('node')]));
  return {...graph,
   nodes:graph.nodes.map(n=>({...n,id:nodeIds.get(n.id)!,
    memberId:n.memberId?memberIds.get(n.memberId):undefined,
    participants:n.participants?.map(x=>memberIds.get(x)!).filter(Boolean),
    inputRefs:(n.inputRefs??[]).map(x=>nodeIds.get(x)!).filter(Boolean),
    condition:n.condition?{...n.condition,source:nodeIds.get(n.condition.source)??n.condition.source}:undefined})),
   edges:graph.edges.map(e=>({...e,id:newId('edge'),from:nodeIds.get(e.from)!,to:nodeIds.get(e.to)!}))};
 };
 const workflows=data.workflows.map(f=>{
  if(!f?.draft?.nodes?.length)throw Error('模板里的流程缺少节点');
  return {...f,id:newId('flow'),name:f.name||'导入的流程',archived:false,updatedAt:Date.now(),
   viewport:f.viewport??{x:0,y:0,zoom:1},
   draft:remapGraph(f.draft),
   // 版本是「当时跑的是这一份」的证据，换了编号就不是原来那份了；导入后重新保存版本
   versions:[]};
 });
 return {members,workflows};
}
