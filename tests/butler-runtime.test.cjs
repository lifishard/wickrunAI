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
  let settings={butler:{proactive:{...domain.DEFAULT_BUTLER_PREFERENCES,consent:{version:domain.BUTLER_CONSENT_VERSION,at:now},enabled:true,hostDeviceId:'device-one',allowRoutineExecution:false,timezone:'UTC',...options.prefs}}},skills=[];
  const conversations=[{id:'conv-1',title:'Useful agent skills',updatedAt:now,messages:[{id:'m1',role:'user',content:'Help me find AI skills useful for my daily work',createdAt:now}]}];
  const model=options.model??(async(_settings,_prefs,prompt)=>{calls.push(JSON.parse(prompt));const evidence=calls.at(-1).signals?.[0]?.id;
    return {text:JSON.stringify({goals:[{title:'Find practical AI skills',hypothesis:'May want a daily shortlist',evidenceIds:[evidence],confidence:'high'}],skills:[]}),tokens:800,sources:[],steps:[],route:'Fixture · brain'};});
  const {ButlerRuntime}=load(path.join(base,'butler-runtime.ts'));
  const services={storage:()=>noopStorage,account:async()=>account,host:()=>options.host!==false,now:()=>now,model,
    collector:options.collector??(async()=>({sources:{}}))};
  const runtime=new ButlerRuntime(services);
  const config={settings:()=>settings,conversations:()=>conversations,skills:()=>skills,onSettings:s=>{settings=s;},onSkills:s=>{skills=s;},...options.work};
  runtime.configure(config);
  return {runtime,createRuntime:()=>{const next=new ButlerRuntime(services);next.configure(config);return next;},db,calls,domain,settings:()=>settings,setPrefs:patch=>{settings={...settings,butler:{...settings.butler,proactive:{...settings.butler.proactive,...patch}}};runtime.configure(config);},setRoutine:enabled=>{settings={...settings,butler:{...settings.butler,proactive:{...settings.butler.proactive,allowRoutineExecution:enabled}}};runtime.configure(config);},setAccount:id=>{account=id;},advance:ms=>{now+=ms;},load,conversations};
}
async function settle(runtime){for(let i=0;i<80;i++){await new Promise(r=>setImmediate(r));if(!runtime.getSnapshot().busy)return;}throw Error('runtime did not settle');}

test('upgraded enabled preferences stop collection and work until explicit data-scope consent',async()=>{
  const actions=[],started=[];
  const f=setup({prefs:{consent:undefined,allowRoutineExecution:true,sources:{wickrun:true,android:true}},
    collector:async(action,input)=>{actions.push({action,input});return {sources:{android:{available:true,consented:true}}};},
    work:{startWork:async()=>{started.push(true);return 'unexpected';}}});
  await f.runtime.tick();await settle(f.runtime);
  assert.equal(f.settings().butler.proactive.paused,true);
  assert.equal(f.settings().butler.proactive.allowRoutineExecution,false);
  assert.equal(f.calls.length,0);assert.equal(started.length,0);assert.equal(f.runtime.getSnapshot().brain.signals.length,0);
  assert.ok(!actions.some(x=>x.action==='poll'||x.action==='suspend'&&x.input.suspended===false));
  for(const action of [{kind:'resume'},{kind:'add-need',text:'Plan my week'},{kind:'analyze-now'},{kind:'set-device-consent',source:'android',consented:true}])
    await assert.rejects(f.runtime.action(action),/数据范围/);
  await f.runtime.action({kind:'consent',granted:true});await settle(f.runtime);
  const prefs=f.settings().butler.proactive;
  assert.equal(prefs.consent.version,f.domain.BUTLER_CONSENT_VERSION);assert.equal(prefs.paused,false);assert.equal(prefs.allowRoutineExecution,false);
  assert.ok(actions.some(x=>x.action==='suspend'&&x.input.suspended===false&&x.input.sources.android===false));
});

test('synced account consent cannot revive an old local Android source grant',async()=>{
  const controls=[];const f=setup({host:false,prefs:{sources:{android:true}},collector:async(action,input)=>{
    if(action==='suspend')controls.push(input);return {sources:{android:{available:true,consented:true}}};
  }});
  const old=JSON.parse(f.db.get('wickrun:butler:device:v1'));old.consent.android=true;f.db.set('wickrun:butler:device:v1',JSON.stringify(old));
  await f.runtime.tick();
  assert.equal(controls.at(-1).sources.android,false);assert.equal(f.runtime.getSnapshot().sources.android.consented,false);
  assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).consent.android,undefined);
  await f.runtime.action({kind:'set-device-consent',source:'android',consented:true});await f.runtime.tick();
  assert.equal(controls.at(-1).sources.android,true);assert.equal(controls.at(-1).dataScopeVersion,f.domain.BUTLER_CONSENT_VERSION);
});

test('current local source grants survive reload, but withdrawal clears them and blocks resume',async()=>{
  const controls=[];const f=setup({host:false,prefs:{sources:{android:true}},collector:async(action,input)=>{
    if(action==='suspend')controls.push(input);return {sources:{android:{available:true,consented:true}}};
  }});
  const local=JSON.parse(f.db.get('wickrun:butler:device:v1'));local.consent.android=true;local.consentVersion=f.domain.BUTLER_CONSENT_VERSION;
  f.db.set('wickrun:butler:device:v1',JSON.stringify(local));
  await f.runtime.tick();assert.equal(controls.at(-1).sources.android,true);
  await f.runtime.action({kind:'consent',granted:false});
  assert.equal(controls.at(-1).suspended,true);assert.deepEqual(JSON.parse(f.db.get('wickrun:butler:device:v1')).consent,{});
  assert.equal(f.settings().butler.proactive.enabled,false);assert.equal(f.settings().butler.proactive.consent,undefined);
  await assert.rejects(f.runtime.action({kind:'resume'}),/数据范围/);
  await f.runtime.action({kind:'consent',granted:true});await f.runtime.tick();assert.equal(controls.at(-1).sources.android,false);
});

test('withdrawal aborts in-flight inference and a late result cannot add a goal',async()=>{
  let entered,resolveModel,signal;const ready=new Promise(r=>{entered=r;});
  const f=setup({model:async(_s,_p,_prompt,_research,_budget,s)=>{signal=s;entered();return new Promise(r=>{resolveModel=r;});}});
  await f.runtime.tick();await ready;
  await f.runtime.action({kind:'consent',granted:false});assert.equal(signal.aborted,true);
  resolveModel({text:'{"goals":[{"title":"late","hypothesis":"late","evidenceIds":[]}],"skills":[]}',tokens:1,sources:[],steps:[]});
  await settle(f.runtime);assert.equal(f.runtime.getSnapshot().brain.goals.length,0);assert.equal(f.runtime.getSnapshot().brain.jobs[0].status,'failed');
});

test('remote consent removal immediately suspends a configured collector',async()=>{
  const controls=[];const f=setup({host:false,collector:async(action,input)=>{if(action==='suspend')controls.push(input);return {sources:{}};}});
  await f.runtime.tick();assert.equal(controls.at(-1).suspended,false);
  f.setPrefs({consent:undefined});await new Promise(r=>setImmediate(r));assert.equal(controls.at(-1).suspended,true);
  await f.runtime.reload();assert.equal(controls.at(-1).suspended,true);
});

test('source withdrawal closes the runtime gate before a pending native revoke finishes',async()=>{
  const controls=[];let entered,release;const ready=new Promise(r=>{entered=r;});
  const f=setup({host:false,prefs:{sources:{android:true}},collector:async(action,input)=>{
    if(action==='suspend')controls.push(input);
    if(action==='consent'&&!input.consented){entered();await new Promise(r=>{release=r;});}
    return {sources:{android:{available:true,consented:true}}};
  }});
  await f.runtime.action({kind:'set-device-consent',source:'android',consented:true});await f.runtime.tick();
  assert.equal(controls.at(-1).sources.android,true);
  const revoked=f.runtime.action({kind:'set-device-consent',source:'android',consented:false});await ready;
  const before=controls.length;await f.runtime.tick();
  assert.ok(controls.slice(before).length>0);
  assert.ok(controls.slice(before).every(input=>input.suspended||input.sources.android===false));
  release();await revoked;await f.runtime.tick();
  assert.equal(controls.at(-1).sources.android,false);
  assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).consent.android,false);
});

test('a pending device grant cannot overwrite a newer withdrawal',async()=>{
  let entered,release;const ready=new Promise(r=>{entered=r;});
  const f=setup({host:false,prefs:{sources:{android:true}},collector:async(action,input)=>{
    if(action==='consent'&&input.consented){entered();await new Promise(r=>{release=r;});}
    return {sources:{android:{available:true,consented:true}}};
  }});
  const granted=f.runtime.action({kind:'set-device-consent',source:'android',consented:true});await ready;
  await f.runtime.action({kind:'set-device-consent',source:'android',consented:false});
  release();await granted;await f.runtime.tick();
  assert.equal(JSON.parse(f.db.get('wickrun:butler:device:v1')).consent.android,false);
  assert.equal(f.runtime.getSnapshot().sources.android.consented,false);
});

test('a poll from an older source grant is discarded even when the source is granted again',async()=>{
  let entered,release;const ready=new Promise(r=>{entered=r;});
  const f=setup({host:false,prefs:{sources:{android:true}},collector:async(action)=>{
    if(action==='poll'){entered();return new Promise(r=>{release=r;});}
    return {sources:{android:{available:true,consented:true}}};
  }});
  const local=JSON.parse(f.db.get('wickrun:butler:device:v1'));local.consent.android=true;local.consentVersion=f.domain.BUTLER_CONSENT_VERSION;
  f.db.set('wickrun:butler:device:v1',JSON.stringify(local));
  const tick=f.runtime.tick();await ready;
  await f.runtime.action({kind:'set-device-consent',source:'android',consented:false});
  await f.runtime.action({kind:'set-device-consent',source:'android',consented:true});
  release({sources:{},signals:[{id:'late',source:'android',sourceLabel:'Reader',topic:'Old activity',intent:'Browse',summary:'An older source snapshot',observedAt:123,basis:'behavior',confidence:'medium'}]});
  await tick;
  assert.equal(f.runtime.getSnapshot().brain.signals.some(signal=>signal.id==='late'),false);
});

test('a replacement runtime can enable the same Android adapter after earlier source changes',async()=>{
  let enabled=false;const scopes=[];
  const status=()=>({enabled,active:enabled,serviceGranted:true,notificationGranted:true,allowedPackages:['example.reader'],deniedPackages:[]});
  const plugin={getStatus:async()=>status(),listApps:async()=>({apps:[]}),poll:async()=>({items:[]}),
    setDataScopeConsent:async input=>{if(!input.version||!input.android)enabled=false;return status();},
    setEnabled:async input=>{enabled=input.enabled;return status();},revokeSource:async()=>{enabled=false;return status();}};
  const mobile=loader({'@capacitor/core':{Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>plugin}})(path.join(base,'butler-mobile.ts'));
  const f=setup({host:false,prefs:{sources:{android:true}},collector:(action,input)=>{
    if(action==='suspend'&&!input.suspended)scopes.push(input.sourceEpoch);
    return mobile.androidButlerCollector(action,input);
  }});
  for(const consented of [true,false,true,false]){await f.runtime.action({kind:'set-device-consent',source:'android',consented});await f.runtime.tick();}
  const oldEpoch=scopes.at(-1);await f.runtime.flush();
  const next=f.createRuntime();await next.action({kind:'set-device-consent',source:'android',consented:true});await next.tick();
  assert.equal(enabled,true);assert.ok(scopes.at(-1)>oldEpoch);
  await next.flush();
});

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
