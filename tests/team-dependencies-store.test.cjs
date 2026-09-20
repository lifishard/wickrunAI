'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');
const deps=require('../electron/team-dependencies.cjs');
const fixtures=require('./team-store-fixtures.cjs');

function rootOf(t){const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'wickrun-dependencies-store-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function change(store,fn){const data=store.read(),project=data.projects.p;fn(project);return store.update(data.revision,project);}
function installAcceptedSource(t){
 const root=rootOf(t),store=createCollaborationStore(root),project=fixtures.project(root);
 project.tasks[0].title='Source';project.tasks[0].intent='deliver';project.tasks[0].createdAt=1;
 store.update(0,project);const sourceRun=fixtures.run(project,'source-run');sourceRun.intent='deliver';project.runs.push(sourceRun);store.update(1,project);store.claim('p','source-run');
 change(store,p=>fixtures.prepareDelivery(p.runs[0]));change(store,p=>fixtures.approveDelivery(p.runs[0]));
 change(store,p=>p.tasks.push({id:'target',title:'Target',goal:'Use the report',acceptance:'Dependency is cited',intent:'deliver',dependsOn:['task'],entries:[],status:'saved',createdAt:2}));
 return {root,store};
}
function addTargetRun(store,mutate=()=>{}){
 let created;
 change(store,p=>{const frozen=deps.captureTaskDependencies(p,'target'),target=p.tasks.find(t=>t.id==='target'),run=fixtures.run(p,'target-run');run.taskId='target';run.intent=target.intent;run.goal=target.goal;run.acceptance=target.acceptance;Object.assign(run,frozen);mutate(run,p);p.runs.push(run);created=run;});
 return created;
}

test('store accepts an authenticated dependency snapshot and claim revalidates it',t=>{
 const {store}=installAcceptedSource(t);addTargetRun(store);
 const claimed=store.claim('p','target-run').projects.p.runs.find(run=>run.id==='target-run');
 assert.equal(claimed.status,'running');
 assert.equal(claimed.dependencyInputs[0].outputs[0].text,'Verified result');
});

test('store rejects forged new snapshots and makes saved dependency fields immutable',t=>{
 const forged=installAcceptedSource(t);
 assert.throws(()=>addTargetRun(forged.store,run=>{run.dependencyInputs[0].outputs[0].text='forged';}),/必须来自已保存的已验收运行/);
 addTargetRun(forged.store);
 assert.throws(()=>change(forged.store,p=>{p.runs.find(run=>run.id==='target-run').dependencyInputs[0].outputs[0].text='rewritten';}),/快照不可改写/);
 assert.throws(()=>change(forged.store,p=>{p.tasks.find(task=>task.id==='target').dependsOn=[];}),/不可修改前置关系/);
 assert.doesNotThrow(()=>change(forged.store,p=>{p.tasks.find(task=>task.id==='target').title='Renamed target';}),'other task fields remain editable');
});

test('claim keeps the prepared snapshot when source title and contract later change',t=>{
 const {store}=installAcceptedSource(t);addTargetRun(store);
 change(store,p=>Object.assign(p.tasks.find(task=>task.id==='task'),{title:'Renamed source',goal:'Changed source goal',acceptance:'Changed source acceptance'}));
 const claimed=store.claim('p','target-run').projects.p.runs.find(run=>run.id==='target-run');
 assert.equal(claimed.status,'running');
 assert.deepEqual(claimed.dependencyInputs[0],{taskId:'task',runId:'source-run',title:'Source',goal:'Produce a report',acceptance:'Verify the report',outputs:[{attemptId:'work',nodeId:'node',text:'Verified result'}]});
});

test('store validates dependency graphs on every update',t=>{
 const {store}=installAcceptedSource(t);
 assert.throws(()=>change(store,p=>{p.tasks.find(task=>task.id==='target').dependsOn=['missing'];}),/不存在/);
 assert.throws(()=>change(store,p=>{p.tasks.find(task=>task.id==='target').dependsOn=['target'];}),/依赖自身/);
});

test('restart and claim preserve compatibility for legacy runs without dependency fields',t=>{
 const root=rootOf(t),first=createCollaborationStore(root),project=fixtures.project(root);project.tasks[0].title='Legacy';
 first.update(0,project);project.runs.push(fixtures.run(project,'legacy-run'));first.update(1,project);
 const restarted=createCollaborationStore(root);
 assert.equal(restarted.read().projects.p.runs[0].dependencyInputs,undefined);
 assert.equal(restarted.claim('p','legacy-run').projects.p.runs[0].status,'running');
});
