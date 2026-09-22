const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.join(__dirname,'..',p);
const realBuildWire=loader()(file('src/lib/agent.ts')).buildWire;
function fixture(result,previous=null){
  const calls=[],states=[],visible=[];let done,apiCalls=0,listener,display='';
  const finished=new Promise(resolve=>done=resolve);
  const bridge={onClientEvent:cb=>{listener=cb;return()=>{listener=null;};},toolAbort:async()=>{},conversationClientRecover:async()=>previous,conversationClientRun:async args=>{calls.push(args);return typeof result==='function'?result(args,event=>listener?.({...event,requestId:args.requestId})):result;}};
  const local=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge},[file('src/lib/agent.ts')]:{buildWire:realBuildWire,runAgent:args=>{apiCalls++;states.push(args.resume);queueMicrotask(()=>done('api'));return {abort(){}};}}});
  const args={requestId:'native-request',config:{client:{kind:'codex',model:'test'},model:'test',toolsEnabled:false,systemPrompt:'',enabledTools:[]},history:[{id:'user-1',role:'user',content:'Keep the original goal',createdAt:1}],toolCtx:()=>({workspaceRoots:[]}),extraSystem:'',confirm:async()=>false,
    events:{onContentDelta(text){display+=text;visible.push(display);},onContentReplace(text){display=text;visible.push(display);},onNotice(){},onRunState:s=>{if(s)states.push(structuredClone(s));},onPaused:()=>done('paused'),onDone:()=>done('completed')}};
  return {calls,states,visible,finished,args,run:extra=>local(file('src/lib/connected-agent.ts')).runConnectedAgent({...args,...extra}),apiCalls:()=>apiCalls};
}
const marker='<wickrun_question>'+JSON.stringify({questions:[{id:'choice',question:'Which day?',options:[{label:'Friday'},{label:'Monday'}]}]})+'</wickrun_question>';

test('streamed native progress stays hidden across every chunk boundary and resumed prose is replaced',async()=>{
  const answer='Current work is saved.\n<wickrun_progress>'+JSON.stringify({milestones:[{id:'remaining',title:'Remaining work',status:'pending'}]})+'</wickrun_progress>';
  const f=fixture(async(_args,emit)=>{for(const text of answer)emit({type:'delta',text});return {status:'completed',text:answer};});
  f.run({resume:{working:f.args.history,runId:'saved',content:'Old attempt prose.',round:1,status:'paused'}});
  assert.equal(await f.finished,'paused');
  assert.equal(f.states.at(-1).content,'Current work is saved.');
  assert.equal(f.states.at(-1).milestones.find(m=>m.id==='remaining').status,'pending');
  assert.ok(f.visible.every(text=>!text.includes('wickrun_')&&!text.includes('milestones')&&!text.includes('Old attempt prose.')));
});

test('malformed progress and interrupted native turns never expose protocol data as answer text',async()=>{
  for(const [status,record] of [['completed','<wickrun_progress>{broken}</wickrun_progress>'],['completed','<wickrun_progress>{"milestones":'],['unknown','<wickrun_progress>{"milestones":']]){
    const f=fixture({status,text:'Visible answer.\n'+record});f.run();assert.equal(await f.finished,'paused');
    assert.equal(f.states.at(-1).content,'Visible answer.');
    assert.ok(f.visible.every(text=>!text.includes('wickrun_')&&!text.includes('milestones')));
    if(status==='unknown')assert.match(f.states.at(-1).uncertainCallId,/native-/);
  }
});

test('image conversations and resumed image turns reach the native host',async()=>{
  const image={id:'image-1',kind:'image',name:'screenshot.png',dataUrl:'data:image/png;base64,aGVsbG8='};
  const history=[{id:'user-image',role:'user',content:'What is visible?',attachments:[image],createdAt:1}];
  const f=fixture({status:'completed',text:'A screenshot'});f.run({history});
  assert.equal(await f.finished,'completed');assert.equal(f.calls.length,1);
  assert.deepEqual(f.calls[0].images,[image.dataUrl]);assert.doesNotMatch(f.calls[0].prompt,/base64/);assert.match(f.calls[0].prompt,/Image 1 attached separately/);
  const resumed=fixture({status:'completed',text:'A screenshot'});resumed.run({resume:{working:history,runId:'saved',round:1,at:1,stoppedBy:'error',status:'paused'}});
  assert.equal(await resumed.finished,'completed');assert.equal(resumed.calls.length,1);
  assert.deepEqual(resumed.calls[0].images,[image.dataUrl]);
});

test('missing image bytes fail before native dispatch but do not block recovery of completed work',async()=>{
  const history=[{id:'user-image',role:'user',content:'What is visible?',attachments:[{kind:'image',name:'missing.png'}],createdAt:1}];
  const f=fixture({status:'completed',text:'unexpected'});f.run({history});
  assert.equal(await f.finished,'paused');assert.equal(f.calls.length,0);assert.match(f.states.at(-1).reason,/图片附件数据缺失/);
  const recovered=fixture(null,{status:'completed',text:'Saved result'});
  recovered.run({resume:{working:history,runId:'saved',uncertainCallId:'native-previous',round:1,at:1,stoppedBy:'error'}});
  assert.equal(await recovered.finished,'completed');assert.equal(recovered.calls.length,0);
});
test('native question and exact answer survive separate native turns in the portable transcript',async()=>{
  const f=fixture({status:'completed',text:marker});f.run();assert.equal(await f.finished,'paused');const state=f.states.at(-1);
  assert.equal(state.waitKind,'question');assert.equal(state.uncertainCallId,undefined);
  state.userQuestion.answers={choice:{selected:['Friday'],text:'Keep this name'}};
  const resumed=fixture({status:'completed',text:'Done'});resumed.run({resume:state,requestId:'native-next'});assert.equal(await resumed.finished,'completed');
  assert.match(resumed.calls[0].prompt,/Friday/);assert.match(resumed.calls[0].prompt,/Keep this name/);assert.equal(resumed.states.at(-1).userQuestionHistory.length,1);assert.equal(resumed.states.at(-1).supplementalInputs.length,1);
});
test('unfinished native output cannot clear uncertainty by containing a question marker',async()=>{
  const f=fixture({status:'unknown',text:marker});f.run();await f.finished;
  assert.equal(f.states.at(-1).userQuestion,undefined);assert.match(f.states.at(-1).uncertainCallId,/^native-/);
});
test('completed host result recovers after renderer loss with zero new dispatches',async()=>{
  const f=fixture({status:'completed',text:'must not run'},{status:'completed',text:'saved on host'});
  f.run({resume:{working:f.args.history,runId:'prior-run',uncertainCallId:'native-prior-attempt',round:1,at:1,stoppedBy:'unknown'}});
  assert.equal(await f.finished,'completed');assert.equal(f.calls.length,0);assert.equal(f.states.at(-1).content,'saved on host');
});
test('unanswered native question does not submit a new model request on generic resume',async()=>{
  const f=fixture({status:'completed',text:marker});f.run();await f.finished;const state=f.states.at(-1);
  const next=fixture({status:'completed',text:'must not run'});next.run({resume:state});assert.equal(await next.finished,'paused');assert.equal(next.calls.length,0);
});
test('switching from a native question to API carries the submitted answer before calling API runtime',async()=>{
  const f=fixture({status:'completed',text:marker});f.run();await f.finished;const state=f.states.at(-1);state.userQuestion.answers={choice:{selected:['Friday'],text:'Keep this name'}};
  const next=fixture({status:'completed',text:'unused'});next.run({resume:state,config:{model:'api-model',toolsEnabled:false}});assert.equal(await next.finished,'api');assert.equal(next.apiCalls(),1);
  assert.equal(next.states.at(-1).userQuestion,undefined);assert.match(next.states.at(-1).working.at(-1).content,/Friday/);
});


test('nonblocking native question remains answerable while independent work runs',async()=>{
  let secondStarted,release;const started=new Promise(r=>secondStarted=r),held=new Promise(r=>release=r);let turn=0;
  const pending='<wickrun_question>'+JSON.stringify({blocking:false,questions:[{id:'choice',question:'Which day?',options:[{label:'Friday'},{label:'Monday'}]}]})+'</wickrun_question>';
  const f=fixture(async()=>{turn++;if(turn===1)return {status:'completed',text:pending};if(turn===2){secondStarted();await held;return {status:'completed',text:'Independent source checked'};}return {status:'completed',text:'Finished with Friday'};});
  const handle=f.run();await started;
  const question=f.states.at(-1).userQuestion;assert.equal(question.nonBlocking,true);
  await handle.answerQuestion(question.request.id,{choice:{selected:['Friday'],text:''}});
  release();assert.equal(await f.finished,'completed');assert.equal(f.calls.length,3);
  assert.match(f.calls[2].prompt,/Friday/);assert.match(f.calls[2].prompt,/Independent source checked/);
  assert.equal(f.states.at(-1).userQuestion,undefined);assert.equal(f.states.at(-1).userQuestionHistory.length,1);
});

test('native completion waits for the outstanding nonblocking question',async()=>{
  let turn=0;const pending=marker.replace('{"questions"','{"blocking":false,"questions"');
  const f=fixture(()=>({status:'completed',text:++turn===1?pending:'Independent work completed'}));
  f.run();assert.equal(await f.finished,'paused');assert.equal(f.calls.length,2);assert.ok(f.states.at(-1).userQuestion);assert.match(f.states.at(-1).reason,/等待用户回答/);
});

test('recovering a native operation processes a pending new input after the recovered result',async()=>{
  const f=fixture({status:'completed',text:'New instruction handled'},{status:'completed',text:'Previous operation was completed once'});
  const input={id:'new-input',role:'user',content:'Now change the target',createdAt:3};
  f.run({resume:{working:f.args.history,runId:'prior-run',uncertainCallId:'native-prior-attempt',round:1,at:1,stoppedBy:'unknown',pendingInputMessages:[input],supplementalInputs:[input],replanPending:true}});
  assert.equal(await f.finished,'completed');assert.equal(f.calls.length,1);
  assert.match(f.calls[0].prompt,/Previous operation was completed once/);assert.match(f.calls[0].prompt,/Now change the target/);
  const working=f.states.at(-1).working;assert.ok(working.findIndex(m=>m.content==='Previous operation was completed once')<working.findIndex(m=>m.id==='new-input'));
});
