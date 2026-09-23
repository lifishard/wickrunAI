const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const {createQuestionDraft}=loader()(path.join(__dirname,'../src/lib/question-draft.ts'));
const answer=text=>({q:{selected:[],text}}),wait=ms=>new Promise(r=>setTimeout(r,ms));

test('delayed saved snapshots cannot remove new characters or restore deleted text',()=>{
  const saved=[],draft=createQuestionDraft(answer(''),a=>saved.push(a));
  draft.update(answer('abc'));draft.flush();
  draft.update(answer('abcdef'));
  assert.equal(draft.receive(saved[0]),false);assert.equal(draft.current().q.text,'abcdef');
  draft.flush();draft.update(answer('ab'));
  assert.equal(draft.receive(saved[1]),false);assert.equal(draft.current().q.text,'ab');
  draft.dispose();assert.equal(saved.at(-1).q.text,'ab');
});

test('rapid edits coalesce into one checkpoint and preserve spaces and empty deletions',async()=>{
  const saved=[],draft=createQuestionDraft(answer(''),a=>saved.push(a),20);
  for(const text of ['a','ab','ab ','ab  '])draft.update(answer(text));
  assert.equal(saved.length,0);await wait(40);assert.equal(saved.length,1);assert.equal(saved[0].q.text,'ab  ');
  draft.update(answer(''));draft.flush();assert.equal(saved.at(-1).q.text,'');draft.dispose();assert.equal(saved.length,2);
});

test('IME text stays local until composition ends and late snapshots cannot cancel it',async()=>{
  const saved=[],draft=createQuestionDraft(answer(''),a=>saved.push(a),20);
  draft.composition(true);draft.update(answer('zhong'));draft.flush();await wait(40);assert.equal(saved.length,0);
  draft.receive(answer('old'));assert.equal(draft.current().q.text,'zhong');
  draft.update(answer('中文'));draft.composition(false);await wait(40);assert.equal(saved.length,1);assert.equal(saved[0].q.text,'中文');draft.dispose();
});

test('unmount flushes the latest answer to its original question and submission cancels obsolete saves',async()=>{
  const first=[],second=[],a=createQuestionDraft(answer(''),v=>first.push(v),20);
  a.update(answer('unsent'));a.dispose();
  const b=createQuestionDraft(answer('restored'),v=>second.push(v),20);
  assert.equal(b.receive(answer('external')),true);assert.equal(b.current().q.text,'external');
  b.update(answer('submitted'));b.submitted();b.dispose();await wait(40);
  assert.equal(first.length,1);assert.equal(first[0].q.text,'unsent');assert.equal(second.length,0);
});
