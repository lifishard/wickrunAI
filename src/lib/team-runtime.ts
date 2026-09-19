import type { AppSettings, ToolStep, RunState, GenerationConfig } from '../types';
import { runAgent, type AgentHandle } from './agent';
import { uid, secretGet, toolContextOf } from './store';
import { TOOL_BY_NAME } from './tools/registry';
import { runtimePolicy } from './task-context';
import { goalDemands } from './harness';
import { observeTeamRun } from './team-observations';
import { loadSkills, skillSystemBlock, type Skill } from './skills';
import { projectSystemBlock, type Project } from './projects';
import { recallFrom } from './recall';
import { loadRuns } from './runs';
import { observationSnapshot } from './observations';
import { limitKey, mergeLearnedLimit, type LearnedLimit } from './limits';
import { nextRoute, resolveFailover, type RouteRef } from './failover';
import type { ErrorInfo } from '../types';
import { emptyTeamProject, loadCollaboration, teamBridge, validateGraph, type CollaborationData, type TeamProject, type TeamRun, type Member, type FlowNode, type FlowVersion } from './collaboration';
import { tr } from './i18n';

type Listener = () => void;
export class TeamRuntime {
 data: CollaborationData | null = null;
 error: string | null = null;
  saving = 0;
 private listeners = new Set<Listener>();
 private serial: Promise<unknown> = Promise.resolve();
 private running = new Map<string, {stop:boolean; handles:Set<AgentHandle>}>();
 private approvals = new Map<string,(ok:boolean)=>void>();
 settings: () => AppSettings | null = () => null;
 /** 项目规范与文档跟单人对话用同一份，成员不该比对话少知道项目的约定 */
 projects: () => Project[] = () => [];
 /**
  * 学到的限速与窗口要能写回去。
  *
  * 之前成员既读不到 limits.ts 学过的节奏，也不回写自己撞出来的 —— 跟 2.3.15 修好的
  * 子代理漏桶是同一个 bug，只是换了一条支路。
  */
 saveSettings: ((update:(prev:AppSettings)=>AppSettings)=>void) | null = null;
  schedulingPaused=false;
 private ticking=false;
 async tick(now=Date.now()){
  if(this.ticking||this.schedulingPaused||!this.data||!this.settings())return;
  this.ticking=true;
  try{for(const original of Object.values(this.data.projects)){
   for(const s of original.schedules.filter(s=>s.enabled)){
    if(s.nextAt&&s.nextAt<=now){
     const day=new Intl.DateTimeFormat('en-CA',{timeZone:s.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(s.nextAt);
     const key=`${s.id}:${day}`;
     await this.update(original.id,p=>{const item=p.schedules.find(x=>x.id===s.id)!;if(!item.enabled||item.nextAt>now)return;item.nextAt=nextTeamTrigger(item.timezone,item.hour,item.minute,now);if(item.triggers.some(t=>t.key===key))return;const busy=p.runs.some(r=>['ready','running','pausing','waiting_user'].includes(r.status)&&r.workflowId===s.workflowId);const reason=!item.catchUp&&now-s.nextAt>60000?'设备关闭期间错过，按规则跳过':busy&&item.overlap==='skip'?'前次运行未结束，按规则跳过':'准备运行';item.triggers.push({key,at:s.nextAt,reason});});
    }
    const pending=this.project(original.id).schedules.find(x=>x.id===s.id)?.triggers.filter(t=>t.reason==='准备运行'||(t.runId&&this.project(original.id).runs.some(r=>r.id===t.runId&&r.status==='ready')))??[];
    for(const trigger of pending){
     try{
      const taskId='scheduled-'+trigger.key;
      await this.update(original.id,p=>{if(!p.tasks.some(t=>t.id===taskId))p.tasks.push({id:taskId,title:s.name,goal:s.goal,acceptance:s.acceptance,workflowId:s.workflowId,status:'待开始',entries:[],createdAt:trigger.at});});
      let run=this.project(original.id).runs.find(r=>r.scheduleKey===trigger.key);
      if(!run){const id=await this.createRun(original.id,taskId,s.workflowId,s.versionId,this.settings()!.defaultConfig,trigger.key);run=this.project(original.id).runs.find(r=>r.id===id)!;}
      const runId=run.id;
      await this.update(original.id,p=>{const t=p.schedules.find(x=>x.id===s.id)!.triggers.find(t=>t.key===trigger.key)!;t.runId=runId;t.reason=undefined;});
      if(run.status==='ready')void this.start(original.id,runId).catch(error=>{this.error=String(error);this.emit();});
     }catch(error){await this.update(original.id,p=>{const t=p.schedules.find(x=>x.id===s.id)!.triggers.find(t=>t.key===trigger.key)!;t.reason=tr('需要处理：{error}',{error:String(error)});});}
    }
   }
  }}catch(error){this.error=String(error);this.emit();}finally{this.ticking=false;}
 }
 async pauseAll(){this.schedulingPaused=true;for(const p of Object.values(this.data?.projects??{}))for(const r of p.runs)if(this.running.has(r.id))await this.pause(p.id,r.id);await this.serial;}
  subscribe = (listener:Listener) => {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};};
 private emit(){for(const fn of this.listeners)fn();}
 async load(){try{this.data=await loadCollaboration();this.error=null;}catch(error){this.error=String(error);}this.emit();}
 project(id:string){return this.data?.projects[id] ?? emptyTeamProject(id);}
 /** Mutations are serialized and reapplied to a fresh revision after conflicts. */
 update(id:string,fn:(project:TeamProject)=>void):Promise<void>{
  this.saving++;this.emit();
  const work=this.serial.then(async()=>{
   if(!this.data)throw Error(tr('协作数据尚未读取'));
   for(let attempt=0;attempt<2;attempt++){
    const p=structuredClone(this.project(id));fn(p);
    try{this.data=await teamBridge().collaborationUpdate(this.data.revision,p);this.error=null;return;}
    catch(error){if(attempt===0&&String(error).includes('已有更新')){this.data=await loadCollaboration();continue;}throw error;}
   }
  }).catch(error=>{this.error=String(error);throw error;}).finally(()=>{this.saving--;this.emit();});
  this.serial=work.catch(()=>{});return work;
 }
 async runUpdate(projectId:string,runId:string,fn:(run:TeamRun,project:TeamProject)=>void){await this.update(projectId,p=>{const r=p.runs.find(x=>x.id===runId);if(!r)throw Error(tr('运行不存在'));fn(r,p);r.updatedAt=Date.now();const task=p.tasks.find(t=>t.id===r.taskId);if(task)task.status=({ready:"待开始",running:"运行中",pausing:"正在暂停",paused:"已暂停",waiting_user:"等待用户",uncertain:"待核实",failed:"失败",cancelled:"已取消",completed:"已完成"})[r.status];});}
 async createRun(projectId:string,taskId:string,workflowId:string,versionId:string,config:GenerationConfig,scheduleKey?:string){
  const id=uid('teamrun');
  await this.update(projectId,p=>{
   if(scheduleKey&&p.runs.some(r=>r.scheduleKey===scheduleKey))throw Error(tr('此触发已创建运行'));
   const task=p.tasks.find(t=>t.id===taskId),flow=p.workflows.find(f=>f.id===workflowId),version=flow?.versions.find(v=>v.id===versionId);
   if(!task?.goal.trim()||!task.acceptance.trim()||!version||flow?.archived)throw Error(tr('需要任务目标、验收标准和可用流程版本'));
   const errors=validateGraph(version.graph,p.members,p.settings.allowedConnections).filter(x=>x.severity==='error');if(errors.length)throw Error(errors[0].message);
   const usedIds=new Set(version.graph.nodes.flatMap(n=>[n.memberId,...(n.participants??[])].filter(Boolean)));
   const members=p.members.filter(m=>usedIds.has(m.id));
   if(version.graph.maxTokens>p.settings.maxTokens||version.graph.maxMinutes>p.settings.maxMinutes)throw Error(tr('流程预算超过项目上限'));
   const now=Date.now();
   p.runs.push({projectSettings:structuredClone(p.settings),memorySnapshot:structuredClone(p.memories.filter(m=>m.status==='adopted')),reservations:{},id,taskId,workflowId,version:structuredClone(version),members:structuredClone(members),config:structuredClone(config),goal:task.goal,acceptance:task.acceptance,status:'ready',queue:version.graph.nodes.filter(n=>n.type==='start').map(n=>n.id),arrivals:{},visits:{},traversals:{},attempts:[],events:[{id:uid(),at:now,kind:'created',text:`已固定版本 ${version.number}、成员及输入快照`}],tokens:0,createdAt:now,updatedAt:now,scheduleKey,memoryIds:p.memories.filter(m=>m.status==='adopted').map(m=>`${m.id}@${m.revision}`)});
   task.status='待开始';
  });return id;
 }
 async start(projectId:string,runId:string){
  if(this.running.has(runId))throw Error(tr('此运行已在执行'));
  await this.serial;
  this.data=await teamBridge().collaborationClaim(projectId,runId);this.emit();
  const control={stop:false,handles:new Set<AgentHandle>()};this.running.set(runId,control);
  try{
   await this.runUpdate(projectId,runId,(r,p)=>{const t=p.tasks.find(t=>t.id===r.taskId);if(t)t.status='运行中';});
   while(!control.stop){
    const r=this.project(projectId).runs.find(x=>x.id===runId)!;
    if(r.status!=='running')break;
    if(r.pendingApproval){await this.runUpdate(projectId,runId,run=>{run.status='waiting_user';});break;}
    const graph=r.version.graph;
    if(r.attempts.length>=graph.maxSteps||r.tokens>=graph.maxTokens||Date.now()-r.createdAt>graph.maxMinutes*60000){await this.pauseWith(projectId,runId,'已达到总步骤、用量或时间上限；换成员或重启不会清零');break;}
    if(!r.queue.length){await this.pauseWith(projectId,runId,'没有可执行步骤；请检查等待中的汇合或尚未完成的交付');break;}
    // The ready frontier can fan out; per-project policy controls actual parallel dispatch.
    const count=Math.max(1,r.projectSettings.maxConcurrent);
    const ready=[...new Set(r.queue)];
    const work=ready.filter(id=>graph.nodes.find(n=>n.id===id)?.type!=='end');
    const frontier=work.length?work.slice(0,count):ready;
    const results=await Promise.allSettled(frontier.map(async nodeId=>{try{await this.executeNode(projectId,runId,nodeId,control);}catch(error){
     const paused=control.stop; // 用户按了暂停/停止，不是这一步自己失败
     control.stop=true;for(const handle of control.handles)handle.abort();await teamBridge().toolAbort(runId);
     await this.runUpdate(projectId,runId,run=>{const a=[...run.attempts].reverse().find(a=>a.nodeId===nodeId&&a.status==='running');if(a){
      // 「被用户打断」和「这条路由干砸了」是两件事。混成 failed 会把人为中止算进路由的失败率。
      a.status=paused||a.state?.uncertainCallId?'uncertain':'failed';
      a.error=paused?tr('用户中止时这一步正在执行，结果需要核实：{error}',{error:String(error)}):String(error);
      a.endedAt=Date.now();}});throw error;}}));
    const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    const latest=this.project(projectId).runs.find(x=>x.id===runId)!;
    if(latest.pendingApproval){await this.runUpdate(projectId,runId,run=>{if(run.status==='running')run.status='waiting_user';});break;}
   }
  }catch(error){const current=this.project(projectId).runs.find(x=>x.id===runId);if(current?.status!=='cancelled')await this.pauseWith(projectId,runId,String(error),control.stop?'uncertain':'failed').catch(()=>{});}
  finally{this.running.delete(runId);this.observe(projectId,runId);this.emit();}
 }
 /**
  * 执行器的停机原因是按单人对话写的（「接着跑会开启下一阶段预算」）。
  * 协作空间里没有「接着跑」这个按钮，照搬过来等于告诉用户去点一个不存在的东西。
  */
 private teamHint(text:string){
  if(/剩余阶段预算不足|阶段轮次已到/.test(text))
   return `${text}\n${tr('在这里：填一句核实依据后点「核实并接着跑」，用新的一段预算从检查点继续；想一次跑完就先提高流程的总用量上限（以及项目设置里的每次运行上限），再新建运行。')}`;
  return text;
 }
 private async pauseWith(p:string,id:string,text:string,status:TeamRun['status']='paused'){
  const note=this.teamHint(text);
  await this.runUpdate(p,id,r=>{r.status=status;r.events.push({id:uid(),at:Date.now(),kind:status,text:note});});
  this.observe(p,id);
 }
 async pause(projectId:string,runId:string,cancel=false){
  const control=this.running.get(runId);if(control){control.stop=true;for(const handle of control.handles)handle.abort();}
  await teamBridge().toolAbort(runId);
  for(const [id,resolve] of this.approvals)if(id.startsWith(runId+':')){resolve(false);this.approvals.delete(id);}
  await this.runUpdate(projectId,runId,r=>{r.status=cancel?'cancelled':control?'pausing':'paused';r.events.push({id:uid(),at:Date.now(),kind:'pause',text:cancel?'用户停止运行，已有记录和产物保留':'停止派发后续步骤，等待当前操作核实'});});
 }
 async approve(projectId:string,runId:string,ok:boolean){
  const pending=this.project(projectId).runs.find(r=>r.id===runId)?.pendingApproval;if(!pending)return;
  if(pending.nodeId.startsWith('client:')){await teamBridge().clientApprove(pending.nodeId,ok);await this.load();return;}
  const resolver=this.approvals.get(runId+':'+pending.nodeId);
  if(resolver){resolver(ok);return;}
  const r=this.project(projectId).runs.find(x=>x.id===runId)!;
  if(r.status!=='waiting_user')throw Error('此确认请求已暂停或中断，请先恢复或核实');
  const n=r.version.graph.nodes.find(x=>x.id===pending.nodeId);if(!n)throw Error('此工具确认已过期，请先核实中断步骤');
  if(r.attempts.some(a=>a.status==='running'))throw Error('其他步骤仍在执行，等待它们到达检查点后再确认');
  if(n.type==='end'&&ok){
   const latest=new Map(r.attempts.map(a=>[a.nodeId,a]));
   if(r.queue.length||[...latest.values()].some(a=>a.nodeId!==n.id&&a.status!=='completed'&&!(a.status==='waiting_user'&&r.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='end')))throw Error('还有未完成或待核实的步骤，不能标记交付完成');
   if(!r.attempts.some(a=>a.nodeId!==n.id&&a.output.trim()))throw Error('缺少可供验收的结果');
  }
  await this.runUpdate(projectId,runId,run=>{const a=[...run.attempts].reverse().find(a=>a.nodeId===n.id&&a.status==='waiting_user');if(a){a.status='completed';a.outcome=ok?'pass':'fail';a.output=ok?'用户已确认':'用户拒绝';a.endedAt=Date.now();}run.approvalQueue=(run.approvalQueue??[]).filter(x=>x.nodeId!==n.id);run.pendingApproval=run.approvalQueue[0];run.status=run.pendingApproval?'waiting_user':'paused';this.route(run,n,ok?'pass':'fail');if(n.type==='end'&&ok&&!run.pendingApproval&&!run.attempts.some(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='end'&&a.outcome==='fail')){run.status='completed';run.queue=[];}run.events.push({id:uid(),at:Date.now(),kind:'approval',approved:ok,text:ok?'用户确认验收':'用户拒绝验收',nodeId:n.id});});
  this.observe(projectId,runId);
 }
 async resolveUncertain(projectId:string,runId:string,decision:'accept'|'retry',evidence:string){
  if(!evidence.trim())throw Error('请记录核实依据或重试范围');
  await this.runUpdate(projectId,runId,r=>{
   const latest=new Map(r.attempts.map(a=>[a.nodeId,a]));
   const uncertain=[...latest.values()].filter(a=>['uncertain','failed','running'].includes(a.status)&&!a.resolution);
   if(!uncertain.length)throw Error('没有尚未核实的步骤');
   const a=uncertain[0],n=r.version.graph.nodes.find(n=>n.id===a.nodeId)!;
   if(decision==='accept'){a.status='completed';a.output+='\n人工核实：'+evidence;this.route(r,n,'default');}
   else {a.status='failed';a.error='用户核实后批准重试：'+evidence;if(!r.queue.includes(n.id))r.queue.unshift(n.id);}
   a.resolution=decision+': '+evidence;
   r.approvalQueue=(r.approvalQueue??[]).filter(x=>x.nodeId!==a.id&&!x.nodeId.startsWith('client:'));r.pendingApproval=r.approvalQueue[0];
   r.status=uncertain.length>1?r.status:'paused';r.events.push({id:uid(),at:Date.now(),kind:'verified',text:evidence,nodeId:n.id});
  });
  this.observe(projectId,runId);
 }
 /**
  * 把这次运行的现状写进观测索引。
  *
  * 写失败只影响统计，不影响运行本身，所以这里吞掉错误、不等待 —— 观测是旁路，
  * 不能变成派活路上的一道闸门。
  */
 private observe(projectId:string,runId:string){
  const run=this.project(projectId).runs.find(r=>r.id===runId);
  if(run)void observeTeamRun(structuredClone(run)).catch(()=>{});
 }
 /**
  * 本机客户端成员的完成检查。
  *
  * 它在自己那边执行工具，wickrunAI 一条 ToolStep 都看不到，模型说「已完成」不构成证据。
  * 这边唯一能程序核对的是隔离区里的文件哈希。核不出来就交回给人核实（uncertain），
  * 不当成通过，也不当成失败 —— 说不清就是说不清。
  *
  * 判断只看这一步的指令和输出要求，不看整次运行的目标：顶层设计这种「不要改文件」的
  * 步骤，如果拿运行目标里的「修改」来判，每次都会被误判成没干活。
  */
 private async clientEvidenceIssue(projectId:string,runId:string,node:FlowNode,members:Member[]):Promise<string|undefined>{
  const clients=members.filter(m=>['client:codex','client:claude'].includes(m.connectionId));
  if(!clients.length)return;
  const demands=goalDemands(`${node.instructions}\n${node.outputRequirement}`);
  if(!demands.modify&&!demands.test&&!demands.push)return;
  let changed=0;
  for(const member of clients){
   const session=this.project(projectId).files.find(f=>f.taskId===runId&&f.memberId===member.id&&f.status!=='merged');
   if(!session)continue;
   try{
    const diff=await teamBridge().teamFilesDiff(session.id);
    await this.update(projectId,p=>{const i=p.files.findIndex(f=>f.id===diff.id);if(i<0)p.files.push(diff);else p.files[i]=diff;});
    changed+=diff.files.filter(f=>f.afterHash!==f.beforeHash).length;
   }catch(error){return tr('无法核对本机成员的隔离区文件变化：{error}',{error:String(error)});}
  }
  if(demands.modify&&!changed)return tr('这一步要求改动文件，但本机客户端的隔离区里没有任何文件变化。请核实它实际做了什么，再决定接受或重试。');
  return tr('这一步要求测试或推送。本机客户端在它自己那边执行，wickrunAI 看不到执行记录，无法程序核验；请核实后再决定。');
 }
 private route(r:TeamRun,n:FlowNode,outcome:string){
  const graph=r.version.graph;
  let edges=graph.edges.filter(e=>e.from===n.id);
  if(['condition','review','approval'].includes(n.type)){const matching=edges.filter(e=>e.port===outcome);edges=matching.length?matching:edges.filter(e=>e.port==='default');}
  for(const e of edges){
   const count=(r.traversals[e.id]??0)+1;
   if(e.maxTraversals>0&&count>e.maxTraversals){r.status='paused';r.events.push({id:uid(),at:Date.now(),kind:'limit',text:`连线「${e.label}」达到次数上限`,nodeId:n.id});continue;}
   r.traversals[e.id]=count;const next=graph.nodes.find(x=>x.id===e.to);if(!next)throw Error('后继节点不存在');
   const arrivals=r.arrivals[next.id]??[];if(!arrivals.includes(e.id))arrivals.push(e.id);r.arrivals[next.id]=arrivals;
   const incoming=graph.edges.filter(x=>x.to===next.id&&!x.loop);
   const ready=next.type!=='join'||next.join==='any'||incoming.every(x=>arrivals.includes(x.id));
   if(ready&&!r.queue.includes(next.id)){r.queue.push(next.id);r.arrivals[next.id]=[];}
  }
 }
 private async executeNode(projectId:string,runId:string,nodeId:string,control:{stop:boolean;handles:Set<AgentHandle>}){
  const r=this.project(projectId).runs.find(x=>x.id===runId)!,node=r.version.graph.nodes.find(n=>n.id===nodeId)!;
  const visit=(r.visits[nodeId]??0)+1;
  if(visit>node.maxVisits){await this.pauseWith(projectId,runId,`「${node.title}」达到执行次数上限`);control.stop=true;return;}
  const attemptId=uid('attempt');
  const prior=[...r.attempts].reverse().find(a=>a.nodeId===nodeId);
  const resumeAttempt=prior?.resolution?.startsWith('retry:')?prior:undefined;
  // Must finish durable attempted record BEFORE dispatching any model or external action.
  await this.runUpdate(projectId,runId,run=>{run.queue=run.queue.filter(id=>id!==nodeId);run.visits[nodeId]=visit;run.attempts.push({id:attemptId,nodeId,visit,status:'running',startedAt:Date.now(),output:'',steps:[],memberStates:structuredClone(resumeAttempt?.memberStates??{}),memberOutputs:structuredClone(resumeAttempt?.memberOutputs??{})});run.events.push({id:uid(),at:Date.now(),kind:'start',nodeId,text:`${node.title} · 第 ${visit} 次`});});
  const finish=async(output:string,outcome='next')=>this.runUpdate(projectId,runId,(run,p)=>{const a=run.attempts.find(x=>x.id===attemptId)!;a.status='completed';a.output=output;a.outcome=outcome;a.endedAt=Date.now();this.route(run,node,outcome);const task=p.tasks.find(t=>t.id===run.taskId);if(task&&['discussion','handoff','review','agent'].includes(node.type))task.entries.push({id:uid(),at:Date.now(),author:node.title,kind:node.type==='discussion'?'decision':node.type==='handoff'?'handoff':'message',text:output,runId});});
  if(node.type==='approval'||node.type==='end'){
   await this.runUpdate(projectId,runId,run=>{run.attempts.find(a=>a.id===attemptId)!.status='waiting_user';const item={nodeId,text:node.type==='end'?`验收交付：${node.outputRequirement}\n任务验收：${run.acceptance}`:node.instructions||node.title};run.approvalQueue=[...(run.approvalQueue??[]),item];run.pendingApproval=run.approvalQueue[0];});return;
  }
  if(node.type==='condition'){const source=[...r.attempts].reverse().find(a=>a.nodeId===node.condition?.source&&a.status==='completed');const outcome=!source?'default':source.output.includes(node.condition?.contains??'')?'pass':'fail';await finish(`条件结果：${outcome}`,outcome);return;}
  if(['start','parallel','join'].includes(node.type)){await finish(node.type==='start'?r.goal:'依赖已满足');return;}
  const members=node.type==='discussion'?(node.participants??[]).map(id=>r.members.find(m=>m.id===id)!):[r.members.find(m=>m.id===node.memberId)!];
  const output:string[]=[];
  for(const member of members){if(control.stop)break;let text=resumeAttempt?.memberOutputs?.[member.id];if(text===undefined){text=await this.runMemberWithFailover(projectId,runId,attemptId,node,member,output.join('\n\n'),control);const saved=text;await this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(x=>x.id===attemptId)!;(a.memberOutputs??={})[member.id]=saved;});}output.push(`${member.name}\n${text}`);}
  if(control.stop){await this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(x=>x.id===attemptId)!;if(a.status==='running')a.status='uncertain';if(run.status!=='cancelled')run.status='uncertain';});return;}
  const text=output.join('\n\n');
  // A reviewer must provide a structured verdict and evidence; unknown results route explicitly.
  let outcome='next';
  if(node.type==='review'){try{const raw=text.slice(text.indexOf('{'),text.lastIndexOf('}')+1);const v=JSON.parse(raw);outcome=v.evidence&&v.verdict==='pass'?'pass':v.evidence&&v.verdict==='fail'?'fail':'default';}catch{outcome='default';}}
  if(['agent','handoff'].includes(node.type)){
   const issue=await this.clientEvidenceIssue(projectId,runId,node,members);
   if(issue){
    await this.runUpdate(projectId,runId,run=>{
     const a=run.attempts.find(x=>x.id===attemptId)!;a.status='uncertain';a.output=text;a.error=issue;a.endedAt=Date.now();
     if(['running','pausing'].includes(run.status))run.status='uncertain';
     run.events.push({id:uid(),at:Date.now(),kind:'uncertain',text:issue,nodeId:node.id});
    });
    this.observe(projectId,runId);return;
   }
  }
  await finish(text,outcome);
  this.observe(projectId,runId);
 }
 /**
  * 成员失灵就按名单交给下一位，进度不重来。
  *
  * 三件事分开（跟单人对话同一套）：**名单是用户排的**，程序不挑、不打分；
  * **换不换**由 errors.ts 的归类决定，说不清的错误留在原地；
  * **怎么换**由这里执行 —— 检查点按成员 id 存着，接手的那位从断点续，
  * 已发生的副作用由幂等键账本兜底，不重复执行。
  *
  * 本机订阅客户端不参与：它的失败没有统一的错误归类，拿不准就不换。
  * 名单为空（用户没设）就是原来的行为，一点不变。
  */
 private async runMemberWithFailover(projectId:string,runId:string,attemptId:string,node:FlowNode,member:Member,discussion:string,control:{stop:boolean;handles:Set<AgentHandle>}):Promise<string>{
  const tried:RouteRef[]=[];
  let active=member;
  for(;;){
   const current:RouteRef={profileId:active.connectionId,model:active.model};
   try{
    const text=await this.runMember(projectId,runId,attemptId,node,active,discussion,control);
    await this.logRoute(projectId,runId,attemptId,member.id,current,'done');
    return text;
   }catch(error){
    await this.logRoute(projectId,runId,attemptId,member.id,current,'failed');
    const info=(error as {info?:ErrorInfo}).info;
    const settings=this.settings();
    const list=resolveFailover(active.failover,undefined,settings?.failover).config;
    const isClient=['client:codex','client:claude'].includes(active.connectionId);
    const decision=!control.stop&&info&&!isClient&&list.enabled
     ? nextRoute({current,order:list.routes??[],tried,health:settings?.modelHealth??{},info}):null;
    if(!decision)throw error;
    tried.push(current);
    // 成员快照是运行的审计基线，创建后不可改写（collaboration-store 会拒绝）。
    // 换人只活在这一次派发里，留痕走 routeLog 和运行事件。
    active={...active,connectionId:decision.route.profileId,model:decision.route.model};
    await this.runUpdate(projectId,runId,run=>{
     run.events.push({id:uid(),at:Date.now(),kind:'failover',nodeId:node.id,
      text:tr('{name}：{reason}，已按接力名单交给 {model} 接手，已有进度保留',{name:member.name,reason:tr(decision.reason),model:decision.route.model})});
    });
   }
  }
 }
 private async logRoute(projectId:string,runId:string,attemptId:string,memberId:string,route:RouteRef,status:'failed'|'done'){
  await this.runUpdate(projectId,runId,run=>{
   const a=run.attempts.find(x=>x.id===attemptId);if(!a)return;
   (a.routeLog??=[]).push({memberId,profileId:route.profileId,model:route.model,at:Date.now(),status});
  }).catch(()=>{});
 }
 private async runMember(projectId:string,runId:string,attemptId:string,node:FlowNode,member:Member,discussion:string,control:{stop:boolean;handles:Set<AgentHandle>}):Promise<string>{
  const settings=this.settings();if(!settings)throw Error('设置未就绪');
  const isClient=['client:codex','client:claude'].includes(member.connectionId);
  const profile=settings.keyProfiles.find(p=>p.id===member.connectionId);if(!profile&&!isClient)throw Error(`成员 ${member.name} 的连接已删除`);
  const key=profile?await secretGet(profile.id):null;if(!key&&!isClient)throw Error(`成员 ${member.name} 缺少 API Key`);
  const p=this.project(projectId),r=p.runs.find(x=>x.id===runId)!;
  let fileSessionId:string|undefined;
  let roots:string[]=[];
  if((isClient||member.tools.some(name=>['files','shell','agent'].includes(TOOL_BY_NAME[name]?.group??'')))&&r.projectSettings.roots.length){
   let session=p.files.find(f=>f.taskId===runId&&f.memberId===member.id&&f.status!=='merged');
   if(!session){session=await teamBridge().teamFilesCreate(projectId,runId,member.id,r.projectSettings.roots[0]);const created=session;await this.update(projectId,p=>{p.files.push(created);});}
   fileSessionId=session.id;roots=[session.isolatedRoot];
  }
  const chosen=member.skills?.length?(await loadSkills()).filter((x:Skill)=>x.enabled&&member.skills!.includes(x.name)):[];
  const sources=r.attempts.filter(a=>a.status==='completed'&&(node.inputRefs.length?node.inputRefs.includes(a.nodeId):true)).map(a=>`${a.nodeId} 第${a.visit}次\n${a.output}`).join('\n\n');
  const memories=r.memorySnapshot.map(m=>`${m.title}（${m.applicability}）\n${m.text}`).join('\n\n');
  const task=p.tasks.find(t=>t.id===r.taskId);
  // 隔离副本按设计排除了 .git 等目录。不先说，模型第一反应就是 git status，
  // 白烧一轮拿到退出码 128 —— 这一轮的上下文和预算都是真金白银。
  const isolationNote=fileSessionId?'\n注意：工作目录是这次运行的隔离副本，不含 .git / node_modules / dist / build / .next。git 命令在这里用不了，要看改动就直接读文件；改动稍后由用户在「文件与产物」里合并回主目录。':'';
  const prompt=`目标：${r.goal}\n验收：${r.acceptance}\n步骤：${node.instructions}\n输出要求：${node.outputRequirement}\n允许工作目录：${roots.join('、')||'无'}${isolationNote}\n前置记录：\n${sources}\n本轮讨论：\n${discussion}\n补充指令：\n${task?.entries.filter(e=>e.kind==='instruction'&&(e.author==='你 → 所有成员'||e.author==='你 → '+member.name)).map(e=>e.text).join('\n')??''}`;
  const resume=r.attempts.find(a=>a.id===attemptId)?.memberStates?.[member.id];
  let output=resume?.content??'',state:RunState|undefined=resume,usage=resume?.spentTokens??0,handle:AgentHandle|undefined;
  const persist=()=>this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(x=>x.id===attemptId)!;a.output=output;a.state=state;if(state)(a.memberStates??={})[member.id]=state;});
  const reservationKey=attemptId+':'+member.id;let remaining=0;
  await this.runUpdate(projectId,runId,run=>{
   const reserved=Object.values(run.reservations).reduce((sum,n)=>sum+n,0);
   const available=run.version.graph.maxTokens-run.tokens-reserved;
   if(available<512)throw Error('总用量预算不足，已停止派发');
   const slots=Math.max(1,run.projectSettings.maxConcurrent-Object.keys(run.reservations).length);
   remaining=Math.max(1,Math.min(member.maxTokens||available,Math.floor(available/slots)));
   run.reservations[reservationKey]=remaining;
  });
  const routeKeyOf=(profileId:string,model:string,baseUrl:string)=>limitKey(profileId,model,baseUrl);
  const learn=(profileId:string,model:string,baseUrl:string,value:LearnedLimit)=>this.saveSettings?.(prev=>({...prev,
    modelLimits:{...(prev.modelLimits??{}),[routeKeyOf(profileId,model,baseUrl)]:mergeLearnedLimit(prev.modelLimits?.[routeKeyOf(profileId,model,baseUrl)],value)}}));
  const config:GenerationConfig={...r.config,model:member.model,effortLevel:member.effort as GenerationConfig['effortLevel'],reasoningEffort:member.effort as GenerationConfig['reasoningEffort'],toolsEnabled:member.tools.length>0,enabledTools:member.tools,approvalMode:r.projectSettings.approvalMode,runtime:{...runtimePolicy(r.config),maxTokens:remaining,maxMinutes:Math.min(member.maxMinutes||30,r.version.graph.maxMinutes)}};
  if(isClient){
   const timer=setInterval(()=>void this.load(),600);
   try{
    const result=await teamBridge().clientRun({projectId,runId,attemptId,memberId:member.id,prompt:[
     projectSystemBlock(this.projects().find(x=>x.id===projectId)??null),
     `${node.type==='review'?'以 JSON 返回 {"verdict":"pass 或 fail","evidence":"具体检查证据","changes":"需要修改项"}。':''}\n成员职责：${member.instructions}\n项目经验：${memories}\n${prompt}`,
     skillSystemBlock(chosen),
    ].filter(Boolean).join('\n\n'),fileSessionId});
    await this.load();
    await this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(a=>a.id===attemptId)!;a.output=result.text??'';run.tokens+=run.reservations[reservationKey]??0;delete run.reservations[reservationKey];run.events.push({id:uid(),at:Date.now(),kind:'client_budget',nodeId:node.id,text:'订阅客户端未提供统一精确用量，已将本次预留额度保守计入总预算。'});});
    if(result.status!=='completed')throw Error(result.error||`本机客户端结果：${result.status}，请核实本次操作`);
    if(!result.text?.trim())throw Error('本机客户端没有返回可验收的结果');
    return result.text;
   }finally{clearInterval(timer);await this.runUpdate(projectId,runId,run=>{if(run.reservations[reservationKey]){run.tokens+=run.reservations[reservationKey];delete run.reservations[reservationKey];run.events.push({id:uid(),at:Date.now(),kind:'client_budget',text:'订阅请求中断，预留用量暂按已用计入，等待核实。'});}});}
  }
  return new Promise<string>((resolve,reject)=>{
   let ended=false;
   let failure:ErrorInfo|undefined;
   const end=(error?:string)=>{if(ended)return;ended=true;if(handle)control.handles.delete(handle);void persist().then(()=>this.runUpdate(projectId,runId,run=>{delete run.reservations[reservationKey];})).then(()=>{
    if(!error)return resolve(output);
    // 把归类带出去：换不换人由 failover.ts 按这个判断，这里只负责不把它丢掉
    const thrown=Object.assign(Error(error),{info:failure});reject(thrown);
   }).catch(reject);};
   const confirm=async(step:ToolStep)=>{
    if(control.stop)return false;
    if(config.approvalMode==='all')return true;
    if(config.approvalMode==='auto'&&!['shell','agent'].includes(TOOL_BY_NAME[step.name]?.group??''))return true;
    await this.runUpdate(projectId,runId,run=>{const item={nodeId:attemptId,text:`${member.name} 请求 ${step.name}\n${JSON.stringify(step.args,null,2)}`};run.approvalQueue=[...(run.approvalQueue??[]),item];run.pendingApproval=run.approvalQueue[0];});
    return new Promise<boolean>((res)=>{this.approvals.set(runId+':'+attemptId,ok=>{this.approvals.delete(runId+':'+attemptId);void this.runUpdate(projectId,runId,run=>{run.approvalQueue=(run.approvalQueue??[]).filter(x=>x.nodeId!==attemptId);run.pendingApproval=run.approvalQueue[0];run.events.push({id:uid(),at:Date.now(),kind:'permission',text:`${member.name} 的 ${step.name}：${ok?'批准':'拒绝'}`,nodeId:node.id});}).then(()=>res(ok)).catch(()=>res(false));});});
   };
   handle=runAgent({resume,resolveUncertain:resume?'retry':undefined,requestId:uid('teamrequest'),profile:profile!,apiKey:key!,config,
    // 任务消息的 id 必须跨派发稳定。
    //
    // 原来每次派发都新生成一个 uid：第一次能登记验收条目（sourceId 指向当时那条消息），
    // 一旦续跑，检查点里记的 requirementSourceIds 还是旧 id，而这次的消息换了新 id，
    // 于是 update_requirements 永远报「要求必须引用真实用户消息 ID」——
    // 而在预算和轮次限制下，续跑几乎是必然的，等于协作空间里根本没法声明验收。
    history:[{id:`teamtask-${runId}-${node.id}-${member.id}`,role:'user',content:prompt,createdAt:Date.now()}],
    skills:chosen,
    modelInfo:[...(settings.cachedModels?.[member.connectionId]??[]),...(settings.customModels?.[member.connectionId]??[])].find(m=>m.id===member.model),
    limitOf:()=>this.settings()?.modelLimits?.[routeKeyOf(profile!.id,member.model,profile!.baseUrl)],
    onLearnLimit:value=>learn(profile!.id,member.model,profile!.baseUrl,value),
    limits:{get:(profileId,model,baseUrl)=>this.settings()?.modelLimits?.[routeKeyOf(profileId,model,baseUrl)],learn},
    // 默认零关联：成员想不起来时才显式查，而且只查同一个项目
    recallTasks:async(query,limit)=>recallFrom(await loadRuns(),await observationSnapshot(),{query,limit,projectId}),toolCtx:()=>({...toolContextOf(settings,projectId),teamExecution:{projectId,runId,attemptId,memberId:member.id,fileSessionId},workspaceRoots:roots,grants:{extraRoots:[],screen:false,admin:false}}),effortMappings:settings.effortMappings,extraSystem:[projectSystemBlock(this.projects().find(x=>x.id===projectId)??null),
    `你是项目成员 ${member.name}。\n${member.instructions}\n已采用项目经验：\n${memories}\n${node.type==='review'?'以 JSON 返回 {"verdict":"pass 或 fail","evidence":"具体检查证据","changes":"需要修改项"}。不得声称执行了没有执行的测试。':''}`,
    skillSystemBlock(chosen)].filter(Boolean).join('\n\n'),timeoutMs:settings.requestTimeoutMs,canRunHostTools:true,autoRetry:settings.autoRetry,confirm,grantAccess:async()=>({ok:false,content:'',error:'协作运行权限固定；请暂停后在项目设置调整并创建新运行。'}),events:{
    onContentDelta(text){output+=text;},onContentReplace(text){output=text;},onReasoningDelta(){},onSources(){},onRound(){},
    /*
     * 限流、重试、等待都走这条。原来这里是个空函数，于是运行详情页从头到尾只有一个
     * 「运行中」：模型在等 429 退避、等了几次、下一次什么时候，你一个字都看不到。
     * 传空串表示清掉。
     */
    onNotice:text=>{void this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(x=>x.id===attemptId);if(a){if(text)a.notice=`${member.name}：${text}`;else delete a.notice;}}).catch(()=>{});},
    onStopReason(){},
    onStep:step=>{void this.runUpdate(projectId,runId,run=>{const a=run.attempts.find(x=>x.id===attemptId)!;const i=a.steps.findIndex(s=>s.id===step.id);if(i<0)a.steps.push(step);else a.steps[i]=step;}).catch(()=>{control.stop=true;handle?.abort();});},
    onUsage:u=>{const next=u.total_tokens??(u.prompt_tokens??0)+(u.completion_tokens??0),delta=Math.max(0,next-usage);usage=next;void this.runUpdate(projectId,runId,run=>{run.tokens+=delta;if(run.reservations[reservationKey]!==undefined)run.reservations[reservationKey]=Math.max(0,run.reservations[reservationKey]-delta);}).catch(()=>{control.stop=true;handle?.abort();});},
    onRunState:async next=>{if(next){state=next;const nextTokens=next.spentTokens??0,delta=Math.max(0,nextTokens-usage);usage=Math.max(usage,nextTokens);if(delta)await this.runUpdate(projectId,runId,run=>{run.tokens+=delta;if(run.reservations[reservationKey]!==undefined)run.reservations[reservationKey]=Math.max(0,run.reservations[reservationKey]-delta);});}await persist();},onDone:()=>end(),onError:(message,info)=>{failure=info;end(message);},onPaused:reason=>{control.stop=true;end(reason);},
   }});control.handles.add(handle);
  });
 }
}
export const teamRuntime = new TeamRuntime();

/** Daily local wall-clock trigger in an explicit IANA zone, including DST transitions. */
export function nextTeamTrigger(timezone:string,hour:number,minute:number,after=Date.now()):number{
 if(!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)throw Error('时间无效');
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const start=Math.floor(after/60000)*60000+60000;
 for(let at=start;at<start+49*3600000;at+=60000){const p=fmt.formatToParts(at);if(Number(p.find(x=>x.type==='hour')?.value)===hour&&Number(p.find(x=>x.type==='minute')?.value)===minute)return at;}
 throw Error('无法计算下一次时间');
}
export function versionById(project:TeamProject,flowId:string,versionId:string):FlowVersion|undefined{return project.workflows.find(f=>f.id===flowId)?.versions.find(v=>v.id===versionId);}
