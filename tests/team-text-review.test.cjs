'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');

const file=p=>path.resolve(__dirname,'..',p);
const textReview=loader()(file('src/lib/team-text-review.ts'));

const node=(id,type,extra={})=>({id,type,title:id,instructions:'Review the exact supplied text.',inputRefs:[],
  outputRequirement:'The text meets the stated acceptance criteria.',maxVisits:3,join:'all',x:0,y:0,ports:[],...extra});
const completed=(id,nodeId,visit,output,extra={})=>({id,nodeId,visit,status:'completed',startedAt:1,endedAt:2,
  output,steps:[],outcome:'next',...extra});
function pureRun(attempts,nodes,edges=[]){return {id:'run',taskId:'task',workflowId:'flow',version:{id:'v1',number:1,createdAt:1,
  graph:{nodes,edges,maxSteps:20,maxMinutes:10,maxTokens:100000}},members:[],config:{},status:'running',goal:'Review text',
  acceptance:'Text is exact',queue:[],arrivals:{},visits:{},traversals:{},attempts,events:[],tokens:0,createdAt:1,updatedAt:2,
  projectSettings:{roots:[],allowedConnections:[],maxConcurrent:1,maxTokens:100000,maxMinutes:10,approvalMode:'ask'},
  memorySnapshot:[],reservations:{},memoryIds:[]};}
const verdict=(kind,ids,evidence,changes='Covered the supplied text and its stated acceptance criteria.')=>JSON.stringify({
  verdict:kind,artifactIds:ids,textEvidence:evidence,changes,
});

test('text snapshots preserve exact source text, attempt identity, visit, and digest',async()=>{
  const source=node('write','agent'),review=node('review','review',{reviewMode:'text',inputRefs:['write']});
  const original='First line exactly.\nSecond line has punctuation: yes!';
  const run=pureRun([completed('attempt-v1','write',1,original)],[source,review]);
  const inputs=await textReview.textReviewInputs(run,review);
  assert.equal(inputs.length,1);
  assert.deepEqual({...inputs[0],digest:undefined},{id:'text:attempt-v1',attemptId:'attempt-v1',nodeId:'write',version:1,text:original,digest:undefined});
  assert.match(inputs[0].digest,/^[a-f0-9]{64}$/);
  const attempt={...completed('review-attempt','review',1,''),inputTexts:structuredClone(inputs)};
  const result=textReview.verifyTextReview(verdict('pass',[inputs[0].id],[{artifactId:inputs[0].id,quote:'Second line has punctuation: yes!'}]),attempt,inputs);
  assert.equal(result.verdict,'pass');
  assert.deepEqual(result.textEvidence,[{artifactId:'text:attempt-v1',quote:'Second line has punctuation: yes!'}]);
});

test('stale snapshot, stale artifact id, and a newer source visit are rejected',async()=>{
  const source=node('write','agent'),review=node('review','review',{reviewMode:'text',inputRefs:['write']});
  const first=completed('attempt-v1','write',1,'The first durable version is complete.');
  const run=pureRun([first],[source,review]);
  const saved=await textReview.textReviewInputs(run,review);
  const attempt={...completed('review-attempt','review',1,''),inputTexts:structuredClone(saved)};
  run.attempts.push(completed('attempt-v2','write',2,'The second durable version replaces it.'));
  const current=await textReview.textReviewInputs(run,review);
  assert.notEqual(current[0].attemptId,saved[0].attemptId);assert.equal(current[0].version,2);
  assert.throws(()=>textReview.verifyTextReview(verdict('pass',[saved[0].id],[{artifactId:saved[0].id,quote:'The first durable version is complete.'}]),attempt,current),/已变化|依赖版本/);
  const currentAttempt={...attempt,inputTexts:structuredClone(current)};
  assert.throws(()=>textReview.verifyTextReview(verdict('pass',[saved[0].id],[{artifactId:saved[0].id,quote:'The first durable version is complete.'}]),currentAttempt,current),/全部产物编号/);
  const changed=[{...current[0],text:'The backend text changed under the same identity.'}];
  assert.throws(()=>textReview.verifyTextReview(verdict('pass',[current[0].id],[{artifactId:current[0].id,quote:'The second durable version replaces it.'}]),currentAttempt,changed),/已变化|依赖版本/);
});

test('pass and fail require real quotes, and pass must quote every input',async()=>{
  const a=node('a','agent'),b=node('b','handoff'),review=node('review','review',{reviewMode:'text',inputRefs:['a','b']});
  const run=pureRun([completed('a1','a',1,'Alpha source has enough exact characters.'),completed('b1','b',1,'Beta source also has exact evidence.')],[a,b,review]);
  const inputs=await textReview.textReviewInputs(run,review),attempt={...completed('r1','review',1,''),inputTexts:structuredClone(inputs)};
  assert.throws(()=>textReview.verifyTextReview(verdict('fail',inputs.map(x=>x.id),[{artifactId:inputs[0].id,quote:'This quote was invented by the reviewer.'}]),attempt,inputs),/实际原文/);
  assert.throws(()=>textReview.verifyTextReview(verdict('fail',inputs.map(x=>x.id),[]),attempt,inputs),/没有原文引用/);
  assert.throws(()=>textReview.verifyTextReview(verdict('pass',inputs.map(x=>x.id),[{artifactId:inputs[0].id,quote:'Alpha source has enough exact characters.'}]),attempt,inputs),/引用全部/);
  const ok=textReview.verifyTextReview(verdict('pass',inputs.map(x=>x.id),[
    {artifactId:inputs[0].id,quote:'Alpha source has enough exact characters.'},
    {artifactId:inputs[1].id,quote:'Beta source also has exact evidence.'},
  ]),attempt,inputs);
  assert.equal(ok.verdict,'pass');
});

test('unverifiable may omit quotes but must retain all current artifact ids',async()=>{
  const source=node('write','agent'),review=node('review','review',{reviewMode:'text',inputRefs:['write']});
  const run=pureRun([completed('a1','write',1,'A claim that needs an external source to verify.')],[source,review]);
  const inputs=await textReview.textReviewInputs(run,review),attempt={...completed('r1','review',1,''),inputTexts:structuredClone(inputs)};
  const result=textReview.verifyTextReview(verdict('unverifiable',inputs.map(x=>x.id),[],'External truth cannot be established from this snapshot.'),attempt,inputs);
  assert.equal(result.verdict,'unverifiable');assert.deepEqual(result.textEvidence,[]);
  assert.throws(()=>textReview.verifyTextReview(verdict('unverifiable',[],[]),attempt,inputs),/全部产物编号/);
});

test('missing, empty, oversized, and file-changing inputs are refused without truncation',async()=>{
  const source=node('write','agent'),review=node('review','review',{reviewMode:'text',inputRefs:['write']});
  await assert.rejects(textReview.textReviewInputs(pureRun([],[source,review]),review),/缺少已完成/);
  await assert.rejects(textReview.textReviewInputs(pureRun([completed('empty','write',1,'   ')],[source,review]),review),/缺少已完成/);
  await assert.rejects(textReview.textReviewInputs(pureRun([completed('large','write',1,'x'.repeat(textReview.TEXT_REVIEW_LIMIT+1))],[source,review]),review),/超过 20000/);
  const changed=completed('files','write',1,'Text accompanied by a changed file.',{artifacts:[{id:'artifact',files:[{path:'result.txt',beforeHash:null,afterHash:'a'.repeat(64)}]}]});
  await assert.rejects(textReview.textReviewInputs(pureRun([changed],[source,review]),review),/不能替代文件变更检查/);
});

function runtimeFixture(t,execute){
  const tmpRoot=fs.realpathSync.native(os.tmpdir()),dir=fs.mkdtempSync(path.join(tmpRoot,'wickrun-text-review-')),data=path.join(dir,'data');fs.mkdirSync(data);
  t.after(()=>{assert.equal(path.dirname(dir),tmpRoot);fs.rmSync(dir,{recursive:true,force:true});});
  const store=createCollaborationStore(data),calls=[];
  const unavailable=async()=>{throw Error('text review must not use file sessions or artifacts');};
  const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(revision,project)=>store.update(revision,project),
    collaborationClaim:async(project,id)=>store.claim(project,id),toolAbort:async()=>{},teamFilesCreate:unavailable,
    teamArtifactsPublish:unavailable,teamArtifactsReceive:unavailable,teamArtifactsValidate:unavailable};
  const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=> 'fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
    './transport':{desktop:()=>bridge},'./agent':{runAgent(args){calls.push(args);queueMicrotask(()=>void Promise.resolve(execute(args,{store,calls})).catch(error=>args.events.onError(error.message,{kind:'unknown'})));return {abort(){args.events.onPaused?.('cancelled');}};}}});
  const domain=load(file('src/lib/collaboration.ts')),{TeamRuntime}=load(file('src/lib/team-runtime.ts')),runtime=new TeamRuntime(),cfg=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  runtime.settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'executor-key',name:'Executor',baseUrl:'https://example.invalid'},
    {id:'reviewer-key',name:'Reviewer',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
  return {dir,data,store,calls,domain,runtime,cfg};
}

async function setupTextReview(f){
  await f.runtime.load();const p=f.domain.emptyTeamProject('p');p.settings.roots=[];p.settings.allowedConnections=['executor-key','reviewer-key'];
  p.settings.maxConcurrent=1;p.settings.maxTokens=100000;p.settings.maxMinutes=30;
  p.members=[{id:'executor',name:'Executor',instructions:'Write the requested text.',connectionId:'executor-key',model:'fixture',effort:'medium',enabled:true,tools:[],maxTokens:20000,maxMinutes:2},
    {id:'reviewer',name:'Reviewer',instructions:'Review only the supplied text snapshot.',connectionId:'reviewer-key',model:'fixture',effort:'medium',enabled:true,tools:['read_file'],maxTokens:20000,maxMinutes:2}];
  const task={id:'task',title:'Text review loop',goal:'Write one sentence whose status is ready and count is two.',
    acceptance:'The sentence says status ready and count two.',ownerId:'executor',entries:[],status:'ready',createdAt:1};
  const flow=f.domain.reviewFlowGraph(task,p.members,'Text review','text');flow.draft.maxTokens=100000;flow.draft.maxMinutes=20;flow.draft.maxSteps=20;
  flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];p.tasks=[task];p.workflows=[flow];
  await f.runtime.update('p',target=>Object.assign(target,p));const runId=await f.runtime.createRun('p','task',flow.id,'v',f.cfg);return {runId,flow};
}

test('runtime completes text fail, rework, pass, and user approval with frozen snapshots and no tools',async t=>{
  let executorVisits=0,reviewVisits=0,f;const reviewInputIds=[],reviewTexts=[];
  f=runtimeFixture(t,async(args,env)=>{
    const scope=args.toolCtx().teamExecution,project=env.store.read().projects.p,run=project.runs.find(r=>r.id===scope.runId);
    const attempt=run.attempts.find(a=>a.id===scope.attemptId),node=run.version.graph.nodes.find(n=>n.id===attempt.nodeId),prompt=args.history[0].content;
    assert.deepEqual(args.toolCtx().workspaceRoots,[]);assert.equal(args.toolCtx().teamExecution.fileSessionId,undefined);
    if(node.type==='agent'){
      executorVisits++;
      if(executorVisits===2)assert.match(prompt,/Change count from one to two/,'rework receives the prior review defect');
      args.events.onContentDelta(executorVisits===1?'The status is draft and the count is one.':'The status is ready and the count is two.');
      args.events.onDone();return;
    }
    assert.equal(node.type,'review');reviewVisits++;
    assert.equal(args.config.toolsEnabled,false);assert.deepEqual(args.config.enabledTools,[]);
    assert.match(prompt,/文本产物快照/);assert.equal(attempt.inputTexts.length,1);assert.ok(prompt.includes(JSON.stringify(attempt.inputTexts)));
    const durableText=attempt.inputTexts[0].text;reviewInputIds.push(attempt.inputTexts[0].id);reviewTexts.push(durableText);
    attempt.inputTexts[0].text='mutated detached read';
    const reread=env.store.read().projects.p.runs.find(r=>r.id===scope.runId).attempts.find(a=>a.id===scope.attemptId);
    assert.equal(reread.inputTexts[0].text,durableText,'model-side data cannot mutate the durable backend snapshot');
    const quote=reviewVisits===1?'The status is draft and the count is one.':'The status is ready and the count is two.';
    args.events.onContentDelta(verdict(reviewVisits===1?'fail':'pass',[reviewInputIds.at(-1)],[{artifactId:reviewInputIds.at(-1),quote}],
      reviewVisits===1?'Change count from one to two.':'The current text exactly states ready and two.'));
    args.events.onDone();
  });
  const {runId}=await setupTextReview(f);await f.runtime.start('p',runId);
  let run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'waiting_user');
  assert.equal(executorVisits,2);assert.equal(reviewVisits,2);assert.notEqual(reviewInputIds[0],reviewInputIds[1]);
  const work=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='agent');
  const reviews=run.attempts.filter(a=>run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type==='review');
  assert.deepEqual(reviews.map(a=>a.textReview.verdict),['fail','pass']);
  assert.deepEqual(reviews.map(a=>a.inputTexts[0].attemptId),work.map(a=>a.id));
  assert.equal(reviews[0].inputTexts[0].text,reviewTexts[0]);assert.equal(reviews[1].inputTexts[0].text,reviewTexts[1]);
  assert.notEqual(reviews[0].inputTexts[0].digest,reviews[1].inputTexts[0].digest);
  assert.equal(f.runtime.project('p').files.length,0,'text-only review needs no file session');
  await f.runtime.approve('p',runId,true);run=f.runtime.project('p').runs.find(r=>r.id===runId);assert.equal(run.status,'completed');
  assert.equal(f.runtime.project('p').tasks.find(task=>task.id==='task').status,'已完成');
});
