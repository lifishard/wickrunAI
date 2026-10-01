const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const b=loader()(path.join(__dirname,'..','src/lib/proactive-butler.ts'));
const base={id:'sig-1',accountId:'acct-1',source:'browser',sourceLabel:'Browser',sourceRef:'local:tab-1',
  topic:'Annual report',intent:'compare figures',summary:'User opened https://example.test/report?token=abc and reviewed figures',
  observedAt:100,confidence:'medium',basis:'behavior'};

test('external evidence is opt-in on both account and collecting device, and projected by whitelist',()=>{
  assert.equal(b.projectButlerSignal(base,{browser:true},{}),null);
  assert.equal(b.projectButlerSignal(base,{wickrun:true},{browser:true}),null);
  const signal=b.projectButlerSignal({...base,rawPassword:'secret',screenshot:'base64 bytes'},
    {browser:true},{browser:true});
  assert.ok(signal);
  assert.equal(Object.hasOwn(signal,'rawPassword'),false);
  assert.equal(Object.hasOwn(signal,'screenshot'),false);
  assert.doesNotMatch(signal.summary,/token=abc/);
  assert.deepEqual(Object.keys(signal).sort(),['id','accountId','source','sourceLabel','sourceRef','topic','intent','summary','observedAt','confidence','basis','modelSafe'].sort());
  assert.equal(b.projectButlerSignal({...base,summary:'password: secret123'},{browser:true},{browser:true}),null);
});

test('only account-matched evidence supports reviewable goals and duplicates are suppressed',()=>{
  const own=b.projectButlerSignal({...base,source:'wickrun',basis:'user-stated'}, {wickrun:true},{});
  const foreign={...own,id:'foreign',accountId:'acct-2'};
  const brain={...b.emptyButlerBrain('acct-1'),signals:[own,foreign]};
  const candidate={id:'goal-1',title:'Compare annual reports',hypothesis:'May want a comparison',evidenceIds:['foreign'],confidence:'high'};
  assert.equal(b.addGoalProposal(brain,candidate),brain);
  const added=b.addGoalProposal(brain,{...candidate,evidenceIds:['sig-1']},200);
  assert.equal(added.goals[0].status,'proposed');
  assert.equal(added.goals[0].confidence,'high');
  assert.equal(b.addGoalProposal(added,{...candidate,id:'goal-2'}),added);
  assert.equal(b.reviewGoal(added,'goal-1','correct','I only need the 2025 figures',300).goals[0].status,'corrected');
  assert.equal(b.reviewGoal(added,'missing','confirm'),added);
});

test('behavioral evidence cannot assert high confidence; revocation removes derived records',()=>{
  const signal=b.projectButlerSignal(base,{browser:true},{browser:true});
  let brain={...b.emptyButlerBrain('acct-1'),signals:[signal]};
  brain=b.addGoalProposal(brain,{id:'goal-1',title:'Compare reports',hypothesis:'Possible comparison work',evidenceIds:['sig-1'],confidence:'high'},200);
  assert.equal(brain.goals[0].confidence,'medium');
  brain=b.addButlerBrief(brain,{id:'brief-1',accountId:'acct-1',period:'morning',createdAt:300,
    items:[{id:'item-1',kind:'suggestion',title:'Compare',summary:'A possible next step',evidenceIds:['sig-1']}]});
  assert.equal(brain.briefs.length,1);
  const revoked=b.revokeButlerSource(brain,'browser',400);
  assert.deepEqual([revoked.signals.length,revoked.goals.length,revoked.briefs.length],[0,0,0]);
});

test('cloud projection excludes local grants, opaque refs, unexpected fields and account-crossing rows',()=>{
  const signal=b.projectButlerSignal({...base,source:'wickrun',basis:'user-stated'},{wickrun:true},{});
  const brain={...b.emptyButlerBrain('acct-1'),signals:[{...signal,rawTranscript:'secret'}, {...signal,id:'foreign',accountId:'acct-2'}],
    actionGrants:[{id:'grant-1',accountId:'acct-1',action:'financial',account:'bank',target:'vendor',amount:100,currency:'USD',expiresAt:999,grantedAt:10}]};
  const sync=b.projectButlerBrainForSync(brain);
  assert.equal(sync.signals.length,1);
  assert.equal(sync.signals[0].sourceRef,undefined);
  assert.equal(Object.hasOwn(sync.signals[0],'rawTranscript'),false);
  assert.deepEqual(sync.actionGrants,[]);
});

test('financial grant requires exact account, target, action, amount and remains one-use',()=>{
  const grant={id:'grant-1',accountId:'acct-1',action:'financial',account:'checking',target:'vendor-1',amount:125,currency:'USD',expiresAt:500,grantedAt:100};
  const request={accountId:'acct-1',action:'financial',account:'checking',target:'vendor-1',amount:125,currency:'USD'};
  assert.equal(b.actionGrantMatches(grant,request,200),true);
  assert.equal(b.actionGrantMatches(grant,{...request,amount:126},200),false);
  assert.equal(b.actionGrantMatches(grant,{...request,target:'vendor-2'},200),false);
  assert.equal(b.actionGrantMatches({...grant,consumedAt:250},request,300),false);
  assert.equal(b.actionGrantMatches(grant,request,501),false);
});
