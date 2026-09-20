'use strict';
const path=require('node:path');

const TEAM_FILE_READ_TOOLS=Object.freeze(['list_dir','read_file','read_document','search_files']);
const TEAM_FILE_EDIT_TOOLS=Object.freeze([...TEAM_FILE_READ_TOOLS,'write_file','edit_file','write_document']);
const TEAM_FILE_COMMAND_TOOLS=Object.freeze([...TEAM_FILE_EDIT_TOOLS,'run_command']);
const CAPABILITIES=new Set(['read','edit','command']);

function normalizeTeamFileRoot(root){
 if(typeof root!=='string'||!root||root!==root.trim()||/[\0\r\n]/.test(root)||root.replace(/\\/g,'/').split('/').some(part=>part==='.'||part==='..')||!path.isAbsolute(root))throw Error('任务文件范围无效');
 const value=path.resolve(root);
 return process.platform==='win32'?value.toLowerCase():value;
}
function teamFileTools(capability,readOnly=false){
 if(!CAPABILITIES.has(capability))throw Error('文件权限级别无效');
 return [...(readOnly||capability==='read'?TEAM_FILE_READ_TOOLS:capability==='edit'?TEAM_FILE_EDIT_TOOLS:TEAM_FILE_COMMAND_TOOLS)];
}
function validateTeamFileScope(scope,projectRoots){
 if(scope===undefined)return;
 if(!scope||typeof scope!=='object'||typeof scope.root!=='string'||!scope.root||scope.root!==scope.root.trim()||/[\0\r\n]/.test(scope.root)||scope.root.replace(/\\/g,'/').split('/').some(part=>part==='.'||part==='..')||!CAPABILITIES.has(scope.capability))throw Error('任务文件范围无效');
 const root=normalizeTeamFileRoot(scope.root);
 if(!Array.isArray(projectRoots)||!projectRoots.some(item=>typeof item==='string'&&path.isAbsolute(item)&&normalizeTeamFileRoot(item)===root))throw Error('任务目录不在项目已授权目录中');
}
function validateTeamFileSnapshot(scope,intent,graph,members){
 if(!Array.isArray(members))throw Error('任务文件运行快照无效');
 for(const member of members)if(member.fileScope!==undefined){
  validateTeamFileScope(member.fileScope,[member.fileScope.root]);
  if(scope===undefined||member.fileScope.capability!==scope.capability||normalizeTeamFileRoot(member.fileScope.root)!==normalizeTeamFileRoot(scope.root))throw Error('流程成员的文件范围与任务不一致');
 }
 if(scope===undefined)return;
 if(!graph||!Array.isArray(graph.nodes))throw Error('任务文件运行快照无效');
 const agentCount=graph.nodes.filter(node=>node.type==='agent').length,reviewCount=graph.nodes.filter(node=>node.type==='review').length;
 if(intent==='explore'||graph.nodes.some(node=>!['start','agent','review','end'].includes(node.type))||agentCount!==1||reviewCount>1)throw Error('文件任务只支持直接完成或独立复核');
 const reviews=graph.nodes.filter(node=>node.type==='review');
 if(reviews.some(node=>scope.capability==='read'?node.reviewMode!=='text':node.reviewMode!=='files'))throw Error('文件复核方式与任务权限不一致');
 const reviewerIds=new Set(reviews.map(node=>node.memberId).filter(Boolean));
 for(const member of members){
  if(typeof member.connectionId!=='string'||member.connectionId.startsWith('client:')||(member.skills?.length||0)||member.failover?.enabled||(member.failover?.routes?.length||0))throw Error('文件任务不能带入技能、本机客户端或接力授权');
  const allowed=new Set(teamFileTools(scope.capability,reviewerIds.has(member.id)));
  if(!Array.isArray(member.tools)||member.tools.some(tool=>!allowed.has(tool)))throw Error('文件任务成员包含超出所选权限的工具');
 }
}

module.exports={TEAM_FILE_READ_TOOLS,TEAM_FILE_EDIT_TOOLS,TEAM_FILE_COMMAND_TOOLS,normalizeTeamFileRoot,teamFileTools,validateTeamFileScope,validateTeamFileSnapshot};
