const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {loader}=require('./load-ts.cjs');
const appPath=path.join(__dirname,'../src/App.tsx'),source=ts.createSourceFile(appPath,fs.readFileSync(appPath,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['createRequestedConversation','startButlerWork','controlButlerWork','requestButlerStops','stopOwnedButlerWork'],found=new Map();
function visit(node){if(ts.isFunctionDeclaration(node)&&names.includes(node.name?.text))found.set(node.name.text,node.getText(source));ts.forEachChild(node,visit);}visit(source);
for(const name of names)assert.ok(found.has(name),`Missing production function ${name}`);
const body=ts.transpileModule(names.map(name=>found.get(name)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
// Execute the actual App handlers; React state, workspace I/O and persistence are controlled boundaries.
const createHandlers=new Function('deps',`with(deps){${body};return {${names.join(',')}};}`);
const domain=loader()(path.join(__dirname,'../src/lib/create-conversation.ts'));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const conv=(id,group=id,privacy='personal-butler')=>({id,coordinationGroupId:group,privacy,config:{toolsEnabled:true,model:'fixture'},keyProfileId:null,messages:[],draft:'',createdAt:1,updatedAt:1});
function fixture(options={}){
  let epoch=0,blocked=false;const stops=[],workspaceCalls=[],conversationsRef={current:options.conversations??[conv('parent')]},queueRef={current:options.queue??[]};
  const state={resume:options.resume??null,failover:options.failover??null};
  const settingsRef={current:{defaultConfig:{toolsEnabled:true,model:'fixture'},activeKeyProfileId:null,tools:{workspaceRoots:['C:/fixture']},butler:{proactive:{enabled:true,paused:false,allowRoutineExecution:true}}}};
  const deps={...domain,conversationsRef,queueRef,settingsRef,creationChain:{current:Promise.resolve()},startedCreations:{current:new Set()},blockedOnRoots:{current:new Map()},
    butlerRuntime:{captureDispatchGuard:()=>{const before=epoch;return()=>!blocked&&before===epoch;},getSnapshot:()=>({brain:{jobs:options.jobs??[],goals:[]}})},
    window:{dispatchEvent(){}},Event:global.Event,flushSync:fn=>fn(),t:text=>text,
    setConversations:fn=>{conversationsRef.current=fn(conversationsRef.current);},setQueue:fn=>{queueRef.current=fn(queueRef.current);},
    saveConversationsNow:async value=>options.save?.(value),desktop:()=>({conversationWorkspaceCreate:async(id,root)=>{workspaceCalls.push(id);await options.workspace?.(id);return {id,root,isolatedRoot:root+'/isolated/'+id};}}),
    setActiveId(){},setTeamVisible(){},setSidebarOpen(){},setOpenArtifact(){},setConfigOpen(){},setAttachments(){},setQuotes(){},
    butlerWorkConfig:()=>({config:{model:'fixture',toolsEnabled:true},keyProfileId:null}),
    setResumeInput:fn=>{state.resume=fn(state.resume);},setFailoverResume:fn=>{state.failover=fn(state.failover);},
    abortRun:id=>{stops.push(id);if(options.failStop===id)throw Error('fixture stop rejected');}};
  return {...createHandlers(deps),conversationsRef,queueRef,state,stops,workspaceCalls,pause:()=>{epoch++;blocked=true;},resume:()=>{blocked=false;}};
}
const request={mode:'work',title:'Child',prompt:'Inspect a file',start:true,request_key:'child'};

test('a Butler child remains a private draft if pause and resume occur while its first save waits',async()=>{
  const entered=deferred(),release=deferred();let held=false;
  const f=fixture({save:async()=>{if(!held){held=true;entered.resolve();await release.promise;}}});
  const creating=f.createRequestedConversation(request,'op','parent');await entered.promise;f.pause();f.resume();release.resolve();
  const result=JSON.parse((await creating).content);assert.equal(result.status,'draft');assert.equal(f.workspaceCalls.length,0);assert.equal(f.queueRef.current.length,0);
  assert.equal(f.conversationsRef.current.find(item=>item.id===result.id).privacy,'personal-butler');
});

test('a child workspace that returns after pause cannot enqueue the old prompt after resume',async()=>{
  const entered=deferred(),release=deferred();const f=fixture({workspace:async()=>{entered.resolve();await release.promise;}});
  const creating=f.createRequestedConversation(request,'op','parent');await entered.promise;f.pause();f.resume();release.resolve();
  const result=JSON.parse((await creating).content);assert.equal(result.status,'draft');assert.equal(f.workspaceCalls.length,1);assert.equal(f.queueRef.current.length,0);
});

test('a late root Work creation returns its saved id so the runtime can register and control it',async()=>{
  const entered=deferred(),release=deferred();const f=fixture({workspace:async()=>{entered.resolve();await release.promise;}});
  const creating=f.startButlerWork({id:'job-one',kind:'work',proposal:true},'Inspect a file');await entered.promise;f.pause();release.resolve();
  const id=await creating;assert.ok(f.conversationsRef.current.some(item=>item.id===id&&item.privacy==='personal-butler'));assert.equal(f.queueRef.current.length,0);
});

test('global Butler stop clears owned queues and retries and still requests children when one stop fails',async()=>{
  const f=fixture({conversations:[conv('parent'),conv('child','parent'),conv('legacy','legacy',undefined),conv('ordinary','ordinary',undefined)],jobs:[{conversationId:'legacy'}],
    queue:[{conversationId:'parent'},{conversationId:'child'},{conversationId:'ordinary'}],resume:{convId:'child'},failover:{convId:'parent'},failStop:'parent'});
  // Undefined passed to a default parameter means private; explicitly mark unrelated/legacy conversations public.
  f.conversationsRef.current.find(item=>item.id==='ordinary').privacy=undefined;f.conversationsRef.current.find(item=>item.id==='legacy').privacy=undefined;
  await assert.rejects(f.stopOwnedButlerWork(),/部分 Work 暂停请求未能转交/);
  assert.deepEqual(f.stops,['parent','child','legacy']);assert.deepEqual(f.queueRef.current,[{conversationId:'ordinary'}]);assert.equal(f.state.resume,null);assert.equal(f.state.failover,null);
});

test('a task pause reaches its Butler descendants while leaving another family alone',async()=>{
  const f=fixture({conversations:[conv('parent'),conv('child','parent'),conv('other')],queue:[{conversationId:'parent'},{conversationId:'child'},{conversationId:'other'}]});
  await f.controlButlerWork('parent',{id:'pause-one',kind:'pause',createdAt:1});assert.deepEqual(f.stops,['parent','child']);assert.deepEqual(f.queueRef.current,[{conversationId:'other'}]);
});
