const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const b=loader()(path.resolve(__dirname,'../src/lib/project-board.ts'));

const verdict=(over)=>({id:Math.random().toString(36),taskId:'t1',taskRev:1,role:'ai',verdict:'pass',actorId:'alice',actorName:'Alice',at:Date.now(),...over});

test('a task is done only after its assignee and a different reviewer approve the current revision',()=>{
  const task={...b.newTask('Write launch post'),id:'t1',assignee:'bob@x.test',reviewer:'alice@x.test',status:'review'};
  const ai=verdict({role:'ai',verdict:'pass',model:'grok-4.7',at:1});
  assert.equal(b.taskState(task,[ai]),'awaiting-assignee');
  const bob=verdict({role:'assignee',verdict:'pass',actorId:'bob',at:2});
  assert.equal(b.taskState(task,[ai,bob]),'awaiting-reviewer');
  const alice=verdict({role:'reviewer',verdict:'pass',actorId:'alice',at:3});
  assert.equal(b.taskState(task,[ai,bob,alice]),'done');
  assert.deepEqual(b.boardProgress({goal:'',tasks:[task]},[ai,bob,alice]),{total:1,done:1,aiPassed:1,percent:100});
  // AI alone never completes a task.
  assert.equal(b.boardProgress({goal:'',tasks:[task]},[ai]).done,0);
  // A rejection after approval returns it.
  assert.equal(b.taskState(task,[ai,bob,alice,verdict({role:'reviewer',verdict:'reject',at:4})]),'returned');
});

test('editing what a task asks for makes earlier confirmations stale',()=>{
  const task={...b.newTask('Draft'),id:'t1',assignee:'bob@x.test',reviewer:'alice@x.test',status:'done'};
  const approvals=[verdict({role:'assignee',actorId:'bob'}),verdict({role:'reviewer'})];
  assert.equal(b.taskState(task,approvals),'done');
  const progressOnly=b.editTask(task,{progress:80});assert.equal(progressOnly.rev,1);
  const changed=b.editTask(task,{acceptance:'Mentions pricing'});
  assert.equal(changed.rev,2);assert.equal(changed.status,'review');
  assert.equal(b.taskState(changed,approvals),'awaiting-assignee');
  assert.equal(b.taskVerdicts(changed,approvals).stale.length,2);
});

test('only the assignee, the reviewer (not the same person) and editors may give verdicts',()=>{
  const task={...b.newTask('Draft'),id:'t1',assignee:'bob@x.test',reviewer:'alice@x.test'};
  assert.deepEqual(b.verdictPermissions(task,[],{id:'bob',email:'Bob@x.test'},'commenter'),{ai:false,assignee:true,reviewer:false,edit:false});
  assert.deepEqual(b.verdictPermissions(task,[],{id:'alice',email:'alice@x.test'},'editor'),{ai:true,assignee:false,reviewer:true,edit:true});
  const self={...task};
  const confirmed=[verdict({role:'assignee',verdict:'pass',actorId:'bob'})];
  assert.equal(b.verdictPermissions(self,confirmed,{id:'bob',email:'bob@x.test'},'owner').reviewer,false);
  // An owner who approved as reviewer cannot then confirm as the assignee.
  const approved=[verdict({role:'reviewer',verdict:'pass',actorId:'bob'})];
  assert.equal(b.verdictPermissions(task,approved,{id:'bob',email:'bob@x.test'},'owner').assignee,false);
  assert.throws(()=>b.editTask(task,{reviewer:'BOB@x.test'}),/两个不同的人/);
});

test('one person or the wrong order never completes a task',()=>{
  const task={...b.newTask('Draft'),id:'t1',assignee:'bob@x.test',reviewer:'alice@x.test',status:'review'};
  const same=[verdict({role:'assignee',verdict:'pass',actorId:'bob',at:1}),verdict({role:'reviewer',verdict:'pass',actorId:'bob',at:2})];
  assert.notEqual(b.taskState(task,same),'done');
  const early=[verdict({role:'reviewer',verdict:'pass',actorId:'alice',at:1}),verdict({role:'assignee',verdict:'pass',actorId:'bob',at:2})];
  assert.equal(b.taskState(task,early),'awaiting-reviewer');
});

test('model output is parsed strictly',()=>{
  assert.deepEqual(b.parseAiVerdict('判定如下 {"verdict":"fail","note":"缺少定价","evidence":["Launch on Monday"]}'),{verdict:'fail',note:'缺少定价',evidence:['Launch on Monday']});
  assert.throws(()=>b.parseAiVerdict('{"verdict":"maybe"}'),/无效/);
  assert.throws(()=>b.parseAiVerdict('no json'),/没有返回/);
  const rows=b.parseBreakdown('```json\n[{"title":"写文案","acceptance":"500 字以内"},{"title":""},{"title":"拍视频"}]\n```');
  assert.deepEqual(rows.map(r=>r.title),['写文案','拍视频']);
  const prompt=JSON.parse(b.aiVerdictPrompt('目标',{...b.newTask('任务'),acceptance:'包含定价'},'交付'.repeat(40000)));
  assert.equal(prompt.task.acceptance,'包含定价');assert.ok(prompt.delivered.length<=60000);
});
