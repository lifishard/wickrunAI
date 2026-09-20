'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {createDurableJson}=require('./durable-json.cjs');
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const EXCLUDED=new Set(['.git','node_modules','.next','dist','build']);
const UUID=/^[a-f0-9-]{36}$/i,HASH=/^[a-f0-9]{64}$/;
function inside(root,p){const rel=path.relative(root,p);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function noLinks(target){
 const absolute=path.resolve(target),parts=absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);let at=path.parse(absolute).root;
 for(const part of parts){at=path.join(at,part);try{if(fs.lstatSync(at).isSymbolicLink())throw Error('目录或祖先已被符号链接替换，停止文件操作');}catch(error){if(error.code!=='ENOENT')throw error;}}
 return absolute;
}
function identity(root){noLinks(root);const st=fs.statSync(root);if(!st.isDirectory())throw Error('文件协作范围必须是目录');return {realPath:fs.realpathSync.native(root),dev:String(st.dev),ino:String(st.ino),birthtimeMs:st.birthtimeMs};}
function sameDirectory(root,expected){
 if(!expected)throw Error('旧隔离记录缺少目录身份，请重新创建隔离区');
 const actual=identity(root);if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('目录身份已变化，停止文件操作');
}
function scan(root){identity(root);const files=Object.create(null);let bytes=0,count=0;
 function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){if(EXCLUDED.has(ent.name))continue;const full=path.join(dir,ent.name),st=fs.lstatSync(full);if(st.isSymbolicLink())throw Error('隔离范围含符号链接，请选择更小的目录：'+full);if(st.isDirectory()){walk(full);continue;}if(!st.isFile())throw Error('隔离范围包含非常规文件');bytes+=st.size;count++;if(bytes>128*1024*1024||count>10000)throw Error('隔离范围超过 128 MB 或 10000 文件，请缩小项目目录');const buf=fs.readFileSync(full);files[path.relative(root,full).split(path.sep).join('/')]=hash(buf);}}
 walk(root);return files;
}
function checked(root,rel){
 noLinks(root);if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.split(/[\\/]/).some(s=>s==='..'||s==='.'||!s||/[<>:"|?*\x00-\x1f]/.test(s)||/[. ]$/.test(s)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))throw Error('文件路径无效');
 const target=path.resolve(root,rel);if(!inside(root,target))throw Error('路径超出隔离范围');noLinks(target);return target;
}
function createTeamFiles(userData){
 const base=path.resolve(userData,'team-files');let baseIdentity;
 function ensureBase(){noLinks(base);fs.mkdirSync(base,{recursive:true});if(baseIdentity)sameDirectory(base,baseIdentity);else baseIdentity=identity(base);noLinks(path.join(base,'sessions.json'));}
 const doc=createDurableJson(path.join(base,'sessions.json'),{initial:()=>({version:1,sessions:{},snapshots:{}}),validate:d=>{if(d?.version!==1||!d.sessions||(d.snapshots!==undefined&&(!d.snapshots||typeof d.snapshots!=='object'||Array.isArray(d.snapshots))))throw Error('文件协作记录版本无效');}});
 function save(rec){ensureBase();doc.update(d=>{d.sessions[rec.id]=rec;});return rec;}
 function rawGet(id){ensureBase();if(typeof id!=='string'||!UUID.test(id))throw Error('隔离编号无效');const rec=doc.read().sessions[id];if(!rec)throw Error('隔离记录不存在');return rec;}
 function check(rec){ensureBase();sameDirectory(rec.root,rec.rootIdentity);sameDirectory(rec.isolatedRoot,rec.isolatedIdentity);if(!inside(path.join(base,rec.id),rec.isolatedRoot))throw Error('隔离记录路径无效');}
 function journalPath(id){return path.join(base,id,'merge.json');}
 function receiveJournalPath(id){return path.join(base,id,'receive.json');}
 function readJournal(rec){
  const file=journalPath(rec.id);noLinks(file);if(!fs.existsSync(file))return null;
  const journal=JSON.parse(fs.readFileSync(file,'utf8'));
  if(journal.id!==rec.id||!Array.isArray(journal.files)||!['prepared','applying','committed','rolled_back','needs_review'].includes(journal.state)||!path.isAbsolute(journal.rollbackRoot)||!inside(path.join(base,rec.id),journal.rollbackRoot))throw Error('合并日志结构无效，需要人工核实');
  for(const f of journal.files){checked(rec.root,f.path);if(![f.beforeHash,f.afterHash].every(h=>h===null||/^[a-f0-9]{64}$/.test(h)))throw Error('合并日志哈希无效');}
  return journal;
 }
 function writeJournal(rec,journal){noLinks(journalPath(rec.id));createDurableJson(journalPath(rec.id),{initial:()=>({})}).write(journal);}
 function readReceiveJournal(rec){
  const file=receiveJournalPath(rec.id);noLinks(file);if(!fs.existsSync(file))return null;const journal=JSON.parse(fs.readFileSync(file,'utf8'));
  if(journal.id!==rec.id||!Array.isArray(journal.snapshotIds)||!journal.snapshotIds.every(id=>UUID.test(id))||!Array.isArray(journal.operations)||!['prepared','applying','committed','rolled_back','needs_review'].includes(journal.state)||typeof journal.rollbackDir!=='string'||!/^pre-receive-[a-f0-9-]{36}$/i.test(journal.rollbackDir))throw Error('接收日志结构无效，需要人工核实');
  for(const operation of journal.operations){checked(rec.isolatedRoot,operation.path);if(![operation.beforeHash,operation.afterHash].every(h=>h===null||HASH.test(h))||!UUID.test(operation.snapshotId)||!['files','before'].includes(operation.area))throw Error('接收日志文件清单无效');}
  return journal;
 }
 function writeReceiveJournal(rec,journal){noLinks(receiveJournalPath(rec.id));createDurableJson(receiveJournalPath(rec.id),{initial:()=>({})}).write(journal);}
 function receiveRollbackRoot(rec,journal){const root=path.join(base,rec.id,journal.rollbackDir);if(!inside(path.join(base,rec.id),root))throw Error('接收备份路径无效');return root;}
 function get(id){const rec=rawGet(id);let issue;
  try{check(rec);const journal=readJournal(rec),receiveJournal=readReceiveJournal(rec);if(receiveJournal&&['prepared','applying','needs_review'].includes(receiveJournal.state))issue='上次工件接收中断，必须先核实并恢复；不会重复接收';else if(journal&&['prepared','applying','needs_review'].includes(journal.state))issue='上次合并中断，必须先核实并恢复；不会重复合并';else if(journal?.state==='committed'&&rec.status!=='merged')issue='文件提交和状态记录不一致，必须核实并恢复';}catch(error){issue=error.message;}
  if(issue&&(!rec.recoveryRequired||rec.recoveryReason!==issue)){rec.recoveryRequired=true;rec.recoveryReason=issue;rec.status='conflict';save(rec);}return rec;
 }
 function create({projectId,taskId,memberId,root},allowedRoots){
  ensureBase();noLinks(root);root=fs.realpathSync.native(root);if(!allowedRoots.some(r=>root===fs.realpathSync.native(noLinks(r))))throw Error('请先在项目设置中选择该目录');
  if(inside(root,base)||inside(base,root))throw Error('不能把应用数据目录作为项目隔离范围');
  const rootIdentity=identity(root),baseline=scan(root),id=crypto.randomUUID(),isolatedRoot=path.join(base,id,'work');fs.mkdirSync(isolatedRoot,{recursive:true});
  for(const rel of Object.keys(baseline)){sameDirectory(root,rootIdentity);const dest=checked(isolatedRoot,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(checked(root,rel),dest);}
  sameDirectory(root,rootIdentity);
  if(JSON.stringify(scan(root))!==JSON.stringify(baseline)||JSON.stringify(scan(isolatedRoot))!==JSON.stringify(baseline))throw Error('复制期间项目文件发生变化，请重新创建隔离区');
  const rec={id,projectId,taskId,memberId,root,rootIdentity,isolatedRoot,isolatedIdentity:identity(isolatedRoot),status:'isolated',files:[],baseline,excluded:[...EXCLUDED],createdAt:Date.now()};return save(rec);
 }
 function diff(id){const rec=get(id);check(rec);if(rec.recoveryRequired)throw Error(rec.recoveryReason||'请先恢复中断合并');if(rec.status==='merged')return rec;
  const after=scan(rec.isolatedRoot);const files=changedFiles(rec,after).map(f=>({...f,status:'pending'}));
  for(const file of files){const target=checked(rec.root,file.path);const now=fs.existsSync(target)?hash(fs.readFileSync(target)):null;if(now!==file.beforeHash)file.status='conflict';}
  rec.files=files;rec.status=files.some(f=>f.status==='conflict')?'conflict':'pending';return save(rec);
 }
 function preview(id,relativePath){const rec=get(id);check(rec);const file=rec.files.find(f=>f.path===relativePath);if(!file)throw Error('请先检查差异');const read=root=>{const p=checked(root,relativePath);if(!fs.existsSync(p))return null;const b=fs.readFileSync(p);if(b.length>512*1024||b.includes(0))return '[二进制或文件超过 512 KB，仅显示哈希]';return b.toString('utf8');};return {path:relativePath,before:read(rec.root),after:read(rec.isolatedRoot)};}
 function atomicReplace(target,bytes){noLinks(target);const tmp=target+'.wickrun-'+crypto.randomUUID()+'.tmp';let fd;try{fs.mkdirSync(path.dirname(target),{recursive:true});fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;noLinks(target);fs.renameSync(tmp,target);}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{}}}
 function changedFiles(rec,after=scan(rec.isolatedRoot)){return [...new Set([...Object.keys(rec.baseline),...Object.keys(after)])].sort().filter(p=>rec.baseline[p]!==after[p]).map(p=>({path:p,beforeHash:rec.baseline[p]??null,afterHash:after[p]??null}));}
 function publicSnapshot(rec){const {id,sessionId,projectId,taskId,memberId,nodeId,attemptId,version,createdAt,digest,files}=rec;return {id,sessionId,projectId,taskId,memberId,nodeId,attemptId,version,createdAt,digest,files};}
 function digestSnapshot(snapshot){const value={id:snapshot.id,sessionId:snapshot.sessionId,projectId:snapshot.projectId,taskId:snapshot.taskId,memberId:snapshot.memberId,nodeId:snapshot.nodeId,attemptId:snapshot.attemptId,version:snapshot.version,createdAt:snapshot.createdAt,files:snapshot.files};return hash(Buffer.from(JSON.stringify(value)));}
 function artifactRoot(id){const root=path.join(base,'artifacts',id);if(!inside(base,root))throw Error('快照存储路径无效');return root;}
 function validateSnapshotShape(snapshot){
  if(!snapshot||typeof snapshot!=='object'||!UUID.test(snapshot.id)||!UUID.test(snapshot.sessionId)||![snapshot.projectId,snapshot.taskId,snapshot.memberId,snapshot.nodeId,snapshot.attemptId].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)||!Number.isSafeInteger(snapshot.version)||snapshot.version<1||!Number.isSafeInteger(snapshot.createdAt)||!HASH.test(snapshot.digest)||!Array.isArray(snapshot.files)||snapshot.files.length>10000)throw Error('工件快照结构无效');
  let previous='';for(const file of snapshot.files){checked(artifactRoot(snapshot.id),file.path);if(file.path<=previous||![file.beforeHash,file.afterHash].every(v=>v===null||HASH.test(v))||file.beforeHash===file.afterHash)throw Error('工件快照文件清单无效');previous=file.path;}
 }
 function rawSnapshot(id){ensureBase();if(typeof id!=='string'||!UUID.test(id))throw Error('工件快照编号无效');const rec=(doc.read().snapshots||{})[id];if(!rec)throw Error('工件快照不存在');validateSnapshotShape(publicSnapshot(rec));return rec;}
 function publish(id,metadata){
  if(!metadata||typeof metadata!=='object'||![metadata.nodeId,metadata.attemptId].every(v=>typeof v==='string'&&v.length>0&&v.length<=256))throw Error('工件来源信息无效');
  const rec=diff(id);check(rec);if(rec.recoveryRequired||rec.status==='merged'||rec.status==='conflict')throw Error('当前隔离区不能发布工件快照');
  const files=rec.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})).sort((a,b)=>a.path.localeCompare(b.path));
  const data=doc.read(),versions=Object.values(data.snapshots||{}).filter(s=>s.sessionId===id).map(s=>s.version),snapshotId=crypto.randomUUID(),createdAt=Date.now();
  const snapshot={id:snapshotId,sessionId:id,projectId:rec.projectId,taskId:rec.taskId,memberId:rec.memberId,nodeId:metadata.nodeId,attemptId:metadata.attemptId,version:(versions.length?Math.max(...versions):0)+1,createdAt,files};snapshot.digest=digestSnapshot(snapshot);validateSnapshotShape(snapshot);
  const root=artifactRoot(snapshotId),filesRoot=path.join(root,'files'),beforeRoot=path.join(root,'before'),artifacts=path.dirname(root);noLinks(artifacts);fs.mkdirSync(artifacts,{recursive:true});noLinks(root);fs.mkdirSync(root);
  try{
   fs.mkdirSync(filesRoot);fs.mkdirSync(beforeRoot);
   for(const file of files){check(rec);if(file.beforeHash){const bytes=fs.readFileSync(checked(rec.root,file.path));if(hash(bytes)!==file.beforeHash)throw Error('发布期间原始文件发生变化：'+file.path);atomicReplace(checked(beforeRoot,file.path),bytes);}if(file.afterHash){const bytes=fs.readFileSync(checked(rec.isolatedRoot,file.path));if(hash(bytes)!==file.afterHash)throw Error('发布期间隔离文件发生变化：'+file.path);atomicReplace(checked(filesRoot,file.path),bytes);}}
   if(JSON.stringify(changedFiles(rec))!==JSON.stringify(files))throw Error('发布期间隔离文件发生变化');
   atomicReplace(path.join(root,'manifest.json'),Buffer.from(JSON.stringify(snapshot)));
   const stored={...snapshot,root:rec.root,rootIdentity:rec.rootIdentity};doc.update(d=>{d.snapshots=d.snapshots||{};if(d.snapshots[snapshotId])throw Error('工件快照编号冲突');d.snapshots[snapshotId]=stored;});return publicSnapshot(stored);
  }catch(error){try{fs.rmSync(root,{recursive:true,force:true});}catch{}throw error;}
 }
 function validateSnapshot(id){
  const stored=rawSnapshot(id),snapshot=publicSnapshot(stored),root=artifactRoot(id);noLinks(root);if(!fs.statSync(root).isDirectory())throw Error('工件快照存储无效');
  const manifestPath=path.join(root,'manifest.json');noLinks(manifestPath);let manifest;try{manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));}catch(error){throw Error('工件快照清单损坏：'+error.message);}
  validateSnapshotShape(manifest);if(JSON.stringify(publicSnapshot(manifest))!==JSON.stringify(snapshot)||digestSnapshot(snapshot)!==snapshot.digest)throw Error('工件快照清单校验失败');
  const filesRoot=path.join(root,'files'),beforeRoot=path.join(root,'before'),actual=scan(filesRoot),before=scan(beforeRoot),expected=Object.fromEntries(snapshot.files.filter(f=>f.afterHash).map(f=>[f.path,f.afterHash])),expectedBefore=Object.fromEntries(snapshot.files.filter(f=>f.beforeHash).map(f=>[f.path,f.beforeHash]));if(JSON.stringify(actual)!==JSON.stringify(expected)||JSON.stringify(before)!==JSON.stringify(expectedBefore))throw Error('工件快照文件校验失败');
  const source=rawGet(snapshot.sessionId);check(source);if(source.projectId!==snapshot.projectId||source.taskId!==snapshot.taskId||source.memberId!==snapshot.memberId||source.root!==stored.root||JSON.stringify(source.rootIdentity)!==JSON.stringify(stored.rootIdentity))throw Error('工件快照来源范围已变化');
  const current=changedFiles(source);if(JSON.stringify(current)!==JSON.stringify(snapshot.files))throw Error('工件快照已过期，发布者文件已变化');return snapshot;
 }
 function receive(targetSessionId,snapshotIds){
  if(!Array.isArray(snapshotIds)||!snapshotIds.length||snapshotIds.length>64||snapshotIds.some(id=>typeof id!=='string'||!UUID.test(id)))throw Error('接收工件快照编号无效');
  const target=get(targetSessionId);check(target);if(target.recoveryRequired)throw Error(target.recoveryReason||'请先恢复中断的工件接收');if(target.status==='merged')throw Error('当前隔离区不能接收工件快照');
  const received=Array.isArray(target.received)?target.received:[],seen=new Set(),incoming=[];
  for(const id of snapshotIds){if(seen.has(id))continue;seen.add(id);if(received.some(r=>r.snapshotId===id))continue;const snapshot=validateSnapshot(id),stored=rawSnapshot(id);
   if(snapshot.memberId===target.memberId)throw Error('工件快照必须由另一成员接收');
   if(snapshot.projectId!==target.projectId||snapshot.taskId!==target.taskId||stored.root!==target.root||JSON.stringify(stored.rootIdentity)!==JSON.stringify(target.rootIdentity))throw Error('工件快照与接收隔离区范围不一致');incoming.push({snapshot,stored});
  }
  if(!incoming.length)return get(targetSessionId);
  const current=scan(target.isolatedRoot),proposed=new Map(Object.entries(current)),latestVersion=new Map(),activeFiles=new Map();
  for(const provenance of received){const key=provenance.sessionId;latestVersion.set(key,Math.max(latestVersion.get(key)||0,provenance.version||0));let active=activeFiles.get(key);if(!active){active=new Map();activeFiles.set(key,active);}for(const file of provenance.files||[])active.set(file.path,{...file,snapshotId:provenance.snapshotId});for(const file of provenance.reverted||[])active.delete(file.path);}
  const operations=new Map(),newProvenance=[];
  for(const {snapshot} of incoming){const priorVersion=latestVersion.get(snapshot.sessionId)||0;if(snapshot.version<=priorVersion)throw Error('工件快照版本早于已接收版本');
   let active=activeFiles.get(snapshot.sessionId);if(!active){active=new Map();activeFiles.set(snapshot.sessionId,active);}const nextPaths=new Set(snapshot.files.map(f=>f.path)),reverted=[];
   for(const [rel,prior] of active){if(nextPaths.has(rel))continue;const actual=proposed.get(rel)??null;if(actual!==prior.afterHash)throw Error('接收隔离区文件与工件来源冲突：'+rel);proposed.set(rel,prior.beforeHash);operations.set(rel,{desiredHash:prior.beforeHash,snapshotId:prior.snapshotId,area:'before'});reverted.push({path:rel,beforeHash:prior.beforeHash,afterHash:prior.afterHash});active.delete(rel);}
   for(const file of snapshot.files){const prior=active.get(file.path),expected=prior?prior.afterHash:file.beforeHash,actual=proposed.get(file.path)??null;if(actual!==expected)throw Error('接收隔离区文件与工件来源冲突：'+file.path);proposed.set(file.path,file.afterHash);operations.set(file.path,{desiredHash:file.afterHash,snapshotId:snapshot.id,area:'files'});active.set(file.path,{...file,snapshotId:snapshot.id});}
   latestVersion.set(snapshot.sessionId,snapshot.version);newProvenance.push({snapshotId:snapshot.id,sessionId:snapshot.sessionId,memberId:snapshot.memberId,nodeId:snapshot.nodeId,attemptId:snapshot.attemptId,version:snapshot.version,digest:snapshot.digest,receivedAt:Date.now(),files:snapshot.files,reverted});
  }
  const backups=new Map();for(const [rel] of operations){const p=checked(target.isolatedRoot,rel);backups.set(rel,fs.existsSync(p)?fs.readFileSync(p):null);}
  const rollbackDir='pre-receive-'+crypto.randomUUID(),rollbackRoot=path.join(base,target.id,rollbackDir);fs.mkdirSync(rollbackRoot,{recursive:true});const journal={id:target.id,at:Date.now(),state:'prepared',snapshotIds:newProvenance.map(item=>item.snapshotId),operations:[...operations].map(([path,{desiredHash,snapshotId,area}])=>({path,beforeHash:backups.get(path)===null?null:hash(backups.get(path)),afterHash:desiredHash,snapshotId,area})),rollbackDir};
  const prior=receiveJournalPath(target.id);if(fs.existsSync(prior)){noLinks(prior);fs.copyFileSync(prior,path.join(base,target.id,'receive-history-'+crypto.randomUUID()+'.json'));}
  for(const operation of journal.operations){if(operation.beforeHash)atomicReplace(checked(rollbackRoot,operation.path),backups.get(operation.path));}writeReceiveJournal(target,journal);let recordSaved=false;
  try{
   journal.state='applying';writeReceiveJournal(target,journal);
   for(const [rel,{desiredHash,snapshotId,area}] of operations){check(target);const dest=checked(target.isolatedRoot,rel),now=fs.existsSync(dest)?hash(fs.readFileSync(dest)):null,expected=backups.get(rel)===null?null:hash(backups.get(rel));if(now!==expected)throw Error('接收期间隔离文件发生变化：'+rel);if(desiredHash){const bytes=fs.readFileSync(checked(path.join(artifactRoot(snapshotId),area),rel));if(hash(bytes)!==desiredHash)throw Error('工件快照文件校验失败：'+rel);atomicReplace(dest,bytes);}else if(fs.existsSync(dest))fs.unlinkSync(dest);}
   for(const [rel,desired] of proposed){const p=checked(target.isolatedRoot,rel),now=fs.existsSync(p)?hash(fs.readFileSync(p)):null;if(now!==desired)throw Error('接收期间隔离文件发生变化：'+rel);}
   const after=scan(target.isolatedRoot),expectedAfter=Object.fromEntries([...proposed].filter(([,value])=>value!==null).sort(([a],[b])=>a.localeCompare(b)));if(JSON.stringify(after)!==JSON.stringify(expectedAfter))throw Error('接收期间隔离文件发生变化');const files=changedFiles(target,after).map(f=>({...f,status:'pending'}));for(const file of files){const p=checked(target.root,file.path),now=fs.existsSync(p)?hash(fs.readFileSync(p)):null;if(now!==file.beforeHash)file.status='conflict';}target.received=[...received,...newProvenance];target.files=files;target.status=files.some(f=>f.status==='conflict')?'conflict':'pending';const saved=save(target);recordSaved=true;journal.state='committed';writeReceiveJournal(target,journal);return saved;
  }catch(error){if(recordSaved)throw Error('工件接收状态记录已保存，但完成日志中断；请执行恢复检查。'+error.message);let recoveryError;try{rollbackReceive(target,journal);journal.state='rolled_back';writeReceiveJournal(target,journal);}catch(e){recoveryError=e.message;journal.state='needs_review';journal.error=recoveryError;try{writeReceiveJournal(target,journal);}catch{}target.status='conflict';target.recoveryRequired=true;target.recoveryReason=recoveryError;try{save(target);}catch{}}throw Error(recoveryError?'工件接收未完成，原件和日志保留；请执行恢复检查。'+recoveryError:error.message);}
 }
 function rollback(rec,journal){
  check(rec);const work=[];
  // Preflight the entire rollback before altering any file. Changed user files
  // are never overwritten, even if a previous merge touched their siblings.
  for(const f of journal.files){const target=checked(rec.root,f.path),now=fs.existsSync(target)?hash(fs.readFileSync(target)):null;if(now===f.beforeHash)continue;if(now!==f.afterHash)throw Error('主文件既不匹配合并前也不匹配合并后，保留现场：'+f.path);let before=null;if(f.beforeHash){before=fs.readFileSync(checked(journal.rollbackRoot,f.path));if(hash(before)!==f.beforeHash)throw Error('合并前备份校验失败：'+f.path);}work.push({f,target,before});}
  for(const {f,target,before} of work){check(rec);const now=fs.existsSync(target)?hash(fs.readFileSync(target)):null;if(now!==f.afterHash)throw Error('恢复期间主文件变化，保留现场：'+f.path);if(before)atomicReplace(target,before);else if(fs.existsSync(target))fs.unlinkSync(target);}
  journal.state='rolled_back';writeJournal(rec,journal);
 }
 function receiveHash(rec,operation){const target=checked(rec.isolatedRoot,operation.path);return fs.existsSync(target)?hash(fs.readFileSync(target)):null;}
 function rollbackReceive(rec,journal){
  check(rec);const work=[];
  const rollbackRoot=receiveRollbackRoot(rec,journal);for(const operation of journal.operations){const now=receiveHash(rec,operation);if(now!==operation.beforeHash&&now!==operation.afterHash)throw Error('接收文件既不匹配接收前也不匹配工件，保留现场：'+operation.path);let before=null;if(operation.beforeHash){before=fs.readFileSync(checked(rollbackRoot,operation.path));if(hash(before)!==operation.beforeHash)throw Error('接收前备份校验失败：'+operation.path);}if(now!==operation.beforeHash)work.push({operation,before});}
  for(const {operation,before} of work){check(rec);if(receiveHash(rec,operation)!==operation.afterHash)throw Error('恢复期间接收文件变化，保留现场：'+operation.path);const target=checked(rec.isolatedRoot,operation.path);if(before)atomicReplace(target,before);else if(fs.existsSync(target))fs.unlinkSync(target);}
 }
 function recoverReceive(rec,journal){
  try{
   const recorded=new Set((rec.received||[]).map(item=>item.snapshotId)),allRecorded=journal.snapshotIds.every(id=>recorded.has(id)),allAfter=journal.operations.every(operation=>receiveHash(rec,operation)===operation.afterHash);
   if(journal.state==='committed'){rec.recoveryRequired=false;delete rec.recoveryReason;save(rec);return diff(rec.id);}
   if(allRecorded&&allAfter){rec.recoveryRequired=false;delete rec.recoveryReason;save(rec);journal.state='committed';writeReceiveJournal(rec,journal);return diff(rec.id);}
   if(journal.state!=='rolled_back')rollbackReceive(rec,journal);rec.received=(rec.received||[]).filter(item=>!journal.snapshotIds.includes(item.snapshotId));if(!rec.received.length)delete rec.received;rec.recoveryRequired=false;delete rec.recoveryReason;rec.status='isolated';save(rec);if(journal.state!=='rolled_back'){journal.state='rolled_back';writeReceiveJournal(rec,journal);}return diff(rec.id);
  }catch(error){journal.state='needs_review';journal.error=error.message;try{writeReceiveJournal(rec,journal);}catch{}rec.recoveryRequired=true;rec.recoveryReason=error.message;rec.status='conflict';try{save(rec);}catch{}throw Error('工件接收恢复未完成，原件和日志保留：'+error.message);}
 }
 function recover(id){const rec=rawGet(id);check(rec);const receiveJournal=readReceiveJournal(rec);if(receiveJournal&&(['prepared','applying','needs_review'].includes(receiveJournal.state)||(receiveJournal.state==='committed'&&rec.recoveryRequired&&/工件接收/.test(rec.recoveryReason||''))))return recoverReceive(rec,receiveJournal);const journal=readJournal(rec);
  if(!journal)throw Error('没有可恢复的合并或接收日志');if(rec.status==='merged'&&journal.state==='committed')throw Error('已完成合并不能通过中断恢复撤销，请新建修改');
  try{rollback(rec,journal);rec.recoveryRequired=false;delete rec.recoveryReason;rec.status='isolated';save(rec);return diff(id);}catch(error){rec.recoveryRequired=true;rec.recoveryReason=error.message;rec.status='conflict';save(rec);throw Error('恢复未完成，原件和日志保留：'+error.message);}
 }
 function merge(id,expectedFiles){
  const rec=diff(id);if(rec.status==='merged')throw Error('此隔离区已合并，不会重复执行');if(rec.status==='conflict')throw Error('主工作区已变化，需先处理冲突');
  if(JSON.stringify(rec.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash})))!==JSON.stringify(expectedFiles))throw Error('差异已变化，请重新检查后合并');
  check(rec);const rollbackRoot=path.join(base,id,'pre-merge-'+crypto.randomUUID());fs.mkdirSync(rollbackRoot,{recursive:true});
  const journal={id,at:Date.now(),state:'prepared',files:rec.files,rollbackRoot};
  const prior=journalPath(id);if(fs.existsSync(prior)){noLinks(prior);fs.copyFileSync(prior,path.join(base,id,'merge-history-'+crypto.randomUUID()+'.json'));}
  for(const f of rec.files){if(f.beforeHash){const back=checked(rollbackRoot,f.path),bytes=fs.readFileSync(checked(rec.root,f.path));if(hash(bytes)!==f.beforeHash)throw Error('合并前主文件变化');atomicReplace(back,bytes);}}
  writeJournal(rec,journal);
  try{
   journal.state='applying';writeJournal(rec,journal);
   for(const f of rec.files){check(rec);const target=checked(rec.root,f.path);const now=fs.existsSync(target)?hash(fs.readFileSync(target)):null;if(now!==f.beforeHash)throw Error('合并期间主工作区发生变化：'+f.path);
    if(f.afterHash){const buf=fs.readFileSync(checked(rec.isolatedRoot,f.path));if(hash(buf)!==f.afterHash)throw Error('隔离区已变化');atomicReplace(target,buf);}else fs.unlinkSync(target);
   }
   journal.state='committed';writeJournal(rec,journal);rec.status='merged';rec.files=rec.files.map(f=>({...f,status:'merged'}));return save(rec);
  }catch(error){
   let recoveryError;try{rollback(rec,journal);}catch(e){recoveryError=e.message;journal.state='needs_review';journal.error=recoveryError;try{writeJournal(rec,journal);}catch{}}
   rec.status='conflict';rec.recoveryRequired=true;rec.recoveryReason=recoveryError||'合并失败，已还原原文件；请核实恢复记录后继续';try{save(rec);}catch{}
   throw Error('合并未完成，原件和日志已保留；请执行恢复检查。'+(recoveryError||error.message));
  }
 }
 return {create,diff,preview,merge,recover,publish,validateSnapshot,receive,get,list:()=>{ensureBase();return Object.keys(doc.read().sessions).map(get);}};
}
module.exports={createTeamFiles,scan,checked,noLinks,identity};
