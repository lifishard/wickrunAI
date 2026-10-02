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
function bucket({mode='single',partSize=10,have=[],failPut=0,status='pending'}={}) {
 const calls=[],sent=[];let fails=failPut;
 const call=async(operation,input)=>{
  calls.push({operation,input});
  if(operation==='fileR2Begin')return mode==='single'
   ?{id:BLOB,mode,status,size:input.size,url:'https://bucket.test/put'}
   :{id:BLOB,mode,status,size:input.size,partSize,partCount:Math.ceil(input.size/partSize),completedParts:have.map(n=>({partNumber:n,size:partSize}))};
  if(operation==='fileR2Parts')return {parts:input.partNumbers.map(n=>({partNumber:n,url:`https://bucket.test/part/${n}`}))};
  if(operation==='fileR2Finish')return {payload:{storage:'r2',blobId:BLOB,name:'promo.mp4',mime:'video/mp4',size:calls[0].input.size}};
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
 assert.deepEqual(server.calls.map(c=>c.operation),['fileR2Begin','fileR2Finish']);
 assert.equal(server.sent.length,1);assert.equal(server.sent[0].url,'https://bucket.test/put');assert.ok(server.sent[0].bytes.equals(bytes));
 assert.equal(uploaded.storage,'r2');assert.equal(uploaded.blobId,BLOB);assert.equal(uploaded.sha256,hash(bytes));
 assert.equal(uploaded.chunkSize,undefined);
 assert.deepEqual(progress.at(-1),{done:5000,total:5000,direction:'upload'});
});

test('a large file is sent in parts, skips parts already stored, and never asks for a hash',async()=>{
 const bytes=crypto.randomBytes(95),server=bucket({mode:'multipart',partSize:10,have:[1,2]});
 const file=new File([bytes],'big.mp4',{type:'video/mp4'});
 const uploaded=await api.uploadSharedFile('file-item',file,{call:server.call,put:server.put,objectStorage:true});
 const urls=server.sent.map(s=>s.url).sort();
 assert.equal(server.sent.length,8,'10 parts minus the 2 already stored');
 assert.ok(!urls.includes('https://bucket.test/part/1')&&!urls.includes('https://bucket.test/part/2'));
 const assembled=Buffer.concat(server.sent.sort((a,b)=>Number(a.url.split('/').pop())-Number(b.url.split('/').pop())).map(s=>s.bytes));
 assert.ok(assembled.equals(bytes.subarray(20)),'parts carry the right byte ranges');
 const batches=server.calls.filter(c=>c.operation==='fileR2Parts');assert.ok(batches.every(c=>c.input.partNumbers.length<=4));
 assert.equal(uploaded.size,95);
});

test('files over 100 MB are accepted here, with a 5 GB ceiling, and are never read into memory',async()=>{
 let reads=0;
 const size=3*1024**3,fake={name:'big.mp4',type:'video/mp4',size,lastModified:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);},slice:()=>new Blob([])};
 const server=bucket({mode:'multipart',partSize:1024**3});
 const uploaded=await api.uploadSharedFile('file-item',fake,{call:server.call,put:server.put,objectStorage:true});
 assert.equal(reads,0);assert.equal(server.sent.length,3);assert.equal(uploaded.sha256,undefined);
 await assert.rejects(api.uploadSharedFile('file-item',{...fake,size:5*1024**3+1},{call:server.call,objectStorage:true}),/5 GB/);
 await assert.rejects(api.uploadSharedFile('file-item',{...fake,size:limit+1},{call:server.call,objectStorage:false}),/100 MB/);
});

test('a server without object storage sends the client down the old chunked path',async()=>{
 const bytes=Buffer.from('fallback'),calls=[];
 const call=async(operation,input)=>{
  calls.push(operation);
  if(operation==='fileR2Begin')throw Object.assign(Error('Object storage is not set up on this server.'),{status:501});
  if(operation==='fileBegin')return {uploadId:'u',chunkSize:512*1024,chunkCount:1,missing:[0]};
  if(operation==='fileChunk')return {index:0};
  if(operation==='fileFinish')return {payload:{name:'a.bin',mime:'application/octet-stream',size:bytes.length,blobId:'b',sha256:hash(bytes),chunkSize:512*1024}};
  throw Error('Unexpected '+operation);
 };
 const result=await api.uploadSharedFile('file-item',new File([bytes],'a.bin'),{call,objectStorage:true});
 assert.deepEqual(calls,['fileR2Begin','fileBegin','fileChunk','fileFinish']);
 assert.equal(result.storage,undefined);
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
