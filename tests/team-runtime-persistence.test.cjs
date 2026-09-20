'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');

function fixture(t,kind){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-team-persistence-'));t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
 const store=createCollaborationStore(data);let failed=false,events;
 const bridge={
  collaborationRead:async()=>store.read(),
  collaborationClaim:async(projectId,runId)=>store.claim(projectId,runId),
  collaborationUpdate:async(revision,project)=>{
   const next=project.runs[0],saved=store.read().projects.p?.runs[0];
   const stepWrite=kind==='step'&&next?.attempts.some(attempt=>attempt.steps?.length)&&!saved?.attempts.some(attempt=>attempt.steps?.length);
   const usageWrite=kind==='usage'&&(next?.tokens??0)>(saved?.tokens??0);
   if(!failed&&(stepWrite||usageWrite)){failed=true;throw Error(kind==='step'?'fixture step persistence failure':'fixture usage persistence failure');}
   return store.update(revision,project);
  },
  toolAbort:async()=>{},
 };
 const load=loader({
  './store':{uid:(prefix='id')=>`${prefix}-${crypto.randomUUID()}`,secretGet:async()=> 'fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
  './transport':{desktop:()=>bridge},
  './agent':{runAgent(args){events=args.events;let ended=false;queueMicrotask(()=>{
   if(kind==='step')args.events.onStep({id:'step',callId:'call',name:'read_file',args:{path:'fixture.txt'},status:'ok',result:'fixture',startedAt:1,endedAt:2});
   else args.events.onUsage({total_tokens:37});
  });return {abort(){if(ended)return;ended=true;args.events.onPaused('用户暂停执行');}};}},
 });
 const {TeamRuntime}=load(path.resolve('src/lib/team-runtime.ts')),domain=load(path.resolve('src/lib/collaboration.ts'));
 const config=load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig(),runtime=new TeamRuntime();
 runtime.settings=()=>({defaultConfig:config,keyProfiles:[{id:'key',name:'Fixture',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
 return {data,store,runtime,domain,config,get failed(){return failed;},get events(){return events;}};
}

async function runFailure(f){
 await f.runtime.load();const project=f.domain.emptyTeamProject('p');project.settings.roots=[f.data];project.settings.maxTokens=10000;project.settings.maxMinutes=30;
 project.members=[{id:'member',name:'Member',instructions:'Do the work',connectionId:'key',model:'fixture',effort:'medium',enabled:true,tools:[],maxTokens:4000,maxMinutes:5}];
 const flow=f.domain.newWorkflow('Flow'),start=flow.draft.nodes[0],end=flow.draft.nodes[1],agent=f.domain.newNode('agent');agent.id='agent';agent.memberId='member';agent.instructions='Produce output';agent.outputRequirement='Evidence';end.outputRequirement='User accepts';
 flow.draft.nodes=[start,agent,end];flow.draft.edges=[{id:'start-agent',from:start.id,to:agent.id,port:'next',label:'next',maxTraversals:3},{id:'agent-end',from:agent.id,to:end.id,port:'next',label:'next',maxTraversals:3}];flow.draft.maxTokens=10000;flow.draft.maxMinutes=30;flow.versions=[{id:'version',number:1,createdAt:1,graph:structuredClone(flow.draft)}];
 project.workflows=[flow];project.tasks=[{id:'task',title:'Task',goal:'Produce output',acceptance:'Evidence',status:'ready',entries:[],createdAt:1}];
 await f.runtime.update('p',target=>Object.assign(target,project));const runId=await f.runtime.createRun('p','task',flow.id,'version',f.config);await f.runtime.start('p',runId);
 assert.equal(f.failed,true);return f.store.read().projects.p.runs.find(run=>run.id===runId).attempts.find(attempt=>attempt.nodeId==='agent');
}

for(const [kind,prefix,original] of [
 ['step','执行记录写入失败','fixture step persistence failure'],
 ['usage','用量记录写入失败','fixture usage persistence failure'],
])test(`${kind} persistence failure survives abort and pause callbacks`,async t=>{
 const attempt=await runFailure(fixture(t,kind));
 assert.equal(attempt.error,`Error: ${prefix}：Error: ${original}`);
 assert.doesNotMatch(attempt.error,/用户暂停/);
 assert.ok(['failed','uncertain'].includes(attempt.status));
});
