import type { TeamRun, NodeAttempt, FlowNode } from './collaboration';
import { mutateObservations, observationEvent, routeAliasOf, observationStore,
  type TaskObservation, type AttemptObservation } from './observations';
import { taskKind } from './harness';
import { APP_VERSION as appVersion } from './version';

/* ------------------------------------------------------------------ *
 * 协作空间的观测投影
 *
 * 在这之前，协作空间跑得再多，经验层看到的都是零：observeRun 只接 RunRecord，
 * 而协作运行存在 collaboration-v1.json 里，从来没有一条路径进过观测索引。
 * 路由记分、回归集、任务反馈因此全都对协作空间失明。
 *
 * 三条刻意的取舍：
 *
 * A. **来源分开记**。对话路径的完成有 ToolStep 和交付核验撑着，协作空间的完成是
 *    流程里的质检节点加人工确认，两者证据强度不同。所以每条记录带 source，
 *    记分默认只看对话路径，要看协作空间得显式切过去 —— 混着算等于自欺。
 *
 * B. **人工验收才是判据**。质检节点的 JSON 裁决是模型自评，不能当成做成。
 *    能算数的只有人在结束节点上点的那一下：批准 = 做成，拒绝 = 部分做成，
 *    失败或取消 = 没做成，跑到一半停着 = 说不清。
 *
 * C. **用量不按成员拆**。一次运行只有一个 tokens 合计，多成员时无法归因到某条路由；
 *    宁可标成「用量有缺口」不给成本数字，也不造一个看起来精确的假数。
 * ------------------------------------------------------------------ */

const RUN_STATUS:Record<string,string>={ready:'unknown',running:'running',pausing:'running',paused:'paused',
  waiting_user:'awaiting_user',uncertain:'paused',failed:'paused',cancelled:'paused',completed:'completed'};
const ATTEMPT_STATUS:Record<string,string>={running:'running',completed:'completed',failed:'paused',
  uncertain:'paused',waiting_user:'awaiting_user'};
/** 事件只记类别，不记正文 —— 目标、产出和报错都不进索引 */
const EVENT_KINDS=new Set(['created','start','pause','paused','failed','uncertain','cancelled','limit',
  'approval','permission','verified','client_budget','client_dispatch']);

export const teamRecordId=(runId:string)=>`team:${runId}`;

function membersOf(node:FlowNode|undefined):string[]{
  if(!node)return [];
  if(node.type==='discussion')return node.participants??[];
  return node.memberId?[node.memberId]:[];
}

export const routeKeyOf=(profileId:string,model:string)=>`${profileId}::${model}`;

function attemptRows(run:TeamRun,routes:Map<string,string>):{rows:AttemptObservation[];split:boolean;handedOff:boolean}{
  const rows:AttemptObservation[]=[];let split=false,handedOff=false;
  for(const a of run.attempts){
    const node=run.version.graph.nodes.find(n=>n.id===a.nodeId);
    const ids=membersOf(node);
    if(!ids.length)continue; // 开始 / 条件 / 汇合这些没有执行者的节点不占样本
    if(ids.length>1)split=true;
    for(const id of ids){
      const member=run.members.find(m=>m.id===id);
      // 中途换过路由的，每条实际用过的路由各记一行；失败的那条不能记成接手那条的成绩
      const log=(a.routeLog??[]).filter(x=>x.memberId===id);
      if(log.length>1)handedOff=true;
      const used=log.length?log.map(x=>({profileId:x.profileId,model:x.model,at:x.at,failed:x.status==='failed'}))
        :[{profileId:member?.connectionId??'unknown',model:member?.model??'unknown',at:a.endedAt??a.startedAt,failed:false}];
      used.forEach((route,i)=>rows.push({
        id:`${a.id}:${id}:${i}`,sourceId:`${a.id}:${id}:${i}`,startedAt:i?used[i-1].at:a.startedAt,lastAt:route.at,
        ...(route.failed||a.endedAt?{endedAt:route.at}:{}),
        model:route.model,effort:member?.effort||'unknown',route:routes.get(routeKeyOf(route.profileId,route.model))??'unknown',
        appVersion,runtimeVersion:'team',status:route.failed?'paused':ATTEMPT_STATUS[a.status]??'unknown',
        waitMs:0,humanWaitMs:0,
        // 一个节点由多位成员完成时，每位各花了多久拆不出来，宁可记 0（不参与中位数）也不平均分摊
        activeMs:ids.length===1?Math.max(0,route.at-(i?used[i-1].at:a.startedAt)):0,
        lastPhase:route.failed?'paused':ATTEMPT_STATUS[a.status]??'unknown',lastObservedAt:route.at,
      }));
    }
  }
  return {rows,split,handedOff};
}

function acceptanceOf(run:TeamRun){
  // API 成员的交付验收存在 attempt.state 里；本机客户端成员那边看不到，如实不计
  const latest=new Map<string,{revision:number;status?:string;method?:string}>();
  for(const a of run.attempts){
    const states=[a.state,...Object.values(a.memberStates??{})];
    for(const state of states)for(const r of state?.requirements??[]){
      const current=r.verification?.revision===r.revision?r.verification:undefined;
      const seen=latest.get(r.id);
      if(!seen||seen.revision<=r.revision)latest.set(r.id,{revision:r.revision,status:current?.status,method:current?.method});
    }
  }
  const all=[...latest.values()];
  return {coverage:all.length?'model_defined':'not_defined',total:all.length,
    passed:all.filter(v=>v.status==='passed').length,failed:all.filter(v=>v.status==='failed').length,
    unverifiable:all.filter(v=>v.status==='unverifiable').length,unchecked:all.filter(v=>!v.status).length,
    program:all.filter(v=>v.method==='program').length,model:all.filter(v=>v.method==='model').length};
}

function endVerdict(run:TeamRun):{outcome:'usable'|'partial'|'unresolved';at:number}|undefined{
  const ends=new Set(run.version.graph.nodes.filter(n=>n.type==='end').map(n=>n.id));
  const rejected=run.attempts.find((a:NodeAttempt)=>ends.has(a.nodeId)&&a.outcome==='fail');
  if(run.status==='completed')return {outcome:'usable',at:run.updatedAt};
  if(rejected)return {outcome:'partial',at:rejected.endedAt??run.updatedAt};
  if(['failed','cancelled'].includes(run.status))return {outcome:'unresolved',at:run.updatedAt};
  return undefined; // 还在跑、等确认或暂停的，既不算成功也不算失败
}

/** 纯投影：同一个 run 投影两次结果相同，正文、标题、路径和报错都不进索引。 */
export function projectTeamObservation(previous:TaskObservation|undefined,run:TeamRun,routes:Map<string,string>):TaskObservation{
  const {rows,split,handedOff}=attemptRows(run,routes);
  const steps=run.attempts.flatMap(a=>a.steps??[]);
  const verdict=endVerdict(run);
  const t:TaskObservation={
    id:previous?.id??globalThis.crypto.randomUUID(),
    source:'team',kind:taskKind(run.goal),
    recordId:teamRecordId(run.id),conversationId:`team:${run.taskId}`,answerId:run.id,
    startedAt:run.createdAt,lastAt:run.updatedAt,status:RUN_STATUS[run.status]??'unknown',
    appVersion,runtimeVersion:'team',
    acceptance:acceptanceOf(run),
    attempts:rows.slice(-100),droppedAttempts:Math.max(0,rows.length-100),
    events:[],nextSeq:0,droppedEvents:0,seenEvents:{},
    requests:{total:0,accepted:0,failed:0,rejected:0,cancelled:0,pending:0,actualInput:0,actualOutput:0,
      // 只有整次运行的合计，拆不到成员头上：标成缺口，成本一栏就不会出数字
      missingInput:1,missingOutput:1,estimatedInput:0,reservedOutput:0,requestMs:0,missingDispatch:0},
    tools:{total:steps.length,ok:steps.filter(s=>s.status==='ok').length,failed:steps.filter(s=>s.status==='error').length,
      denied:steps.filter(s=>s.status==='denied').length,elapsedMs:steps.reduce((n,s)=>n+(s.elapsedMs??0),0)},
    compactions:{total:0,latestBeforeTokens:null,latestAfterTokens:null},
    requirementStates:{},
    pauseCount:run.events.filter(e=>['pause','paused','failed','uncertain','limit'].includes(e.kind)).length,
    resumeCount:0,pauseReasons:{},supplements:0,recoveredWrites:0,
    missing:['协作空间只有整次运行的用量合计，无法按成员或路由拆分',
      ...(split?['同一步骤由多位成员完成，每位的耗时无法分离']:[]),
      ...(handedOff?['本次运行中途按名单换过路由；做成与否按整次运行计，换下来的那条也会计入这一次']:[])],
  };
  if(verdict)t.feedback={outcome:verdict.outcome,at:verdict.at,attemptId:t.attempts.at(-1)?.id};
  const first=t.attempts[0]?.id??'unknown';
  observationEvent(t,`team:${run.id}:created`,'task_started',run.createdAt,first,{members:run.members.length,nodes:run.version.graph.nodes.length,version:run.version.number});
  for(const a of run.attempts){
    const node=run.version.graph.nodes.find(n=>n.id===a.nodeId);
    observationEvent(t,`node:${a.id}`,'team_step',a.startedAt,`${a.id}:${membersOf(node)[0]??'none'}`,
      {node:node?.type??'unknown',visit:a.visit,status:a.status,outcome:a.outcome??'none',steps:(a.steps??[]).length});
  }
  for(const e of run.events)if(EVENT_KINDS.has(e.kind))
    observationEvent(t,`event:${e.id}`,'team_event',e.at,first,{kind:e.kind,...(typeof e.approved==='boolean'?{approved:e.approved}:{})});
  if(verdict)observationEvent(t,`verdict:${run.id}:${verdict.outcome}`,'user_feedback',verdict.at,t.attempts.at(-1)?.id??first,
    {outcome:verdict.outcome,reason:'none',from:'team_approval'});
  return t;
}

/**
 * 把一次协作运行写进观测索引。
 *
 * 路由别名和对话路径用同一套算法：模型 + 连接 + 路由键。这样 Claude Code 这个席位
 * 和它在单人对话里的成绩落在同一行，才比得了。
 */
export async function observeTeamRun(run:TeamRun):Promise<void>{
  const store=await observationStore();
  const routes=new Map<string,string>();
  const seen=[...run.members.map(m=>({profileId:m.connectionId,model:m.model})),
    ...run.attempts.flatMap(a=>(a.routeLog??[]).map(x=>({profileId:x.profileId,model:x.model})))];
  for(const route of seen){
    const key=routeKeyOf(route.profileId,route.model);
    if(!routes.has(key))routes.set(key,await routeAliasOf(route.model,route.profileId,'',store.epoch));
  }
  return mutateObservations(s=>{
    if(s.clearedAt&&run.createdAt<=s.clearedAt)return;
    const id=teamRecordId(run.id);
    if(s.ignoredRecordIds.includes(id))return;
    const index=s.tasks.findIndex(t=>t.recordId===id);
    const next=projectTeamObservation(s.tasks[index],run,routes);
    if(index<0)s.tasks.push(next);else s.tasks[index]=next;
  });
}
