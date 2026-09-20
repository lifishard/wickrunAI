'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createTeamFiles}=require('../electron/team-files.cjs');

function fixture(t){
 const tmpRoot=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tmpRoot,'wickrun-artifact-test-'));
 t.after(()=>{assert.equal(path.dirname(dir),tmpRoot);assert.ok(path.basename(dir).startsWith('wickrun-artifact-test-'));fs.rmSync(dir,{recursive:true,force:true});});
 const root=path.join(dir,'project'),userData=path.join(dir,'data');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'edit.txt'),'base');fs.writeFileSync(path.join(root,'delete.txt'),'remove me');
 const api=createTeamFiles(userData),create=(memberId,overrides={})=>api.create({projectId:'project',taskId:'task',memberId,root,...overrides},[overrides.root||root]);
 return {dir,root,userData,api,create};
}
function publish(api,session,node='node-a',attempt='attempt-a'){return api.publish(session.id,{nodeId:node,attemptId:attempt});}
function expected(rec){return rec.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash}));}

test('publishes immutable add/edit/delete bytes and receives them into another member isolation',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');
 fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'changed');fs.unlinkSync(path.join(producer.isolatedRoot,'delete.txt'));fs.writeFileSync(path.join(producer.isolatedRoot,'new.json'),JSON.stringify({answer:42}));
 const snapshot=publish(f.api,producer);assert.equal(snapshot.sessionId,producer.id);assert.equal(snapshot.memberId,'author');assert.equal(snapshot.version,1);assert.match(snapshot.digest,/^[a-f0-9]{64}$/);assert.deepEqual(snapshot.files.map(x=>x.path),['delete.txt','edit.txt','new.json']);
 assert.deepEqual(f.api.validateSnapshot(snapshot.id),snapshot);const received=f.api.receive(reviewer.id,[snapshot.id]);
 assert.equal(fs.readFileSync(path.join(f.root,'edit.txt'),'utf8'),'base');assert.equal(fs.existsSync(path.join(f.root,'new.json')),false);
 assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'changed');assert.equal(fs.existsSync(path.join(reviewer.isolatedRoot,'delete.txt')),false);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(reviewer.isolatedRoot,'new.json'),'utf8')),{answer:42});
 assert.deepEqual(received.received.map(r=>({snapshotId:r.snapshotId,sessionId:r.sessionId,memberId:r.memberId,nodeId:r.nodeId,attemptId:r.attemptId,digest:r.digest})),[{snapshotId:snapshot.id,sessionId:producer.id,memberId:'author',nodeId:'node-a',attemptId:'attempt-a',digest:snapshot.digest}]);
 const merged=f.api.merge(reviewer.id,expected(received));assert.equal(merged.status,'merged');assert.equal(fs.readFileSync(path.join(f.root,'edit.txt'),'utf8'),'changed');assert.equal(fs.existsSync(path.join(f.root,'delete.txt')),false);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'new.json'),'utf8')),{answer:42});
});

test('duplicate receive is idempotent and newer version replaces only unchanged imported files',t=>{
 const f=fixture(t),producer=f.create('author'),clean=f.create('clean-reviewer'),edited=f.create('edited-reviewer');
 fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'version one');const one=publish(f.api,producer,'node-1','attempt-1');
 const first=f.api.receive(clean.id,[one.id,one.id]),duplicate=f.api.receive(clean.id,[one.id]);assert.equal(first.received.length,1);assert.deepEqual(duplicate,first);
 f.api.receive(edited.id,[one.id]);fs.writeFileSync(path.join(edited.isolatedRoot,'edit.txt'),'reviewer note');
 fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'version two');const two=publish(f.api,producer,'node-2','attempt-2');assert.equal(two.version,2);
 const updated=f.api.receive(clean.id,[two.id]);assert.equal(fs.readFileSync(path.join(clean.isolatedRoot,'edit.txt'),'utf8'),'version two');assert.deepEqual(updated.received.map(r=>r.version),[1,2]);
 assert.throws(()=>f.api.receive(edited.id,[two.id]),/冲突/);assert.equal(fs.readFileSync(path.join(edited.isolatedRoot,'edit.txt'),'utf8'),'reviewer note');
 fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'base');const three=publish(f.api,producer,'node-3','attempt-3');assert.deepEqual(three.files,[]);
 const reverted=f.api.receive(clean.id,[three.id]);assert.equal(fs.readFileSync(path.join(clean.isolatedRoot,'edit.txt'),'utf8'),'base');assert.deepEqual(reverted.received.at(-1).reverted.map(x=>x.path),['edit.txt']);
});

test('rejects snapshots after the producer changes from the published digest',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'published');const snapshot=publish(f.api,producer);
 fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'unpublished');assert.throws(()=>f.api.validateSnapshot(snapshot.id),/已过期/);assert.throws(()=>f.api.receive(reviewer.id,[snapshot.id]),/已过期/);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'base');
});

test('rejects tampered managed snapshot bytes before changing the receiver',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'published');const snapshot=publish(f.api,producer);
 fs.writeFileSync(path.join(f.userData,'team-files','artifacts',snapshot.id,'files','edit.txt'),'tampered');assert.throws(()=>f.api.validateSnapshot(snapshot.id),/文件校验失败/);assert.throws(()=>f.api.receive(reviewer.id,[snapshot.id]),/文件校验失败/);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'base');
});

test('rejects cross-task, cross-project, and different-root receives',t=>{
 const f=fixture(t),producer=f.create('author');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'published');const snapshot=publish(f.api,producer);
 const otherRoot=path.join(f.dir,'other');fs.mkdirSync(otherRoot);fs.writeFileSync(path.join(otherRoot,'edit.txt'),'base');fs.writeFileSync(path.join(otherRoot,'delete.txt'),'remove me');
 const otherTask=f.create('reviewer-task',{taskId:'other-task'}),otherProject=f.create('reviewer-project',{projectId:'other-project'}),otherRootSession=f.create('reviewer-root',{root:otherRoot});
 assert.throws(()=>f.api.receive(otherTask.id,[snapshot.id]),/范围不一致/);assert.throws(()=>f.api.receive(otherProject.id,[snapshot.id]),/范围不一致/);assert.throws(()=>f.api.receive(otherRootSession.id,[snapshot.id]),/范围不一致/);
});

test('conflicting receiver edits and overlapping artifacts are rejected without partial writes',t=>{
 const f=fixture(t),first=f.create('author-a'),second=f.create('author-b'),reviewer=f.create('reviewer');
 fs.writeFileSync(path.join(first.isolatedRoot,'edit.txt'),'from a');fs.writeFileSync(path.join(second.isolatedRoot,'edit.txt'),'from b');const a=publish(f.api,first,'a','1'),b=publish(f.api,second,'b','1');
 assert.throws(()=>f.api.receive(reviewer.id,[a.id,b.id]),/冲突/);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'base');assert.equal(f.api.get(reviewer.id).received,undefined);
 fs.writeFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'receiver edit');assert.throws(()=>f.api.receive(reviewer.id,[a.id]),/冲突/);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'receiver edit');
});

test('process interruption during receive is detected and explicit recovery restores exact receiver bytes',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'partial import');fs.writeFileSync(path.join(producer.isolatedRoot,'new.json'),'{}');const snapshot=publish(f.api,producer);
 const script="const fs=require('node:fs'),path=require('node:path');const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b===path.join(process.argv[4],'edit.txt'))process.exit(74)};require(process.argv[1]).createTeamFiles(process.argv[2]).receive(process.argv[3],[process.argv[5]]);";
 const result=spawnSync(process.execPath,['-e',script,path.resolve(__dirname,'../electron/team-files.cjs'),f.userData,reviewer.id,reviewer.isolatedRoot,snapshot.id],{shell:false,windowsHide:true,encoding:'utf8'});assert.equal(result.status,74,result.stderr);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'partial import');assert.equal(fs.existsSync(path.join(reviewer.isolatedRoot,'new.json')),false);
 const next=createTeamFiles(f.userData),interrupted=next.get(reviewer.id);assert.equal(interrupted.recoveryRequired,true);assert.match(interrupted.recoveryReason,/工件接收中断/);assert.throws(()=>next.receive(reviewer.id,[snapshot.id]),/工件接收中断/);
 const recovered=next.recover(reviewer.id);assert.equal(recovered.recoveryRequired,false);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'base');assert.equal(fs.existsSync(path.join(reviewer.isolatedRoot,'new.json')),false);assert.equal(recovered.received,undefined);
});

test('recovery confirms a fully saved receive when only the final journal write was interrupted',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'complete import');const snapshot=publish(f.api,producer),journal=path.join(f.userData,'team-files',reviewer.id,'receive.json');
 const rename=fs.renameSync;let journalWrites=0;fs.renameSync=(from,to)=>{if(to===journal&&++journalWrites===3)throw Error('injected final journal failure');return rename(from,to);};
 try{assert.throws(()=>f.api.receive(reviewer.id,[snapshot.id]),/完成日志中断/);}finally{fs.renameSync=rename;}
 const next=createTeamFiles(f.userData),interrupted=next.get(reviewer.id);assert.equal(interrupted.recoveryRequired,true);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'complete import');
 const recovered=next.recover(reviewer.id);assert.equal(recovered.recoveryRequired,false);assert.equal(recovered.received.length,1);assert.equal(recovered.received[0].snapshotId,snapshot.id);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'complete import');assert.equal(JSON.parse(fs.readFileSync(journal,'utf8')).state,'committed');
});

test('receive recovery preserves reviewer edits made after an interruption and marks manual review',t=>{
 const f=fixture(t),producer=f.create('author'),reviewer=f.create('reviewer');fs.writeFileSync(path.join(producer.isolatedRoot,'edit.txt'),'partial import');fs.writeFileSync(path.join(producer.isolatedRoot,'new.json'),'{}');const snapshot=publish(f.api,producer);
 const script="const fs=require('node:fs'),path=require('node:path');const rename=fs.renameSync;fs.renameSync=(a,b)=>{rename(a,b);if(b===path.join(process.argv[4],'edit.txt'))process.exit(75)};require(process.argv[1]).createTeamFiles(process.argv[2]).receive(process.argv[3],[process.argv[5]]);";
 const result=spawnSync(process.execPath,['-e',script,path.resolve(__dirname,'../electron/team-files.cjs'),f.userData,reviewer.id,reviewer.isolatedRoot,snapshot.id],{shell:false,windowsHide:true,encoding:'utf8'});assert.equal(result.status,75,result.stderr);fs.writeFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'reviewer after interruption');
 const next=createTeamFiles(f.userData);assert.equal(next.get(reviewer.id).recoveryRequired,true);assert.throws(()=>next.recover(reviewer.id),/既不匹配/);assert.equal(fs.readFileSync(path.join(reviewer.isolatedRoot,'edit.txt'),'utf8'),'reviewer after interruption');const record=next.get(reviewer.id);assert.equal(record.recoveryRequired,true);assert.equal(record.status,'conflict');assert.equal(JSON.parse(fs.readFileSync(path.join(f.userData,'team-files',reviewer.id,'receive.json'),'utf8')).state,'needs_review');
});
