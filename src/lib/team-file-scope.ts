import type { Graph, Member, TeamFileScope } from './collaboration';
import { tr } from './i18n';

export const TEAM_FILE_READ_TOOLS=['list_dir','read_file','read_document','search_files'] as const;
export const TEAM_FILE_EDIT_TOOLS=[...TEAM_FILE_READ_TOOLS,'write_file','edit_file','write_document'] as const;
export const TEAM_FILE_COMMAND_TOOLS=[...TEAM_FILE_EDIT_TOOLS,'run_command'] as const;

const CAPABILITIES=new Set<TeamFileScope['capability']>(['read','edit','command']);

/** Stable renderer-side equality for roots returned by the native folder picker. */
export function normalizeTeamFileRoot(root:string):string {
 if(typeof root!=='string'||root!==root.trim()||/[\0\r\n]/.test(root)||root.replace(/\\/g,'/').split('/').some(part=>part==='.'||part==='..'))throw Error(tr('任务文件范围无效'));
 let value=root.replace(/\\/g,'/'),unc=value.startsWith('//');
 value=value.replace(/\/{2,}/g,'/');if(unc)value='/'+value;
 if(value.length>1&&!/^[A-Za-z]:\/$/.test(value))value=value.replace(/\/+$/,'');
 return /^(?:[A-Za-z]:\/|\/\/)/.test(value)?value.toLocaleLowerCase():value;
}

export function teamFileTools(capability:TeamFileScope['capability'],readOnly=false):string[] {
 if(!CAPABILITIES.has(capability))throw Error(tr('文件权限级别无效'));
 return [...(readOnly||capability==='read'?TEAM_FILE_READ_TOOLS:capability==='edit'?TEAM_FILE_EDIT_TOOLS:TEAM_FILE_COMMAND_TOOLS)];
}

/** Undefined means a legacy text-only task/run and intentionally remains valid. */
export function validateTeamFileScope(scope:TeamFileScope|undefined,projectRoots:string[]):void {
 if(scope===undefined)return;
 if(!scope||typeof scope!=='object'||typeof scope.root!=='string'||!scope.root||scope.root!==scope.root.trim()||/[\0\r\n]/.test(scope.root)||scope.root.replace(/\\/g,'/').split('/').some(part=>part==='.'||part==='..')||!CAPABILITIES.has(scope.capability))throw Error(tr('任务文件范围无效'));
 if(!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(scope.root)||!Array.isArray(projectRoots)||!projectRoots.some(root=>typeof root==='string'&&normalizeTeamFileRoot(root)===normalizeTeamFileRoot(scope.root)))throw Error(tr('任务目录不在项目已授权目录中'));
}

/** Validate the authority frozen into a run; callers decide whether it must equal a current task. */
export function validateTeamFileSnapshot(scope:TeamFileScope|undefined,intent:'explore'|'deliver'|undefined,graph:Graph,members:Member[]):void {
 for(const member of members)if(member.fileScope!==undefined){
  validateTeamFileScope(member.fileScope,[member.fileScope.root]);
  if(scope===undefined||member.fileScope.capability!==scope.capability||normalizeTeamFileRoot(member.fileScope.root)!==normalizeTeamFileRoot(scope.root))throw Error(tr('流程成员的文件范围与任务不一致'));
 }
 if(scope===undefined)return;
 const agentCount=graph.nodes.filter(node=>node.type==='agent').length,reviewCount=graph.nodes.filter(node=>node.type==='review').length;
 if(intent==='explore'||graph.nodes.some(node=>!['start','agent','review','end'].includes(node.type))||agentCount!==1||reviewCount>1)throw Error(tr('文件任务只支持直接完成或独立复核'));
 const reviews=graph.nodes.filter(node=>node.type==='review');
 if(reviews.some(node=>scope.capability==='read'?node.reviewMode!=='text':node.reviewMode!=='files'))throw Error(tr('文件复核方式与任务权限不一致'));
 const reviewerIds=new Set(reviews.map(node=>node.memberId).filter((id):id is string=>!!id));
 for(const member of members){
  if(typeof member.connectionId!=='string'||member.connectionId.startsWith('client:')||(member.skills?.length??0)||member.failover?.enabled||(member.failover?.routes?.length??0))throw Error(tr('文件任务不能带入技能、本机客户端或接力授权'));
  const allowed=new Set(teamFileTools(scope.capability,reviewerIds.has(member.id)));
  if(!Array.isArray(member.tools)||member.tools.some(tool=>!allowed.has(tool)))throw Error(tr('文件任务成员包含超出所选权限的工具'));
 }
}
