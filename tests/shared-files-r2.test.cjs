const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');
const {File,Blob}=require('node:buffer');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const limit=100*1024*1024;
const api=loader({[path.join(root,'shared-resources.ts')]:{SHARED_FILE_MAX_BYTES:limit},[path.join(root,'cloud-api.ts')]:{cloudAccountIdentity:async()=> 'alice'}})(path.join(root,'shared-files.ts'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ok=()=>({ok:true,status:200});
const item=payload=>({id:'file-item',kind:'file',title:'Video',payload});
const BLOB='11111111-2222-3333-4444-555555555555';

/** A stand-in for the server and the bucket: it records what was asked and what was sent. */
function bucket({mode='multipart',partSize=16*1024*1024,have=[],failPut=0,status='pending'}={}) {
 const calls=[],sent=[];let fails=failPut;
 const call=async(operation,input)=>{
  calls.push({operation,input});
  if(operation==='fileR2Begin')return {id:BLOB,mode,status,size:input.size,contentScheme:input.contentScheme,contentRoot:input.contentRoot,partSize,partCount:Math.ceil(input.size/partSize),completedParts:have.map(n=>({partNumber:n,size:partSize}))};
  if(operation==='fileR2Parts')return {parts:input.partNumbers.map(n=>({partNumber:n,url:`https://bucket.test/part/${n}`}))};
  if(operation==='fileR2Finish'){const start=calls.findLast(c=>c.operation==='fileR2Begin').input;return {id:BLOB,mode:'multipart',size:start.size,status:'ready',contentScheme:start.contentScheme,contentRoot:start.contentRoot,verifiedAt:1,payload:{storage:'r2',blobId:BLOB,name:start.name,mime:start.mime,size:start.size}};}
  if(operation==='fileR2Abort')return {ok:true};
  if(operation==='fileR2Url')return {url:'https://bucket.test/get',name:'promo.mp4',mime:'video/mp4',size:0};
  throw Object.assign(Error('Unexpected operation '+operation),{status:500});
 };
 const put=async(url,body)=>{
  if(fails>0){fails--;return {ok:false,status:503};}
  sent.push({url,size:body.size,bytes:Buffer.from(await body.arrayBuffer())});return ok();
 };
 return {calls,sent,call,put};
}

test('a video goes straight to the bucket in one request and the item gets a compact manifest',async()=>{
 const bytes=crypto.randomBytes(5000),server=bucket(),progress=[];
 const uploaded=await api.uploadSharedFile('file-item',new File([bytes],'promo.mp4',{type:'video/mp4'}),{call:server.call,put:server.put,objectStorage:true,onProgress:p=>progress.push(p)});
 assert.deepEqual(server.calls.map(c=>c.operation),['fileR2Begin','fileR2Parts','fileR2Finish']);
 assert.equal(server.sent.length,1);assert.equal(server.sent[0].url,'https://bucket.test/part/1');assert.ok(server.sent[0].bytes.equals(bytes));
 assert.equal(uploaded.storage,'r2');assert.equal(uploaded.blobId,BLOB);assert.equal(uploaded.sha256,hash(bytes));assert.equal(server.calls[0].input.contentRoot,hash(JSON.stringify(['wickrun-media-content-v1',bytes.length,4*1024*1024,[hash(bytes)]])));
 assert.equal(uploaded.chunkSize,undefined);
 assert.deepEqual(progress.at(-1),{done:5000,total:5000,direction:'upload',phase:'done'});
});

test('a large file is sent in parts, skips parts already stored, and declares its content root',async()=>{
 const bytes=Buffer.alloc(48*1024**2+95,7),server=bucket({have:[1,2]});
 const file=new File([bytes],'big.mp4',{type:'video/mp4'});
 const uploaded=await api.uploadSharedFile('file-item',file,{call:server.call,put:server.put,objectStorage:true});
 const urls=server.sent.map(s=>s.url).sort();
 assert.equal(server.sent.length,2,'4 parts minus the 2 already stored');
 assert.ok(!urls.includes('https://bucket.test/part/1')&&!urls.includes('https://bucket.test/part/2'));
 const assembled=Buffer.concat(server.sent.sort((a,b)=>Number(a.url.split('/').pop())-Number(b.url.split('/').pop())).map(s=>s.bytes));
 assert.ok(assembled.equals(bytes.subarray(32*1024**2)),'parts carry the right byte ranges');
 const batches=server.calls.filter(c=>c.operation==='fileR2Parts');assert.ok(batches.every(c=>c.input.partNumbers.length<=4));
 assert.equal(uploaded.size,bytes.length);
});

test('a 5 GB file hashes bounded slices and never reads the whole file into memory',async t=>{
 let reads=0;
 const size=5*1024**3,chunk=4*1024**2,buffer=new ArrayBuffer(chunk),slices=[];
 t.mock.method(globalThis.crypto.subtle,'digest',async()=>new ArrayBuffer(32));
 const fake={name:'big.mp4',type:'video/mp4',size,lastModified:1,arrayBuffer:async()=>{reads++;throw Error('whole file forbidden');},slice:(start,end)=>({size:end-start,arrayBuffer:async()=>{slices.push(end-start);assert(end-start<=chunk);return buffer;}})};
 const server=bucket();let parts=0;
 const uploaded=await api.uploadSharedFile('file-item',fake,{call:server.call,put:async()=>{parts++;return ok();},objectStorage:true});
 assert.equal(reads,0);assert.equal(parts,320);assert.equal(slices.length,1280);assert.equal(uploaded.sha256,undefined);
 await assert.rejects(api.uploadSharedFile('file-item',{...fake,size:5*1024**3+1},{call:server.call,objectStorage:true}),/5 GB/);
 await assert.rejects(api.uploadSharedFile('file-item',{...fake,size:limit+1},{call:server.call,objectStorage:false}),/100 MB/);
});

test('a server without strict object storage cannot silently downgrade a nonempty upload',async()=>{
 const bytes=Buffer.from('fallback'),calls=[];
 const call=async(operation,input)=>{
  calls.push(operation);
  if(operation==='fileR2Begin')throw Object.assign(Error('Object storage is not set up on this server.'),{status:501});
  if(operation==='fileBegin')return {uploadId:'u',chunkSize:512*1024,chunkCount:1,missing:[0]};
  if(operation==='fileChunk')return {index:0};
  if(operation==='fileFinish')return {payload:{name:'a.bin',mime:'application/octet-stream',size:bytes.length,blobId:'b',sha256:hash(bytes),chunkSize:512*1024}};
  throw Error('Unexpected '+operation);
 };
 await assert.rejects(api.uploadSharedFile('file-item',new File([bytes],'a.bin'),{call,objectStorage:true}),error=>error.status===501);
 assert(calls.every(op=>op==='fileR2Begin'));
});

test('a dropped connection keeps the upload for resuming; cancelling releases it',async()=>{
 const bytes=crypto.randomBytes(50),flaky=bucket({failPut:99});
 const file=new File([bytes],'promo.mp4',{type:'video/mp4'});
 await assert.rejects(api.uploadSharedFile('file-item',file,{call:flaky.call,put:flaky.put,objectStorage:true}),/网络不稳定/);
 assert.ok(!flaky.calls.some(c=>c.operation==='fileR2Abort'),'progress is kept so the same file can resume');
 // The same file asks with the same key, which is how the server finds the unfinished upload.
 await assert.rejects(api.uploadSharedFile('file-item',file,{call:flaky.call,put:flaky.put,objectStorage:true}),/网络不稳定/);
 const keys=flaky.calls.filter(c=>c.operation==='fileR2Begin').map(c=>c.input.requestKey);
 assert.equal(keys[0],keys[1]);

 const controller=new AbortController(),cancelled=bucket();
 await assert.rejects(api.uploadSharedFile('file-item',file,{call:cancelled.call,put:async()=>{controller.abort();throw new DOMException('x','AbortError');},signal:controller.signal,objectStorage:true}),{name:'AbortError'});
 assert.equal(cancelled.calls.at(-1).operation,'fileR2Abort');
});

test('a download asks for a link under the item\'s access rules and checks what came back',async()=>{
 const bytes=crypto.randomBytes(3000),server=bucket();
 const payload={storage:'r2',blobId:BLOB,name:'promo.mp4',mime:'video/mp4',size:3000,sha256:hash(bytes)};
 const get=async()=>({ok:true,status:200,blob:async()=>new Blob([bytes])});
 const blob=await api.downloadSharedFile(item(payload),{call:server.call,get,token:'tok',historyId:'h1'});
 assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
 assert.deepEqual(server.calls[0].input,{itemId:'file-item',blobId:BLOB,mode:'attachment',token:'tok',historyId:'h1'});
 await assert.rejects(api.downloadSharedFile(item({...payload,sha256:'0'.repeat(64)}),{call:server.call,get}),/校验失败/);
 await assert.rejects(api.downloadSharedFile(item({...payload,size:3001}),{call:server.call,get}),/长度不一致/);
 await assert.rejects(api.downloadSharedFile(item(payload),{call:server.call,get:async()=>({ok:false,status:403})}),/HTTP 403/);
});

test('a multi-gigabyte file is not assembled in memory, but its link is still available',async()=>{
 const server=bucket(),payload={storage:'r2',blobId:BLOB,name:'promo.mp4',mime:'video/mp4',size:3*1024**3};
 await assert.rejects(api.downloadSharedFile(item(payload),{call:server.call}),/直接下载/);
 assert.equal(server.calls.length,0);
 const link=await api.sharedFileLink(item(payload),{call:server.call,mode:'inline'});
 assert.equal(link.url,'https://bucket.test/get');
 assert.equal(server.calls[0].input.mode,'inline');
 await assert.rejects(api.sharedFileLink(item({name:'a',mime:'x',size:1,blobId:'b',sha256:'1'.repeat(64),chunkSize:512*1024}),{call:server.call}),/对象存储/);
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function wrappedBucket(hook=()=>{}){
 const server=bucket();let begin;
 const call=async(operation,input,options)=>{
  const custom=await hook(operation,input,{server,begin,options});if(custom!==undefined)return custom;
  const result=await server.call(operation,input);if(operation==='fileR2Begin')begin=result;return result;
 };
 return{...server,call};
}

test('same shared-file name, size and mtime with different bytes cannot reuse a reservation',async()=>{
 const server=bucket(),first=new File(['aaaa'],'same.bin',{lastModified:1}),second=new File(['bbbb'],'same.bin',{lastModified:1});
 await api.uploadSharedFile('file-item',first,{call:server.call,put:server.put,objectStorage:true});
 await api.uploadSharedFile('file-item',second,{call:server.call,put:server.put,objectStorage:true});
 const starts=server.calls.filter(c=>c.operation==='fileR2Begin');assert.notEqual(starts[0].input.requestKey,starts[1].input.requestKey);assert.notEqual(starts[0].input.contentRoot,starts[1].input.contentRoot);
});

for(const stage of ['fileR2Begin','fileR2Finish'])for(const defect of ['scheme','root','size','single','missingTime','zeroTime','stringTime','foreignPayload'])test(`shared ${stage} rejects ${defect} without publishing`,async()=>{
 const server=wrappedBucket(async(operation,input,{server,begin})=>{
  if(operation!==stage)return;
  const value=await server.call(operation,input);
  if(stage==='fileR2Begin'){value.status='ready';value.verifiedAt=1;}
  if(defect==='scheme')delete value.contentScheme;
  if(defect==='root')value.contentRoot='0'.repeat(64);
  if(defect==='size')value.size++;
  if(defect==='single')value.mode='single';
  if(defect==='missingTime')delete value.verifiedAt;
  if(defect==='zeroTime')value.verifiedAt=0;
  if(defect==='stringTime')value.verifiedAt='1';
  if(defect==='foreignPayload'){
   if(stage==='fileR2Begin'){value.contentRoot='0'.repeat(64);}
   else value.payload.blobId='another-file';
  }
  return value;
 });
 const progress=[];await assert.rejects(api.uploadSharedFile('file-item',new File(['abc'],'a.bin'),{call:server.call,put:server.put,objectStorage:true,onProgress:p=>progress.push(p)}),/续传信息不一致/);
 assert(!progress.some(p=>p.phase==='done'));assert(!server.calls.some(c=>c.operation==='fileR2Abort'));
});

test('shared verification stays finalizing and returns only the old save-compatible manifest',async()=>{
 let polls=0;const server=wrappedBucket(async(operation,input,{server,begin})=>{
  if(operation==='fileR2Finish'&&++polls===1)return{...begin,status:'verifying',retryAfterMs:0};
 });
 const progress=[],result=await api.uploadSharedFile('file-item',new File(['abc'],'a.bin'),{call:server.call,put:server.put,objectStorage:true,onProgress:p=>progress.push(p)});
 assert.equal(polls,2);assert.equal(result.contentScheme,undefined);assert.equal(result.contentRoot,undefined);assert.equal(result.verifiedAt,undefined);
 assert.deepEqual(Object.keys(result).sort(),['blobId','mime','name','sha256','size','storage']);
 assert.equal(progress.at(-1).phase,'done');assert.equal(progress.at(-2).phase,'finalizing');
});

test('shared verification failure cleans the trusted old reservation before identical reselect',async()=>{
 let fail=true,aborts=0;const server=wrappedBucket((operation,input,{begin})=>{
  if(operation==='fileR2Finish'&&fail){fail=false;return{...begin,status:'verification_failed',code:'integrity_mismatch'};}
  if(operation==='fileR2Abort'){aborts++;assert.equal(input.uploadId,begin.id);return{ok:true};}
 });
 const file=new File(['abc'],'a.bin');await assert.rejects(api.uploadSharedFile('file-item',file,{call:server.call,put:server.put,objectStorage:true}),error=>error.code==='integrity_mismatch');
 assert.equal(aborts,1);await api.uploadSharedFile('file-item',file,{call:server.call,put:server.put,objectStorage:true});
});

for(const state of ['pendingCleanup','unresponsive'])test(`shared cancel during verification handles ${state} cleanup and ignores late ready`,async()=>{
 const control=new AbortController(),entered=deferred(),late=deferred();let aborts=0;
 const server=wrappedBucket((operation,input,{options})=>{
  if(operation==='fileR2Finish'){entered.resolve();return late.promise;}
  if(operation==='fileR2Abort'){aborts++;assert.equal(options.accountId,'alice');return state==='pendingCleanup'?{ok:true,pendingCleanup:true}:new Promise(()=>{});}
 });
 const phases=[],pending=api.uploadSharedFile('file-item',new File(['abc'],'a.bin'),{call:server.call,put:server.put,objectStorage:true,signal:control.signal,onProgress:p=>phases.push(p.phase)});
 await entered.promise;control.abort();await assert.rejects(pending,error=>error.name==='AbortError'&&error.code===(state==='pendingCleanup'?'cleanup_pending':'abort_unconfirmed'));
 late.resolve({status:'ready'});await tick();assert.equal(aborts,1);assert(!phases.includes('done'));
});

test('shared account lifetime catches A to B to A and refuses late results',async()=>{
 let account='alice',listener;const local=loader({[path.join(root,'shared-resources.ts')]:{SHARED_FILE_MAX_BYTES:limit},[path.join(root,'cloud-api.ts')]:{cloudAccountIdentity:async()=>account,onWebCloudAccountChange:fn=>{listener=fn;return()=>{listener=null;};}}})(path.join(root,'shared-files.ts'));
 const entered=deferred(),late=deferred(),server=wrappedBucket(op=>{if(op==='fileR2Finish'){entered.resolve();return late.promise;}}),phases=[];
 const pending=local.uploadSharedFile('file-item',new File(['abc'],'a.bin'),{call:server.call,put:server.put,objectStorage:true,onProgress:p=>phases.push(p.phase)});
 await entered.promise;account='bob';listener(account);account='alice';listener(account);await assert.rejects(pending,{name:'AbortError'});
 late.resolve({status:'ready'});await tick();assert(!phases.includes('done'));assert.equal(listener,null);
});

test('shared 403 renews the same part only once and honors long Retry-After',async()=>{
 const file=new File(['abc'],'a.bin'),server=bucket();let puts=0;
 await api.uploadSharedFile('file-item',file,{call:server.call,objectStorage:true,put:async()=>++puts===1?{ok:false,status:403}:ok()});
 const parts=server.calls.filter(c=>c.operation==='fileR2Parts');assert.equal(parts.length,2);assert.deepEqual(parts[0].input,parts[1].input);
 puts=0;await assert.rejects(api.uploadSharedFile('file-item',file,{call:server.call,objectStorage:true,put:async()=>{puts++;return{ok:false,status:429,headers:new Headers({'Retry-After':'121'})};}}),e=>e.status===429&&e.retryAfterMs===121000);assert.equal(puts,1);
});

test('shared rejects invalid part size before allocating a huge part-number list',async()=>{
 const server=wrappedBucket(async(op,input,{server})=>{if(op==='fileR2Begin')return{...await server.call(op,input),partSize:1,partCount:input.size};});
 await assert.rejects(api.uploadSharedFile('file-item',new File(['abc'],'a.bin'),{call:server.call,put:server.put,objectStorage:true}),/续传信息不一致/);assert.equal(server.sent.length,0);
});

test('encrypted shared upload hashes ciphertext and preserves the actual save encoder manifest',async()=>{
 const ciphertext=Buffer.from('ciphertext-with-auth-tag'),plain=new File(['private plain bytes'],'private.txt',{type:'text/plain'}),server=bucket();
 const load=loader({
  [path.join(root,'cloud-api.ts')]:{cloudAccountIdentity:async()=> 'alice',cloudCall:async(_action,body,options)=>server.call(body.operation,body.input,options)},
  [path.join(root,'shared-encryption-bridge.ts')]:{sharedEncryptionClient:async()=>({isEncrypted:async()=>true,encryptFile:async()=>({keyId:'key1',bytes:ciphertext})})},
 });
 const local=load(path.join(root,'shared-files.ts')),uploaded=await local.uploadSharedFile('file-item',plain,{put:server.put,objectStorage:true});
 assert.equal(uploaded.name,'private.txt');assert.equal(uploaded.sha256,hash(ciphertext));assert.equal(uploaded.fileEncryption.plainSize,plain.size);
 const begun=server.calls.find(c=>c.operation==='fileR2Begin').input;
 assert.equal(begun.contentRoot,hash(JSON.stringify(['wickrun-media-content-v1',ciphertext.length,4*1024**2,[hash(ciphertext)]])));
 assert.notEqual(begun.contentRoot,hash(JSON.stringify(['wickrun-media-content-v1',plain.size,4*1024**2,[hash(Buffer.from(await plain.arrayBuffer()))]])));
 const {SharedEncryptionClient}=load(path.join(root,'shared-encryption.ts'));
 const encoded=await SharedEncryptionClient.prototype.encodePayload.call({seal:async()=> 'encrypted-payload'},{id:'file-item',kind:'file',encryption:{}},uploaded,{});
 assert.match(encoded.sha256,/^[a-f0-9]{64}$/);assert.equal(encoded.sha256,hash(ciphertext));assert.equal(encoded.blobId,BLOB);assert.equal(encoded.contentRoot,undefined);assert.equal(encoded.verifiedAt,undefined);
 assert.deepEqual(Object.keys(encoded).sort(),['blobId','chunkSize','ciphertext','mime','name','sha256','size','storage']);
});
