import { getTransport, desktop } from './transport';
import { observationStore, reloadCloudObservations } from './observations';
import type { CloudLocal, CloudRow } from './cloud-data';
const PENDING='wickrun:cloud:pending-apply:v1';
const KEYS=['snc:settings:v1','snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','anyai:observations:v1','wickrun:cloud:archives:v1'];

/** An interrupted local apply restores its saved source before normal app startup. */
export async function recoverCloudApply():Promise<void> {
  const transport=getTransport(), raw=await transport.kvGet(PENDING);
  if(!raw || raw==='null')return;
  const backup=JSON.parse(raw) as Record<string,string>;
  if(KEYS.some(key=>typeof backup[key]!=='string'))throw new Error('Cloud restore journal is invalid. Local data has been preserved.');
  for(const key of KEYS)await transport.kvSet(key,backup[key]);
  await transport.kvSet(PENDING,'null');
}
export async function readCloudObservations():Promise<CloudRow[]> {
  return (await observationStore()).tasks as unknown as CloudRow[];
}
export async function readCloudArchives():Promise<CloudRow[]> {
  const saved=JSON.parse(await getTransport().kvGet('wickrun:cloud:archives:v1')||'[]') as CloudRow[];
  const records=new Map(saved.map(row=>[row.id,row]));
  const native=desktop();
  if(native){
    for(const record of await native.runList())records.set('run:'+record.id,{id:'run:'+record.id,title:record.title||record.question.content.slice(0,80),kind:'chat',updatedAt:record.state.at,
      text:JSON.stringify({question:record.question.content,result:record.state.content,reasoning:record.state.reasoning,status:record.state.status,steps:record.state.steps,usage:record.state.usage},null,2)});
    const team=await native.collaborationRead();
    for(const project of Object.values(team.projects))for(const run of project.runs)records.set('team:'+run.id,{id:'team:'+run.id,title:run.goal,kind:'team',updatedAt:run.updatedAt,
      text:JSON.stringify({goal:run.goal,acceptance:run.acceptance,status:run.status,attempts:run.attempts,events:run.events,tokens:run.tokens},null,2)});
  }
  return [...records.values()];
}
/** Persist before changing React state. The journal survives crashes between keys. */
export async function applyCloudLocal(next:CloudLocal):Promise<void> {
  const transport=getTransport(), observations=await observationStore();
  const values=[next.settings,next.conversations,next.projects,next.skills,next.tasks,{...observations,tasks:next.observations},next.archives??[]];
  const backup:Record<string,string>={};
  for(const key of KEYS)backup[key]=await transport.kvGet(key)??(key==='snc:settings:v1'?'{}':key==='anyai:observations:v1'?JSON.stringify(observations):'[]');
  await transport.kvSet(PENDING,JSON.stringify(backup));
  try {
    for(let i=0;i<KEYS.length;i++)await transport.kvSet(KEYS[i],JSON.stringify(values[i]));
    await reloadCloudObservations();
    await transport.kvSet(PENDING,'null');
  } catch(error) { await recoverCloudApply(); await reloadCloudObservations(); throw error; }
}
