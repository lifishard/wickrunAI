'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');
const {createTeamFiles}=require('../electron/team-files.cjs');
const {createTeamExecutionGuard}=require('../electron/team-execution-guard.cjs');
const {createLocalClients}=require('../electron/local-clients.cjs');

function fixture(t,execute){
 const tmpRoot=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tmpRoot,'wickrun-review-loop-')),root=path.join(dir,'project'),data=path.join(dir,'data');fs.mkdirSync(root);fs.mkdirSync(data);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({state:'seed'}));
 t.after(()=>{assert.equal(path.dirname(dir),tmpRoot);assert.ok(path.basename(dir).startsWith('wickrun-review-loop-'));fs.rmSync(dir,{recursive:true,force:true});});
 const store=createCollaborationStore(data),teamFiles=createTeamFiles(data),collaboration={read:()=>store.read()},guard=createTeamExecutionGuard({collaboration,teamFiles}),calls=[];
 const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(revision,project)=>store.update(revision,project),collaborationClaim:async(project,id)=>store.claim(project,id),toolAbort:async()=>{},
  teamFilesCreate:(projectId,runId,memberId,sourceRoot)=>guard.createFileSession({projectId,taskId:runId,memberId,root:sourceRoot}),teamFilesDiff:id=>teamFiles.diff(id),
  teamArtifactsPublish:(scope,id)=>guard.publishArtifact(scope,id),teamArtifactsReceive:(scope,id,ids)=>guard.receiveArtifacts(scope,id,ids),teamArtifactsValidate:(scope,ids)=>guard.validateArtifacts(scope,ids)};
 const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=> 'fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},'./transport':{desktop:()=>bridge},'./agent':{runAgent(args){calls.push(args);queueMicrotask(()=>void Promise.resolve(execute(args,{store,teamFiles,guard,root,calls})).catch(error=>args.events.onError(error.message,{kind:'unknown'})));return {abort(){args.events.onPaused?.('cancelled');}};}}});
 const domain=load(path.resolve('src/lib/collaboration.ts')),contract=load(path.resolve('src/lib/team-contract.ts')),{TeamRuntime}=load(path.resolve('src/lib/team-runtime.ts')),runtime=new TeamRuntime(),cfg=load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();
 runtime.settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'executor-key',name:'Executor',baseUrl:'https://example.invalid'},{id:'reviewer-key',name:'Reviewer',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
 return {dir,root,data,store,teamFiles,guard,calls,domain,contract,runtime,cfg};
}
async function setupReview(f){
 await f.runtime.load();const p=f.domain.emptyTeamProject('p');p.settings.roots=[f.root];p.settings.allowedConnections=['executor-key','reviewer-key'];p.settings.maxConcurrent=1;p.settings.maxTokens=100000;p.settings.maxMinutes=30;
 p.members=[{id:'executor',name:'Executor',instructions:'Write the requested JSON.',connectionId:'executor-key',model:'fixture',effort:'medium',enabled:true,tools:['read_file','write_file'],maxTokens:20000,maxMinutes:2},{id:'reviewer',name:'Reviewer',instructions:'Read every artifact and validate the schema.',connectionId:'reviewer-key',model:'fixture',effort:'medium',enabled:true,tools:['read_file'],maxTokens:20000,maxMinutes:2}];
 const task={id:'task',title:'JSON review loop',goal:'Write result.json with state ready and count 2.',acceptance:'result.json is valid JSON with state exactly ready and count exactly 2.',ownerId:'executor',entries:[],status:'ready',createdAt:1},flow=f.domain.reviewFlowGraph(task,p.members,'Review loop');flow.draft.maxTokens=100000;flow.draft.maxMinutes=20;flow.draft.maxSteps=20;flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];p.tasks=[task];p.workflows=[flow];await f.runtime.update('p',target=>Object.assign(target,p));const runId=await f.runtime.createRun('p','task',flow.id,'v',f.cfg);return {runId,flow};
}
function step(id,name,args,output='ok'){return {id,callId:id,name,args,status:'ok',summary:name,output,startedAt:Date.now(),elapsedMs:1};}

test('real runtime, artifacts, and guard complete fail-rework-pass before user delivery',async t=>{
 let executorVisits=0,reviewVisits=0,oldArtifactId;let f;
 f=fixture(t,async(args,env)=>{
  const ctx=args.toolCtx(),scope=ctx.teamExecution,project=env.store.read().projects.p,run=project.runs.find(r=>r.id===scope.runId),attempt=run.attempts.find(a=>a.id===scope.attemptId),node=run.version.graph.nodes.find(n=>n.id===attempt.nodeId),session=project.files.find(file=>file.taskId===run.id&&file.memberId===scope.memberId);
  assert.ok(session);assert.notEqual(session.isolatedRoot,env.root);
  if(node.type==='agent'){
   executorVisits++;const guarded=env.guard.tool('write_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json');assert.equal(path.dirname(target),session.isolatedRoot);
   if(executorVisits===1)fs.writeFileSync(target,'{"state":"broken"');else{assert.match(args.history[0].content,/invalid JSON/);fs.writeFileSync(target,JSON.stringify({state:'ready',count:2}));}
   args.events.onStep(step('write-'+executorVisits,'write_file',{path:target}));args.events.onContentDelta(executorVisits===1?'Draft written':'Reworked from reviewer feedback');args.events.onDone();return;
  }
  assert.equal(node.type,'review');reviewVisits++;assert.throws(()=>env.guard.tool('write_file',ctx),/只允许读取/);const guarded=env.guard.tool('read_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json'),body=fs.readFileSync(target,'utf8'),callId='read-'+reviewVisits;args.events.onStep(step(callId,'read_file',{path:target},body));
  const ids=attempt.inputArtifacts.map(a=>a.id);assert.equal(ids.length,1);
  if(reviewVisits===1){oldArtifactId=ids[0];assert.throws(()=>JSON.parse(body));args.events.onContentDelta(JSON.stringify({verdict:'fail',evidence:[callId],changes:'result.json is invalid JSON; rewrite it with state ready and count 2.',artifactIds:ids}));}
  else{assert.deepEqual(JSON.parse(body),{state:'ready',count:2});assert.notEqual(ids[0],oldArtifactId);assert.equal(attempt.inputArtifacts[0].version,2);assert.throws(()=>env.guard.receiveArtifacts(scope,session.id,[oldArtifactId]),/最新已完成输入/);fs.writeFileSync(target,JSON.stringify({state:'reviewer-mutated',count:2}));assert.throws(()=>env.guard.validateArtifacts(scope,ids),/接收后变化/);fs.writeFileSync(target,body);assert.deepEqual(env.guard.validateArtifacts(scope,ids).map(a=>a.id),ids);args.events.onContentDelta(JSON.stringify({verdict:'pass',evidence:[callId],changes:'Read the new result.json and verified valid JSON, state ready, and count 2.',artifactIds:ids}));}
  args.events.onDone();
 });
 const {runId}=await setupReview(f);await f.runtime.start('p',runId);let run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'waiting_user');assert.equal(executorVisits,2);assert.equal(reviewVisits,2);
 const work=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='agent'),reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');assert.deepEqual(work.map(a=>a.artifacts[0].version),[1,2]);assert.deepEqual(reviews.map(a=>a.review.verdict),['fail','pass']);assert.equal(reviews[0].inputArtifacts[0].id,work[0].artifacts[0].id);assert.equal(reviews[1].inputArtifacts[0].id,work[1].artifacts[0].id);
 const reviewerSession=f.runtime.project('p').files.find(file=>file.memberId==='reviewer');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(reviewerSession.isolatedRoot,'result.json'),'utf8')),{state:'ready',count:2});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'result.json'),'utf8')),{state:'seed'});
 await f.runtime.approve('p',runId,true);run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'completed');assert.equal(f.runtime.project('p').tasks.find(task=>task.id==='task').status,'已完成');
});

test('review contract rejects invented calls, stale artifacts, and unrelated-file evidence',t=>{
 const f=fixture(t,async()=>{}),artifact={id:'artifact-current',files:[{path:'result.json',beforeHash:null,afterHash:'a'.repeat(64)}]},attempt={inputArtifacts:[artifact],steps:[step('read-real','read_file',{path:path.join(f.root,'unrelated.json')})]};
 assert.throws(()=>f.contract.verifyTeamReview(JSON.stringify({verdict:'pass',evidence:['invented-call'],changes:'claimed',artifactIds:[artifact.id]}),attempt),/实际成功/);
 assert.throws(()=>f.contract.verifyTeamReview(JSON.stringify({verdict:'pass',evidence:['read-real'],changes:'wrong file',artifactIds:['artifact-old']}),attempt),/本次接收/);
 assert.throws(()=>f.contract.verifyTeamReview(JSON.stringify({verdict:'pass',evidence:['read-real'],changes:'wrong file',artifactIds:[artifact.id]}),attempt),/全部改动文件/);
});

test('native clients reject review nodes before dispatch because they cannot provide tool evidence',async t=>{
 const tmpRoot=fs.realpathSync.native(os.tmpdir()),root=fs.mkdtempSync(path.join(tmpRoot,'wickrun-native-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const member={id:'reviewer',name:'Native reviewer',enabled:true,connectionId:'client:codex',model:'fixture',effort:'medium',tools:['read_file'],maxTokens:100,maxMinutes:1},run={id:'run',status:'running',members:[member],projectSettings:{allowedConnections:['client:codex'],roots:[],maxConcurrent:1},version:{graph:{maxTokens:1000,maxMinutes:1,nodes:[{id:'review',type:'review',memberId:'reviewer'}]}},tokens:0,reservations:{'attempt:reviewer':100},attempts:[{id:'attempt',nodeId:'review',status:'running'}],events:[]},project={id:'p',files:[],runs:[run]};let data={revision:0,projects:{p:project}},created=0;
 const collaboration={read:()=>structuredClone(data),update(revision,next){assert.equal(revision,data.revision);data={revision:revision+1,projects:{p:structuredClone(next)}};}},manager=createLocalClients({userData:root,collaboration,teamFiles:{get:()=>null},getSettings:()=>({clients:{codexBin:path.join(root,'missing.exe')}}),openExternal:async()=>{},deps:{createCodexClient(){created++;throw Error('must not dispatch');}}});t.after(()=>manager.close());
 await assert.rejects(manager.run({projectId:'p',runId:'run',attemptId:'attempt',memberId:'reviewer',prompt:'Review this'}),/不提供可核验/);assert.equal(created,0);
});

test('native modification-only work accepts a real isolated diff as completion evidence',async t=>{
 const f=fixture(t,async()=>{});await f.runtime.load();const p=f.domain.emptyTeamProject('p');p.settings.roots=[f.root];p.settings.allowedConnections=['client:codex'];p.settings.maxTokens=10000;const member={id:'native',name:'Native executor',instructions:'Edit files',connectionId:'client:codex',model:'fixture',effort:'medium',enabled:true,tools:['write_file'],maxTokens:2000,maxMinutes:1};p.members=[member];const flow=f.domain.newWorkflow('Native edit'),start=flow.draft.nodes[0],end=flow.draft.nodes[1],agent=f.domain.newNode('agent');agent.memberId=member.id;agent.instructions='Edit result.json';end.outputRequirement='result.json is changed';agent.outputRequirement='result.json is changed';flow.draft.nodes=[start,agent,end];flow.draft.edges=[{id:'a',from:start.id,to:agent.id,port:'next',label:'edit',maxTraversals:2},{id:'b',from:agent.id,to:end.id,port:'next',label:'deliver',maxTraversals:2}];flow.draft.maxTokens=10000;flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];p.workflows=[flow];p.tasks=[{id:'task',title:'Native edit',goal:'Edit result.json',acceptance:'result.json is changed',entries:[],status:'ready',createdAt:1}];await f.runtime.update('p',target=>Object.assign(target,p));const runId=await f.runtime.createRun('p','task',flow.id,'v',f.cfg),session=f.teamFiles.create({projectId:'p',taskId:runId,memberId:member.id,root:f.root},[f.root]);await f.runtime.update('p',project=>project.files.push(session));assert.match(await f.runtime.clientEvidenceIssue('p',runId,agent,[member]),/没有任何文件变化/);fs.writeFileSync(path.join(session.isolatedRoot,'result.json'),JSON.stringify({state:'native-change'}));
 const issue=await f.runtime.clientEvidenceIssue('p',runId,agent,[member]);assert.equal(issue,undefined);const saved=f.runtime.project('p').files.find(file=>file.id===session.id);assert.equal(saved.status,'pending');assert.deepEqual(saved.files.map(file=>file.path),['result.json']);assert.match(await f.runtime.clientEvidenceIssue('p',runId,{...agent,instructions:'Edit result.json and run tests'},[member]),/要求测试或推送/);
});

test('execution-review template has independent roles and bounded rework with native review rejected before dispatch',t=>{
 const f=fixture(t,async()=>{}),members=[{id:'a',enabled:true,connectionId:'key',tools:['write_file'],model:'fixture',maxTokens:1000},{id:'b',enabled:true,connectionId:'key',tools:['read_file'],model:'fixture',maxTokens:1000}];
 const flow=f.domain.reviewFlowGraph({title:'Task',goal:'Write a result',acceptance:'Readable result'},members,'Review');
 assert.equal(flow.draft.nodes.some(n=>n.type==='discussion'),false);assert.equal(flow.draft.nodes.find(n=>n.type==='agent').memberId,'a');assert.equal(flow.draft.nodes.find(n=>n.type==='review').memberId,'b');assert.ok(flow.draft.edges.find(e=>e.loop&&e.port==='fail').maxTraversals>0);
 assert.equal(f.domain.validateGraph(flow.draft,members).filter(x=>x.severity==='error').length,0);
 members[1].connectionId='client:codex';assert.ok(f.domain.validateGraph(flow.draft,members).some(x=>/API/.test(x.message)));
});
