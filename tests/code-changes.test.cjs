const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const audit=require('../electron/code-changes.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-audit-'));t.after(()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});return {root,p:path.join(root,'hello.ts'),ctx:{workspaceRoots:[root],reviewCodeChanges:true}};}

test('preview leaves original unchanged; approval applies exact reviewed content with line numbers',t=>{
  const {p,ctx}=fixture(t);fs.writeFileSync(p,'const n = 1;\nkeep();\n');
  const args={path:p,old_str:'n = 1',new_str:'n = 2'}, preview=audit.prepare('edit_file',args,ctx);
  assert.equal(fs.readFileSync(p,'utf8'),'const n = 1;\nkeep();\n');
  assert.equal(preview.codeChanges[0].status,'pending');assert.equal(preview.codeChanges[0].additions,1);assert.equal(preview.codeChanges[0].deletions,1);
  const result=audit.apply('edit_file',args,{...ctx,codeReviewToken:preview.reviewToken});
  assert.equal(result.codeChanges[0].status,'applied');assert.equal(fs.readFileSync(p,'utf8'),'const n = 2;\nkeep();\n');
  assert.equal(result.codeChanges[0].lines.find(l=>l.kind==='add').newLine,1);
  assert.throws(()=>audit.apply('edit_file',args,{...ctx,codeReviewToken:preview.reviewToken}),/审核已过期/);
});
test('missing approval and changed parameters cannot write',t=>{
  const {p,ctx}=fixture(t),args={path:p,content:'new\n'};
  assert.throws(()=>audit.apply('write_file',args,ctx),/审核已过期/);
  const preview=audit.prepare('write_file',args,ctx);
  assert.equal(fs.existsSync(p),false);
  assert.throws(()=>audit.apply('write_file',{...args,content:'other'}, {...ctx,codeReviewToken:preview.reviewToken}),/参数变化/);
  assert.equal(fs.existsSync(p),false);
});
test('outside modifications and newly created targets conflict instead of being overwritten',t=>{
  const {p,ctx}=fixture(t),args={path:p,content:'AI\n'};
  for(const before of [null,'old']){
    if(fs.existsSync(p))fs.unlinkSync(p);if(before!==null)fs.writeFileSync(p,before);
    const preview=audit.prepare('write_file',args,ctx);fs.writeFileSync(p,'external');
    assert.throws(()=>audit.apply('write_file',args,{...ctx,codeReviewToken:preview.reviewToken}),/文件已发生变化/);
    assert.equal(fs.readFileSync(p,'utf8'),'external');
  }
});
test('create and delete are audited; cancelled approval cannot mutate',t=>{
  const {p,ctx}=fixture(t);const create={path:p,content:'hello\n'};
  const a=audit.prepare('write_file',create,ctx);assert.equal(a.codeChanges[0].kind,'added');assert.equal(a.codeChanges[0].additions,1);
  audit.apply('write_file',create,{...ctx,codeReviewToken:a.reviewToken});
  const b=audit.prepare('delete_file',{path:p},ctx);assert.equal(fs.existsSync(p),true);assert.equal(b.codeChanges[0].deletions,1);
  const abort=new AbortController();abort.abort();assert.throws(()=>audit.apply('delete_file',{path:p},{...ctx,codeReviewToken:b.reviewToken,signal:abort.signal}),/取消/);assert.equal(fs.existsSync(p),true);
  const c=audit.prepare('delete_file',{path:p},ctx);audit.apply('delete_file',{path:p},{...ctx,codeReviewToken:c.reviewToken});assert.equal(fs.existsSync(p),false);
});
test('automatic writes record changes and no-op stays empty',t=>{
  const {p,ctx}=fixture(t);ctx.reviewCodeChanges=false;
  assert.equal(audit.apply('write_file',{path:p,content:'hello'},ctx).codeChanges[0].kind,'added');
  assert.equal(audit.apply('write_file',{path:p,content:'hello'},ctx).codeChanges.length,0);
});
test('failed atomic replacement keeps original bytes and removes staging file',t=>{
  const {p,ctx,root}=fixture(t);fs.writeFileSync(p,'original');const args={path:p,content:'replacement'},preview=audit.prepare('write_file',args,ctx);
  const original=fs.renameSync;fs.renameSync=()=>{throw Error('simulated locked file');};
  try{assert.throws(()=>audit.apply('write_file',args,{...ctx,codeReviewToken:preview.reviewToken}),/locked file/);}finally{fs.renameSync=original;}
  assert.equal(fs.readFileSync(p,'utf8'),'original');assert.deepEqual(fs.readdirSync(root),['hello.ts']);
});
test('shell snapshots find additions deletions and edits without including pre-existing changes',t=>{
  const {root,p}=fixture(t);fs.writeFileSync(p,'already dirty');fs.writeFileSync(path.join(root,'delete.ts'),'gone');fs.writeFileSync(path.join(root,'binary.bin'),Buffer.from([0,1]));
  const before=audit.snapshot([root]);fs.writeFileSync(p,'new');fs.unlinkSync(path.join(root,'delete.ts'));fs.writeFileSync(path.join(root,'new.ts'),'added');
  const result=audit.compare(before,audit.snapshot([root]));assert.deepEqual(result.codeChanges.map(c=>c.kind).sort(),['added','deleted','modified']);assert.ok(result.codeAuditWarnings.length);
  assert.ok(result.codeChanges.find(c=>c.path===p).lines.some(l=>l.kind==='delete'&&l.text==='already dirty'));
});
test('oversized, binary, ambiguous, and unauthorized proposals fail without writing',t=>{
  const {p,ctx,root}=fixture(t);fs.writeFileSync(p,'same same');
  assert.throws(()=>audit.prepare('edit_file',{path:p,old_str:'same',new_str:'new'},ctx),/唯一/);
  assert.throws(()=>audit.prepare('write_file',{path:path.join(root,'..','outside.ts'),content:'x'},ctx),/允许的工作目录/);
  assert.throws(()=>audit.prepare('write_file',{path:p,content:'x'.repeat(524289)},ctx),/512 KB/);
  fs.writeFileSync(p,Buffer.from([0,1,2]));assert.throws(()=>audit.prepare('write_file',{path:p,content:'x'},ctx),/二进制/);
});
test('line comparison preserves replacements, context, empty files and EOF changes',()=>{
  const a=audit.difference('a\nb\nc\n','a\nx\nc\n');assert.equal(a.additions,1);assert.equal(a.deletions,1);
  assert.deepEqual(a.lines.filter(l=>l.kind==='context').map(l=>l.text),['a','c']);
  assert.equal(audit.difference(null,'').additions,0);
  assert.match(audit.difference('hello','hello\n').lines.at(-1).text,/换行/);
});

test('native journal survives reopening with complete code audit metadata',t=>{
  const {root,p,ctx}=fixture(t);const result=audit.apply('write_file',{path:p,content:'persist\n'},{...ctx,reviewCodeChanges:false});
  const {createRunStore}=require('../electron/run-store.cjs');const journal=createRunStore(path.join(root,'data'));
  journal.saveJob('run-a','call-a',{status:'completed',result});
  assert.deepEqual(createRunStore(path.join(root,'data')).job('run-a','call-a').result.codeChanges,result.codeChanges);
});
