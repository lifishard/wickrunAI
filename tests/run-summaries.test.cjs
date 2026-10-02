const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createRunStore,summaryOf}=require('../electron/run-store.cjs');
const {reconcileRunSummaries}=require('../electron/code-versions.cjs');
const {loader}=require('./load-ts.cjs');const file=p=>path.join(__dirname,'..',p);
const tmp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'run-summaries-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const big=n=>[{id:'m'+n,role:'user',content:'context '.repeat(20000),createdAt:1}];
function record(id,extra={}){
  const state={runId:id,working:big(id),contextArchive:big(id+'a'),contextArchiveSteps:[{id:'s'+id}],compactions:[{id:'c'}],status:'paused',round:1,at:10,stoppedBy:'user',content:'result '+id,steps:[{id:'step'+id,callId:'call'}],...extra};
  return {id,conversationId:'conv',answerId:id+'-answer',question:{id:id+'-q',role:'user',content:'question '+id,createdAt:1},config:{model:'x'},keyProfileId:'k',title:'t '+id,state};
}

test('a summary keeps what the UI shows and drops only the model context',()=>{
  const r=record('a'),s=summaryOf(r);
  assert.equal(s.state.slim,true);assert.deepEqual(s.state.working,[]);
  for(const f of ['contextArchive','contextArchiveSteps','compactions'])assert.equal(s.state[f],undefined);
  assert.equal(s.state.content,'result a');assert.deepEqual(s.state.steps,r.state.steps);assert.equal(s.question.content,'question a');
  assert.ok(r.state.working.length&&r.state.contextArchive.length,'the source record is not modified');
  assert.ok(JSON.stringify(s).length<JSON.stringify(r).length/50);
});

test('summaries are served from small files, rebuilt when stale, and skip deleted runs',async t=>{
  const dir=tmp(t),store=createRunStore(dir);
  store.save(record('a'));store.save(record('b'));store.save(record('gone'));store.remove('gone');
  let reads=0;const io=Object.create(fs);io.readFileSync=(...a)=>{const data=fs.readFileSync(...a);if(String(a[0]).includes(path.join(dir,'runs'))&&data.length>10000)reads++;return data;};
  const counting=createRunStore(dir,{io});
  const list=await counting.listSummaries();
  assert.deepEqual(list.map(r=>r.id).sort(),['a','b']);assert.ok(list.every(r=>r.state.slim&&r.state.working.length===0));
  assert.equal(reads,0,'fresh summaries mean no large run file is parsed (a tiny tombstone may be)');
  // A run file replaced behind the store's back (restored backup, older build) is noticed.
  const runFile=fs.readdirSync(path.join(dir,'runs')).filter(n=>n.endsWith('.json')).find(n=>JSON.parse(fs.readFileSync(path.join(dir,'runs',n),'utf8')).state);
  const updated=JSON.parse(fs.readFileSync(path.join(dir,'runs',runFile),'utf8'));updated.state.content='changed elsewhere';
  await new Promise(r=>setTimeout(r,20));fs.writeFileSync(path.join(dir,'runs',runFile),JSON.stringify(updated));
  const after=await counting.listSummaries();
  assert.ok(after.some(r=>r.state.content==='changed elsewhere'));assert.ok(reads>=1);
  // Summaries are created for runs written before this feature existed.
  fs.rmSync(path.join(dir,'run-summaries'),{recursive:true,force:true});
  assert.equal((await createRunStore(dir).listSummaries()).length,2);assert.equal(fs.readdirSync(path.join(dir,'run-summaries')).length,2);
});

test('get returns the full record; listing never mutates what is stored',async t=>{
  const store=createRunStore(tmp(t));store.save(record('a'));
  await store.listSummaries();
  const full=store.get('a');assert.equal(full.state.working[0].id,'ma');assert.equal(full.state.contextArchive[0].id,'maa');assert.equal(store.get('missing'),null);
  store.remove('a');assert.equal(store.get('a'),null);
});

test('saving a summary-only record keeps the stored model context',async t=>{
  const store=createRunStore(tmp(t));store.save(record('a'));
  const [slim]=await store.listSummaries();
  store.save({...slim,state:{...slim.state,status:'completed',content:'edited'}});
  const full=store.get('a');
  assert.equal(full.state.status,'completed');assert.equal(full.state.content,'edited');assert.equal(full.state.slim,undefined);
  assert.equal(full.state.working[0].id,'ma');assert.equal(full.state.contextArchive[0].id,'maa');assert.equal(full.state.compactions[0].id,'c');
  const summary=(await store.listSummaries())[0];assert.equal(summary.state.content,'edited');
  assert.throws(()=>store.save({...slim,id:'ghost'}),/不在本机/);
});

test('reverted code changes are applied on the full record without losing context',async t=>{
  const store=createRunStore(tmp(t));
  store.save(record('a',{steps:[{id:'s',callId:'c',codeChanges:[{revisionId:'rev',status:'kept',path:path.join(os.tmpdir(),'x.txt')}]}]}));store.save(record('b'));
  const versions={summary:ids=>({entries:ids.map(()=>({status:'reverted'}))})};
  const list=await reconcileRunSummaries(store,versions);
  const a=list.find(r=>r.id==='a'),b=list.find(r=>r.id==='b');
  assert.equal(a.state.status,'paused');assert.match(a.state.reason,/回退/);assert.equal(a.state.slim,true);
  assert.equal(b.state.at,10,'unaffected runs are untouched');
  const stored=store.get('a');assert.equal(stored.state.working.at(-1).role,'user');assert.equal(stored.state.working[0].id,'ma');assert.equal(stored.state.contextArchive[0].id,'maa');
  assert.equal((await reconcileRunSummaries(store,null)).length,2);
});

function renderer(t,store){
  const calls=[];
  const bridge={runList:async()=>store.listSummaries(),runGet:async id=>{calls.push(id);return store.get(id);},runSave:async r=>store.save(r),runRemove:async id=>store.remove(id)};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge,getTransport:()=>({kvGet:async()=>null,kvSet:async()=>{}})},
    [file('src/lib/observations.ts')]:{reconcileObservations:async()=>{},observeRun:async()=>{},removeObservations:async()=>{}}});
  return {runs:load(file('src/lib/runs.ts')),calls};
}

test('the renderer starts from summaries and reads a conversation\'s context only when it is opened',async t=>{
  const store=createRunStore(tmp(t));store.save(record('a'));store.save({...record('b'),conversationId:'other'});
  const {runs,calls}=renderer(t,store);
  const loaded=await runs.loadRuns();
  assert.ok(loaded.every(r=>r.state.slim));assert.equal(calls.length,0);
  const conv=runs.recoverConversations([],loaded).find(c=>c.id==='conv');
  assert.equal(conv.messages.at(-1).runState.slim,true);
  await runs.prepareConversationRuns(conv);
  assert.deepEqual(calls,['a'],'only this conversation\'s runs');
  const ready=runs.restoreRunStates(conv);
  assert.equal(ready.messages.at(-1).runState.slim,undefined);assert.equal(ready.messages.at(-1).runState.working[0].id,'ma');assert.equal(ready.messages.at(-1).runState.status,'paused');
  assert.equal(runs.runRecord('a').state.contextArchive[0].id,'maa');assert.equal(runs.runRecord('b').state.slim,true);
  await runs.prepareConversationRuns(conv);assert.equal(calls.length,1,'already read');
  // A later reload keeps the context that was read.
  await runs.loadRuns();assert.equal(runs.runRecord('a').state.slim,undefined);
});

test('resuming or handing off a summary-only state reads the full context first',async t=>{
  const store=createRunStore(tmp(t));store.save(record('a'));
  const {runs}=renderer(t,store);const [loaded]=await runs.loadRuns();
  const full=await runs.fullRunState(loaded.state);
  assert.equal(full.slim,undefined);assert.equal(full.working[0].id,'ma');assert.equal(full.contextArchiveSteps[0].id,'sa');
  assert.equal(await runs.fullRunState(full),full);
  await assert.rejects(runs.fullRunState({...loaded.state,runId:undefined}),/缺少编号/);
});

test('saving from the renderer never replaces stored context with an empty summary',async t=>{
  const store=createRunStore(tmp(t));store.save(record('a'));
  const {runs}=renderer(t,store);const [loaded]=await runs.loadRuns();
  await runs.saveRun({...loaded,state:{...loaded.state,content:'answered'}});
  const stored=store.get('a');assert.equal(stored.state.content,'answered');assert.equal(stored.state.working[0].id,'ma');assert.equal(stored.state.slim,undefined);
  store.remove('a');
  await assert.rejects(runs.saveRun({...loaded,id:'a'}),/不在本机/);
});

test('overlapping progress writes to one job never corrupt it or leave temporary files',async t=>{
  for(let round=0;round<40;round++){
    const dir=tmp(t),store=createRunStore(dir,{io:{...fs,promises:fs.promises}});
    await Promise.allSettled(Array.from({length:25},(_,i)=>store.saveJobProgress('r','j',{status:'running',partial:'p'.repeat(1000*(i+1)),i})));
    const saved=store.job('r','j');
    assert.ok(saved,'round '+round+' left a readable record');assert.equal(saved.partial.length,1000*(saved.i+1));
    assert.deepEqual(fs.readdirSync(path.join(dir,'jobs')).filter(n=>n.endsWith('.tmp')),[]);
  }
});
