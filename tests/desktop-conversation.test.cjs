const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const file=p=>path.join(__dirname,'..',p);
function fixture(result='方案比较与结论',options={}){
  const states=[],created=[],opened=[];let finish,task;const finished=new Promise(r=>finish=r);
  const bridge={nativeAiCreate:async input=>{created.push(input);task={id:'desktop-task',status:'completed',result,workers:[],jobs:[],progress:[],createdAt:1};return {task,prompt:'official prompt'};},
    nativeAiState:async()=>({tasks:[task||{id:'desktop-task',status:'completed',result,workers:[],jobs:[],progress:[],createdAt:1}]}),nativeAiOpen:async(...args)=>opened.push(args),nativeAiCancel:async()=>{}};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge},[file('src/lib/agent.ts')]:{buildWire:history=>history}});
  const args={requestId:'desktop-turn',config:{model:'desktop',client:{kind:'claude-desktop',model:'desktop'},toolsEnabled:false},history:[{id:'goal',role:'user',content:'比较两个方案',createdAt:1}],extraSystem:'',
    events:{onRunState:s=>{if(s)states.push(structuredClone(s));},onContentReplace(){},onNotice(){},onDone:()=>finish('completed'),onPaused:()=>finish('paused')},...options};
  const handle=load(file('src/lib/desktop-conversation.ts')).runDesktopConversation(args);
  return {states,created,opened,finished,handle};
}
test('normal conversation creates desktop handoff without API workers and receives result in same run',async()=>{
  const f=fixture();assert.equal(await f.finished,'completed');assert.equal(f.created.length,1);assert.deepEqual(f.created[0].workers,[]);
  assert.equal(f.created[0].requestKey,'desktop-turn');assert.equal(f.states.at(-1).content,'方案比较与结论');assert.equal(f.states.at(-1).nativeDesktop.taskId,'desktop-task');
});
test('restored desktop conversation reads the original task instead of creating another',async()=>{
  const f=fixture('已保存的成果',{resume:{runId:'previous',working:[],round:1,at:1,stoppedBy:'unknown',nativeDesktop:{taskId:'desktop-task'}}});
  assert.equal(await f.finished,'completed');assert.equal(f.created.length,0);assert.equal(f.opened[0][1],'desktop-task');
});
test('desktop plan-only result remains paused even after MCP reports completion',async()=>{
  const f=fixture('先核对真实状态，不做假设。',{config:{model:'desktop',client:{kind:'claude-desktop',model:'desktop'},toolsEnabled:true},history:[{id:'goal',role:'user',content:'修复日期错误并测试',createdAt:1}]});
  assert.equal(await f.finished,'paused');assert.equal(f.created.length,1);assert.equal(f.states.at(-1).status,'paused');
});
test('a connected Claude session claims the queued task without opening a deep link',async()=>{
  const states=[],opened=[];let finish;const finished=new Promise(r=>finish=r);
  const task={id:'queued',status:'completed',result:'领取后完成的结论',workers:[],jobs:[],progress:[],createdAt:1};
  const bridge={nativeAiCreate:async()=>({task,prompt:'p'}),nativeAiState:async()=>({connections:[{provider:'claude-desktop',configured:true,connected:true}],tasks:[task]}),nativeAiOpen:async(...a)=>opened.push(a),nativeAiCancel:async()=>{}};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge},[file('src/lib/agent.ts')]:{buildWire:h=>h}});
  load(file('src/lib/desktop-conversation.ts')).runDesktopConversation({requestId:'turn',config:{model:'desktop',client:{kind:'claude-desktop',model:'desktop'},toolsEnabled:false},history:[{id:'g',role:'user',content:'比较',createdAt:1}],extraSystem:'',
    events:{onRunState:s=>{if(s)states.push(s);},onContentReplace(){},onNotice(){},onDone:()=>finish('completed'),onPaused:()=>finish('paused')}});
  assert.equal(await finished,'completed');assert.equal(opened.length,0);
});
test('a blocked report pauses the conversation with Claude\'s reason',async()=>{
  let finish,reason;const finished=new Promise(r=>finish=r);
  const task={id:'b',status:'blocked',blockedReason:'缺少仓库访问权限',workers:[],jobs:[],progress:[],createdAt:1};
  const bridge={nativeAiCreate:async()=>({task,prompt:'p'}),nativeAiState:async()=>({connections:[],tasks:[task]}),nativeAiOpen:async()=>{},nativeAiCancel:async()=>{}};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge},[file('src/lib/agent.ts')]:{buildWire:h=>h}});
  load(file('src/lib/desktop-conversation.ts')).runDesktopConversation({requestId:'turn2',config:{model:'desktop',client:{kind:'claude-desktop',model:'desktop'},toolsEnabled:false},history:[{id:'g',role:'user',content:'比较',createdAt:1}],extraSystem:'',
    events:{onRunState(){},onContentReplace(){},onNotice(){},onDone:()=>finish('completed'),onPaused:r=>{reason=r;finish('paused');}}});
  assert.equal(await finished,'paused');assert.match(reason,/缺少仓库访问权限/);
});
