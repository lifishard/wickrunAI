const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.join(__dirname,'..',p);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function apiFixture(options={}){
  const states=[],chats=[],tools=[],aborts=[];let allowed=true,finish;
  const finished=new Promise(r=>{finish=r;});
  const transport={abort:async()=>{},chat:async(init,events)=>{chats.push(init);await options.chat?.(init,events);},
    callTool:async(name,args,ctx)=>{tools.push({name,args,ctx});return options.tool?options.tool(name,args,ctx):{ok:true,content:'read result'};}};
  const load=loader({[file('src/lib/transport.ts')]:{getTransport:()=>transport,desktop:()=>({toolAbort:async id=>aborts.push(id)})}});
  const config=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config,{model:'fixture',enabledTools:['read_file'],toolsEnabled:true,maxToolRounds:3,approvalMode:'ask',runtime:{contextTokens:100000,maxTokens:100000,maxMinutes:1}});
  const args={requestId:'fixture-run',profile:{id:'fixture',baseUrl:'https://fixture.invalid/v1',extraHeaders:{}},apiKey:'fixture',config,canDispatch:()=>allowed,
    history:[{id:'user',role:'user',content:'Inspect the fixture document',createdAt:1}],toolCtx:()=>({workspaceRoots:['C:/fixture']}),effortMappings:[],extraSystem:'',timeoutMs:1000,canRunHostTools:true,autoRetry:0,
    confirm:async()=>true,grantAccess:async()=>({ok:false,content:''}),
    events:{onContentDelta(){},onContentReplace(){},onReasoningDelta(){},onSources(){},onUsage(){},onRound(){},onNotice(){},onStopReason(){},onStep(){},
      onRunState:async state=>{if(state){states.push(structuredClone(state));await options.save?.(state);}},onPaused:()=>finish('paused'),onError:()=>finish('error'),onDone:()=>finish('completed')}};
  const handle=load(file('src/lib/agent.ts')).runAgent(args);
  return {states,chats,tools,aborts,finished,handle,block:()=>{allowed=false;}};
}
const toolReply=(_init,events)=>{events.onToolCalls([{id:'read-one',name:'read_file',arguments:'{"path":"C:/fixture/input.txt"}'}]);events.onStop({reason:'tool_calls'});events.onDone();};

test('API request cannot dispatch after pause during its durable reservation',async()=>{
  const entered=deferred(),release=deferred();let held=false;
  const f=apiFixture({chat:()=>assert.fail('must not dispatch'),save:async state=>{if(!held&&state.requestStats?.length){held=true;entered.resolve();await release.promise;}}});
  await Promise.race([entered.promise,f.finished.then(value=>{throw Error('finished before boundary: '+value+' '+f.states.at(-1)?.reason);})]);f.block();release.resolve();assert.equal(await f.finished,'paused');assert.equal(f.chats.length,0);assert.equal(f.tools.length,0);
});

test('API tool cannot dispatch after pause while its intent checkpoint is saving',async()=>{
  const entered=deferred(),release=deferred();let held=false;
  const f=apiFixture({chat:toolReply,save:async state=>{if(!held&&state.phase==='tools'&&state.steps?.some(step=>step.status==='running')){held=true;entered.resolve();await release.promise;}}});
  await Promise.race([entered.promise,f.finished.then(value=>{throw Error('finished before boundary: '+value+' '+f.states.at(-1)?.reason);})]);f.block();release.resolve();assert.equal(await f.finished,'paused');assert.equal(f.chats.length,1);assert.equal(f.tools.length,0);
});

test('API cancellation reaches existing native cancellation and keeps an in-flight tool uncertain',async()=>{
  const entered=deferred(),release=deferred();let lateResult;
  const f=apiFixture({chat:toolReply,tool:async()=>{entered.resolve();await release.promise;lateResult={ok:true,content:'late durable result'};return lateResult;}});
  await Promise.race([entered.promise,f.finished.then(value=>{throw Error('finished before boundary: '+value+' '+f.states.at(-1)?.reason);})]);f.block();f.handle.abort();assert.equal(await f.finished,'paused');
  assert.deepEqual(f.aborts,['fixture-run']);assert.equal(f.states.at(-1).uncertainCallId,'read-one');
  release.resolve();await new Promise(setImmediate);assert.equal(lateResult.content,'late durable result');
  assert.equal(f.chats.length,1);assert.equal(f.tools.length,1);assert.equal(f.states.at(-1).status,'paused');
});

test('native request cannot dispatch after its uncertain-intent save completes under a closed gate',{timeout:10000},async()=>{
  const entered=deferred(),release=deferred(),calls=[],states=[];let allowed=true,held=false,finish;
  const finished=new Promise(r=>{finish=r;});
  const bridge={onClientEvent:()=>()=>{},conversationClientRun:async input=>{calls.push(input);return {status:'completed',text:'unexpected'};},toolAbort:async()=>{}};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge}});
  load(file('src/lib/connected-agent.ts')).runConnectedAgent({requestId:'native-pending',canDispatch:()=>allowed,
    config:{model:'fixture',client:{kind:'codex',model:'fixture'},toolsEnabled:false,enabledTools:[],systemPrompt:''},history:[{id:'u',role:'user',content:'Inspect',createdAt:1}],toolCtx:()=>({workspaceRoots:[]}),extraSystem:'',
    events:{onContentDelta(){},onContentReplace(){},onNotice(){},onStep(){},onDone:()=>finish('completed'),onPaused:()=>finish('paused'),
      onRunState:async state=>{if(state){states.push(structuredClone(state));if(!held&&state.uncertainCallId){held=true;entered.resolve();await release.promise;}}}}});
  await Promise.race([entered.promise,finished.then(value=>{throw Error('finished before native boundary: '+value+' '+states.at(-1)?.reason);})]);allowed=false;release.resolve();assert.equal(await finished,'paused');assert.equal(calls.length,0);assert.equal(states.at(-1).status,'paused');
});

test('Claude Desktop cannot create a new handoff after pause during checkpoint persistence',{timeout:10000},async()=>{
  const entered=deferred(),release=deferred(),created=[];let allowed=true,held=false,finish;
  const finished=new Promise(r=>{finish=r;});
  const bridge={nativeAiCreate:async input=>{created.push(input);throw Error('unexpected creation');},nativeAiCancel:async()=>{}};
  const load=loader({[file('src/lib/transport.ts')]:{desktop:()=>bridge},[file('src/lib/agent.ts')]:{buildWire:history=>history}});
  load(file('src/lib/desktop-conversation.ts')).runDesktopConversation({requestId:'desktop-pending',canDispatch:()=>allowed,
    config:{model:'fixture',client:{kind:'claude-desktop',model:'fixture'},toolsEnabled:false},history:[{id:'u',role:'user',content:'Inspect',createdAt:1}],extraSystem:'',
    events:{onContentReplace(){},onNotice(){},onDone:()=>finish('completed'),onPaused:()=>finish('paused'),onRunState:async()=>{if(!held){held=true;entered.resolve();await release.promise;}}}});
  await entered.promise;allowed=false;release.resolve();assert.equal(await finished,'paused');assert.equal(created.length,0);
});
