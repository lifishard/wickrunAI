const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const base=path.join(__dirname,'..','src','lib');
let serial=0;
const uid=p=>`${p||'id'}-${++serial}`;
const hash=s=>require('node:crypto').createHash('sha256').update(s).digest('hex').slice(0,16);
function setup(options={}) {
  const db=new Map(),calls=[];let now=Date.UTC(2026,8,30,7),account=options.account??'account-one';
  db.set('wickrun:butler:device:v1',JSON.stringify({deviceId:'device-one',consent:{},day:'',spent:0,analyzed:'',done:[],contextSeen:[]}));
  const noopStorage={kvGet:async k=>db.get(k)||null,kvSet:async(k,v)=>{await options.beforeWrite?.(k,v);db.set(k,v);}};
  const load=loader({'./store':{uid},'./skills':{bodyHash:hash,slugify:s=>s},'./transport':{desktop:()=>null,getTransport:()=>noopStorage},
    './cloud-api':{cloudCall:async()=>({user:null}),cloudBridge:()=>null},'./butler-model':{runButlerModel:async()=>{throw Error('unexpected default model');}}});
  const domain=load(path.join(base,'proactive-butler.ts'));
  let settings={butler:{proactive:{...domain.DEFAULT_BUTLER_PREFERENCES,enabled:true,consent:{version:1,at:1},hostDeviceId:'device-one',allowRoutineExecution:false,timezone:'UTC',...options.prefs}}},skills=[];
  const conversations=[{id:'conv-1',title:'Useful agent skills',updatedAt:now,messages:[{id:'m1',role:'user',content:'Help me find AI skills useful for my daily work',createdAt:now}]}];
  const model=options.model??(async(_settings,_prefs,prompt)=>{calls.push(JSON.parse(prompt));const evidence=calls.at(-1).signals?.[0]?.id;
    return {text:JSON.stringify({goals:[{title:'Find practical AI skills',hypothesis:'May want a daily shortlist',evidenceIds:[evidence],confidence:'high'}],skills:[]}),tokens:800,sources:[],steps:[],route:'Fixture · brain'};});
  const {ButlerRuntime}=load(path.join(base,'butler-runtime.ts'));
  const runtime=new ButlerRuntime({storage:()=>noopStorage,account:async()=>account,host:()=>options.host!==false,now:()=>now,model,
    collector:options.collector??(async()=>({sources:{}}))});
  const config={settings:()=>settings,conversations:()=>conversations,skills:()=>skills,onSettings:s=>{settings=s;},onSkills:s=>{skills=s;},...options.work};
  runtime.configure(config);
  return {runtime,db,calls,domain,settings:()=>settings,patchPrefs:patch=>{settings={...settings,butler:{...settings.butler,proactive:{...settings.butler.proactive,...patch}}};runtime.configure(config);},configureWork:work=>runtime.configure({...config,...work}),setRoutine:enabled=>{settings={...settings,butler:{...settings.butler,proactive:{...settings.butler.proactive,allowRoutineExecution:enabled}}};runtime.configure(config);},setAccount:id=>{account=id;},advance:ms=>{now+=ms;},load,conversations};
}
async function settle(runtime){for(let i=0;i<80;i++){await new Promise(r=>setImmediate(r));if(!runtime.getSnapshot().busy)return;}throw Error('runtime did not settle');}

test('disabled Butler never dispatches a model or harvests internal conversations',async()=>{
  const f=setup({prefs:{enabled:false}});await f.runtime.tick();
  assert.equal(f.calls.length,0);assert.equal(f.runtime.getSnapshot().brain.signals.length,0);
});
test('selected host derives reviewable evidence-backed goals; a phone only queues',async()=>{
  const host=setup();await host.runtime.tick();await settle(host.runtime);
  const brain=host.runtime.getSnapshot().brain;
  assert.equal(brain.goals.length,1);assert.equal(brain.goals[0].status,'proposed');
  assert.equal(brain.jobs[0].status,'completed');assert.equal(host.calls.length,1);
  assert.ok(brain.audit.some(a=>a.model==='Fixture · brain'));
  const phone=setup({host:false,prefs:{hostDeviceId:'another-computer'}});
  await phone.runtime.action({kind:'analyze-now'});await phone.runtime.tick();
  assert.equal(phone.calls.length,0);assert.equal(phone.runtime.getSnapshot().brain.jobs[0].status,'queued');
});
test('pause aborts a pending model immediately and prevents a late result from changing goals',async()=>{
  let started;const ready=new Promise(r=>{started=r;});let resolveModel,observedSignal;
  const f=setup({model:async(_s,_p,_prompt,_research,_budget,signal)=>{observedSignal=signal;started();return await new Promise(r=>{resolveModel=r;});}});
  await f.runtime.tick();await ready;
  await f.runtime.action({kind:'pause'});assert.equal(observedSignal.aborted,true);
  resolveModel({text:'{"goals":[{"title":"late","hypothesis":"late","evidenceIds":[]}],"skills":[]}',tokens:1,sources:[],steps:[]});await settle(f.runtime);
  assert.equal(f.runtime.getSnapshot().brain.goals.length,0);assert.equal(f.runtime.getSnapshot().brain.jobs[0].status,'failed');assert.equal(f.settings().butler.proactive.paused,true);
});
test('negative feedback cancels queued research, survives storage, and conditions later inference',async()=>{
  const f=setup();await f.runtime.tick();await settle(f.runtime);
  const goal=f.runtime.getSnapshot().brain.goals[0];
  await f.runtime.action({kind:'run-research',goalId:goal.id});
  await f.runtime.action({kind:'feedback',targetKind:'goal',targetId:goal.id,rating:'not-my-need',comment:'I need coding tutorials instead'});
  assert.equal(f.runtime.getSnapshot().brain.goals[0].status,'dismissed');
  assert.equal(f.runtime.getSnapshot().brain.feedback[0].comment,'I need coding tutorials instead');
  assert.ok(f.runtime.getSnapshot().brain.jobs.filter(j=>j.goalId===goal.id).every(j=>j.status!=='queued'));
  const saved=JSON.parse(f.db.get('wickrun:butler:brain:v1'));assert.equal(saved.feedback.length,1);
  f.advance(360000);await f.runtime.tick();await settle(f.runtime);
  assert.ok(f.calls.some(c=>c.userFeedback?.[0]?.rating==='not-my-need'));
});
test('budget is reserved before dispatch and is not restored by a crash or unknown failure',async()=>{
  let calls=0;
  const f=setup({prefs:{maxTokensPerDay:2000},model:async()=>{calls++;throw Error('connection lost');}});
  await f.runtime.tick();await settle(f.runtime);f.advance(360000);await f.runtime.tick();await settle(f.runtime);
  assert.equal(calls,1);assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).spent,2000);
});
test('account-mismatched shared brain is never adopted',async()=>{
  const f=setup({account:'account-two',prefs:{enabled:false}});
  f.db.set('wickrun:butler:brain:v1',JSON.stringify({...f.domain.emptyButlerBrain('account-one'),signals:[{id:'private',summary:'other user'}]}));
  await f.runtime.load();assert.equal(f.runtime.getSnapshot().brain.accountId,'account-two');assert.deepEqual(f.runtime.getSnapshot().brain.signals,[]);
});
test('daily schedule catches up once per configured local day and honors pause',()=>{
  const f=setup(),{dueButlerBrief}=f.load(path.join(base,'butler-policy.ts'));
  const prefs={...f.domain.DEFAULT_BUTLER_PREFERENCES,enabled:true,timezone:'America/Vancouver',cadence:'daily'};
  const now=Date.UTC(2026,8,30,16);
  assert.deepEqual(dueButlerBrief(prefs,now,[]),{key:'2026-09-30:morning',period:'morning'});
  assert.equal(dueButlerBrief(prefs,now,['2026-09-30:morning']),null);
  assert.equal(dueButlerBrief({...prefs,paused:true},now,[]),null);
});
test('private Butler content never enters diagnostic exchanges',()=>{
  const {beginExchange,exchangeOf,recordRaw}=loader()(path.join(base,'wiretap.ts'));
  beginExchange({requestId:'private-butler',url:'https://model.test',body:{messages:'private page content'},stream:true,privateInput:true});
  recordRaw('private response','private-butler');assert.equal(exchangeOf('private-butler'),null);
});

test('pause during reservation save prevents dispatch before the model starts',async()=>{
  let release,entered;const reserved=new Promise(r=>{entered=r;});
  const f=setup({beforeWrite:async(k,v)=>{if(k.endsWith('device:v1')&&JSON.parse(v).spent>0&&!release){entered();await new Promise(r=>{release=r;});}}});
  const ticking=f.runtime.tick();await reserved;
  const pausing=f.runtime.action({kind:'pause'});await new Promise(r=>setImmediate(r));release();
  await Promise.all([ticking,pausing]);await settle(f.runtime);
  assert.equal(f.calls.length,0);assert.equal(f.settings().butler.proactive.paused,true);
});

test('account reload discards the previous brain and writes only the new account',async()=>{
  const f=setup({prefs:{enabled:false}});await f.runtime.load();
  f.setAccount('account-two');const next=f.domain.emptyButlerBrain('account-two');
  f.db.set('wickrun:butler:brain:v1',JSON.stringify(next));await f.runtime.reload();
  assert.equal(f.runtime.getSnapshot().brain.accountId,'account-two');
  assert.equal(JSON.parse(f.db.get('wickrun:butler:brain:v1')).accountId,'account-two');
});

test('imported links are persisted before collector acknowledgement without a draining second poll',async()=>{
  const trace=[];const f=setup({host:false,prefs:{sources:{share:true},externalUnderstanding:'local-topics'},collector:async(action)=>{
    trace.push(action);if(action==='ack')assert.ok(JSON.parse(f.db.get('wickrun:butler:brain:v1')).signals.some(s=>s.id==='shared:topic'));
    return {sources:{share:{available:true,consented:true}},...(action==='import-link'?{recordIds:['shared'],signals:[{id:'shared:topic',source:'share',topic:'Useful skills',intent:'Explore',summary:'Looking for skills',observedAt:1,confidence:'low',basis:'behavior'}]}:{})};
  }});
  await f.runtime.load();await f.runtime.action({kind:'set-device-consent',source:'share',consented:true});
  await f.runtime.action({kind:'import-link',url:'https://example.org/skills'});
  assert.ok(f.runtime.getSnapshot().brain.signals.some(s=>s.id==='shared:topic'));assert.ok(trace.includes('ack'));
});

test('a phone cannot select itself as executor or mutate the selected computer',async()=>{
  const f=setup({host:false,prefs:{hostDeviceId:'desktop-other'}});await f.runtime.load();
  await assert.rejects(f.runtime.action({kind:'select-host',deviceId:'device-one'}),/常开电脑/);
  assert.equal(f.settings().butler.proactive.hostDeviceId,'desktop-other');assert.equal(f.runtime.getSnapshot().canHost,false);
});

test('reviewed work dispatches once, reports actual completion and receives phone control without restarting context',async()=>{
 const started=[],controls=[];let status='running';
 const f=setup({work:{startWork:async(job,prompt)=>{started.push({job,prompt});return 'work-conversation';},controlWork:async(id,command)=>{controls.push({id,command});},workState:()=>({status,summary:status==='completed'?'Created report.xlsx':'Working on the file'})}});
 await f.runtime.tick();await settle(f.runtime);const goal=f.runtime.getSnapshot().brain.goals[0];
 await assert.rejects(f.runtime.action({kind:'run-work',goalId:goal.id}),/确认/);
 await f.runtime.action({kind:'review-goal',goalId:goal.id,decision:'confirm'});await f.runtime.action({kind:'run-work',goalId:goal.id});f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.equal(started.length,1);const job=f.runtime.getSnapshot().brain.jobs.find(j=>j.kind==='work');assert.equal(job.status,'running');assert.equal(job.conversationId,'work-conversation');
 await f.runtime.action({kind:'work-command',jobId:job.id,command:'message',text:'Include a sources tab'});await f.runtime.tick();
 assert.equal(controls.filter(c=>c.command.kind==='message').length,1);await f.runtime.tick();assert.equal(controls.filter(c=>c.command.kind==='message').length,1);
 status='completed';await f.runtime.tick();assert.equal(f.runtime.getSnapshot().brain.jobs.find(j=>j.id===job.id).status,'completed');
 assert.ok(f.runtime.getSnapshot().brain.briefs.some(b=>b.items.some(i=>i.result?.id==='work-conversation')));
});

test('autonomous routine work starts for a proposed goal and respects its daily cap',async()=>{
 const started=[];let status='running';const f=setup({prefs:{allowRoutineExecution:true,allowResearch:false,maxWorkPerDay:1},work:{startWork:async(job,prompt)=>{started.push({job,prompt});return 'auto-work';},workState:()=>({status,summary:'Generated notes.md'})}});
 await f.runtime.tick();await settle(f.runtime);assert.equal(f.runtime.getSnapshot().brain.goals[0].status,'proposed');
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);assert.equal(started.length,1);assert.equal(started[0].job.automatic,true);assert.match(started[0].prompt,/候选需求/);
 status='completed';await f.runtime.tick();
 const brain=f.runtime.getSnapshot().brain;brain.goals.push({...brain.goals[0],id:'second-goal',title:'Another useful artifact'});f.db.set('wickrun:butler:brain:v1',JSON.stringify(brain));await f.runtime.reload();f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.equal(started.length,1);assert.equal(f.runtime.getSnapshot().brain.jobs.filter(j=>j.kind==='work').length,1);
});

test('disabling routine execution stops automatic Work without pausing manual Work',{timeout:5000},async()=>{
 const controls=[];const f=setup({prefs:{allowRoutineExecution:true,allowResearch:false},work:{startWork:async()=> 'auto-work',controlWork:async(id,command)=>controls.push({id,command}),workState:()=>({status:'running'})}});
 await f.runtime.tick();await settle(f.runtime);f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.ok(f.runtime.getSnapshot().brain.jobs.some(job=>job.kind==='work'&&job.automatic));
 f.setRoutine(false);await new Promise(r=>setImmediate(r));
 assert.deepEqual(controls.map(c=>c.command.kind),['pause']);
 const manual=setup({work:{startWork:async()=> 'manual-work',controlWork:async(id,command)=>controls.push({id,command}),workState:()=>({status:'running'})}});
 await manual.runtime.tick();await settle(manual.runtime);const goal=manual.runtime.getSnapshot().brain.goals[0];
 await manual.runtime.action({kind:'review-goal',goalId:goal.id,decision:'confirm'});
 await manual.runtime.action({kind:'run-work',goalId:goal.id});manual.advance(40000);await manual.runtime.tick();await settle(manual.runtime);
 assert.ok(manual.runtime.getSnapshot().brain.jobs.some(job=>job.kind==='work'&&!job.automatic&&job.status==='running'));
 const before=controls.length;manual.setRoutine(false);await new Promise(r=>setImmediate(r));assert.equal(controls.length,before);
});

test('disabling routine execution during Work creation cancels the just-created run',{timeout:5000},async()=>{
 let resolveStart,entered;const started=new Promise(r=>{entered=r;}),controls=[];
 const f=setup({prefs:{allowRoutineExecution:true,allowResearch:false},work:{startWork:async()=>{entered();return await new Promise(r=>{resolveStart=r;});},controlWork:async(id,command)=>controls.push({id,command})}});
 await f.runtime.tick();await settle(f.runtime);f.advance(40000);await f.runtime.tick();await started;
 f.setRoutine(false);resolveStart('late-work');await settle(f.runtime);
 assert.deepEqual(controls.map(c=>[c.id,c.command.kind]),[['late-work','pause']]);
 assert.equal(f.runtime.getSnapshot().brain.jobs.find(job=>job.kind==='work').status,'failed');
 assert.equal(f.runtime.getSnapshot().brain.jobs.find(job=>job.kind==='work').conversationId,'late-work');
});

test('pausing Butler during manual Work creation stops the just-created run',{timeout:5000},async()=>{
 let resolveStart,entered;const started=new Promise(r=>{entered=r;}),controls=[];
 const f=setup({work:{startWork:async()=>{entered();return await new Promise(r=>{resolveStart=r;});},controlWork:async(id,command)=>controls.push({id,command})}});
 await f.runtime.tick();await settle(f.runtime);const goal=f.runtime.getSnapshot().brain.goals[0];
 await f.runtime.action({kind:'review-goal',goalId:goal.id,decision:'confirm'});
 await f.runtime.action({kind:'run-work',goalId:goal.id});f.advance(40000);await f.runtime.tick();await started;
 await f.runtime.action({kind:'pause'});resolveStart('late-manual-work');await settle(f.runtime);
 assert.deepEqual(controls.map(c=>[c.id,c.command.kind]),[['late-manual-work','pause']]);
 assert.equal(f.runtime.getSnapshot().brain.jobs.find(job=>job.kind==='work').status,'failed');
 assert.equal(f.runtime.getSnapshot().brain.jobs.find(job=>job.kind==='work').conversationId,'late-manual-work');
});

test('failed analysis resumes its local checkpoint without synchronizing the session to the brain',async()=>{
 let calls=0,resumed;const f=setup({model:async(_s,_p,prompt,_r,_b,_signal,_notice,session)=>{
  calls++;const request=JSON.parse(prompt);
  if(calls===1){await session.onCheckpoint({version:2,runId:'preserved-session',working:[{id:'input',role:'user',content:prompt,createdAt:1}],spentTokens:600,reasoning:'private reasoning',status:'paused'});throw Error('temporary connection failure');}
  resumed=session.initial;await session.onCheckpoint(null);return {text:JSON.stringify({goals:[{title:'Resumed need',hypothesis:'Preserved context',evidenceIds:[request.signals[0].id],confidence:'medium'}],skills:[]}),tokens:200,sources:[],steps:[]};
 }});
 await f.runtime.tick();await settle(f.runtime);const job=f.runtime.getSnapshot().brain.jobs[0];
 const saved=JSON.parse(f.db.get('wickrun:butler:checkpoints:v1'));assert.equal(saved.sessions[job.id].state.reasoning,'');assert.equal(f.db.get('wickrun:butler:brain:v1').includes('preserved-session'),false);
 await f.runtime.action({kind:'retry-job',jobId:job.id});await settle(f.runtime);assert.equal(resumed.runId,'preserved-session');assert.equal(resumed.spentTokens,600);assert.deepEqual(JSON.parse(f.db.get('wickrun:butler:checkpoints:v1')).sessions,{});
});

test('device privacy rules filter application conversations before inference',async()=>{
 const f=setup({collector:async()=>({sources:{},privacy:{excludedTerms:['daily work'],encryptedOnlyTerms:[],categories:{contact:'redact',financial:'redact',health:'exclude'},encryptedStorage:true}})});
 await f.runtime.tick();await settle(f.runtime);assert.equal(f.calls.length,0);assert.equal(f.runtime.getSnapshot().brain.signals.length,0);
});

test('a collector grant from another account cannot enable capture before local account consent',async()=>{
 const controls=[];const f=setup({prefs:{sources:{browser:true}},collector:async(action,input)=>{if(action==='suspend')controls.push(input);return {sources:{browser:{available:true,consented:true}}};}});
 await f.runtime.tick();await settle(f.runtime);
 assert.equal(controls.at(-1).suspended,false);assert.equal(controls.at(-1).sources.browser,false);
 await f.runtime.action({kind:'set-device-consent',source:'browser',consented:true});await f.runtime.tick();await settle(f.runtime);
 assert.equal(controls.at(-1).sources.browser,true);
});

test('semantic extraction sees the request at the end and saves a bounded summary without looping',async()=>{
 let calls=0,excerpt;
 const f=setup({model:async(_s,_p,prompt)=>{calls++;const p=JSON.parse(prompt);excerpt=p.excerpts[0].text;
   return {text:JSON.stringify({summaries:[{evidenceId:p.signals[0].id,topic:'Budget report',intent:'Compare monthly spending',summary:'Prepare a monthly report under a fixed budget.'}],goals:[],skills:[]}),tokens:200,sources:[],steps:[]};}});
 f.conversations[0].messages[0].content='Background '.repeat(400)+' My actual need is a budget report.';
 await f.runtime.tick();await settle(f.runtime);assert.match(excerpt,/actual need is a budget report/);assert.ok(excerpt.length<1700);
 const signal=f.runtime.getSnapshot().brain.signals[0];assert.equal(signal.summary,'Prepare a monthly report under a fixed budget.');
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);assert.equal(calls,1);assert.equal(f.runtime.getSnapshot().brain.signals[0].summary,signal.summary);
 assert.equal(JSON.parse(f.db.get('wickrun:butler:brain:v1')).signals[0].summary,signal.summary);
});

test('new evidence refines a pending need in place while user correction remains authoritative',async()=>{
 let calls=0,target;
 const f=setup({model:async(_s,_p,prompt)=>{calls++;const p=JSON.parse(prompt);
   return {text:JSON.stringify({goals:[{...(target?{goalId:target}:{}),title:calls===1?'Report':'Refined report',hypothesis:'Compare monthly expenses; currency still unknown.',evidenceIds:[p.signals[0].id],confidence:'medium'}],skills:[]}),tokens:200,sources:[],steps:[]};}});
 await f.runtime.tick();await settle(f.runtime);target=f.runtime.getSnapshot().brain.goals[0].id;
 f.conversations[0].messages.push({id:'m2',role:'user',content:'Include the last three months',createdAt:Date.now()});f.advance(40000);
 await f.runtime.tick();await settle(f.runtime);let goals=f.runtime.getSnapshot().brain.goals;assert.equal(goals.length,1);assert.equal(goals[0].id,target);assert.equal(goals[0].title,'Refined report');
 await f.runtime.action({kind:'review-goal',goalId:target,decision:'correct',correction:'Only this month, in Canadian dollars'});
 await f.runtime.action({kind:'analyze-now'});await settle(f.runtime);goals=f.runtime.getSnapshot().brain.goals;
 assert.equal(goals.length,1);assert.equal(goals[0].status,'corrected');assert.equal(goals[0].userCorrection,'Only this month, in Canadian dollars');
});

test('invented evidence cannot replace a summary and edited messages are extracted again',async()=>{
 let calls=0;
 const f=setup({model:async()=>{calls++;return {text:JSON.stringify({summaries:[{evidenceId:'invented',topic:'Fake',intent:'Fake',summary:'Fake'}],goals:[],skills:[]}),tokens:200,sources:[],steps:[]};}});
 await f.runtime.tick();await settle(f.runtime);const original=f.runtime.getSnapshot().brain.signals[0].id;
 f.conversations[0].messages[0].content='My corrected request is a reusable weekly plan';f.advance(40000);
 await f.runtime.tick();await settle(f.runtime);assert.equal(calls,2);const signals=f.runtime.getSnapshot().brain.signals;
 assert.equal(signals.length,1);assert.equal(signals[0].id,original);assert.match(signals[0].summary,/corrected request/);
});

test('nothing is collected or sent until the data-scope notice is accepted',async()=>{
 const f=setup({prefs:{consent:undefined}});await f.runtime.tick();await settle(f.runtime);
 assert.equal(f.calls.length,0);assert.equal(f.runtime.getSnapshot().brain.signals.length,0);
 await assert.rejects(f.runtime.action({kind:'add-need',text:'Plan my week'}),/数据范围/);
 await f.runtime.action({kind:'consent',granted:true});await settle(f.runtime);
 assert.equal(f.settings().butler.proactive.consent.version,1);assert.equal(f.runtime.getSnapshot().brain.signals.length,0);
 await f.runtime.action({kind:'resume'});await settle(f.runtime);assert.ok(f.runtime.getSnapshot().brain.signals.length>0);
 await f.runtime.action({kind:'consent',granted:false});
 assert.equal(f.settings().butler.proactive.consent,undefined);assert.equal(f.settings().butler.proactive.enabled,false);
});

test('without routine execution the Butler suggests in a quiet inbox and runs only what is accepted',async()=>{
 const f=setup();await f.runtime.tick();await settle(f.runtime);
 const goal=f.runtime.getSnapshot().brain.goals[0];assert.equal(goal.status,'proposed');
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 let proposal=f.runtime.getSnapshot().brain.jobs.find(j=>j.proposal);
 assert.equal(proposal.status,'proposed');assert.equal(proposal.kind,'research');assert.equal(proposal.goalId,goal.id);
 const before=f.calls.length;f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.equal(f.calls.length,before);assert.equal(f.runtime.getSnapshot().brain.jobs.filter(j=>j.proposal).length,1);
 await f.runtime.action({kind:'answer-proposal',jobId:proposal.id,decision:'accept'});await settle(f.runtime);
 assert.equal(f.runtime.getSnapshot().brain.goals[0].status,'confirmed');
 proposal=f.runtime.getSnapshot().brain.jobs.find(j=>j.id===proposal.id);assert.equal(proposal.status,'completed');assert.equal(proposal.automatic,false);
 assert.equal(f.calls.length,before+1);
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.equal(f.runtime.getSnapshot().brain.jobs.filter(j=>j.proposal).length,1,'a researched goal is not suggested again without Work');
});

test('a declined suggestion is not repeated and open suggestions are capped',async()=>{
 let n=0;const f=setup({model:async(_s,_p,prompt)=>{const p=JSON.parse(prompt);const id=p.signals?.[0]?.id;
  return {text:JSON.stringify({goals:id?[1,2,3,4,5].map(i=>({title:`Need ${++n}-${i}`,hypothesis:'Recurring need',evidenceIds:[id],confidence:'medium'})):[],skills:[]}),tokens:100,sources:[],steps:[]};}});
 await f.runtime.tick();await settle(f.runtime);
 for(let i=0;i<6;i++){f.advance(40000);await f.runtime.tick();await settle(f.runtime);}
 const open=f.runtime.getSnapshot().brain.jobs.filter(j=>j.status==='proposed');assert.equal(open.length,3);
 await f.runtime.action({kind:'answer-proposal',jobId:open[0].id,decision:'decline'});
 for(let i=0;i<3;i++){f.advance(40000);await f.runtime.tick();await settle(f.runtime);}
 const jobs=f.runtime.getSnapshot().brain.jobs.filter(j=>j.proposal);
 assert.equal(jobs.filter(j=>j.goalId===open[0].goalId).length,1);assert.equal(jobs.length,3,'the daily cap holds after a decline');
});

test('forgotten needs and goals are removed everywhere and not learned again from the same messages',async()=>{
 const f=setup();await f.runtime.tick();await settle(f.runtime);
 const brain=f.runtime.getSnapshot().brain,signal=brain.signals.find(s=>!s.id.includes('habit'));
 await f.runtime.action({kind:'feedback',targetKind:'goal',targetId:brain.goals[0].id,rating:'useful',comment:'keep going'});
 await f.runtime.action({kind:'forget-goal',goalId:brain.goals[0].id});
 let next=f.runtime.getSnapshot().brain;
 assert.equal(next.goals.length,0);assert.ok(!next.signals.some(s=>s.id===signal.id));assert.equal(next.feedback.length,0);
 assert.ok(next.forgotten.some(x=>x.id===signal.id));
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);next=f.runtime.getSnapshot().brain;
 assert.ok(!next.signals.some(s=>s.id===signal.id),'the same message is not ingested again');
 f.conversations[0].messages.push({id:'m-new',role:'user',content:'Now help me plan a garden',createdAt:Date.UTC(2026,8,30,7)+50000});
 f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 assert.ok(f.runtime.getSnapshot().brain.signals.some(s=>/garden/.test(s.summary)),'new activity is still learned');
 await f.runtime.action({kind:'forget-all'});next=f.runtime.getSnapshot().brain;
 assert.deepEqual([next.signals.length,next.goals.length,next.briefs.length,next.audit.length>0],[0,0,0,true]);
 const synced=f.domain.projectButlerBrainForSync({...next,signals:[{...signal,observedAt:1}]});
 assert.equal(synced.signals.length,0,'a stale copy from another device cannot bring a forgotten signal back');
});

test('the model writes the brief and greeting; references it cannot back are dropped',async()=>{
 const prompts=[];const f=setup({model:async(_s,_p,prompt)=>{const p=JSON.parse(prompt);prompts.push(p);
  if(String(p.task).includes('简报')){const goalId=p.goals[0].goalId;
   return {text:JSON.stringify({greeting:'早上好。今天先把 AI 技能清单定下来。',items:[{kind:'suggestion',title:'挑三个技能',summary:'从已确认的需求出发，先试三个。',ref:goalId},{kind:'finding',title:'编造的进展',summary:'没有依据。',ref:'goal-unknown'}]}),tokens:300,sources:[],steps:[]};}
  return {text:JSON.stringify({goals:[{title:'Find practical AI skills',hypothesis:'May want a daily shortlist',evidenceIds:[p.signals[0].id],confidence:'high'}],skills:[]}),tokens:300,sources:[],steps:[]};}});
 await f.runtime.tick();await settle(f.runtime);
 await f.runtime.action({kind:'generate-brief',period:'morning'});await settle(f.runtime);
 const brief=f.runtime.getSnapshot().brain.briefs.at(-1);
 assert.equal(brief.greeting,'早上好。今天先把 AI 技能清单定下来。');assert.deepEqual(brief.items.map(i=>i.title),['挑三个技能']);
 assert.ok(brief.items[0].evidenceIds.length>0);assert.ok(prompts.at(-1).goals.length===1&&prompts.at(-1).now.weekday);
 const failing=setup({model:async(_s,_p,prompt)=>{if(String(JSON.parse(prompt).task).includes('简报'))throw Error('rate limited');
  const p=JSON.parse(prompt);return {text:JSON.stringify({goals:[{title:'Find practical AI skills',hypothesis:'May want a daily shortlist',evidenceIds:[p.signals[0].id],confidence:'high'}],skills:[]}),tokens:300,sources:[],steps:[]};}});
 await failing.runtime.tick();await settle(failing.runtime);await failing.runtime.action({kind:'generate-brief',period:'evening'});await settle(failing.runtime);
 const fallback=failing.runtime.getSnapshot().brain;assert.equal(fallback.briefs.at(-1).greeting,undefined);assert.equal(fallback.briefs.at(-1).items.length,1);
 assert.ok(fallback.audit.some(a=>a.title==='简报改用模板'));
});

test('an upgraded account stays paused after consent until explicit resume, with automatic execution off',async()=>{
 const f=setup({prefs:{consent:undefined,allowRoutineExecution:true}});await f.runtime.tick();
 assert.equal(f.settings().butler.proactive.paused,true,'older app versions on the account stop too');
 await f.runtime.action({kind:'consent',granted:true});
 assert.deepEqual([f.settings().butler.proactive.paused,f.settings().butler.proactive.allowRoutineExecution],[true,false]);
 await f.runtime.action({kind:'resume'});assert.equal(f.settings().butler.proactive.paused,false);
});

test('an accepted Work suggestion runs sandboxed even with routine execution off',async()=>{
 const started=[];const f=setup({prefs:{allowResearch:false},work:{startWork:async(job,prompt)=>{started.push({job,prompt});return 'sandbox-work';},workState:()=>({status:'running'})}});
 await f.runtime.tick();await settle(f.runtime);f.advance(40000);await f.runtime.tick();await settle(f.runtime);
 const proposal=f.runtime.getSnapshot().brain.jobs.find(j=>j.proposal);assert.equal(proposal.kind,'work');assert.equal(started.length,0);
 await f.runtime.action({kind:'answer-proposal',jobId:proposal.id,decision:'accept'});await settle(f.runtime);
 assert.equal(started.length,1);assert.equal(started[0].job.proposal,true);assert.equal(started[0].job.automatic,false);
 assert.match(started[0].prompt,/建议收件箱/);assert.match(started[0].prompt,/仅获准在当前隔离工作目录内读写文件/);
 const {butlerWorkConfig}=f.load(path.join(base,'butler-work.ts'));
 const settings={defaultConfig:{enabledTools:['run_command','web_search'],approvalMode:'ask'},routeGroups:[{id:'g',routes:[{profileId:'p',model:'m'}]}]};
 const cfg=butlerWorkConfig(settings,{allowRoutineExecution:false,backend:{kind:'route-group',routeGroupId:'g',effort:'medium'}},{accepted:true});
 assert.ok(!cfg.config.enabledTools.includes('run_command'));assert.ok(!cfg.config.enabledTools.includes('web_search'));
});

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function seedWork(f,commands=[]){
 const brain=f.runtime.getSnapshot().brain;
 brain.goals=[{id:'stop-goal',accountId:brain.accountId,title:'Fixture task',hypothesis:'User requested a task',evidenceIds:[],confidence:'high',status:'confirmed',updatedAt:1}];
 brain.jobs=[{id:'stop-job',accountId:brain.accountId,kind:'work',goalId:'stop-goal',conversationId:'stop-conversation',status:'running',createdAt:1,updatedAt:1,commands}];
}

test('pause closes dispatch synchronously, remains pending through collector suspension, and never certifies exit',async()=>{
 const entered=deferred(),release=deferred();let hold=false;
 const f=setup({collector:async action=>{if(action==='suspend'&&hold){entered.resolve();await release.promise;}return {sources:{}};}});
 await f.runtime.load();const before=f.runtime.captureDispatchGuard();assert.equal(before(),true);hold=true;
 const pending=f.runtime.action({kind:'pause'});
 assert.equal(f.settings().butler.proactive.paused,true);assert.equal(before(),false);
 await entered.promise;assert.equal(f.runtime.getSnapshot().stopRequest.status,'pending');
 await assert.rejects(f.runtime.action({kind:'resume'}),/仍在处理中/);
 hold=false;release.resolve();await pending;
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'requested');
 assert.ok(f.runtime.getSnapshot().brain.audit.some(row=>row.title==='暂停请求已记录'&&row.status==='planned'));
 assert.equal(f.calls.length,0);
 await f.runtime.action({kind:'resume'});assert.equal(before(),false,'old preparation cannot revive after resume');
 assert.equal(f.runtime.captureDispatchGuard()(),true);await settle(f.runtime);
});

test('paused host keeps a heartbeat without collecting or dispatching a model',async()=>{
 const actions=[];const f=setup({prefs:{paused:true},collector:async action=>{actions.push(action);return {sources:{}};}});
 await f.runtime.tick();const first=f.runtime.getSnapshot().brain.hosts[0].lastSeenAt;
 f.advance(61000);await f.runtime.tick();
 assert.ok(f.runtime.getSnapshot().brain.hosts[0].lastSeenAt>first);assert.equal(f.calls.length,0);
 assert.equal(f.runtime.getSnapshot().brain.signals.length,0);assert.ok(actions.every(action=>['status','suspend'].includes(action)));
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'requested');
});

test('remote consent and local consent never lift a stored explicit or upgrade pause',async()=>{
 const f=setup({prefs:{consent:undefined}});await f.runtime.tick();await f.runtime.action({kind:'pause'});
 f.patchPrefs({consent:{version:1,at:2}});await f.runtime.tick();
 assert.equal(f.settings().butler.proactive.paused,true);assert.equal(f.calls.length,0);
 await f.runtime.action({kind:'consent',granted:true});await f.runtime.tick();
 assert.equal(f.settings().butler.proactive.paused,true);assert.equal(f.calls.length,0);
});

test('a source withdrawal blocks old preparations before the collector acknowledges it',async()=>{
 const entered=deferred(),release=deferred();
 const f=setup({collector:async action=>{if(action==='consent'){entered.resolve();await release.promise;}return {sources:{}};}});
 await f.runtime.load();const before=f.runtime.captureDispatchGuard();
 const pending=f.runtime.action({kind:'set-device-consent',source:'browser',consented:false});
 assert.equal(before(),false);await entered.promise;assert.equal(f.runtime.captureDispatchGuard()(),false);
 release.resolve();await pending;assert.equal(before(),false);await settle(f.runtime);
});

test('failed Work request is collected without reopening the pause gate or claiming completion',async()=>{
 const f=setup({work:{controlWork:async()=>{throw Error('fixture delivery failure');}}});await f.runtime.load();seedWork(f);
 await f.runtime.action({kind:'pause'});
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'failed');assert.equal(f.runtime.getSnapshot().stopRequest.failedCount,1);
 assert.match(f.runtime.getSnapshot().error,/fixture delivery failure/);assert.equal(f.runtime.captureDispatchGuard()(),false);
 assert.equal(f.runtime.getSnapshot().brain.jobs[0].status,'running');
 assert.equal(f.runtime.getSnapshot().brain.audit.find(row=>row.title==='暂停请求已记录').status,'failed');
});

test('a paused remote host remains unconfirmed without invoking local Work controls',async()=>{
 let stops=0;const f=setup({host:false,prefs:{hostDeviceId:'remote'},work:{controlWork:async()=>stops++}});await f.runtime.load();seedWork(f);
 await f.runtime.action({kind:'pause'});assert.equal(stops,0);assert.equal(f.runtime.getSnapshot().stopRequest.status,'requested');
 assert.equal(f.runtime.getSnapshot().brain.jobs[0].status,'running');
});

test('pause then resume while a command is pending cannot let its old command loop dispatch another resume',async()=>{
 const entered=deferred(),release=deferred(),commands=[];
 const f=setup({work:{controlWork:async(_id,command)=>{commands.push(command.kind);if(command.kind==='message'){entered.resolve();await release.promise;}},workState:()=>({status:'running'})}});
 await f.runtime.load();seedWork(f,[{id:'message-one',kind:'message',text:'detail',createdAt:1},{id:'old-resume',kind:'resume',createdAt:2}]);
 const syncing=f.runtime.syncWorkJobs();await entered.promise;
 await f.runtime.action({kind:'pause'});await f.runtime.action({kind:'resume'});release.resolve();await syncing;
 assert.equal(commands.includes('resume'),false);await settle(f.runtime);
});

test('queued stop delivery keeps its original controller and does not cross an account boundary',async()=>{
 let oldCalls=0,newCalls=0;const f=setup({work:{controlWork:async()=>oldCalls++}});await f.runtime.load();seedWork(f);
 const pending=f.runtime.stopWork();f.configureWork({controlWork:async()=>newCalls++});await pending;
 assert.equal(oldCalls,1);assert.equal(newCalls,0);
 const foreign=f.runtime.stopWork();f.runtime.emit({brain:f.domain.emptyButlerBrain('other-account'),stopRequest:undefined});await foreign;
 assert.equal(newCalls,0);assert.equal(f.runtime.getSnapshot().stopRequest,undefined);
});

test('a collector poll from before pause and resume cannot start a fresh extraction request',async()=>{
 const entered=deferred(),release=deferred();let models=0;
 const f=setup({prefs:{sources:{browser:true},externalUnderstanding:'redacted-context'},collector:async action=>{
   if(action==='poll'){entered.resolve();await release.promise;return {sources:{},recordIds:['old-context'],contexts:[{id:'old-context',source:'browser',sourceLabel:'Browser',text:'research agent skills',observedAt:Date.UTC(2026,8,30,7)}]};}return {sources:{}};
 },model:async()=>{models++;return {text:'{"signals":[]}',tokens:1,sources:[],steps:[]};}});
 const local=JSON.parse(f.db.get('wickrun:butler:device:v1'));local.consent.browser=true;f.db.set('wickrun:butler:device:v1',JSON.stringify(local));
 const oldTick=f.runtime.tick();await entered.promise;await f.runtime.action({kind:'pause'});await f.runtime.action({kind:'resume'});release.resolve();await oldTick;
 assert.equal(models,0);assert.equal(f.runtime.getSnapshot().brain.signals.some(row=>row.id==='old-context'),false);
});

test('pause during collector configuration prevents its old continuation from polling after resume',async()=>{
 const entered=deferred(),release=deferred();let polls=0,held=false;
 const f=setup({collector:async(action,input)=>{if(action==='suspend'&&input?.suspended===false&&!held){held=true;entered.resolve();await release.promise;}if(action==='poll')polls++;return {sources:{}};}});
 const oldTick=f.runtime.tick();await entered.promise;await f.runtime.action({kind:'pause'});await f.runtime.action({kind:'resume'});release.resolve();await oldTick;
 assert.equal(polls,0);
});

test('a non-host still contributes its authorized local source without executing queued host work',async()=>{
 let polls=0;const f=setup({host:false,prefs:{hostDeviceId:'remote',sources:{browser:true}},collector:async action=>{
   if(action==='poll'){polls++;return {sources:{},signals:[{id:'browser-topic',source:'browser',sourceLabel:'Browser',topic:'Agent tools',intent:'research',summary:'Research agent tools',observedAt:1,basis:'behavior',confidence:'low'}]};}return {sources:{}};
 }});
 const local=JSON.parse(f.db.get('wickrun:butler:device:v1'));local.consent.browser=true;f.db.set('wickrun:butler:device:v1',JSON.stringify(local));
 await f.runtime.tick();assert.equal(polls,1);assert.equal(f.calls.length,0);assert.ok(f.runtime.getSnapshot().brain.signals.some(row=>row.id==='browser-topic'));
});

test('failed source withdrawal immediately removes its local grant and stays fail-closed across reload',async()=>{
 let models=0;const f=setup({prefs:{sources:{browser:true},externalUnderstanding:'redacted-context'},collector:async action=>{
   if(action==='consent')throw Error('collector could not persist withdrawal');
   if(action==='poll')return {sources:{},contexts:[{id:'must-not-send',source:'browser',sourceLabel:'Browser',text:'private activity',observedAt:1}]};return {sources:{}};
 },model:async()=>{models++;return {text:'{"signals":[]}',tokens:1,sources:[],steps:[]};}});
 const local=JSON.parse(f.db.get('wickrun:butler:device:v1'));local.consent.browser=true;f.db.set('wickrun:butler:device:v1',JSON.stringify(local));await f.runtime.load();
 await assert.rejects(f.runtime.action({kind:'set-device-consent',source:'browser',consented:false}),/could not persist/);
 assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).consent.browser,false);
 assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).controlFailed,true);
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'failed');assert.equal(f.runtime.captureDispatchGuard()(),false);
 f.patchPrefs({paused:false});await f.runtime.reload();await f.runtime.tick();assert.equal(models,0);assert.equal(f.runtime.captureDispatchGuard()(),false);
});

test('pause persistence failure stays visible and does not reopen local dispatch',async()=>{
 let fail=false;const f=setup({beforeWrite:async()=>{if(fail)throw Error('fixture storage failure');}});await f.runtime.load();fail=true;
 await assert.rejects(f.runtime.action({kind:'pause'}),/fixture storage failure/);
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'failed');assert.match(f.runtime.getSnapshot().error,/storage failure/);
 assert.equal(f.settings().butler.proactive.paused,true);assert.equal(f.runtime.captureDispatchGuard()(),false);
 fail=false;await f.runtime.tick();assert.equal(f.calls.length,0);
});

test('collector suspension failure remains failed and local dispatch stays closed',async()=>{
 let fail=false;const f=setup({collector:async action=>{if(fail&&action==='suspend')throw Error('fixture collector failure');return {sources:{}};}});await f.runtime.load();fail=true;
 await assert.rejects(f.runtime.action({kind:'pause'}),/fixture collector failure/);
 assert.equal(f.runtime.getSnapshot().stopRequest.status,'failed');assert.equal(f.runtime.captureDispatchGuard()(),false);
 fail=false;await f.runtime.tick();assert.equal(f.calls.length,0);
});
