'use strict';
/* 与 src/lib/team-permissions.ts 同一份规则；tests/team-permissions.test.cjs 保证两边一致。 */
const TEAM_READ_ONLY_TOOLS=Object.freeze([
 'web_search','fetch_url','chrome_tabs','chrome_read_page','chrome_fetch_json','github_search',
 'list_dir','list_directory','read_file','read_document','search_files','inspect_deliverable',
 'read_tool_result','project_memory_read','project_doc_read','recall_past_task','read_skill','read_context',
 'request_user_input','update_plan','update_requirements','verify_requirements','read_review_text',
]);
const TEAM_SCOPED_FILE_TOOLS=Object.freeze([
 'list_dir','list_directory','read_file','read_document','search_files',
 'write_file','edit_file','write_document','delete_file','register_outputs','run_command',
]);
const isAbsolutePath=value=>typeof value==='string'&&/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
function teamGrants(run,memberId){
 const own=(run.accessGrants||[]).filter(g=>g.memberId===memberId);
 return {extraRoots:[...new Set(own.filter(g=>g.scope==='path'&&g.target).map(g=>g.target))],screen:own.some(g=>g.scope==='screen'),admin:own.some(g=>g.scope==='admin')};
}
/** 新追加的授权记录必须是本次运行的成员、已知范围、有理由；想法梳理运行不接受授权。 */
function validateGrant(grant,run){
 if(run.intent==='explore')throw Error('想法梳理运行不能申请额外授权');
 if(!grant||typeof grant.memberId!=='string'||!run.members.some(m=>m.id===grant.memberId)||!['path','screen','admin'].includes(grant.scope)||typeof grant.reason!=='string'||!grant.reason.trim()||grant.reason.length>1000||!Number.isFinite(grant.at)||(grant.scope==='path'?!isAbsolutePath(grant.target)||/[\0\r\n]/.test(grant.target):grant.target!==undefined))throw Error('成员授权记录无效');
}
module.exports={TEAM_READ_ONLY_TOOLS,TEAM_SCOPED_FILE_TOOLS,teamGrants,validateGrant,isAbsolutePath};
