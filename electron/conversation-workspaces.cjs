"use strict";
const fs=require('node:fs'),path=require('node:path');
function createConversationWorkspaces({teamFiles,conversations,settings}){
 const mine=id=>{const c=conversations().find(c=>c.id===id);if(!c)throw Error('会话不存在');return c;};
 const publicSession=s=>({id:s.id,root:s.root,isolatedRoot:s.isolatedRoot});
 const equal=(a,b)=>{const x=fs.realpathSync(a),y=fs.realpathSync(b);return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y;};
 function create(id,root){const c=mine(id);if(!c.config?.toolsEnabled)throw Error('只有 Work 会话可创建工作区');const allowed=settings().tools?.workspaceRoots||[];
  if(typeof root!=='string'||!path.isAbsolute(root)||!allowed.some(r=>{try{return equal(r,root);}catch{return false;}}))throw Error('请选择已授权的工作目录');
  const prior=teamFiles.list().find(s=>s.taskId===id&&s.memberId==='conversation');
  if(prior){if(!equal(prior.root,root))throw Error('此会话已有其他工作区');return publicSession(prior);}
  return publicSession(teamFiles.create({projectId:c.projectId||'conversations',taskId:id,memberId:'conversation',root},allowed));
 }
 function resolve(id){const c=mine(id);if(!c.workspace)return null;const s=teamFiles.get(c.workspace.id);if(!(settings().tools?.workspaceRoots||[]).some(r=>{try{return equal(r,s.root);}catch{return false;}}))throw Error('工作目录授权已撤销');if(s.taskId!==id||s.memberId!=='conversation'||s.isolatedRoot!==c.workspace.isolatedRoot||s.root!==c.workspace.root||s.recoveryRequired||s.status==='merged')throw Error('隔离工作区不可用，请核实或新建 Work 会话');return s;}
 function tool(ctx){const s=resolve(ctx.conversationId);if(!s)throw Error('会话缺少独立工作区');return {...ctx,workspaceRoots:[s.isolatedRoot],grants:{extraRoots:[],admin:false,screen:false}};}
 return {create,resolve,tool};
}
module.exports={createConversationWorkspaces};
