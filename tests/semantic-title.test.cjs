const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const {cleanConversationTitle,titlePrompt}=loader()(path.join(__dirname,'..','src','lib','conversation-title.ts'));

test('semantic title accepts a concise model label and rejects explanatory output',()=>{
  assert.equal(cleanConversationTitle('标题：修复工作区排队与自动唤醒'),'修复工作区排队与自动唤醒');
  assert.equal(cleanConversationTitle('"Cloud sync conflicts"'),'Cloud sync conflicts');
  assert.equal(cleanConversationTitle(''),null);
  assert.equal(cleanConversationTitle('<script>bad</script>'),null);
  assert.equal(cleanConversationTitle('a'.repeat(49)),null);
});

test('title request bounds both goal and answer',()=>{
  const request=JSON.parse(titlePrompt('g'.repeat(5000),'a'.repeat(2000)));
  assert.equal(request.goal.length,4000);
  assert.equal(request.answer.length,1200);
});
