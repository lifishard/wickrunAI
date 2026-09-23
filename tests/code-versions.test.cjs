const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCodeVersions,reconcileRuns}=require('../electron/code-versions.cjs');
function fixture(t,options){const base=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-versions-')),root=path.join(base,'workspace'),ledger=path.join(base,'ledger');fs.mkdirSync(root);t.after(()=>{assert.ok(path.resolve(base).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(base,{recursive:true,force:true});});const versions=createCodeVersions(ledger,options);let n=0;const edit=(name,before,after)=>{const p=path.join(root,name);if(after===null){if(fs.existsSync(p))fs.unlinkSync(p);}else fs.writeFileSync(p,after);const change={id:'change-'+(++n),path:p,at:Date.now()};versions.record(change,before,after);return change.id;};return {root,ledger,versions,edit,read:n=>fs.readFileSync(path.join(root,n),'utf8')};}
test('a whole turn collapses repeated edits, retains review and restores exact pre-task dirty bytes after restart',t=>{
 const f=fixture(t),a=f.edit('a.ts','user dirty\r\n','intermediate\n'),b=f.edit('a.ts','intermediate\n','final\n');
 const details=f.versions.details([b,a]);assert.equal(details.files.length,1);assert.equal(details.files[0].additions,1);assert.equal(details.files[0].deletions,1);assert.ok(!details.files[0].lines.some(l=>l.text==='intermediate'));
 f.versions.keep([a,b]);assert.equal(f.read('a.ts'),'final\n');
 const restarted=createCodeVersions(f.ledger);assert.ok(restarted.summary([a,b]).entries.every(e=>e.status==='kept'));assert.equal(restarted.preview([a,b],[f.root]).files.length,1);
 restarted.revert([a,b],[f.root]);assert.equal(f.read('a.ts'),'user dirty\r\n');assert.ok(restarted.summary([a,b]).entries.every(e=>e.status==='reverted'));restarted.revert([a,b],[f.root]);
});
test('one revert restores deletions, removes creations, and preserves unrelated files',t=>{
 const f=fixture(t),a=f.edit('created.ts',null,'new'),b=f.edit('deleted.ts','deleted\n',null);fs.writeFileSync(path.join(f.root,'unrelated'),'user');
 f.versions.revert([a,b],[f.root]);assert.equal(fs.existsSync(path.join(f.root,'created.ts')),false);assert.equal(f.read('deleted.ts'),'deleted\n');assert.equal(f.read('unrelated'),'user');
});
test('all targets are checked before writing: later edit blocks the entire version',t=>{
 const f=fixture(t),a=f.edit('a.ts','a','aa'),b=f.edit('b.ts','b','bb');fs.writeFileSync(path.join(f.root,'b.ts'),'external');
 assert.throws(()=>f.versions.revert([a,b],[f.root]),/后续修改/);assert.equal(f.read('a.ts'),'aa');assert.equal(f.read('b.ts'),'external');assert.equal(f.versions.summary([a]).entries[0].status,'applied');
});
test('older versions can only be reverted after newer edits are reverted; gaps cannot be folded',t=>{
 const f=fixture(t),a=f.edit('a.ts','base','v1'),b=f.edit('a.ts','v1','v2');assert.throws(()=>f.versions.revert([a],[f.root]),/后续修改/);
 f.versions.revert([b],[f.root]);f.versions.revert([a],[f.root]);assert.equal(f.read('a.ts'),'base');
 const c=f.edit('gap.ts','base','v1'),d=f.edit('gap.ts','outside','v2');assert.match(f.versions.details([c,d]).warning,/其他编辑/);assert.throws(()=>f.versions.revert([c,d],[f.root]),/其他编辑/);
});
test('partial filesystem failure persists a resumable transaction and blocks further mutations across restart',t=>{
 let writes=0;const f=fixture(t,{replace:(a,b)=>{if(++writes===2)throw Error('occupied');fs.renameSync(a,b);}}),a=f.edit('a.ts','a','aa'),b=f.edit('b.ts','b','bb');
 assert.throws(()=>f.versions.revert([a,b],[f.root]),/回退未全部完成/);assert.equal(f.read('a.ts'),'a');assert.equal(f.read('b.ts'),'bb');
 const recovered=createCodeVersions(f.ledger);assert.throws(()=>recovered.assertReady(),/尚未完成/);assert.throws(()=>recovered.keep([a,b]),/尚未完成/);assert.throws(()=>recovered.revert([b],[f.root]),/整轮/);
 assert.equal(recovered.preview([a,b],[f.root]).recovering,true);recovered.revert([a,b],[f.root]);recovered.assertReady();assert.equal(f.read('b.ts'),'b');assert.equal(fs.readdirSync(f.root).some(n=>n.endsWith('.tmp')),false);
});
test('missing or corrupt backups and revoked roots cannot mutate files',t=>{
 const f=fixture(t),a=f.edit('a.ts','before','after');assert.throws(()=>f.versions.revert([a],[]));assert.equal(f.read('a.ts'),'after');
 const metadata=JSON.parse(fs.readFileSync(path.join(f.ledger,'versions.json'),'utf8'));fs.writeFileSync(path.join(f.ledger,'blobs',metadata.entries[a].beforeRef),'broken');
 assert.throws(()=>f.versions.revert([a],[f.root]),/快照校验失败/);assert.equal(f.read('a.ts'),'after');assert.throws(()=>f.versions.preview(['old-record'],[f.root]),/快照不存在/);
});
test('hard links are refused and path relocation cannot redirect the restore',t=>{
 const f=fixture(t),a=f.edit('a.ts','before','after');fs.linkSync(path.join(f.root,'a.ts'),path.join(f.root,'link.ts'));assert.throws(()=>f.versions.revert([a],[f.root]),/普通文本文件/);assert.equal(f.read('link.ts'),'after');
});
test('full-file review preserves distant context and exact line numbers from the recorded version',t=>{
 const f=fixture(t),before=Array.from({length:60},(_,i)=>i===30?'old implementation':`context ${i+1}`).join('\n')+'\n',after=before.replace('old implementation','new implementation');
 const a=f.edit('full.py',before,after);assert.ok(!f.versions.details([a]).files[0].lines.some(l=>l.text==='context 1'));
 fs.writeFileSync(path.join(f.root,'full.py'),'later unrelated disk content');const full=f.versions.file([a],path.join(f.root,'full.py')).files[0];
 assert.equal(full.lines[0].text,'context 1');assert.equal(full.lines.at(-1).text,'context 60');assert.equal(full.lines.find(l=>l.kind==='delete').oldLine,31);assert.equal(full.lines.find(l=>l.kind==='add').newLine,31);assert.equal(full.lines.length,61);assert.equal(full.additions,1);assert.equal(full.deletions,1);
 assert.throws(()=>f.versions.file([a],path.join(f.root,'outside.py')),/不属于/);assert.equal(f.read('full.py'),'later unrelated disk content');
});
test('reverted records invalidate delivery checks and provide durable context exactly once',t=>{
 const f=fixture(t),a=f.edit('a.ts','before','after');const record={id:'run',state:{working:[],content:'Done',status:'completed',steps:[{codeChanges:[{revisionId:a,path:path.join(f.root,'a.ts'),status:'applied'}],files:[{path:path.join(f.root,'a.ts')}]}],requirements:[{verification:{status:'passed'}}],delivery:{complete:true}}};let saves=0;const journal={list:()=>[record],save:()=>saves++};
 f.versions.revert([a],[f.root]);reconcileRuns(journal,f.versions);assert.equal(saves,1);assert.equal(record.state.status,'paused');assert.equal(record.state.requirements[0].verification,undefined);assert.equal(record.state.delivery,undefined);assert.equal(record.state.steps[0].codeChanges[0].status,'reverted');assert.equal(record.state.steps[0].files.length,0);assert.match(record.state.working[0].content,/不要自动重做/);reconcileRuns(journal,f.versions);assert.equal(saves,1);
});
test('real file tools persist revision snapshots only after applying and reload them for reversal',t=>{
 const f=fixture(t),electronId=require.resolve('electron'),cached=require.cache[electronId];require.cache[electronId]={id:electronId,filename:electronId,loaded:true,exports:{app:{getPath:()=>f.ledger}}};
 t.after(()=>{if(cached)require.cache[electronId]=cached;else delete require.cache[electronId];});
 const audit=require('../electron/code-changes.cjs'),p=path.join(f.root,'actual.ts'),ctx={workspaceRoots:[f.root],reviewCodeChanges:true};fs.writeFileSync(p,'original\r\n');
 const args={path:p,old_str:'original',new_str:'updated'},preview=audit.prepare('edit_file',args,ctx);assert.equal(preview.codeChanges[0].revisionId,undefined);
 const result=audit.apply('edit_file',args,{...ctx,codeReviewToken:preview.reviewToken});assert.ok(result.codeChanges[0].revisionId);assert.equal(result.codeChanges[0].revertUnavailable,undefined);
 const store=createCodeVersions(path.join(f.ledger,'code-versions-v1'));store.revert([result.codeChanges[0].revisionId],[f.root]);assert.equal(f.read('actual.ts'),'original\r\n');
});
