import type { CollaborationData, TeamProject } from './collaboration';
import { assertPublicCollaboration, collaborationCall, workflowShareSeed, type SharedItem, type SharedSeed, type SharedView } from './shared-resources';
import { cloudCall } from './cloud-api';
import { getTransport } from './transport';

const KEY='wickrun:shared:workflow-bindings:v1';
export interface SharedWorkflowBinding {itemId:string;sourceId:string;accountId:string;lastRuns?:string;retryAt?:number}
type Storage={kvGet(key:string):Promise<string|null>;kvSet(key:string,value:string):Promise<void>};
type Services={storage:Storage;account:()=>Promise<string|null>;call:<T>(operation:string,input?:Record<string,unknown>)=>Promise<T>;now?:()=>number};
const defaults=():Services=>({storage:getTransport(),account:async()=>(await cloudCall<{user:{id:string}|null}>('status')).user?.id??null,call:collaborationCall});
let pendingWrites=Promise.resolve();
function serial<T>(work:()=>Promise<T>):Promise<T>{const task=pendingWrites.then(work);pendingWrites=task.then(()=>{},()=>{});return task;}
export async function registerSharedWorkflow(seed:SharedSeed,item:SharedItem):Promise<void> {
  if(seed.kind!=='workflow'||!seed.sourceId||item.kind!=='workflow')return;
  const io=defaults(),accountId=await io.account();if(!accountId||item.ownerId!==accountId)return;
  await serial(async()=>{
    const bindings=await readBindings(io.storage);
    const next=bindings.filter(b=>b.itemId!==item.id);
    next.push({itemId:item.id,sourceId:seed.sourceId!,accountId});
    await io.storage.kvSet(KEY,JSON.stringify(next));
  });
}
async function readBindings(storage:Storage):Promise<SharedWorkflowBinding[]> {
  const raw=await storage.kvGet(KEY);if(!raw)return [];
  const rows:unknown=JSON.parse(raw);if(!Array.isArray(rows))throw Error('共享流程关联记录无效。');
  return rows.filter((b):b is SharedWorkflowBinding=>!!b&&typeof b==='object'&&typeof b.itemId==='string'&&typeof b.sourceId==='string'&&typeof b.accountId==='string');
}
function safeTeam(team:TeamProject,excluded:Set<string>):TeamProject {
  const privateTasks=new Set(team.tasks.filter(t=>t.sourceConversationId&&excluded.has(t.sourceConversationId)).map(t=>t.id));
  return {...team,runs:team.runs.filter(r=>!privateTasks.has(r.taskId))};
}
/** Shared definitions stay authoritative; a local executor publishes only its selected run evidence. */
export async function syncSharedWorkflowRuns(data:CollaborationData,privateConversationIds:Iterable<string>=[],services?:Services):Promise<void> {
  return serial(async()=>{
  const io=services??defaults(),time=io.now?.()??Date.now();
  const bindings=await readBindings(io.storage);
  if(!bindings.length||bindings.every(b=>Number(b.retryAt)>time))return;
  const accountId=await io.account();if(!accountId)return;
  const excluded=new Set(privateConversationIds),failures:unknown[]=[];
  for(const binding of bindings){
    if(binding.accountId!==accountId||Number(binding.retryAt)>time)continue;
    try{
    const team=Object.values(data.projects).find(p=>p.workflows.some(w=>w.id===binding.sourceId));
    const workflow=team?.workflows.find(w=>w.id===binding.sourceId);if(!team||!workflow||workflow.archived)continue;
    const projection=workflowShareSeed(safeTeam(team,excluded),workflow);
    const localRuns=projection.payload.runs as Record<string,unknown>[],fingerprint=JSON.stringify(localRuns);
    if(fingerprint===binding.lastRuns)continue;
    const allLocalIds=new Set(team.runs.filter(r=>r.workflowId===workflow.id).map(r=>r.id));
    for(let attempt=0;attempt<2;attempt++){
      const remote=await io.call<SharedView>('get',{itemId:binding.itemId});
      if(remote.item.kind!=='workflow'||!(remote.permissions?.edit??['owner','admin','editor'].includes(remote.role)))throw Object.assign(Error('共享流程权限已撤销，未同步执行记录。'),{status:403});
      const others=(Array.isArray(remote.item.payload.runs)?remote.item.payload.runs:[]) as Record<string,unknown>[];
      const runs=[...others.filter(r=>!allLocalIds.has(String(r.id))),...localRuns].sort((a,b)=>Number(a.createdAt)-Number(b.createdAt)).slice(-200);
      const payload={...remote.item.payload,runs};assertPublicCollaboration(payload);
      if(JSON.stringify(remote.item.payload.runs??[])===JSON.stringify(runs))break;
      try{await io.call('update',{itemId:binding.itemId,expectedRevision:remote.item.revision,payload});break;}
      catch(error){if(attempt===1||(error as {status?:number}).status!==409)throw error;}
    }
    binding.lastRuns=fingerprint;
    delete binding.retryAt;
    }catch(error){
      // Recheck revoked access later without repeatedly requesting or reporting it.
      if([403,404,429].includes((error as {status?:number}).status??0))binding.retryAt=time+300000;
      failures.push(error);
    }
  }
  await io.storage.kvSet(KEY,JSON.stringify(bindings));
  if(failures.length)throw failures[0];
  });
}
