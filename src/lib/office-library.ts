import { tr } from './i18n';
import { AGENT_ROLES, addRole, ensureOffice, installModule, type AgentRole, type DepartmentModule } from './office';
import type { TeamProject } from './collaboration';
import { uid } from './store';

export interface OfficeLibrary {roles?:AgentRole[];hiddenRoleIds?:string[];departments?:DepartmentModule[];sourceCheckedAt?:number;sourceRevision?:string}
export interface DepartmentTemplate {id:string;name:string;category:string;purpose:string;groups:{name:string;purpose:string;roleIds:string[];parent?:number}[]}
export function libraryRoles(library?:OfficeLibrary,custom:AgentRole[]=[]):AgentRole[]{const hidden=new Set(library?.hiddenRoleIds??[]);return [...new Map([...AGENT_ROLES,...(library?.roles??[]),...custom].filter(r=>!hidden.has(r.id)).map(r=>[r.id,r])).values()];}
export function filterRoles(roles:AgentRole[],query:string,category=''):AgentRole[]{const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);return roles.filter(r=>(!category||r.division===category)&&terms.every(t=>`${r.name} ${r.originalName??''} ${r.id} ${r.summary} ${r.division} ${r.strengths.join(' ')}`.toLocaleLowerCase().includes(t)));}
export function parseRoleMarkdown(raw:string,filename:string):AgentRole {
  if(!raw.trim()||new TextEncoder().encode(raw).length>200000)throw Error(tr("{p0}：角色正文为空或超过 200 KB",{p0:filename}));
  const header=raw.startsWith('---')?raw.split('---',3)[1]:'';
  const field=(key:string)=>header.match(new RegExp(`^${key}:\\s*(.+)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'');
  const name=field('name')??raw.match(/^#\s+(.+)$/m)?.[1]??filename.replace(/\.md$/i,'');
  if(name.length>160)throw Error(tr("{p0}：名称过长",{p0:filename}));
  return {id:uid('role'),name,division:field('division')??'自定义',summary:(field('description')??'导入的职责模板').slice(0,1000),strengths:['自定义职责'],instructions:raw,source:filename,color:'#668578'};
}
export function portableModule(module:DepartmentModule):DepartmentModule {const result=structuredClone(module);result.members=result.members.map(m=>({...m,connectionId:'',model:'',enabled:false,tools:[],skills:[],failover:undefined,fileScope:undefined}));return result;}
export function saveDepartment(library:OfficeLibrary,module:DepartmentModule):OfficeLibrary {if((library.departments?.length??0)>=100)throw Error(tr("个人部门库最多保存 100 组，请先整理已有部门"));return {...library,departments:[...(library.departments??[]),{...portableModule(module),id:uid('module')}]};}
export function importDepartmentModules(files:{name:string;text:string}[]):DepartmentModule[]{
  if(!files.length||files.length>30)throw Error(tr("一次请选择 1–30 个部门模块"));
  return files.flatMap(file=>{if(new TextEncoder().encode(file.text).length>2000000)throw Error(tr("{p0}：文件超过 2 MB",{p0:file.name}));const data=JSON.parse(file.text);if(data.format!=='wickrun-department-v1'||!data.module)throw Error(tr("{p0}：不是部门模块",{p0:file.name}));const test={members:[],workflows:[],office:{departments:[],modules:[]}} as unknown as TeamProject;installModule(test,data.module,undefined,true);return [portableModule(data.module)];});
}
export function departmentTemplates(roles:AgentRole[]):DepartmentTemplate[]{
  const group=(name:string,purpose:string,roleIds:string[],parent?:number)=>({name,purpose,roleIds,parent});
  const scenarios:DepartmentTemplate[]=[
    {id:'content-studio',name:'内容工作室',category:'常用组合',purpose:'从选题调研到内容创作，安排独立复核。',groups:[group('内容工作室','策划与统筹',['project-management-project-shepherd']),group('选题调研','理解受众与内容方向',['product-trend-researcher'],0),group('内容制作','文案、社交媒体与视频策划',['marketing-content-creator','marketing-social-media-strategist','marketing-video-optimization-specialist'],0),group('独立复核','审核证据与完成质量',['testing-evidence-collector','testing-reality-checker'],0)]},
    {id:'product-team',name:'产品研发部',category:'常用组合',purpose:'需求、设计与前后端开发分工，测试独立承担。',groups:[group('产品研发部','需求与研发统筹',['product-manager','project-management-project-shepherd']),group('设计与开发','设计及前后端实现',['design-ui-designer','engineering-frontend-developer','engineering-backend-architect'],0),group('独立测试','收集证据并复核交付',['testing-evidence-collector','testing-reality-checker'],0)]},
    {id:'growth-team',name:'市场增长部',category:'常用组合',purpose:'调研、增长策略、内容和社交渠道协作。',groups:[group('市场增长部','制定增长方向',['marketing-growth-hacker','product-trend-researcher']),group('内容与渠道','制作内容与规划渠道',['marketing-content-creator','marketing-social-media-strategist'],0)]},
    {id:'quality-team',name:'独立质检部',category:'常用组合',purpose:'从证据和验收角度独立复核，执行规则仍由工作流规定。',groups:[group('独立质检部','证据检查与质量复核',['testing-evidence-collector','testing-reality-checker'])]},
  ].filter(t=>t.groups.every(g=>g.roleIds.every(id=>roles.some(r=>r.id===id))));
  const categories=[...new Set(roles.filter(r=>r.sourcePath).map(r=>r.division))];
  return [...scenarios,...categories.map(category=>({id:'division-'+category,name:tr('{name}部',{name:tr(category)}),category:'按专业组建',purpose:tr('包含角色库中{category}分类的所有职责，可在组装后精简和分工。',{category:tr(category)}),groups:[group(tr('{name}部',{name:tr(category)}),tr('{category}专业团队',{category:tr(category)}),roles.filter(r=>r.division===category&&r.sourcePath).map(r=>r.id))]}))];
}
export function assembleDepartment(project:TeamProject,template:DepartmentTemplate,roles:AgentRole[],brain:{profileId:string;model:string},parentId?:string):string {
  if(template.groups.some((g,i)=>g.parent!==undefined&&(g.parent<0||g.parent>=i)))throw Error(tr("部门层级无效"));
  if(template.groups.some(g=>g.roleIds.some(id=>!roles.some(r=>r.id===id))))throw Error(tr("部门所需角色已变更，请重新选择组合"));
  const office=ensureOffice(project);if(parentId&&!office.departments.some(d=>d.id===parentId))throw Error(tr("上级部门已不存在"));
  const ids=template.groups.map(()=>uid('dept'));template.groups.forEach((g,i)=>{office.departments.push({id:ids[i],name:g.name,purpose:g.purpose,parentId:g.parent===undefined?parentId:ids[g.parent],memberIds:[],workflowIds:[]});for(const id of g.roleIds)addRole(project,ids[i],roles.find(r=>r.id===id)!,brain);});return ids[0];
}
