const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const t=require('../electron/artifact-transfer.cjs');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('multipart quota includes reserved files and validates the 100 MB boundary without a whole-file buffer',()=>{
 const block=Buffer.alloc(t.CHUNK_SIZE,65),h=crypto.createHash('sha256');for(let i=0;i<200;i++)h.update(block);
 const a=t.begin({name:'large.txt',requestKey:'file',size:t.FILE_LIMIT,sha256:h.digest('hex')});assert.equal(a.chunkCount,200);const verify=t.verifier(a);for(let i=0;i<200;i++){assert.equal(t.chunk(a,i,block).length,block.length);verify.add(block);}verify.finish();
 assert.throws(()=>t.begin({...a,size:t.FILE_LIMIT+1}),/100 MB/);assert.throws(()=>t.quota([],Array.from({length:5},(_,i)=>({...a,requestKey:'file'+i})),a),/500 MB/);
 assert.throws(()=>t.quota([],Array.from({length:50},(_,i)=>({...a,size:1,requestKey:'file'+i})),{...a,size:1}),/50 files/);
 assert.throws(()=>t.chunk(a,200,block),/index/);assert.throws(()=>t.chunk(a,0,Buffer.alloc(3)),/exactly/);assert.throws(()=>t.chunk(a,0,'*bad'),/base64/);
});
test('multipart completion rejects wrong digest, spoofed file and invalid text',()=>{
 const bytes=Buffer.from('good'),meta=t.begin({name:'a.txt',requestKey:'a',size:4,sha256:hash(Buffer.from('evil'))});const v=t.verifier(meta);v.add(bytes);assert.throws(()=>v.finish(),/checksum/);
 const image=t.verifier({...meta,name:'a.png'});assert.throws(()=>image.add(bytes),/extension/);const text=t.verifier(meta);assert.throws(()=>text.add(Buffer.from([0xff])),/encoded|encoding|UTF/);
 assert.equal(t.authorized(meta,meta.token,meta.expiresAt),false);assert.equal(t.authorized(meta,meta.token,meta.expiresAt-1),true);assert.equal(t.authorized(meta,'wrong'),false);
});
