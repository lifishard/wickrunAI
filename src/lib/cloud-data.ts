import type { AppSettings, Conversation } from '../types';
import type { Project } from './projects';
import type { Skill } from './skills';
import type { ScheduledTask } from './schedule';

export type CloudRow = Record<string, unknown> & { id: string };
export type CloudCollection = 'conversations'|'projects'|'skills'|'tasks'|'observations'|'profiles'|'archives';
export type CloudData = { version:1; preferences:Record<string,unknown> } & Record<CloudCollection,CloudRow[]>;
export const cloudCollections: CloudCollection[] = ['conversations','projects','skills','tasks','observations','profiles','archives'];
export const emptyCloudData = ():CloudData => ({version:1,conversations:[],projects:[],skills:[],tasks:[],observations:[],profiles:[],archives:[],preferences:{}});
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
    if(prefer)return prefer==='local'?l:r;
    conflicts.push(key);return l;
  };
  for(const name of cloudCollections){
    const maps=[base,local,remote].map(data=>new Map(data[name].map(row=>[row.id,row])));
    const ids=new Set(maps.flatMap(map=>[...map.keys()]));
    result[name]=[...ids].sort().map(id=>pick(maps[0].get(id),maps[1].get(id),maps[2].get(id),`${name}:${id}`)).filter(Boolean) as CloudRow[];
  }
  for(const key of new Set([...Object.keys(base.preferences),...Object.keys(local.preferences),...Object.keys(remote.preferences)])){
    const value=pick(base.preferences[key],local.preferences[key],remote.preferences[key],`preferences:${key}`);
    if(value!==undefined)result.preferences[key]=value;
  }
  if(conflicts.length)throw new CloudMergeConflict(conflicts);
  return result;
}

const take=(value:unknown,keys:string[]):Record<string,unknown>=>{
  const record=value&&typeof value==='object'?value as Record<string,unknown>:{};
  return Object.fromEntries(keys.filter(k=>record[k]!==undefined).map(k=>[k,record[k]]));
};
const PREFS=['theme','locale','uiDensity','sendKey','fontScale','showReasoningByDefault','requestTimeoutMs'];
const CONFIG=['model','stream','systemPrompt','historyLimit','effortLevel','thinkingStyle','reasoningEffort','thinkingBudget','params','customBody','maxToolRounds'];
const MSG=['id','role','content','reasoning','createdAt','model','steps','error','errorInfo','usage','sources','attachments','skillNames','quotes','annotations','progress','milestones','delivery','taskId','supplementalInputs','userQuestionHistory'];
export type CloudLocal = { settings:AppSettings; conversations:Conversation[]; projects:Project[]; skills:Skill[]; tasks:ScheduledTask[]; observations:CloudRow[]; archives?:CloudRow[] };
export function projectCloudData(local:CloudLocal):CloudData {
  const result=emptyCloudData();
  result.preferences=take(local.settings,PREFS);
  result.profiles=local.settings.keyProfiles.map(p=>({ ...take(p,['name','baseUrl','createdAt','routeProfiles','quotaGroup']), id:p.id, extraHeaders:Object.fromEntries(Object.entries(p.extraHeaders??{}).filter(([k])=>!/(?:auth|token|secret|password|api.?key)/i.test(k))) }));
  result.conversations=local.conversations.map(c=>({ ...take(c,['title','pinned','forkedFrom','projectId','keyProfileId','createdAt','updatedAt','draft']), id:c.id, draft:c.draft??'', config:take(c.config,CONFIG), messages:c.messages.map(m=>take(m,MSG)) }));
  result.projects=local.projects.map(p=>take(p,['id','name','emoji','instructions','docs','prompts','memory','defaultModel','defaultKeyProfileId','createdAt'])) as CloudRow[];
  result.skills=local.skills.map(s=>take(s,['id','name','description','body','source','installedAt','uses','outcomes','installedHash'])) as CloudRow[];
  result.tasks=local.tasks.map(t=>take(t,['id','name','prompt','schedule','projectId','keyProfileId','model','target','conversationId','createdAt','lastRunAt','lastResult'])) as CloudRow[];
  result.observations=local.observations;
  result.archives=local.archives??[];
  return JSON.parse(JSON.stringify(result)) as CloudData;
}

export function hydrateCloudData(data:CloudData,local:CloudLocal,keyIds:string[]):CloudLocal {
  const ids=new Set(keyIds);
  const settings={...local.settings,...take(data.preferences,PREFS)} as AppSettings;
  settings.keyProfiles=data.profiles.map(p=>({...take(p,['id','name','baseUrl','createdAt','routeProfiles','quotaGroup']),extraHeaders:take(p,['extraHeaders']).extraHeaders??{},hasSecret:ids.has(p.id)})) as AppSettings['keyProfiles'];
  if(!settings.keyProfiles.some(p=>p.id===settings.activeKeyProfileId))settings.activeKeyProfileId=settings.keyProfiles[0]?.id??null;
  const conversations=data.conversations.map(row=>{
    const old=local.conversations.find(c=>c.id===row.id);
    const config={...local.settings.defaultConfig,...take(row.config,CONFIG),toolsEnabled:old?.config.toolsEnabled??false,enabledTools:old?.config.enabledTools??[],approvalMode:old?.config.approvalMode??'ask'};
    const messages=(Array.isArray(row.messages)?row.messages:[]).map(m=>{
      const shared=take(m,MSG), previous=old?.messages.find(x=>x.id===shared.id);
      return previous && same(take(previous,MSG),shared) ? previous : {...shared,pending:false,cloudImported:true};
    });
    return {...take(row,['id','title','pinned','forkedFrom','projectId','keyProfileId','createdAt','updatedAt','draft']),config,messages};
  }) as Conversation[];
  return {settings,conversations,
    projects:data.projects.map(p=>take(p,['id','name','emoji','instructions','docs','prompts','memory','defaultModel','defaultKeyProfileId','createdAt'])) as unknown as Project[],
    skills:data.skills.map(s=>({...take(s,['id','name','description','body','source','installedAt','uses','outcomes','installedHash']),enabled:local.skills.find(x=>x.id===s.id)?.enabled??false})) as unknown as Skill[],
    tasks:data.tasks.map(t=>({...take(t,['id','name','prompt','schedule','projectId','keyProfileId','model','target','conversationId','createdAt','lastRunAt','lastResult']),enabled:local.tasks.find(x=>x.id===t.id)?.enabled??false,catchUp:false})) as unknown as ScheduledTask[],
    observations:data.observations,archives:data.archives,
  };
}
