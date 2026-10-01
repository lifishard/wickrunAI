const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readSharedFile}=require('../electron/shared-file-read.cjs');
test('explicit file sharing reads the complete binary and rejects oversized files before allocation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-shared-read-'));
 try{const file=path.join(root,'binary.dat'),bytes=Buffer.alloc(2*1024*1024+17,193);fs.writeFileSync(file,bytes);
  assert.deepEqual(Buffer.from(readSharedFile(file)),bytes);
  assert.throws(()=>readSharedFile('relative.dat'),/路径/);
  fs.truncateSync(file,100*1024*1024+1);assert.throws(()=>readSharedFile(file),/100 MB/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
