const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const {emptyCloudData,projectCloudData,mergeCloudData,mergeButlerSlices,butlerBrainFromRows,butlerCloudSlice,firstButlerBase,withButlerCloudSlice}=loader()(path.join(root,'cloud-data.ts'));

function local(accountId='account-1'){
  return {settings:{defaultConfig:{},keyProfiles:[],butler:{proactive:{enabled:true,paused:false,hostDeviceId:'device-1',backend:{kind:'route-group',routeGroupId:'r',effort:'medium'},externalUnderstanding:'redacted-context',deviceConsent:{browser:true}}}},
    conversations:[],projects:[],skills:[],tasks:[],observations:[],butler:{schema:1,accountId,signals:[],goals:[],briefs:[],skillProposals:[],jobs:[],hosts:[],feedback:[],audit:[],actionGrants:[{id:'private-grant',accountId}],updatedAt:1}};
}

test('Butler rows are scoped, whitelisted, and split by entity id',()=>{
  const input=local();
  input.butler.signals=[{id:'signal-1',accountId:'account-1',source:'wickrun',sourceLabel:'Chat',sourceRef:'private-ref',topic:'Plan',intent:'finish',summary:'Finish plan',observedAt:1,confidence:'high',basis:'user-stated',modelSafe:true}];
  input.butler.goals=[{id:'goal-1',accountId:'account-1',title:'Plan',hypothesis:'Finish the plan',evidenceIds:['signal-1'],confidence:'high',status:'confirmed',updatedAt:2}];
  input.butler.jobs=[{id:'job-1',accountId:'account-1',kind:'research',status:'queued',createdAt:2,updatedAt:2}];
  input.butler.hosts=[{id:'device-1',accountId:'account-1',name:'Desk',lastSeenAt:3}];
  input.butler.feedback=[{id:'feedback-1',accountId:'account-1',targetKind:'goal',targetId:'goal-1',rating:'useful',createdAt:4},{id:'feedback-2',accountId:'account-1',targetKind:'goal',targetId:'deleted-goal',rating:'useful',createdAt:4}];
  input.butler.audit=[{id:'audit-1',accountId:'account-1',at:5,kind:'model',title:'Analyzed',detail:'Used model',status:'completed'}];
  const data=projectCloudData(input);
  assert.deepEqual(data.butler.map(row=>row.id),['signal:signal-1','goal:goal-1','job:job-1','host:device-1','feedback:feedback-1','audit:audit-1']);
  assert.equal(data.butler[0].sourceRef,undefined);
  assert.equal(JSON.stringify(data).includes('private-grant'),false);
  assert.equal(JSON.stringify(data).includes('deviceConsent'),false);
  assert.equal(data.preferences['butler.paused'],false);
  assert.equal(data.preferences['butler.externalUnderstanding'],'redacted-context');
  const restored=butlerBrainFromRows(data.butler,'account-1',input.butler);
  assert.equal(restored.jobs[0].status,'queued');
  assert.equal(restored.jobs[0].kind,'research');
  assert.equal(restored.audit[0].kind,'model');
  assert.equal(restored.actionGrants[0].id,'private-grant');
  assert.equal(butlerBrainFromRows(data.butler,'other-account').signals.length,0);
});

test('concurrent pause beats resume; explicit off beats re-enable',()=>{
  const base={...emptyCloudData(),preferences:{'butler.paused':undefined,'butler.enabled':undefined}};
  const local={...base,preferences:{'butler.paused':true,'butler.enabled':false}};
  const remote={...base,preferences:{'butler.paused':false,'butler.enabled':true}};
  const merged=mergeButlerSlices(base,local,remote);
  assert.equal(merged.preferences['butler.paused'],true);
  assert.equal(merged.preferences['butler.enabled'],false);
  assert.equal(mergeButlerSlices(base,remote,local).preferences['butler.paused'],true);
});

test('first sync accepts existing account pause instead of local defaults',()=>{
  const local={...emptyCloudData(),preferences:{'butler.paused':false,'butler.enabled':false}};
  const remote={...emptyCloudData(),preferences:{'butler.paused':true,'butler.enabled':true}};
  const merged=mergeButlerSlices(firstButlerBase(local,remote),local,butlerCloudSlice(remote));
  assert.equal(merged.preferences['butler.paused'],true);
  assert.equal(merged.preferences['butler.enabled'],true);
});

test('independent Butler entities merge while a narrow pause write preserves other collections',()=>{
  const base=emptyCloudData();
  const first={...base,butler:[{id:'job:a',entityId:'a',kind:'job',accountId:'account-1',status:'queued'}]};
  const second={...base,butler:[{id:'host:b',entityId:'b',kind:'host',accountId:'account-1',lastSeenAt:1}]};
  assert.equal(mergeCloudData(base,first,second).butler.length,2);
  const remote={...base,conversations:[{id:'chat',title:'Keep me'}],profiles:[{id:'key',name:'API'}]};
  const pause={...butlerCloudSlice(base),preferences:{'butler.paused':true}};
  const merged=withButlerCloudSlice(remote,pause);
  assert.deepEqual(merged.conversations,remote.conversations);
  assert.deepEqual(merged.profiles,remote.profiles);
  assert.equal(merged.preferences['butler.paused'],true);
});

test('a remote pause command survives concurrent host status and summary changes',()=>{
  const base={...emptyCloudData(),butler:[{id:'job:work-1',entityId:'work-1',kind:'job',accountId:'account-1',status:'running',summary:'Starting',updatedAt:1,commands:[]}]};
  const host={...base,butler:[{...base.butler[0],status:'waiting',summary:'Needs review',updatedAt:3}]};
  const phone={...base,butler:[{...base.butler[0],commands:[{id:'pause-1',kind:'pause',createdAt:2}],updatedAt:2}]};
  for(const [local,remote] of [[host,phone],[phone,host]]){
    const merged=mergeButlerSlices(base,local,remote).butler[0];
    assert.equal(merged.status,'waiting');assert.equal(merged.summary,'Needs review');
    assert.deepEqual(merged.commands,[{id:'pause-1',kind:'pause',createdAt:2}]);
  }
});

test('concurrent commands on one Work job merge by stable id without duplicating earlier commands',()=>{
  const old={id:'old',kind:'message',text:'Earlier',createdAt:1};
  const base={...emptyCloudData(),butler:[{id:'job:work-1',entityId:'work-1',kind:'job',accountId:'account-1',status:'running',commands:[old]}]};
  const host={...base,butler:[{...base.butler[0],commands:[old,{id:'host',kind:'message',text:'Host note',createdAt:2}]}]};
  const phone={...base,butler:[{...base.butler[0],commands:[old,{id:'phone',kind:'pause',createdAt:3}]}]};
  assert.deepEqual(mergeButlerSlices(base,host,phone).butler[0].commands.map(command=>command.id),['old','host','phone']);
});

test('route groups and the autonomous task cap sync without credentials or local rules',()=>{
 const input=local();input.settings.routeGroups=[{id:'group-one',name:'My routes',routes:[{profileId:'profile-one',model:'model-one',secret:'never-sync'}],createdAt:1,note:'private note',secret:'never-sync'}];input.settings.butler.proactive.maxWorkPerDay=2;
 const data=projectCloudData(input);assert.equal(data.preferences['butler.maxWorkPerDay'],2);assert.deepEqual(data.preferences.routeGroups,[{id:'group-one',name:'My routes',routes:[{profileId:'profile-one',model:'model-one'}],createdAt:1}]);assert.equal(JSON.stringify(data).includes('never-sync'),false);
});

test('forgets, greetings and suggestions travel as rows; a withdrawn consent travels as null',()=>{
  const {butlerPreferencesFromCloud}=loader()(path.join(root,'cloud-data.ts'));
  const input=local();
  input.settings.butler.proactive.consent={version:1,at:10};
  input.butler.signals=[{id:'signal-1',accountId:'account-1',source:'wickrun',sourceLabel:'Chat',topic:'Plan',intent:'finish',summary:'Finish plan',observedAt:20,confidence:'high',basis:'user-stated',modelSafe:true}];
  input.butler.briefs=[{id:'brief-1',accountId:'account-1',period:'morning',createdAt:30,greeting:'早上好。',items:[{id:'i',kind:'suggestion',title:'Plan',summary:'Do it',evidenceIds:['signal-1']}]}];
  input.butler.goals=[{id:'g',accountId:'account-1',title:'Plan',hypothesis:'Finish the plan',evidenceIds:['signal-1'],confidence:'high',status:'proposed',updatedAt:21}];
  input.butler.jobs=[{id:'job-1',accountId:'account-1',kind:'research',status:'proposed',proposal:true,goalId:'g',summary:'Look it up',createdAt:22,updatedAt:22}];
  input.butler.forgotten=[{id:'old-signal',accountId:'account-1',at:15}];
  const data=projectCloudData(input);
  assert.deepEqual(data.butler.map(row=>row.id),['signal:signal-1','goal:g','brief:brief-1','job:job-1','forget:old-signal']);
  assert.deepEqual(data.preferences['butler.consent'],{version:1,at:10});
  const back=butlerBrainFromRows(data.butler,'account-1');
  assert.equal(back.briefs[0].greeting,'早上好。');assert.equal(back.jobs[0].proposal,true);assert.deepEqual(back.forgotten,[{accountId:'account-1',at:15,id:'old-signal'}]);
  delete input.settings.butler.proactive.consent;
  const withdrawn=projectCloudData(input);assert.equal(withdrawn.preferences['butler.consent'],null);
  const other=butlerPreferencesFromCloud(withdrawn.preferences,{...input.settings.butler.proactive,consent:{version:1,at:10}});
  assert.equal(other.consent,undefined,'another device drops its copy of the consent');
});

test('a forget survives merges with copies that lack it; rows made before "forget everything" stay gone',()=>{
  const {mergeButlerSlices:merge}=loader()(path.join(root,'cloud-data.ts'));
  const {projectButlerBrainForSync}=loader()(path.join(root,'proactive-butler.ts'));
  const row=(kind,entityId,extra)=>({id:`${kind}:${entityId}`,entityId,kind,accountId:'account-1',...extra});
  const forget=row('forget','s1',{at:10}),star=row('forget','*',{at:20});
  const base={...emptyCloudData(),butler:[forget]},stale={...emptyCloudData(),butler:[]},fresh={...emptyCloudData(),butler:[forget]};
  assert.deepEqual(merge(base,stale,fresh).butler.map(r=>r.id),['forget:s1'],'an app that dropped the row cannot delete it');
  const later={...emptyCloudData(),butler:[star]};
  assert.deepEqual(merge(base,later,fresh).butler.map(r=>r.id),['forget:*'],'"forget everything" covers older forgets');
  const brain={schema:1,accountId:'account-1',signals:[{id:'s2',accountId:'account-1',source:'wickrun',sourceLabel:'Chat',topic:'Old',intent:'x',summary:'Old need',observedAt:15,confidence:'high',basis:'user-stated',modelSafe:true}],
    goals:[{id:'g1',accountId:'account-1',title:'Old goal',hypothesis:'Old',evidenceIds:['s2'],confidence:'high',status:'proposed',updatedAt:16}],briefs:[],skillProposals:[],actionGrants:[],
    jobs:[{id:'p1',accountId:'account-1',kind:'research',goalId:'g1',status:'proposed',proposal:true,summary:'Old goal',createdAt:17,updatedAt:17},{id:'w1',accountId:'account-1',kind:'work',goalId:'g1',status:'running',createdAt:17,updatedAt:17}],
    audit:[{id:'a1',accountId:'account-1',at:18,kind:'work',title:'Suggested',detail:'Old goal',status:'planned',sourceIds:['s2']}],
    feedback:[{id:'f1',accountId:'account-1',targetKind:'goal',targetId:'g1',rating:'useful',createdAt:18}],forgotten:[{id:'*',accountId:'account-1',at:20}],updatedAt:20};
  const synced=projectButlerBrainForSync(brain);
  assert.deepEqual([synced.signals.length,synced.goals.length,synced.audit.length,synced.feedback.length],[0,0,0,0]);
  assert.deepEqual(synced.jobs.map(j=>j.id),['w1'],'running Work stays under its own controls');
});

test('records about data learned after a forget are kept; a comment does not outlive its brief',()=>{
  const {projectButlerBrainForSync}=loader()(path.join(root,'proactive-butler.ts'));
  const signal=(id,at)=>({id,accountId:'account-1',source:'wickrun',sourceLabel:'Chat',topic:'T',intent:'x',summary:'Need '+id,observedAt:at,confidence:'high',basis:'user-stated',modelSafe:true});
  const brain={schema:1,accountId:'account-1',signals:[signal('new',9000),signal('wickrun:habit-rhythm',9100)],goals:[],skillProposals:[],actionGrants:[],
    briefs:[{id:'b-old',accountId:'account-1',period:'morning',createdAt:9500,items:[{id:'i',kind:'progress',title:'Old',summary:'Old',evidenceIds:['forgotten-signal']}]}],
    feedback:[{id:'f1',accountId:'account-1',targetKind:'brief',targetId:'b-old',rating:'useful',comment:'about forgotten',createdAt:9600}],
    audit:[{id:'a-new',accountId:'account-1',at:9200,kind:'collection',title:'New',detail:'New',status:'completed',sourceIds:['new']},
      {id:'a-habit',accountId:'account-1',at:9300,kind:'collection',title:'Habit',detail:'Habit',status:'completed',sourceIds:['wickrun:habit-rhythm']}],
    forgotten:[{id:'*',accountId:'account-1',at:5000},{id:'wickrun:habit-rhythm',accountId:'account-1',at:6000},{id:'forgotten-signal',accountId:'account-1',at:9400}],updatedAt:9600};
  const synced=projectButlerBrainForSync(brain);
  assert.deepEqual(synced.audit.map(a=>a.id),['a-new','a-habit']);
  assert.deepEqual([synced.briefs.length,synced.feedback.length],[0,0]);
});
