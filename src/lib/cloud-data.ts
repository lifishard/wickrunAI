import type { AppSettings, Conversation } from '../types';
import type { Project } from './projects';
import type { Skill } from './skills';
import type { ScheduledTask } from './schedule';
import { memoryItemsOf, mergeMemoryItems3, renderMemoryText, type ProjectMemoryItem } from './memory-core';
import { emptyButlerBrain, projectButlerBrainForSync, type ButlerBrainState, type ButlerProactivePreferences } from './proactive-butler';
import { sanitizeRouteGroups } from './route-groups';

export type CloudRow = Record<string, unknown> & { id: string };
export type CloudCollection = 'conversations'|'projects'|'skills'|'tasks'|'observations'|'profiles'|'archives'|'butler';
export type CloudData = { version:1; preferences:Record<string,unknown>; butler?:CloudRow[] } & Record<Exclude<CloudCollection,'butler'>,CloudRow[]>;
export const cloudCollections: CloudCollection[] = ['conversations','projects','skills','tasks','observations','profiles','archives','butler'];
export const emptyCloudData = ():CloudData => ({version:1,conversations:[],projects:[],skills:[],tasks:[],observations:[],profiles:[],archives:[],butler:[],preferences:{}});
export function canonicalCloud(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalCloud).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalCloud((value as Record<string,unknown>)[k])).join(',')+'}';
  return JSON.stringify(value)??'null';
}
const same = (a:unknown,b:unknown)=>canonicalCloud(a)===canonicalCloud(b);
export class CloudMergeConflict extends Error {
  constructor(public records:string[]) { super(`Cloud sync conflict: ${records.join(', ')}`); }
}
/** Three-way merge: compare with the last accepted server snapshot, never device clocks. */
export function mergeCloudData(base:CloudData,local:CloudData,remote:CloudData, prefer?:'local'|'remote'):CloudData {
  const result=emptyCloudData(), conflicts:string[]=[];
  const pick=(b:unknown,l:unknown,r:unknown,key:string)=>{
    if(same(l,r))return l;
    if(same(l,b))return r;
    if(same(r,b))return l;
    if(key==='preferences:butler.paused')return l===true||r===true;
    if(key==='preferences:butler.enabled')return !(l===false||r===false);
    if(key.startsWith('butler:')||key.startsWith('preferences:butler.'))return prefer==='remote'?r:l;
    if(prefer)return prefer==='local'?l:r;
    conflicts.push(key);return l;
  };
  for(const name of cloudCollections){
    const maps=[base,local,remote].map(data=>new Map((data[name]??[]).map(row=>[row.id,row])));
    const ids=new Set(maps.flatMap(map=>[...map.keys()]));
    const merge=name==='projects'?mergeProjectRow:name==='butler'?(b:CloudRow|undefined,l:CloudRow|undefined,r:CloudRow|undefined,key:string)=>
      key.startsWith('butler:job:')?mergeButlerJobRow(b,l,r,key,pick):pick(b,l,r,key)
      :(b:CloudRow|undefined,l:CloudRow|undefined,r:CloudRow|undefined,key:string)=>pick(b,l,r,key);
    result[name]=[...ids].sort().map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${name}:${id}`,pick)).filter(Boolean) as CloudRow[];
  }
  for(const key of new Set([...Object.keys(base.preferences),...Object.keys(local.preferences),...Object.keys(remote.preferences)])){
    const value=pick(base.preferences[key],local.preferences[key],remote.preferences[key],`preferences:${key}`);
    if(value!==undefined)result.preferences[key]=value;
  }
  if(conflicts.length)throw new CloudMergeConflict(conflicts);
  return result;
}

/** A phone's pause/message must survive a simultaneous host progress update. */
function mergeButlerJobRow(b:CloudRow|undefined,l:CloudRow|undefined,r:CloudRow|undefined,key:string,pick:(b:unknown,l:unknown,r:unknown,key:string)=>unknown):CloudRow|undefined {
  if(!l||!r)return pick(b,l,r,key) as CloudRow|undefined;
  const merged:CloudRow={id:l.id};
  for(const field of new Set([...Object.keys(b??{}),...Object.keys(l),...Object.keys(r)])){
    if(field==='id'||field==='commands')continue;
    const value=pick(b?.[field],l[field],r[field],`${key}:${field}`);
    if(value!==undefined)merged[field]=value;
  }
  const commands=new Map<string,Record<string,unknown>>();
  for(const row of [b,l,r])for(const value of Array.isArray(row?.commands)?row.commands:[]){
    if(!value||typeof value!=='object'||typeof value.id!=='string'||!value.id)continue;
    const prior=commands.get(value.id);
    if(!prior||value.kind==='pause')commands.set(value.id,value);
  }
  if(commands.size)merged.commands=[...commands.values()].sort((a,b)=>Number(a.createdAt??0)-Number(b.createdAt??0)||String(a.id).localeCompare(String(b.id))).slice(-20);
  return merged;
}

/**
 * 项目这一行：记忆按条目单独合并（两台设备各记了一条、一边删一边改都不算冲突），
 * 其余字段照旧三方比较。旧字段 memory 只是条目的镜像，合并后重新生成。
 */
function mergeProjectRow(b:CloudRow|undefined,l:CloudRow|undefined,r:CloudRow|undefined,key:string,pick:(b:unknown,l:unknown,r:unknown,key:string)=>unknown):CloudRow|undefined {
  const strip=(row:CloudRow|undefined)=>{if(!row)return row;const {memory:_m,memoryItems:_i,...rest}=row;return rest;};
  const row=pick(strip(b),strip(l),strip(r),key) as CloudRow|undefined;
  if(!row)return undefined;
  if(![b,l,r].some(x=>x&&(x.memory!==undefined||x.memoryItems!==undefined)))return row;
  // 没升级的设备只有整段文本：固定时间迁移，同一段文字每次得到同样的条目
  const items=(x:CloudRow|undefined):ProjectMemoryItem[]=>x?memoryItemsOf(x as {memory?:string;memoryItems?:unknown},0):[];
  const merged=dedupeMemory(mergeMemoryItems3(items(b),items(l),items(r)));
  return {...row,memoryItems:merged,memory:renderMemoryText(merged)};
}
/** 同一句话出现两条（新旧版本各迁移了一次）时只留一条：留更新的那条 */
function dedupeMemory(list:ProjectMemoryItem[]):ProjectMemoryItem[] {
  const keep=new Map<string,ProjectMemoryItem>();
  for(const m of list){
    if(m.deletedAt)continue;
    const prev=keep.get(m.hash);
    if(!prev||m.updatedAt>prev.updatedAt||(m.updatedAt===prev.updatedAt&&m.id<prev.id))keep.set(m.hash,m);
  }
  return list.filter(m=>m.deletedAt||keep.get(m.hash)===m);
}

const take=(value:unknown,keys:string[]):Record<string,unknown>=>{
  const record=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return Object.fromEntries(keys.filter(k=>record[k]!==undefined).map(k=>[k,record[k]]));
};
const PREFS=['theme','locale','uiDensity','sendKey','fontScale','showReasoningByDefault','requestTimeoutMs','routeGroups'];
const BUTLER_PREFS=['enabled','paused','sources','backend','maxTokensPerDay','cadence','morning','evening','timezone','hostDeviceId','allowResearch','allowRoutineExecution','maxWorkPerDay','externalUnderstanding'];
export function butlerCloudSlice(data:CloudData):CloudData {
  const slice=emptyCloudData();
  slice.butler=data.butler??[];
  slice.preferences=Object.fromEntries(Object.entries(data.preferences).filter(([key])=>key.startsWith('butler.')));
  return slice;
}
/** Account state supersedes seed defaults on a device's first sync. */
export function firstButlerBase(local:CloudData,remote:CloudData):CloudData {
  const base=butlerCloudSlice(emptyCloudData());
  base.preferences=local.preferences;
  base.butler=(local.butler??[]).filter(row=>(remote.butler??[]).some(other=>other.id===row.id));
  return base;
}
export function withButlerCloudSlice(remote:CloudData,slice:CloudData):CloudData {
  const preferences=Object.fromEntries(Object.entries(remote.preferences).filter(([key])=>!key.startsWith('butler.')));
  return {...remote,butler:slice.butler??[],preferences:{...preferences,...slice.preferences}};
}
export function mergeButlerSlices(base:CloudData,local:CloudData,remote:CloudData):CloudData {
  const merged=mergeCloudData(base,local,remote,'local');
  for(const [key,safe] of [['butler.paused',true],['butler.enabled',false]] as const){
    if(local.preferences[key]!==base.preferences[key]&&remote.preferences[key]!==base.preferences[key]
      &&local.preferences[key]!==remote.preferences[key])merged.preferences[key]=safe;
  }
  return merged;
}
export function butlerPreferencesFromCloud(preferences:Record<string,unknown>,local:ButlerProactivePreferences|undefined):ButlerProactivePreferences|undefined {
  const result={...(local??{})} as ButlerProactivePreferences;
  for(const key of BUTLER_PREFS)if(preferences[`butler.${key}`]!==undefined){
    if(key==='hostDeviceId'&&preferences[`butler.${key}`]===null)delete result.hostDeviceId;
    else (result as unknown as Record<string,unknown>)[key]=preferences[`butler.${key}`];
  }
  return Object.keys(result).length?result:undefined;
}
const CONFIG=['model','stream','systemPrompt','historyLimit','effortLevel','thinkingStyle','reasoningEffort','thinkingBudget','params','customBody','maxToolRounds'];
const MSG=['id','role','content','reasoning','createdAt','model','steps','error','errorInfo','usage','sources','attachments','skillNames','quotes','annotations','progress','milestones','delivery','taskId','supplementalInputs','userQuestionHistory'];
export type CloudLocal = { settings:AppSettings; conversations:Conversation[]; projects:Project[]; skills:Skill[]; tasks:ScheduledTask[]; observations:CloudRow[]; archives?:CloudRow[]; butler?:ButlerBrainState };
export function butlerRows(brain:ButlerBrainState):CloudRow[] {
  const safe=projectButlerBrainForSync(brain);
  return ([['signal',safe.signals],['goal',safe.goals],['brief',safe.briefs],['skill',safe.skillProposals],['job',safe.jobs??[]],['host',safe.hosts??[]],['feedback',safe.feedback??[]],['audit',safe.audit??[]]] as const)
    .flatMap(([kind,items])=>items.map(item=>({...item,...(kind==='job'?{jobKind:(item as import('./proactive-butler').ButlerJob).kind}:{}),...(kind==='audit'?{auditKind:(item as import('./proactive-butler').ButlerAudit).kind}:{}),id:`${kind}:${item.id}`,entityId:item.id,kind})));
}
export function butlerBrainFromRows(rows:CloudRow[]|undefined,accountId:string,local?:ButlerBrainState):ButlerBrainState {
  const scoped=(kind:string)=> (rows??[]).filter(row=>row.kind===kind&&row.accountId===accountId).map(({kind:_kind,entityId,id:_id,jobKind,auditKind,...rest})=>({...rest,id:entityId,...(kind==='job'?{kind:jobKind}:{}),...(kind==='audit'?{kind:auditKind}:{} )}));
  const brain=emptyButlerBrain(accountId);
  return {...brain,signals:scoped('signal') as unknown as ButlerBrainState['signals'],goals:scoped('goal') as unknown as ButlerBrainState['goals'],
    briefs:scoped('brief') as unknown as ButlerBrainState['briefs'],skillProposals:scoped('skill') as unknown as ButlerBrainState['skillProposals'],
    jobs:scoped('job') as unknown as ButlerBrainState['jobs'],hosts:scoped('host') as unknown as ButlerBrainState['hosts'],
    feedback:scoped('feedback') as unknown as ButlerBrainState['feedback'],audit:scoped('audit') as unknown as ButlerBrainState['audit'],
    actionGrants:local?.accountId===accountId?local.actionGrants:[],updatedAt:Math.max(local?.accountId===accountId?local.updatedAt:0,...(rows??[]).map(row=>Number(row.updatedAt??row.createdAt??row.lastSeenAt??0)))};
}
export function projectCloudData(local:CloudLocal):CloudData {
  const result=emptyCloudData();
  result.preferences=take(local.settings,PREFS);
  if(local.settings.routeGroups)result.preferences.routeGroups=sanitizeRouteGroups(local.settings.routeGroups).map(({id,name,routes,createdAt})=>({id,name,routes,createdAt}));
  const proactive=local.settings.butler?.proactive;
  if(proactive){
    for(const [key,value] of Object.entries(take(proactive,BUTLER_PREFS)))result.preferences[`butler.${key}`]=value;
    result.preferences['butler.hostDeviceId']=proactive.hostDeviceId??null;
  }
  if(local.butler)result.butler=butlerRows(local.butler);
  result.profiles=local.settings.keyProfiles.map(p=>({ ...take(p,['name','baseUrl','createdAt','routeProfiles','quotaGroup']), id:p.id, extraHeaders:Object.fromEntries(Object.entries(p.extraHeaders??{}).filter(([k])=>!/(?:auth|token|secret|password|api.?key)/i.test(k))) }));
  result.conversations=local.conversations.map(c=>({ ...take(c,['privacy','title','titleManuallySet','titleGenerated','pinned','forkedFrom','projectId','keyProfileId','createdAt','updatedAt','draft']), id:c.id, draft:c.draft??'', config:take(c.config,CONFIG), messages:c.messages.map(m=>take(m,MSG)) }));
  result.projects=local.projects.map(p=>take(p,['id','name','emoji','instructions','docs','prompts','memory','memoryItems','defaultModel','defaultKeyProfileId','createdAt'])) as CloudRow[];
  result.skills=local.skills.map(s=>take(s,['id','name','description','body','source','installedAt','uses','outcomes','installedHash'])) as CloudRow[];
  result.tasks=local.tasks.map(t=>take(t,['id','name','prompt','schedule','projectId','keyProfileId','model','target','conversationId','createdAt','lastRunAt','lastResult'])) as CloudRow[];
  result.observations=local.observations;
  result.archives=local.archives??[];
  return JSON.parse(JSON.stringify(result)) as CloudData;
}

export function hydrateCloudData(data:CloudData,local:CloudLocal,keyIds:string[],accountId=local.butler?.accountId):CloudLocal {
  const ids=new Set(keyIds);
  const settings={...local.settings,...take(data.preferences,PREFS)} as AppSettings;
  settings.routeGroups=sanitizeRouteGroups(data.preferences.routeGroups??local.settings.routeGroups);
  const proactive=butlerPreferencesFromCloud(data.preferences,local.settings.butler?.proactive);
  if(proactive)settings.butler={...local.settings.butler,proactive};
  settings.keyProfiles=data.profiles.map(p=>({...take(p,['id','name','baseUrl','createdAt','routeProfiles','quotaGroup']),extraHeaders:take(p,['extraHeaders']).extraHeaders??{},hasSecret:ids.has(p.id)})) as AppSettings['keyProfiles'];
  if(!settings.keyProfiles.some(p=>p.id===settings.activeKeyProfileId))settings.activeKeyProfileId=settings.keyProfiles[0]?.id??null;
  const conversations=data.conversations.map(row=>{
    const old=local.conversations.find(c=>c.id===row.id);
    const config={...local.settings.defaultConfig,...old?.config,...take(row.config,CONFIG),toolsEnabled:old?.config.toolsEnabled??false,enabledTools:old?.config.enabledTools??[],approvalMode:old?.config.approvalMode??'ask'};
    const messages=(Array.isArray(row.messages)?row.messages:[]).map(m=>{
      const shared=take(m,MSG), previous=old?.messages.find(x=>x.id===shared.id);
      return previous && same(take(previous,MSG),shared) ? previous : {...shared,pending:false,cloudImported:true};
    });
    return {...take(old,['workspace','workspaceError','creationFingerprint','coordinationGroupId','coordinationMessages','handoffSourceRunId']),...take(row,['privacy','id','title','titleManuallySet','titleGenerated','pinned','forkedFrom','projectId','keyProfileId','createdAt','updatedAt','draft']),config,messages};
  }) as Conversation[];
  return {settings,conversations,butler:accountId?butlerBrainFromRows(data.butler,accountId,local.butler):local.butler,
    projects:data.projects.map(p=>take(p,['id','name','emoji','instructions','docs','prompts','memory','memoryItems','defaultModel','defaultKeyProfileId','createdAt'])) as unknown as Project[],
    skills:data.skills.map(s=>({...take(s,['id','name','description','body','source','installedAt','uses','outcomes','installedHash']),enabled:local.skills.find(x=>x.id===s.id)?.enabled??false})) as unknown as Skill[],
    tasks:data.tasks.map(t=>({...take(t,['id','name','prompt','schedule','projectId','keyProfileId','model','target','conversationId','createdAt','lastRunAt','lastResult']),enabled:local.tasks.find(x=>x.id===t.id)?.enabled??false,catchUp:false})) as unknown as ScheduledTask[],
    observations:data.observations,archives:data.archives,
  };
}
