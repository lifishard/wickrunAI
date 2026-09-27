"use strict";
const fs=require('node:fs'),path=require('node:path'),transfer=require('./artifact-transfer.cjs');
function createArtifactUploads({directory,getTask,getTasks,updateTask,origin,now=Date.now}){
 const root=path.resolve(directory,'uploads');
 const folder=id=>{if(!/^[0-9a-f-]{36}$/.test(id))throw transfer.error('Upload not found.',404);const p=path.resolve(root,id);if(!p.startsWith(root+path.sep))throw transfer.error('Invalid upload path.');return p;};
 const remove=id=>{fs.rmSync(folder(id),{recursive:true,force:true});};
 const active=t=>{if(t.status!=='working')throw transfer.error('Claim an active task first.',409);};
 function cleanup(){for(const t of getTasks()){const expired=(t.uploads||[]).filter(u=>u.expiresAt<=now());if(!expired.length)continue;updateTask(t.id,t.provider,current=>{current.uploads=(current.uploads||[]).filter(u=>u.expiresAt>now());});for(const u of expired)remove(u.id);}}
 function run(provider,taskId,input){
  let t=getTask(taskId,provider),u;
  if(input.action==='begin'){
   active(t);cleanup();t=getTask(taskId,provider);const next=transfer.begin(input,now()),existing=(t.artifacts||[]).find(a=>a.requestKey===next.requestKey);
   if(existing){transfer.same(existing,next);return {artifact:existing,duplicate:true};}
   u=(t.uploads||[]).find(a=>a.requestKey===next.requestKey);if(u)transfer.same(u,next);else{transfer.quota(t.artifacts||[],t.uploads||[],next);u=next;fs.mkdirSync(folder(u.id),{recursive:true});updateTask(taskId,provider,t=>{t.uploads=[...(t.uploads||[]),u];});}
  }else{
   const existing=(t.artifacts||[]).find(a=>a.id===input.uploadId);if(existing&&['finish','status'].includes(input.action))return {artifact:existing,duplicate:true};
   active(t);u=(t.uploads||[]).find(a=>a.id===input.uploadId);if(!u||u.expiresAt<=now())throw transfer.error('Upload expired or unavailable; begin again.',404);
  }
  const dir=folder(u.id);
  if(input.action==='chunk'){
   const bytes=transfer.chunk(u,input.index,input.bytes??input.base64),file=path.join(dir,String(input.index));
   if(fs.existsSync(file)){if(!fs.readFileSync(file).equals(bytes))throw transfer.error('Chunk already has different content.',409);return {uploadId:u.id,index:input.index,duplicate:true};}
   const temp=file+'.part';fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,file);return {uploadId:u.id,index:input.index,duplicate:false};
  }
  if(input.action==='abort'){updateTask(taskId,provider,t=>{t.uploads=(t.uploads||[]).filter(a=>a.id!==u.id);});remove(u.id);return {ok:true};}
  if(input.action==='finish'){
   const destination=path.join(directory,'artifacts',taskId);fs.mkdirSync(destination,{recursive:true});const final=path.join(destination,u.id+'-'+u.name),temp=path.join(dir,'assembling');
   const fd=fs.openSync(temp,'w',0o600),check=transfer.verifier(u);try{for(let i=0;i<u.chunkCount;i++){const file=path.join(dir,String(i));if(!fs.existsSync(file))throw transfer.error('Upload incomplete; use status to resume missing chunks.',409);const bytes=fs.readFileSync(file);check.add(bytes);fs.writeSync(fd,bytes);}check.finish();fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   fs.renameSync(temp,final);const artifact={...transfer.manifest(u),requestKey:u.requestKey,path:final};
   updateTask(taskId,provider,t=>{active(t);t.artifacts=[...(t.artifacts||[]),artifact];t.uploads=(t.uploads||[]).filter(a=>a.id!==u.id);});try{remove(u.id);}catch{}return {artifact};
  }
  if(!['begin','status'].includes(input.action))throw transfer.error('Invalid upload action.');
  const indices=fs.readdirSync(dir).filter(n=>/^\d+$/.test(n)).map(Number);return {...transfer.status(u,indices),transfer:transfer.ticket(u,origin())};
 }
 return {run,cleanup,removeTask(taskId){const t=getTasks().find(t=>t.id===taskId);for(const u of t?.uploads||[])remove(u.id);},writeToken(id,token,index,bytes){for(const t of getTasks()){const u=t.uploads?.find(u=>u.id===id);if(u){if(!transfer.authorized(u,token,now()))throw transfer.error('Invalid upload authorization.',401);return run(t.provider,t.id,{action:'chunk',uploadId:id,index,bytes});}}throw transfer.error('Upload not found.',404);}};
}
module.exports={createArtifactUploads};
