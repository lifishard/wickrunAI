import { tr } from './i18n';
import source from '../data/agency-source.json';
import { AGENT_ROLES, type AgentRole } from './office';
import { libraryRoles, parseRoleMarkdown, type OfficeLibrary } from './office-library';
export const AGENCY_SOURCE=source;
export interface RoleChange {id:string;kind:'added'|'updated'|'removed';before?:AgentRole;after?:AgentRole}
export interface SourcePreview {revision:string;checkedAt:number;changes:RoleChange[];total:number}
export function compareRoleSource(current:AgentRole[],incoming:AgentRole[]):RoleChange[]{
  const old=new Map(current.filter(r=>r.sourcePath).map(r=>[r.id,r]));const next=new Map(incoming.map(r=>[r.id,r]));
  return [...incoming.flatMap<RoleChange>(after=>{const before=old.get(after.id);return !before?[{id:after.id,kind:'added',after}]:before.instructions!==after.instructions||before.sourcePath!==after.sourcePath?[{id:after.id,kind:'updated',before,after}]:[];}),...[...old.values()].filter(r=>!next.has(r.id)).map(before=>({id:before.id,kind:'removed' as const,before}))];
}
export function applySourceChanges(library:OfficeLibrary,preview:SourcePreview,selected:string[]):OfficeLibrary {
  const roles=new Map((library.roles??[]).map(r=>[r.id,r]));const hidden=new Set(library.hiddenRoleIds??[]);
  for(const change of preview.changes.filter(c=>selected.includes(c.id))){if(change.kind==='removed'){roles.delete(change.id);hidden.add(change.id);}else if(change.after){roles.set(change.id,change.after);hidden.delete(change.id);}}
  return {...library,roles:[...roles.values()],hiddenRoleIds:[...hidden],sourceCheckedAt:preview.checkedAt,sourceRevision:preview.revision};
}
export async function checkRoleSource(library:OfficeLibrary,options:{signal?:AbortSignal;onProgress?:(done:number,total:number)=>void;fetcher?:typeof fetch}={}):Promise<SourcePreview>{
  const fetcher=options.fetcher??fetch;const signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000);
  async function read(url:string,limit:number):Promise<string>{const response=await fetcher(url,{signal,credentials:'omit'});if(!response.ok)throw Error(response.status===403||response.status===429?'GitHub 暂时限制请求，请稍后重试；已有角色库仍可使用。':`读取角色来源失败（${response.status}），请稍后重试。`);const reader=response.body?.getReader();if(!reader)throw Error(tr("角色来源返回空响应"));const decoder=new TextDecoder();let result='',bytes=0;try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>limit)throw Error(tr("来源文件超过允许大小，已停止读取"));result+=decoder.decode(part.value,{stream:true});}return result+decoder.decode();}finally{await reader.cancel();}}
  const commit=JSON.parse(await read(`https://api.github.com/repos/${source.repo}/commits/main`,200000));
  if(!/^[a-f0-9]{40}$/.test(commit.sha??''))throw Error(tr("来源没有返回有效版本"));const revision:string=commit.sha;
  const current=libraryRoles(library);const checkedAt=Date.now();
  if(revision===source.revision)return {revision,checkedAt,total:AGENT_ROLES.length,changes:compareRoleSource(current,AGENT_ROLES)};
  const raw=`https://raw.githubusercontent.com/${source.repo}/${revision}/`;
  const divisions=JSON.parse(await read(raw+'divisions.json',100000)).divisions;
  if(!divisions||typeof divisions!=='object'||Array.isArray(divisions))throw Error(tr("来源分类格式无效"));
  const tree=JSON.parse(await read(`https://api.github.com/repos/${source.repo}/git/trees/${revision}?recursive=1`,5000000));
  if(tree.truncated||!Array.isArray(tree.tree))throw Error(tr("来源目录不完整，未应用更新"));
  const paths=tree.tree.filter((f:{path:string;type:string})=>f.type==='blob'&&typeof f.path==='string'&&Object.hasOwn(divisions,f.path.split('/')[0])&&f.path.endsWith('.md')).map((f:{path:string})=>f.path) as string[];
  if(!paths.length||paths.length>1000||paths.some(p=>!/^[-\w/.]+\.md$/.test(p)||p.split('/').includes('..')))throw Error(tr("来源角色目录规模或路径无效"));
  const incoming:AgentRole[]=[];let cursor=0,done=0,totalBytes=0;const ids=new Set<string>();
  await Promise.all(Array.from({length:Math.min(6,paths.length)},async()=>{while(cursor<paths.length){const path=paths[cursor++];const body=await read(raw+path,200000);totalBytes+=body.length;if(totalBytes>40000000)throw Error(tr("来源总大小超过限制"));if(!body.startsWith('---')||!/^name:\s*\S/m.test(body.split('---',3)[1]??''))throw Error(tr("角色格式无效：{p0}，未应用更新",{p0:path}));const role=parseRoleMarkdown(body,path);const id=path.split('/').at(-1)!.replace(/\.md$/,'');if(ids.has(id))throw Error(tr("来源存在重复角色编号，未应用更新"));ids.add(id);const prior=AGENT_ROLES.find(r=>r.id===id);const category=path.split('/')[0];const division=divisions[category];const localized=(source.divisions as Record<string,{label:string}>)[category];incoming.push({...role,id,name:prior?.name??role.name,originalName:role.name,summary:prior?.summary??role.summary,division:localized?.label??String(division.label??category),category,strengths:prior?.strengths??[localized?.label??String(division.label??category)],source: `https://github.com/${source.repo}/blob/${revision}/${path}`,sourcePath:path,sourceRevision:revision,color:/^#[0-9a-f]{6}$/i.test(division.color??'')?division.color:'#668578'});options.onProgress?.(++done,paths.length);}}));
  return {revision,checkedAt,total:incoming.length,changes:compareRoleSource(current,incoming.sort((a,b)=>a.id.localeCompare(b.id)))};
}
