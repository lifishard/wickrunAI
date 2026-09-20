'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=name=>path.resolve(__dirname,'..',name);
const ts=loader()(file('src/lib/team-dependencies.ts'));
const cjs=require('../electron/team-dependencies.cjs');

const node=(id,type)=>({id,type,title:id,instructions:'work',outputRequirement:'done',inputRefs:[],maxVisits:3,join:'all',x:0,y:0});
function task(id,options={}){return {id,title:options.title??id,goal:options.goal??`${id} goal`,acceptance:options.acceptance??`${id} accepted`,intent:options.intent,dependsOn:options.dependsOn,status:'saved',entries:[],createdAt:options.createdAt??1};}
function acceptedRun(task,id='source-run',options={}){
 const nodes=[node('start','start'),node('work','agent'),node('review','review'),node('end','end')];
 const startedAt=options.startedAt??10;
 return {id,taskId:task.id,status:options.status??'completed',goal:options.goal??task.goal,acceptance:options.acceptance??task.acceptance,createdAt:options.createdAt??10,updatedAt:options.updatedAt??10,
  intent:options.intent,queue:options.queue??[],approvalQueue:options.approvalQueue??[],reservations:options.reservations??{},pendingApproval:options.pendingApproval,
  version:{id:'v',number:1,createdAt:1,graph:{nodes,edges:[],maxSteps:20,maxMinutes:10,maxTokens:100000}},
  attempts:options.attempts??[
   {id:'old-work',nodeId:'work',status:'failed',startedAt:1,endedAt:2,output:'old output',steps:[]},
   {id:'latest-work',nodeId:'work',status:'completed',startedAt:3,endedAt:4,output:options.output??'accepted dependency text',steps:[],artifacts:options.artifacts},
   {id:'end-pass',nodeId:'end',status:'completed',outcome:'pass',startedAt,endedAt:startedAt+1,output:'accepted',steps:[]},
  ],events:options.events??[{id:'approval',kind:'approval',nodeId:'end',approved:true,at:startedAt+1,text:'approved'}]};
}
function project(options={}){
 const source=task('source',{title:'Source'}),target=task('target',{title:'Target',dependsOn:['source']});
 return {tasks:options.tasks??[source,target],runs:options.runs??[acceptedRun(source)]};
}
function errorOf(fn){try{fn();return null;}catch(error){return error.message;}}

test('dependency graph rejects unknown, self, duplicate, explore, excessive and cyclic edges',()=>{
 const cases=[
  [[task('a',{dependsOn:['missing']})],/不存在/],
  [[task('a',{dependsOn:['a']})],/依赖自身/],
  [[task('a'),task('b',{dependsOn:['a','a']})],/重复/],
  [[task('idea',{intent:'explore'}),task('b',{dependsOn:['idea']})],/想法梳理/],
  [[...Array.from({length:9},(_,i)=>task('s'+i)),task('b',{dependsOn:Array.from({length:9},(_,i)=>'s'+i)})],/最多只能有 8 个/],
  [[task('a',{dependsOn:['b']}),task('b',{dependsOn:['a']})],/循环/],
 ];
 for(const [tasks,pattern] of cases)assert.throws(()=>ts.validateTaskDependencies({tasks}),pattern);
});

test('capture requires the newest created run to be completed and explicitly accepted',()=>{
 const p=project();
 assert.deepEqual(ts.captureTaskDependencies(p,'target'),{
  dependencyTaskIds:['source'],dependencyInputs:[{taskId:'source',runId:'source-run',title:'Source',goal:'source goal',acceptance:'source accepted',outputs:[{attemptId:'latest-work',nodeId:'work',text:'accepted dependency text'}]}],
 });
 for(const [label,mutate,pattern] of [
  ['failed',run=>{run.status='failed';},/尚无已完成/],
  ['cancelled',run=>{run.status='cancelled';},/尚无已完成/],
  ['no end approval',run=>{run.events=[];},/明确验收/],
  ['failed end',run=>{run.attempts.at(-1).outcome='fail';},/明确验收/],
  ['changed contract',run=>{run.goal='old goal';},/已变化/],
  ['empty work',run=>{run.attempts[1].output='';},/缺少实际完成/],
  ['exploration run',run=>{run.intent='explore';},/想法梳理运行/],
  ['queued work',run=>{run.queue=['work'];},/执行、审批或预留/],
  ['pending approval',run=>{run.pendingApproval={nodeId:'end',text:'pending'};},/执行、审批或预留/],
  ['unresolved attempt',run=>{run.attempts.push({id:'uncertain',nodeId:'review',status:'uncertain',startedAt:20,output:'',steps:[]});},/未核实步骤/],
  ['later failed visit',run=>{run.attempts.push({id:'later-fail',nodeId:'work',status:'failed',startedAt:20,output:'',steps:[]});},/失败或未完成步骤/],
 ]){
  const copy=structuredClone(p);mutate(copy.runs[0]);assert.throws(()=>ts.captureTaskDependencies(copy,'target'),pattern,label);
 }
 const later=acceptedRun(p.tasks[0],'later',{status:'failed',createdAt:20});
 assert.throws(()=>ts.captureTaskDependencies({...p,runs:[p.runs[0],later]},'target'),/尚无已完成/,'latest created run controls readiness');
});

test('text-only limits reject file artifacts and oversized snapshots without truncation',()=>{
 const files=project();files.runs[0].attempts[1].artifacts=[{id:'artifact',files:[{path:'result.txt',beforeHash:null,afterHash:'hash'}]}];
 assert.throws(()=>ts.captureTaskDependencies(files,'target'),/只支持文本依赖/);
 const huge=project();huge.runs[0].attempts[1].output='x'.repeat(32000);
 assert.throws(()=>ts.captureTaskDependencies(huge,'target'),/超过 32000 字符/);
 assert.equal(huge.runs[0].attempts[1].output.length,32000,'source text is not truncated');
});

test('frozen snapshots are immutable but remain valid after a newer source run',()=>{
 const p=project(),frozen=ts.captureTaskDependencies(p,'target');
 const run={id:'target-run',taskId:'target',...structuredClone(frozen)};
 assert.doesNotThrow(()=>ts.validateFrozenDependencies(p,run));
 const tampered=structuredClone(run);tampered.dependencyInputs[0].outputs[0].text='rewritten';
 assert.throws(()=>ts.validateFrozenDependencies(p,tampered),/不可改写/);
 const later=acceptedRun(p.tasks[0],'later-success',{createdAt:20,output:'newer text'});
 assert.doesNotThrow(()=>ts.validateFrozenDependencies({...p,runs:[...p.runs,later]},run),'new source work does not replace the frozen run');
 const renamed=structuredClone(p);Object.assign(renamed.tasks[0],{title:'Renamed',goal:'New goal',acceptance:'New acceptance'});
 assert.doesNotThrow(()=>ts.validateFrozenDependencies(renamed,run),'later task edits do not rewrite an authenticated frozen source run');
 const legacy={id:'legacy',taskId:'source'};
 assert.doesNotThrow(()=>ts.validateFrozenDependencies(p,legacy));
 assert.throws(()=>ts.validateFrozenDependencies(p,{id:'missing',taskId:'target'}),/缺少前置任务冻结快照/);
});

test('dependencyBlockers returns readable errors and never throws',()=>{
 const p=project();assert.deepEqual(ts.dependencyBlockers(p,'target'),[]);
 p.runs[0].status='failed';const blockers=ts.dependencyBlockers(p,'target');assert.equal(blockers.length,1);assert.match(blockers[0],/尚无已完成/);
 assert.deepEqual(ts.dependencyBlockers(p,'missing'),['任务不存在']);
});

test('TypeScript and Electron helpers remain behaviorally identical',()=>{
 const good=project();assert.deepEqual(cjs.captureTaskDependencies(good,'target'),ts.captureTaskDependencies(good,'target'));
 const mutations=[
  p=>p.tasks[1].dependsOn=['source','source'],
  p=>p.runs[0].events=[],
  p=>p.runs[0].attempts[1].artifacts=[{id:'files'}],
  p=>p.runs[0].attempts[1].output='x'.repeat(32000),
 ];
 for(const mutate of mutations){const p=project();mutate(p);assert.equal(errorOf(()=>cjs.captureTaskDependencies(p,'target')),errorOf(()=>ts.captureTaskDependencies(p,'target')));}
 const frozen=ts.captureTaskDependencies(good,'target'),run={id:'target-run',taskId:'target',...frozen};
 assert.equal(errorOf(()=>cjs.validateFrozenDependencies(good,run)),errorOf(()=>ts.validateFrozenDependencies(good,run)));
 run.dependencyInputs[0].outputs[0].text='tamper';
 assert.equal(errorOf(()=>cjs.validateFrozenDependencies(good,run)),errorOf(()=>ts.validateFrozenDependencies(good,run)));
});
