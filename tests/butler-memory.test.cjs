const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const root=path.join(__dirname,'..','src','lib');
const load=loader();
const {retainButlerSignals,repeatsDeniedGoal,butlerMemoryView}=load(path.join(root,'butler-memory.ts'));
const {emptyButlerBrain}=load(path.join(root,'proactive-butler.ts'));
const signal=(id,at)=>({id,accountId:'own',source:'wickrun',sourceLabel:'chat',topic:'AI tools',intent:'learn',summary:`need ${id}`,observedAt:at,confidence:'high',basis:'user-stated',modelSafe:true});

test('reviewed old evidence survives hundreds of new observations and stays sourced in prompt view',()=>{
  const brain={...emptyButlerBrain('own'),signals:[signal('old',1),...Array.from({length:600},(_,i)=>signal(`new-${i}`,i+2))],
    goals:[{id:'g1',accountId:'own',title:'Find tools',hypothesis:'Find useful AI tools',evidenceIds:['old'],confidence:'high',status:'confirmed',updatedAt:2}],
    skillProposals:[],feedback:[]};
  const kept=retainButlerSignals(brain);
  assert.equal(kept.length,500);assert.ok(kept.some(s=>s.id==='old'));
  const view=butlerMemoryView({...brain,signals:kept});
  assert.ok(view.signals.some(s=>s.id==='old'));assert.equal(view.reviewedGoals[0].evidenceIds[0],'old');
});

test('dismissed goals survive retention and block a paraphrased title with the same evidence',()=>{
  const brain={...emptyButlerBrain('own'),signals:[signal('denied',1),...Array.from({length:510},(_,i)=>signal(`fresh-${i}`,i+2))],
    goals:[{id:'g2',accountId:'own',title:'Buy a stock',hypothesis:'Perhaps invest',evidenceIds:['denied'],confidence:'low',status:'dismissed',updatedAt:3}],skillProposals:[]};
  const kept=retainButlerSignals(brain);
  assert.ok(kept.some(s=>s.id==='denied'));
  assert.equal(repeatsDeniedGoal({...brain,signals:kept},{title:'Purchase a stock',evidenceIds:['denied']}),true);
  assert.equal(repeatsDeniedGoal({...brain,signals:kept},{title:'Learn Python',evidenceIds:['fresh-1']}),false);
});

test('accepted skills and negative feedback remain in bounded model context without foreign records',()=>{
  const brain={...emptyButlerBrain('own'),signals:[signal('skill-source',1),signal('recent',2),{...signal('foreign',3),accountId:'other'}],
    skillProposals:[{id:'s1',accountId:'own',name:'Workflow',description:'Weekly research',body:'Compare public sources',evidenceIds:['skill-source'],status:'accepted',createdAt:3}],
    feedback:[{id:'f1',accountId:'own',targetKind:'goal',targetId:'g1',rating:'not-my-need',comment:'No trading',createdAt:4}]};
  const view=butlerMemoryView(brain,1);
  assert.deepEqual(view.signals.map(s=>s.id),['skill-source']);
  assert.equal(view.acceptedSkills[0].evidenceIds[0],'skill-source');
  assert.equal(view.feedback[0].rating,'not-my-need');
  assert.equal(view.signals.some(s=>s.accountId==='other'),false);
});

test('protected evidence overflow fails instead of silently weakening later revocation',()=>{
  const brain={...emptyButlerBrain('own'),signals:[signal('one',1),signal('two',2)],
    goals:[{id:'g',accountId:'own',title:'Old goal',hypothesis:'Old',evidenceIds:['one','two'],confidence:'high',status:'confirmed',updatedAt:3}]};
  assert.throws(()=>retainButlerSignals(brain,1),/exceeds/);
});

test('corrected goals keep every original evidence source before the recent tail',()=>{
  const brain={...emptyButlerBrain('own'),signals:[signal('old-browser',1),signal('old-chat',2),
    ...Array.from({length:500},(_,i)=>signal(`fresh-${i}`,i+3))],
    goals:[{id:'corrected',accountId:'own',title:'Learn tools',hypothesis:'Original guess',userCorrection:'Compare tools for teaching',
      evidenceIds:['old-browser','old-chat'],confidence:'high',status:'corrected',updatedAt:4}]};
  const kept=retainButlerSignals(brain);
  assert.equal(kept.length,500);
  assert.ok(kept.some(s=>s.id==='old-browser'));
  assert.ok(kept.some(s=>s.id==='old-chat'));
  assert.equal(butlerMemoryView({...brain,signals:kept}).reviewedGoals[0].intent,'Compare tools for teaching');
});
