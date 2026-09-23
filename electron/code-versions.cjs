'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createDurableJson}=require('./durable-json.cjs');
const {guardPath}=require('./tools/common.cjs');
const digest=value=>value===null?null:crypto.createHash('sha256').update(value).digest('hex');
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
function identity(p){let probe=p;while(!fs.existsSync(probe)){const parent=path.dirname(probe);if(parent===probe)throw Error('文件路径无法解析');probe=parent;}return key(path.join(fs.realpathSync(probe),path.relative(probe,p)));}
function current(p){try{const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink>1||s.size>512*1024)throw Error('目标不再是可回退的普通文本文件');return fs.readFileSync(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function createCodeVersions(root,{replace=fs.renameSync.bind(fs)}={}){
  const blobs=path.join(root,'blobs');
  const db=createDurableJson(path.join(root,'versions.json'),{initial:()=>({version:1,entries:{},transaction:null}),validate:d=>{if(d?.version!==1||!d.entries||typeof d.entries!=='object')throw Error('代码版本记录损坏');}});
  function put(text){if(text===null)return null;const data=Buffer.from(text,'utf8'),id=digest(data);fs.mkdirSync(blobs,{recursive:true});const file=path.join(blobs,id);if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}else if(digest(fs.readFileSync(file))!==id)throw Error('代码快照损坏');return id;}
  function get(id){if(id===null)return null;if(!/^[a-f0-9]{64}$/.test(id))throw Error('代码快照编号无效');const bytes=fs.readFileSync(path.join(blobs,id));if(digest(bytes)!==id)throw Error('代码快照校验失败，已停止回退');return bytes;}
  const view=e=>({id:e.id,status:e.status,reviewedAt:e.reviewedAt,revertedAt:e.revertedAt,path:e.path});
  function assertReady(){if(db.read().transaction)throw Error('上次代码回退尚未完成，请先在代码改动面板继续回退并核实结果。');}
  function record(change,before,after,modes={}){
    assertReady();const beforeRef=put(before),afterRef=put(after);
    const entry={id:change.id,path:path.resolve(change.path),identity:identity(change.path),beforeRef,afterRef,beforeMode:modes.beforeMode,afterMode:modes.afterMode,at:change.at,status:'applied'};
    db.update(d=>{if(d.entries[entry.id])throw Error('代码版本编号重复');entry.order=Object.keys(d.entries).length;d.entries[entry.id]=entry;});return entry.id;
  }
  function select(ids){if(!Array.isArray(ids)||!ids.length||ids.length>4000||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw Error('请选择有效的代码版本');const d=db.read();const entries=ids.map(id=>{const e=d.entries[id];if(!e)throw Error('版本快照不存在；旧记录只能查看差异，不能自动回退');return e;}).sort((a,b)=>a.order-b.order);return {d,entries};}
  function summary(ids){const {d,entries}=select(ids);return {entries:entries.map(view),recovering:Boolean(d.transaction&&d.transaction.ids.some(id=>ids.includes(id)))};}
  function group(entries){
    const grouped=new Map();for(const e of entries){const k=key(e.path),f=grouped.get(k);if(f){if(f.afterRef!==e.beforeRef||f.identity!==e.identity)throw Error(`改动之间存在其他编辑，不能合并为一个版本：${e.path}`);f.afterRef=e.afterRef;f.afterMode=e.afterMode;}else grouped.set(k,{path:e.path,identity:e.identity,beforeRef:e.beforeRef,afterRef:e.afterRef,beforeMode:e.beforeMode,afterMode:e.afterMode});}
    return [...grouped.values()];
  }
  function details(ids){const {entries}=select(ids),result=summary(ids);try{const {difference}=require('./code-changes.cjs');return {...result,files:group(entries).map((f,i)=>({id:ids[0]+':'+i,path:f.path,kind:f.beforeRef===null?'added':f.afterRef===null?'deleted':'modified',status:'applied',at:entries[0].at,beforeHash:f.beforeRef,afterHash:f.afterRef,...difference(get(f.beforeRef)?.toString('utf8')??null,get(f.afterRef)?.toString('utf8')??null)}))};}catch(error){return {...result,files:[],warning:error.message};}}
  function file(ids,requestedPath){const {entries}=select(ids);if(typeof requestedPath!=='string')throw Error('请选择版本中的文件');const f=group(entries).find(f=>key(f.path)===key(requestedPath));if(!f)throw Error('该文件不属于所选版本');return {...summary(ids),files:[{id:ids[0]+':full',path:f.path,kind:f.beforeRef===null?'added':f.afterRef===null?'deleted':'modified',status:entries.every(e=>e.status==='reverted')?'reverted':'applied',at:entries[0].at,beforeHash:f.beforeRef,afterHash:f.afterRef,...require('./code-changes.cjs').difference(get(f.beforeRef)?.toString('utf8')??null,get(f.afterRef)?.toString('utf8')??null,true)}]};}
  function plan(ids,roots){
    const {d,entries}=select(ids);const recovery=d.transaction;
    if(recovery&&(recovery.ids.length!==ids.length||!recovery.ids.every(id=>ids.includes(id))))throw Error('请先恢复上次未完成的整轮回退');
    if(entries.every(e=>e.status==='reverted'))return {entries,files:[],alreadyReverted:true,recovering:false};
    if(entries.some(e=>e.status==='reverted'))throw Error('该版本部分改动已回退，请刷新后选择剩余改动');
    const files=[];
    if(recovery)files.push(...recovery.files);
    else {
      files.push(...group(entries));
    }
    // Check the complete batch before the first write, including both backups.
    for(const f of files){guardPath(f.path,roots);if(identity(f.path)!==f.identity)throw Error(`目标位置已改变，未回退：${f.path}`);get(f.beforeRef);get(f.afterRef);const actual=digest(current(f.path));if(actual!==f.afterRef&&!(recovery&&actual===f.beforeRef))throw Error(`文件已有后续修改，未回退：${f.path}`);if(actual===f.afterRef&&actual!==null&&f.afterMode!==undefined&&(fs.statSync(f.path).mode&0o777)!==(f.afterMode&0o777))throw Error(`文件权限已改变，未回退：${f.path}`);}
    return {entries,files,recovering:Boolean(recovery),alreadyReverted:false};
  }
  function preview(ids,roots){const p=plan(ids,roots);const {difference}=require('./code-changes.cjs');return {recovering:p.recovering,alreadyReverted:p.alreadyReverted,files:p.files.map(f=>({path:f.path,kind:f.beforeRef===null?'deleted':f.afterRef===null?'added':'modified',...difference(get(f.afterRef)?.toString('utf8')??null,get(f.beforeRef)?.toString('utf8')??null)}))};}
  function keep(ids){assertReady();const {entries}=select(ids);if(entries.some(e=>e.status==='reverted'))throw Error('已回退的版本不能标记为保留');db.update(d=>{for(const e of entries){d.entries[e.id].status='kept';d.entries[e.id].reviewedAt=Date.now();}});return summary(ids);}
  function revert(ids,roots){
    const p=plan(ids,roots);if(p.alreadyReverted)return summary(ids);
    if(!p.recovering)db.update(d=>{d.transaction={id:crypto.randomUUID(),ids:[...ids],files:p.files,at:Date.now()};for(const e of p.entries)d.entries[e.id].status='reverting';});
    try{
      for(const f of p.files){
        guardPath(f.path,roots);if(identity(f.path)!==f.identity)throw Error('文件位置发生变化');const actual=digest(current(f.path));
        if(actual===f.beforeRef)continue;
        if(actual!==f.afterRef)throw Error(`文件发生后续修改：${f.path}`);
        const before=get(f.beforeRef);
        if(before===null)fs.unlinkSync(f.path);
        else {
          fs.mkdirSync(path.dirname(f.path),{recursive:true});const temp=path.join(path.dirname(f.path),`.wickrun-revert-${crypto.randomUUID()}.tmp`);
          try{fs.writeFileSync(temp,before,{flag:'wx',mode:f.beforeMode??0o666});if(digest(current(f.path))!==f.afterRef||identity(f.path)!==f.identity)throw Error('写入前文件发生变化');replace(temp,f.path);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
        }
      }
      db.update(d=>{for(const id of ids){d.entries[id].status='reverted';d.entries[id].revertedAt=Date.now();}d.transaction=null;});
      return summary(ids);
    }catch(error){throw Error(`回退未全部完成，快照和恢复记录已保留。请排除文件占用或冲突后「继续回退」。${error.message}`);}
  }
  return {record,summary,details,file,preview,keep,revert,assertReady};
}
let singleton;
function runtimeVersions(){if(singleton)return singleton;const app=require('electron').app;if(!app?.getPath)return null;return singleton=createCodeVersions(path.join(app.getPath('userData'),'code-versions-v1'));}
function archive(change,before,after,modes){try{const store=runtimeVersions();if(!store)return {...change,revertUnavailable:'当前执行环境没有本机版本存储'};return {...change,revisionId:store.record(change,before,after,modes)};}catch(error){return {...change,revertUnavailable:`快照未保存，不能自动回退：${error.message}`};}}
// The durable ledger also invalidates saved execution checkpoints after a revert.
// Re-run on load so a crash between restoring files and updating chat is recoverable.
function reconcileRuns(journal,versions){
  const records=journal.list();if(!versions)return records;
  for(const record of records){
    const state=record.state,changes=(state.steps??[]).flatMap(s=>s.codeChanges??[]).filter(c=>c.revisionId&&c.status!=='reverted');
    if(!changes.length)continue;
    const reverted=new Set();for(const c of changes){try{if(versions.summary([c.revisionId]).entries[0].status==='reverted')reverted.add(c.revisionId);}catch{/* imported records may have no local snapshots */}}
    if(!reverted.size)continue;
    const paths=new Set(changes.filter(c=>reverted.has(c.revisionId)).map(c=>key(c.path)));
    const note={id:'code-revert-'+crypto.randomUUID(),role:'user',content:'用户已回退以下已记录的代码改动。原交付结论和验证已失效；后续任务必须重新读取文件并验证，不要自动重做已回退的修改。\n'+[...paths].join('\n'),createdAt:Date.now()};
    state.steps=state.steps.map(s=>({...s,codeChanges:s.codeChanges?.map(c=>reverted.has(c.revisionId)?{...c,status:'reverted'}:c),files:s.files?.filter(f=>!paths.has(key(f.path))),filePath:s.filePath&&paths.has(key(s.filePath))?undefined:s.filePath}));
    for(const r of state.requirements??[]){if(r.verification){r.verificationHistory=[...(r.verificationHistory??[]),r.verification];delete r.verification;}}
    state.delivery=undefined;state.status='paused';state.reason='代码改动已回退，需要重新检查项目';state.at=Date.now();state.replanPending=true;
    state.pendingInputMessages=[...(state.pendingInputMessages??[]),note];state.working.push(note);
    state.content=(state.content??'')+'\n\n【代码版本已回退】此前交付与验证结果需要重新检查。';
    journal.save(record);
  }
  return records;
}
module.exports={createCodeVersions,runtimeVersions,archive,reconcileRuns};
