'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {buildMcpb,zipStore,crc32}=require('../electron/mcpb.cjs');

/** 按 zip 规范读出中央目录里的每个条目，用本地文件头定位数据 */
function unzip(buf){
  const end=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));assert.ok(end>=0,'end of central directory');
  const count=buf.readUInt16LE(end+10);let at=buf.readUInt32LE(end+16);const out={};
  for(let i=0;i<count;i++){
    assert.equal(buf.readUInt32LE(at),0x02014b50);
    const crc=buf.readUInt32LE(at+16),size=buf.readUInt32LE(at+24),nameLen=buf.readUInt16LE(at+28),local=buf.readUInt32LE(at+42);
    const name=buf.subarray(at+46,at+46+nameLen).toString('utf8');
    assert.equal(buf.readUInt32LE(local),0x04034b50);
    const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28);
    const data=buf.subarray(start,start+size);assert.equal(crc32(data),crc);out[name]=data;
    at+=46+nameLen+buf.readUInt16LE(at+30)+buf.readUInt16LE(at+32);
  }
  return out;
}

test('crc32 matches the standard value',()=>{
  assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
  if(zlib.crc32)assert.equal(crc32(Buffer.from('灯芯AI')),zlib.crc32(Buffer.from('灯芯AI')));
});

test('extension bundle contains a valid manifest, the server and the private connection path',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-mcpb-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const server=path.join(dir,'srv.cjs');fs.writeFileSync(server,'console.log("server")');
  const icon=path.join(dir,'icon.png');fs.writeFileSync(icon,Buffer.from([0x89,0x50,0x4e,0x47]));
  const conn=path.join(dir,'native-ai','claude-desktop.json');
  const {file}=buildMcpb({outFile:path.join(dir,'out','wickrun-ai.mcpb'),serverFile:server,connectionFile:conn,version:'2.19.3',iconFile:icon});
  const files=unzip(fs.readFileSync(file));
  assert.deepEqual(Object.keys(files).sort(),['icon.png','manifest.json','server/index.js']);
  const m=JSON.parse(files['manifest.json']);
  assert.equal(m.manifest_version,'0.3');assert.equal(m.server.type,'node');assert.equal(m.server.entry_point,'server/index.js');
  assert.deepEqual(m.server.mcp_config.args,['${__dirname}/server/index.js',conn]);
  assert.equal(m.version,'2.19.3');assert.equal(m.icon,'icon.png');
  assert.ok(m.tools.some(x=>x.name==='wickrun_claim_task'));
  assert.equal(files['server/index.js'].toString(),'console.log("server")');
  const noIcon=buildMcpb({outFile:path.join(dir,'b.mcpb'),serverFile:server,connectionFile:conn,version:'x',iconFile:path.join(dir,'missing.png')});
  assert.equal(noIcon.manifest.icon,undefined);assert.equal(noIcon.manifest.version,'1.0.0');
  assert.equal(Object.keys(unzip(fs.readFileSync(noIcon.file))).length,2);
  assert.equal(Object.keys(unzip(zipStore([]))).length,0);
});
