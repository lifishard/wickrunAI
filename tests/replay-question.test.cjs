const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { replayUserQuestion } = require('./load-ts.cjs').loader()(path.join(__dirname, '../src/lib/replay-question.ts'));

test('regeneration preserves original image/audio/video attachments and quote scope while accepting edited text', () => {
  const question = {id:'original',role:'user',content:'before',createdAt:1,attachments:[{id:'image',dataUrl:'data:image/png;base64,AA=='},{id:'audio',dataUrl:'data:audio/wav;base64,AA=='},{id:'video',dataUrl:'data:video/mp4;base64,AA=='}],quotes:[{text:'original quote'}],quoteOnly:true,skillNames:['original skill']};
  const replay = replayUserQuestion(question,'after');
  assert.deepEqual(replay,{...question,content:'after'});
  assert.notEqual(replay,question);
  assert.equal(question.content,'before');
  assert.equal(replayUserQuestion(undefined,'new'),undefined);
  assert.equal(replayUserQuestion({role:'assistant',content:'reply'},'new'),undefined);
});
