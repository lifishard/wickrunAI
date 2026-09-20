'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');
const {createTeamFiles}=require('../electron/team-files.cjs');
const {createTeamExecutionGuard}=require('../electron/team-execution-guard.cjs');

const file=p=>path.resolve(__dirname,'..',p),stagnation=loader()(file('src/lib/team-stagnation.ts'));
const reviewNode=(mode='files')=>({id:'review',type:'review',reviewMode:mode,title:'Review',instructions:'Check the delivered result.',
  inputRefs:['work'],outputRequirement:'The result satisfies the frozen requirement.',maxVisits:5,join:'all',x:0,y:0,ports:[]});
const step=(id,path,output,name='read_file')=>({id,callId:id,name,args:{path},status:'ok',summary:name,output,startedAt:1,elapsedMs:1});
const artifact=(id,files)=>({id,sessionId:'session',projectId:'p',taskId:'task',memberId:'worker',nodeId:'work',attemptId:'work-'+id,
  version:1,createdAt:1,digest:'digest-'+id,files});
const requirement=(title='Frozen requirement')=>({id:crypto.randomUUID(),revision:1,title,sourceId:'source',sourceQuote:'The result is valid.',
  check:{kind:'review'},at:1,history:[]});
function fileAttempt(id,{status='completed',outcome='fail',artifactId=id,files=[{path:'result.json',beforeHash:null,afterHash:'a'.repeat(64)}],
  calls=[step('read-'+id,`C:/isolated-${id}/result.json`,'{"state":"broken"}')],evidence=calls.map(call=>call.id),
  verdict='fail',requirements=[requirement()]}={}){
  return {id,nodeId:'review',visit:1,status,startedAt:1,endedAt:2,output:'review',steps:calls,outcome,
    inputArtifacts:[artifact(artifactId,files)],review:{verdict,evidence,changes:'Exact check result.',method:'model',artifactIds:[artifactId]},
    state:{requirements}};
}
function textAttempt(id,{status='completed',outcome='fail',inputId=id,digest='b'.repeat(64),quote='The exact repeated sentence.',
  verdict='fail',requirements=[requirement()]}={}){
  return {id,nodeId:'review',visit:1,status,startedAt:1,endedAt:2,output:'review',steps:[],outcome,
    inputTexts:[{id:'text:'+inputId,attemptId:inputId,nodeId:'work',version:Number(id.replace(/\D/g,''))||1,digest,text:'The exact repeated sentence.'}],
    textReview:{verdict,artifactIds:['text:'+inputId],textEvidence:verdict==='unverifiable'?[]:[{artifactId:'text:'+inputId,quote}],changes:'Exact check result.',method:'model'},
    state:{requirements}};
}
function run(attempts,node=reviewNode()){
  return {id:'run',taskId:'task',workflowId:'flow',version:{id:'v',number:1,createdAt:1,graph:{nodes:[node],edges:[],maxSteps:20,maxMinutes:10,maxTokens:100000}},
    members:[],config:{},status:'running',goal:'Produce the frozen result.',acceptance:'The result is valid.',queue:[],arrivals:{},visits:{},traversals:{},attempts,
    events:[],tokens:0,createdAt:1,updatedAt:2,projectSettings:{roots:[],allowedConnections:[],maxConcurrent:1,maxTokens:100000,maxMinutes:10,approvalMode:'ask'},
    memorySnapshot:[],reservations:{},memoryIds:[]};
}

test('file manifests ignore artifact and call ids, include deletions, and compare read substance',async()=>{
  const files=[{path:'result.json',beforeHash:null,afterHash:'a'.repeat(64)},{path:'old.txt',beforeHash:'c'.repeat(64),afterHash:null}];
  const prior=fileAttempt('prior',{artifactId:'artifact-v1',files,calls:[step('call-v1','C:/first-root/result.json','same bytes')]});
  const current=fileAttempt('current',{status:'running',artifactId:'artifact-v2',files:[...files].reverse(),calls:[step('call-v2','D:/second-root/result.json','same bytes')]});
  const found=await stagnation.repeatedReviewStagnation(run([prior,current]),reviewNode(),current);
  assert.equal(found.repeats,2);assert.match(found.fingerprint,/^[a-f0-9]{64}$/);assert.match(found.reason,/精确产物与检查重复/);
});

test('text fingerprints ignore attempt/version ids but require identical digest and quote evidence',async()=>{
  const node=reviewNode('text'),prior=textAttempt('prior1',{inputId:'work-v1'}),current=textAttempt('current2',{status:'running',inputId:'work-v2'});
  assert.ok(await stagnation.repeatedReviewStagnation(run([prior,current],node),node,current));
  const changed=textAttempt('changed3',{status:'running',inputId:'work-v3',digest:'c'.repeat(64)});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,changed],node),node,changed),undefined);
  const newQuote=textAttempt('quote4',{status:'running',inputId:'work-v4',quote:'repeated sentence.'});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,newQuote],node),node,newQuote),undefined,'a distinct exact quote is new evidence');
});

test('changed content, requirements, or read evidence continue; unusable manifests fail open',async()=>{
  const node=reviewNode(),prior=fileAttempt('prior');
  const changed=fileAttempt('changed',{status:'running',files:[{path:'result.json',beforeHash:null,afterHash:'d'.repeat(64)}]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,changed]),node,changed),undefined);
  const requirements=fileAttempt('requirements',{status:'running',requirements:[requirement('A newly distinct requirement')]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,requirements]),node,requirements),undefined);
  const supplemented=fileAttempt('supplemented',{status:'running'});
  supplemented.reviewInstructionSnapshot=['New user constraint, even before the model declares it as a requirement.'];
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,supplemented]),node,supplemented),undefined,'new user instructions are progress even without model declaration');
  const changedRead=fileAttempt('changed-read',{status:'running',calls:[step('read-new','C:/next/result.json','{"state":"broken","detail":"new evidence"}')]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,changedRead]),node,changedRead),undefined,'a new read result is distinct evidence');
  const newEvidence=fileAttempt('evidence',{status:'running',files:[{path:'result.json',beforeHash:null,afterHash:'a'.repeat(64)},{path:'details.txt',beforeHash:null,afterHash:'e'.repeat(64)}],
    calls:[step('read-main','C:/next/result.json','{"state":"broken"}'),step('read-details','C:/next/details.txt','new details')]});
  const priorSameManifest=fileAttempt('prior-manifest',{files:newEvidence.inputArtifacts[0].files,calls:[step('read-old','C:/old/result.json','{"state":"broken"}') ]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([priorSameManifest,newEvidence]),node,newEvidence),undefined);
  const empty=fileAttempt('empty',{status:'running',files:[]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,empty]),node,empty),undefined);
  const invalid=fileAttempt('invalid',{status:'running',files:[{path:'result.json',beforeHash:null,afterHash:''}]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,invalid]),node,invalid),undefined);
  const opaque=fileAttempt('opaque',{status:'running',calls:[step('inspect','C:/next/result.json','same','inspect_deliverable')]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,opaque]),node,opaque),undefined,'unsupported evidence normalization fails open');
});

test('pass, unverifiable, and unresolved prior attempts never count as repeated failed reviews',async()=>{
  const node=reviewNode(),prior=fileAttempt('prior'),current=fileAttempt('current',{status:'running'});
  const pass=fileAttempt('pass',{status:'running',verdict:'pass',outcome:'pass'});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,pass]),node,pass),undefined);
  const unverifiable=fileAttempt('unknown',{status:'running',verdict:'unverifiable',outcome:'default',evidence:[]});
  assert.equal(await stagnation.repeatedReviewStagnation(run([prior,unverifiable]),node,unverifiable),undefined);
  const uncertain={...prior,status:'uncertain'};
  assert.equal(await stagnation.repeatedReviewStagnation(run([uncertain,current]),node,current),undefined);
});

function fixture(t,execute){
  const tmpRoot=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tmpRoot,'wickrun-stagnation-')),root=path.join(dir,'project'),data=path.join(dir,'data');
  fs.mkdirSync(root);fs.mkdirSync(data);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({state:'seed'}));
  t.after(()=>{assert.equal(path.dirname(dir),tmpRoot);fs.rmSync(dir,{recursive:true,force:true});});
  const store=createCollaborationStore(data),teamFiles=createTeamFiles(data),collaboration={read:()=>store.read()},guard=createTeamExecutionGuard({collaboration,teamFiles}),calls=[];
  const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(revision,project)=>store.update(revision,project),collaborationClaim:async(project,id)=>store.claim(project,id),toolAbort:async()=>{},
    teamFilesCreate:(projectId,runId,memberId,sourceRoot)=>guard.createFileSession({projectId,taskId:runId,memberId,root:sourceRoot}),teamFilesDiff:id=>teamFiles.diff(id),
    teamArtifactsPublish:(scope,id)=>guard.publishArtifact(scope,id),teamArtifactsReceive:(scope,id,ids)=>guard.receiveArtifacts(scope,id,ids),teamArtifactsValidate:(scope,ids)=>guard.validateArtifacts(scope,ids)};
  const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=> 'fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
    './transport':{desktop:()=>bridge},'./agent':{runAgent(args){calls.push(args);queueMicrotask(()=>void Promise.resolve(execute(args,{store,guard,teamFiles,root,calls})).catch(error=>args.events.onError(error.message,{kind:'unknown'})));return {abort(){args.events.onPaused?.('cancelled');}};}}});
  const domain=load(file('src/lib/collaboration.ts')),{TeamRuntime}=load(file('src/lib/team-runtime.ts')),runtime=new TeamRuntime(),cfg=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  const settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'executor-key',name:'Executor',baseUrl:'https://example.invalid'},{id:'reviewer-key',name:'Reviewer',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
  runtime.settings=settings;
  return {root,data,store,guard,teamFiles,calls,domain,runtime,cfg,TeamRuntime,settings};
}

async function setup(f){
  await f.runtime.load();const p=f.domain.emptyTeamProject('p');p.settings.roots=[f.root];p.settings.allowedConnections=['executor-key','reviewer-key'];p.settings.maxConcurrent=1;p.settings.maxTokens=100000;p.settings.maxMinutes=30;
  p.members=[{id:'executor',name:'Executor',instructions:'Write result.json.',connectionId:'executor-key',model:'fixture',effort:'medium',enabled:true,tools:['write_file'],maxTokens:20000,maxMinutes:2},
    {id:'reviewer',name:'Reviewer',instructions:'Read result.json and report the exact check.',connectionId:'reviewer-key',model:'fixture',effort:'medium',enabled:true,tools:['read_file'],maxTokens:20000,maxMinutes:2}];
  const task={id:'task',title:'Review stagnation',goal:'Write result.json with state ready and count 2.',acceptance:'result.json has state ready and count 2.',ownerId:'executor',entries:[],status:'ready',createdAt:1};
  const flow=f.domain.reviewFlowGraph(task,p.members,'Review stagnation');flow.draft.maxTokens=100000;flow.draft.maxMinutes=20;flow.draft.maxSteps=30;
  flow.draft.nodes.find(n=>n.type==='agent').maxVisits=5;flow.draft.nodes.find(n=>n.type==='review').maxVisits=6;
  flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];p.tasks=[task];p.workflows=[flow];await f.runtime.update('p',target=>Object.assign(target,p));
  return f.runtime.createRun('p','task',flow.id,'v',f.cfg);
}

function runtimeResponder(mode){
  let executorVisits=0,reviewVisits=0;
  const execute=async(args,env)=>{
    const ctx=args.toolCtx(),scope=ctx.teamExecution,project=env.store.read().projects.p,run=project.runs.find(r=>r.id===scope.runId),attempt=run.attempts.find(a=>a.id===scope.attemptId),node=run.version.graph.nodes.find(n=>n.id===attempt.nodeId);
    if(node.type==='agent'){
      executorVisits++;const guarded=env.guard.tool('write_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json');
      const body=mode==='changed'?(executorVisits===1?'{"state":"broken","count":1}':executorVisits===2?'{"state":"different","count":1}':'{"state":"ready","count":2}'):'{"state":"broken","count":1}';
      fs.writeFileSync(target,body);args.events.onStep(step('write-'+executorVisits,target,body,'write_file'));args.events.onContentDelta('Wrote visit '+executorVisits);args.events.onDone();return;
    }
    assert.equal(node.type,'review');reviewVisits++;const guarded=env.guard.tool('read_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json'),body=fs.readFileSync(target,'utf8'),callId='read-'+reviewVisits;
    args.events.onStep(step(callId,target,body));const ids=attempt.inputArtifacts.map(item=>item.id),pass=mode==='changed'&&reviewVisits===3;
    args.events.onContentDelta(JSON.stringify({verdict:pass?'pass':'fail',evidence:[callId],changes:pass?'state and count are correct':'state/count remain incorrect',artifactIds:ids}));args.events.onDone();
  };
  return {execute,counts:()=>({executorVisits,reviewVisits})};
}

test('real runtime stops after two identical failed reviews and preserves explicit bounded recovery',async t=>{
  const responder=runtimeResponder('same'),f=fixture(t,responder.execute),runId=await setup(f);await f.runtime.start('p',runId);
  let run=f.runtime.project('p').runs.find(r=>r.id===runId),counts=responder.counts();assert.deepEqual(counts,{executorVisits:2,reviewVisits:2});assert.equal(run.status,'uncertain');
  const work=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='agent'),reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');
  assert.deepEqual(reviews.map(a=>a.status),['completed','uncertain']);assert.deepEqual(reviews.map(a=>a.review.verdict),['fail','fail']);
  assert.notEqual(work[0].artifacts[0].id,work[1].artifacts[0].id);assert.equal(work[0].artifacts[0].files[0].afterHash,work[1].artifacts[0].files[0].afterHash);
  assert.notEqual(reviews[0].review.evidence[0],reviews[1].review.evidence[0]);assert.match(reviews[1].error,/连续 2 次复核|重复指纹/);assert.equal(run.queue.length,0);

  await f.runtime.resolveUncertain('p',runId,'retry','Deliberately run the reviewer once more against the frozen artifact.');await f.runtime.start('p',runId);
  run=f.runtime.project('p').runs.find(r=>r.id===runId);counts=responder.counts();assert.deepEqual(counts,{executorVisits:2,reviewVisits:3});assert.equal(run.status,'uncertain','one explicit retry is allowed, then the exact repeat stops again');
  await f.runtime.resolveUncertain('p',runId,'accept','I reviewed the repeated exact evidence and will decide at delivery.');await f.runtime.start('p',runId);
  run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'waiting_user');await f.runtime.approve('p',runId,true);
  assert.equal(f.runtime.project('p').runs.find(r=>r.id===runId).status,'completed');assert.deepEqual(responder.counts(),{executorVisits:2,reviewVisits:3});
});

test('real runtime continues when delivered file content changes and later passes',async t=>{
  const responder=runtimeResponder('changed'),f=fixture(t,responder.execute),runId=await setup(f);await f.runtime.start('p',runId);
  const run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'waiting_user');assert.deepEqual(responder.counts(),{executorVisits:3,reviewVisits:3});
  const reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');
  assert.deepEqual(reviews.map(a=>a.review.verdict),['fail','fail','pass']);assert.equal(reviews.some(a=>a.status==='uncertain'),false);
});

test('runtime snapshots new user instructions before review even when no requirement is declared',async t=>{
  const responder=runtimeResponder('same');let workerCalls=0;
  const f=fixture(t,async(args,env)=>{
    if(args.profile.id==='executor-key'&&++workerCalls===2)await f.runtime.update('p',p=>{
      p.tasks[0].entries.push({id:'new-instruction',at:Date.now(),author:'你 → 所有成员',kind:'instruction',text:'Check the count separately under the new requirement.'});
    });
    await responder.execute(args,env);
  });
  const runId=await setup(f);await f.runtime.start('p',runId);
  const run=f.runtime.project('p').runs.find(r=>r.id===runId),reviews=run.attempts.filter(a=>a.review);
  assert.deepEqual(responder.counts(),{executorVisits:3,reviewVisits:3});assert.equal(run.status,'uncertain');
  assert.deepEqual(reviews[0].reviewInstructionSnapshot,[]);
  assert.deepEqual(reviews[1].reviewInstructionSnapshot,['Check the count separately under the new requirement.']);
  assert.equal(reviews[1].status,'completed','new instructions prevent the second failure from being treated as stagnant');
  assert.equal(reviews[2].status,'uncertain','the next unchanged check still stops');
});

test('persisted reviewer state survives runtime reload and explicit retry remains bounded',async t=>{
  let executorVisits=0,reviewVisits=0;
  const f=fixture(t,async(args,env)=>{
    const ctx=args.toolCtx(),scope=ctx.teamExecution,project=env.store.read().projects.p,run=project.runs.find(r=>r.id===scope.runId),attempt=run.attempts.find(a=>a.id===scope.attemptId),node=run.version.graph.nodes.find(n=>n.id===attempt.nodeId);
    if(node.type==='agent'){
      executorVisits++;const guarded=env.guard.tool('write_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json'),body='{"state":"broken","count":1}';
      fs.writeFileSync(target,body);args.events.onStep(step('write-state-'+executorVisits,target,body,'write_file'));args.events.onContentDelta('Wrote unchanged broken result');args.events.onDone();return;
    }
    reviewVisits++;const guarded=env.guard.tool('read_file',ctx),target=path.join(guarded.workspaceRoots[0],'result.json'),body=fs.readFileSync(target,'utf8'),callId='persisted-read-'+reviewVisits,read=step(callId,target,body);
    const sourceQuote='result.json has state ready and count 2.';
    const content=JSON.stringify({verdict:'fail',evidence:[callId],changes:'state/count remain incorrect',artifactIds:attempt.inputArtifacts.map(item=>item.id)});
    const spentTokens=(args.resume?.spentTokens??0)+200;
    args.events.onUsage({total_tokens:spentTokens});
    await args.events.onRunState({working:[],content,spentTokens,round:reviewVisits,at:Date.now(),stoppedBy:'completed',steps:[read],contextArchiveSteps:[],
      requirements:[{id:'generated-requirement-'+reviewVisits,revision:reviewVisits,title:'Check exact state and count',
        sourceId:'generated-source-'+reviewVisits,sourceQuote,check:{kind:'review'},at:Date.now(),history:[],
        verification:{revision:reviewVisits,status:'failed',method:'model',detail:'Still broken on review '+reviewVisits,evidence:[callId],at:Date.now()}}]});
    args.events.onContentDelta(content);args.events.onDone();
  });
  const runId=await setup(f);await f.runtime.start('p',runId);
  let run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'uncertain');assert.deepEqual({executorVisits,reviewVisits},{executorVisits:2,reviewVisits:2});
  let reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');
  assert.equal(reviews[1].state.requirements[0].sourceQuote,'result.json has state ready and count 2.');assert.equal(reviews[1].state.steps[0].callId,'persisted-read-2');

  const reloaded=new f.TeamRuntime();reloaded.settings=f.settings;await reloaded.load();
  run=reloaded.project('p').runs.find(r=>r.id===runId);reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');
  assert.equal(run.status,'uncertain');assert.equal(reviews[1].textReview,undefined);assert.equal(reviews[1].review.verdict,'fail');
  assert.equal(reviews[1].state.requirements[0].id,'generated-requirement-2');assert.equal(reviews[1].state.steps[0].output,'{"state":"broken","count":1}');
  const oldState=structuredClone(reviews[1].state);

  await reloaded.resolveUncertain('p',runId,'retry','After restart, deliberately perform one fresh review of the frozen artifact.');await reloaded.start('p',runId);
  run=reloaded.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'uncertain');assert.deepEqual({executorVisits,reviewVisits},{executorVisits:2,reviewVisits:3});
  reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');assert.equal(reviews.length,3);
  assert.equal(reviews[2].review.verdict,'fail');assert.equal(reviews[2].state.requirements[0].id,'generated-requirement-3');
  assert.match(reviews[2].error,/连续 2 次复核|重复指纹/);
  assert.equal(f.calls.at(-1).resume,undefined,'a completed stagnant review retries with fresh model output');
  assert.deepEqual(reviews[1].state,oldState,'previous checkpoint remains intact for audit');
  assert.equal(run.tokens,600,'all three review requests count once, including explicit retry');
  assert.deepEqual(reviews[2].inputArtifacts,reviews[1].inputArtifacts,'retry reviews the same frozen artifact');
});
