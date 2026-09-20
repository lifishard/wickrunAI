'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');
const fixtures=require('./team-store-fixtures.cjs');

const file=name=>path.resolve(__dirname,'..',name);
function change(store,fn){const data=store.read(),project=data.projects.p;fn(project);return store.update(data.revision,project);}
function fixture(t){
 const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'wickrun-dependencies-runtime-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=createCollaborationStore(root),project=fixtures.project(root);project.tasks[0].title='Accepted source';project.tasks[0].intent='deliver';project.tasks[0].createdAt=1;
 store.update(0,project);const sourceRun=fixtures.run(project,'source-run');sourceRun.intent='deliver';project.runs.push(sourceRun);store.update(1,project);store.claim('p','source-run');
 change(store,p=>fixtures.prepareDelivery(p.runs[0]));change(store,p=>fixtures.approveDelivery(p.runs[0]));
 change(store,p=>p.tasks.push({id:'target',title:'Dependent work',goal:'Use the accepted source text',acceptance:'Cite the frozen source',intent:'deliver',dependsOn:['task'],entries:[],status:'saved',createdAt:2}));
 const calls=[],bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(revision,p)=>store.update(revision,p),collaborationClaim:async(projectId,runId)=>store.claim(projectId,runId),toolAbort:async()=>{}};
 const load=loader({
  './store':{uid:(prefix='id')=>`${prefix}-${crypto.randomUUID()}`,secretGet:async()=> 'fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
  './transport':{desktop:()=>bridge},
  './agent':{runAgent(args){calls.push(args);queueMicrotask(()=>{args.events.onContentDelta('dependent result');args.events.onDone();});return {abort(){args.events.onPaused?.('cancelled');}};}},
 });
 const {TeamRuntime}=load(file('src/lib/team-runtime.ts')),runtime=new TeamRuntime(),config=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
 runtime.settings=()=>({defaultConfig:config,keyProfiles:[{id:'key',name:'Fixture',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
 return {store,runtime,config,calls,load};
}

test('runtime freezes accepted inputs and sends exact dependency text to the member prompt and contract',async t=>{
 const f=fixture(t);await f.runtime.load();
 const runId=await f.runtime.createRun('p','target','flow','v',f.config);
 let run=f.runtime.project('p').runs.find(item=>item.id===runId);
 assert.deepEqual(run.dependencyTaskIds,['task']);
 assert.equal(run.dependencyInputs[0].runId,'source-run');
 assert.equal(run.dependencyInputs[0].outputs[0].text,'Verified result');
 const agent=run.version.graph.nodes.find(node=>node.type==='agent');
 const {teamTaskContract}=f.load(file('src/lib/team-contract.ts'));
 assert.deepEqual(teamTaskContract(run,agent,'m',[],[]).dependencyInputs,run.dependencyInputs);
 await f.runtime.start('p',runId);
 assert.equal(f.calls.length,1);
 const prompt=f.calls[0].history[0].content;
 assert.match(prompt,/"dependencyInputs"/);
 assert.match(prompt,/Accepted source/);
 assert.match(prompt,/Verified result/);
 run=f.runtime.project('p').runs.find(item=>item.id===runId);assert.equal(run.status,'waiting_user');
});

test('runtime create blocks an unaccepted latest source run and start preserves prepared snapshots',async t=>{
 const blocked=fixture(t);await blocked.runtime.load();
 change(blocked.store,p=>{const later=fixtures.run(p,'later');later.intent='deliver';p.runs.push(later);});
 await blocked.runtime.load();
 await assert.rejects(()=>blocked.runtime.createRun('p','target','flow','v',blocked.config),/尚无已完成的验收运行/);

 const prepared=fixture(t);await prepared.runtime.load();const runId=await prepared.runtime.createRun('p','target','flow','v',prepared.config);
 change(prepared.store,p=>Object.assign(p.tasks.find(task=>task.id==='task'),{title:'Renamed after preparation',goal:'Changed after preparation',acceptance:'Changed after preparation'}));
 await prepared.runtime.load();
 await prepared.runtime.start('p',runId);
 assert.equal(prepared.store.read().projects.p.runs.find(run=>run.id===runId).status,'waiting_user');
 assert.equal(prepared.calls.length,1);
 assert.match(prepared.calls[0].history[0].content,/Accepted source/);
 assert.match(prepared.calls[0].history[0].content,/Produce a report/);
 assert.doesNotMatch(prepared.calls[0].history[0].content,/Renamed after preparation/);
});

test('a newer accepted source run does not replace a prepared frozen snapshot',async t=>{
 const f=fixture(t);await f.runtime.load();const runId=await f.runtime.createRun('p','target','flow','v',f.config);
 // A second accepted source run is appended through the same durable transitions.
 let data=f.store.read(),p=data.projects.p,later=fixtures.run(p,'later-source');later.intent='deliver';p.runs.push(later);f.store.update(data.revision,p);
 f.store.claim('p','later-source');change(f.store,p=>{const r=p.runs.find(run=>run.id==='later-source');fixtures.prepareDelivery(r);r.attempts.find(a=>a.id==='work').output='New source output';});change(f.store,p=>fixtures.approveDelivery(p.runs.find(run=>run.id==='later-source')));
 await f.runtime.load();await f.runtime.start('p',runId);
 assert.match(f.calls[0].history[0].content,/Verified result/);
 assert.doesNotMatch(f.calls[0].history[0].content,/New source output/);
});
