const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const crypto=require('node:crypto');
const {File}=require('node:buffer');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const limit=100*1024*1024,chunk=512*1024;
const api=loader({[path.join(root,'shared-resources.ts')]:{SHARED_FILE_MAX_BYTES:limit},[path.join(root,'cloud-api.ts')]:{cloudAccountIdentity:async()=> 'alice'}})(path.join(root,'shared-files.ts'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const item=payload=>({id:'file-item',kind:'file',title:'File',payload});
function fixture(bytes,name='result.bin') {
 const calls=[],parts=new Map(),payload={name,mime:'application/octet-stream',size:bytes.length,blobId:'blob-id',sha256:hash(bytes),chunkSize:chunk};
 const call=async(operation,input)=>{
  calls.push({operation,input});
  if(operation==='fileBegin')return {uploadId:'upload-id',chunkSize:chunk,chunkCount:Math.ceil(bytes.length/chunk),missing:Array.from({length:Math.ceil(bytes.length/chunk)},(_,i)=>i)};
  if(operation==='fileChunk'){parts.set(input.index,Buffer.from(input.data,'base64'));return {index:input.index};}
  if(operation==='fileFinish'){assert.deepEqual(Buffer.concat([...parts].sort((a,b)=>a[0]-b[0]).map(([,p])=>p)),bytes);return {payload};}
  if(operation==='fileReadChunk')return {index:input.index,data:bytes.subarray(input.index*chunk,(input.index+1)*chunk).toString('base64')};
  if(operation==='fileAbort')return {ok:true};
  throw Error('Unexpected operation '+operation);
 };
 return {calls,call,payload};
}

test('shared file transport sends bounded chunks and verifies identical round-trip bytes',async()=>{
 const bytes=crypto.randomBytes(chunk+37),server=fixture(bytes),progress=[];
 const uploaded=await api.uploadSharedFile('file-item',new File([bytes],'result.bin'),{call:server.call,onProgress:p=>progress.push(p)});
 assert.equal(uploaded.sha256,hash(bytes));assert.deepEqual(progress.at(-1),{done:bytes.length,total:bytes.length,direction:'upload'});
 const writes=server.calls.filter(c=>c.operation==='fileChunk');assert.equal(writes.length,2);
 assert.ok(writes.every(c=>Buffer.byteLength(JSON.stringify(c.input))<700000));
 assert.equal(server.calls[0].input.sha256,hash(bytes));
 const downloaded=await api.downloadSharedFile(item(uploaded),{call:server.call});
 assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes);
});

test('100MB exact cap accepts boundary metadata and rejects a larger file before reading or sending',async()=>{
 let reads=0,calls=0;
 const tooLarge={name:'large.bin',size:limit+1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}};
 await assert.rejects(api.uploadSharedFile('file-item',tooLarge,{call:async()=>{calls++;}}),/100 MB/);
 assert.equal(reads,0);assert.equal(calls,0);
 const boundary=item({name:'large.bin',size:limit,blobId:'valid-blob',sha256:'1'.repeat(64),chunkSize:chunk});
 await assert.rejects(api.downloadSharedFile(boundary,{call:async(op)=>{calls++;assert.equal(op,'fileReadChunk');throw Object.assign(Error('denied'),{status:403});}}),/denied/);
 assert.equal(calls,1,'valid boundary reached the ACL request');
});

test('a transient chunk failure retries the same chunk without publishing duplicates',async()=>{
 const bytes=Buffer.from('retry keeps bytes'),server=fixture(bytes);let attempted=false;
 const call=async(op,input)=>{const answer=await server.call(op,input);if(op==='fileChunk'&&!attempted){attempted=true;throw Object.assign(Error('temporary'),{status:503});}return answer;};
 await api.uploadSharedFile('file-item',new File([bytes],'result.bin'),{call});
 const writes=server.calls.filter(c=>c.operation==='fileChunk');assert.equal(writes.length,2);assert.deepEqual(writes[0].input,writes[1].input);
 assert.equal(server.calls.filter(c=>c.operation==='fileFinish').length,1);
});

test('cancelling after a chunk aborts the unpublished upload and sends no remaining chunk',async()=>{
 const bytes=Buffer.alloc(chunk+3,1),server=fixture(bytes),controller=new AbortController();
 await assert.rejects(api.uploadSharedFile('file-item',new File([bytes],'result.bin'),{call:server.call,signal:controller.signal,onProgress:p=>{if(p.done>0)controller.abort();}}),{name:'AbortError'});
 assert.equal(server.calls.filter(c=>c.operation==='fileChunk').length,1);
 assert.equal(server.calls.some(c=>c.operation==='fileFinish'),false);assert.equal(server.calls.at(-1).operation,'fileAbort');
});

test('account switching cannot continue or clean up a transfer as the next account',async()=>{
 const bytes=Buffer.from('account scope'),server=fixture(bytes);let account='alice';
 const call=async(op,input)=>{const answer=await server.call(op,input);if(op==='fileChunk')account='bob';return answer;};
 await assert.rejects(api.uploadSharedFile('file-item',new File([bytes],'result.bin'),{call,account:async()=>account}),/账号已切换/);
 assert.equal(server.calls.some(c=>['fileFinish','fileAbort'].includes(c.operation)),false);
});

test('historical download carries its exact history reference and rejects corrupted content',async()=>{
 const bytes=Buffer.from('historic version'),server=fixture(bytes);
 const downloaded=await api.downloadSharedFile(item(server.payload),{call:server.call,historyId:'version-id',token:'a'.repeat(43),account:async()=>null});
 assert.equal(await downloaded.text(),'historic version');
 assert.equal(server.calls[0].input.historyId,'version-id');assert.equal(server.calls[0].input.token,'a'.repeat(43));
 await assert.rejects(api.downloadSharedFile(item(server.payload),{call:async()=>({index:0,data:Buffer.from('Xistoric version').toString('base64')})}),/文件校验失败/);
 await assert.rejects(api.downloadSharedFile(item(server.payload),{call:async()=>({index:1,data:bytes.toString('base64')})}),/分块长度/);
});

test('empty files and legacy text/binary downloads remain usable',async()=>{
 const server=fixture(Buffer.alloc(0));
 const uploaded=await api.uploadSharedFile('file-item',new File([],'result.bin'),{call:server.call});
 assert.equal(uploaded.size,0);assert.equal(server.calls.some(c=>c.operation==='fileChunk'),false);
 assert.equal((await api.downloadSharedFile(item(uploaded),{call:server.call})).size,0);
 assert.equal(await (await api.downloadSharedFile(item({name:'old.txt',text:'legacy text'}))).text(),'legacy text');
 assert.equal(await (await api.downloadSharedFile(item({name:'old.bin',data:Buffer.from('binary').toString('base64')}))).text(),'binary');
});
