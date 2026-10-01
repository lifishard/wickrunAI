const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=path.join(__dirname,'..','src','lib','butler-model.ts');
const settings={routeGroups:[{id:'chosen',routes:[{profileId:'p1',model:'one'},{profileId:'p2',model:'two'}]}],
  keyProfiles:[{id:'p1',name:'First',baseUrl:'https://first.test/v1',hasSecret:true},{id:'p2',name:'Second',baseUrl:'https://second.test/v1',hasSecret:true}],
  cachedModels:{},effortMappings:[],requestTimeoutMs:30000,autoRetry:1};
const prefs={backend:{kind:'route-group',routeGroupId:'chosen',effort:'medium'}};
let serial=0;
const loadWith=runConnectedAgent=>loader({'./connected-agent':{runConnectedAgent},'./store':{secretGet:async()=> 'test-key',toolContextOf:()=>({}),uid:prefix=>`${prefix}-${++serial}`},
  './transport':{desktop:()=>null}})(file);
const info=(kind,blameModel=false)=>({kind,title:kind,detail:kind,fixes:[],retryable:false,blameModel});

test('eligible route failure resumes the exact saved context on the next route without losing evidence or double charging',async()=>{
  serial=0;const attempts=[],saved=[],limits=[];
  const {runButlerModel}=loadWith(args=>{
    attempts.push(args);
    void (async()=>{
      if(attempts.length===1){
        const checkpoint={version:2,runId:'same-run',status:'paused',stoppedBy:'error',reason:'route unavailable',phase:'request',round:2,
          spentTokens:250,content:'First route found evidence',working:[{id:'source-original',role:'user',content:'Original request',createdAt:1}],
          steps:[{id:'step-1',name:'web_search',status:'ok',summary:'Source found'}],sources:[{title:'Official source',url:'https://example.test'}],requestStats:[{profileId:'p1',model:'one'}]};
        await args.events.onRunState(checkpoint);args.onLearnLimit?.({rpm:3,at:1,from:'header'});
        args.events.onUsage({total_tokens:250});args.events.onError('route unavailable',info('route_unavailable'));
      }else{
        assert.deepEqual(args.resume,saved[0]);
        assert.equal(args.resume.working[0].content,'Original request');
        assert.equal(args.resume.steps[0].summary,'Source found');
        assert.equal(args.config.runtime.maxTokens,1750);
        args.events.onContentReplace('First route found evidence');
        args.events.onContentDelta(' and second route finished');
        args.events.onUsage({total_tokens:400});
        await args.events.onRunState({...args.resume,status:'completed',content:'First route found evidence and second route finished',spentTokens:400});
        await args.events.onRunState(null);args.events.onDone();
      }
    })();
    return {abort(){}};
  });
  const result=await runButlerModel(settings,prefs,'Original request',true,2000,new AbortController().signal,()=>{},
    {onCheckpoint:async state=>{saved.push(state);},onLearnLimit:(key,limit)=>limits.push({key,limit})});
  assert.equal(attempts.length,2);assert.equal(result.tokens,400);
  assert.match(result.text,/First route found evidence and second route finished/);
  assert.equal(result.steps[0].id,'step-1');assert.equal(result.sources[0].title,'Official source');
  assert.equal(attempts[1].privateInput,true);
  assert.equal(attempts[1].config.runtime.semanticCompression,true);
  assert.equal(attempts[1].config.runtime.harness,'guided');
  assert.equal(attempts[1].config.runtime.recoveryMinutes,1);
  assert.match(limits[0].key,/p1::https:\/\/first\.test\/v1::one/);
  assert.equal(saved.at(-1),null);
});

test('extraction has only management tools; research adds public read tools but no file or command tools',async()=>{
  serial=0;const captured=[];
  const {runButlerModel}=loadWith(args=>{captured.push(args);queueMicrotask(()=>args.events.onDone());return {abort(){}};});
  await runButlerModel(settings,prefs,'extract',false,3000,new AbortController().signal,()=>{});
  await runButlerModel(settings,prefs,'research',true,3000,new AbortController().signal,()=>{});
  assert.deepEqual(captured[0].config.enabledTools,[]);
  assert.deepEqual(captured[1].config.enabledTools,['web_search','fetch_url']);
  for(const args of captured){assert.equal(args.textOnly,true);assert.equal(args.config.toolsEnabled,true);
    assert.equal(args.config.runtime.milestones,false);assert.equal(args.config.runtime.semanticCompression,true);
    assert.equal(args.config.runtime.autoHandoff,true);assert.equal(args.privateInput,true);
    assert.equal(args.toolCtx().workspaceRoots.length,0);assert.equal(args.toolCtx().grants.screen,false);}
});

test('pause, budget stop, and unknown error do not fan out to more routes',async()=>{
  for(const outcome of ['pause','budget','unknown']){
    let calls=0;
    const {runButlerModel}=loadWith(args=>{calls++;void(async()=>{
      if(outcome==='budget')await args.events.onRunState({status:'paused',stoppedBy:'error',reason:'本阶段达到 token 预算',spentTokens:100});
      if(outcome==='pause')args.events.onPaused('用户已暂停');
      else args.events.onError(outcome==='unknown'?'unexpected error':'rate limit',info(outcome==='unknown'?'unknown':'rate_limit'));
    })();return {abort(){}};});
    await assert.rejects(runButlerModel(settings,prefs,'x',false,3000,new AbortController().signal,()=>{}));
    assert.equal(calls,1,`${outcome} should stop`);
  }
});

test('a persisted checkpoint resumes its original model and keeps its prior token spend',async()=>{
  serial=0;let seen;
  const initial={version:2,runId:'prior-run',status:'paused',stoppedBy:'error',reason:'app closed',phase:'request',round:2,
    content:'Evidence already collected',spentTokens:600,working:[{id:'original',role:'user',content:'Original',createdAt:1}],
    steps:[{id:'old-step',name:'web_search',status:'ok'}],sources:[],requestStats:[{profileId:'p2',model:'two'}]};
  const {runButlerModel}=loadWith(args=>{seen=args;queueMicrotask(()=>{args.events.onUsage({total_tokens:800});args.events.onDone();});return {abort(){}};});
  const result=await runButlerModel(settings,prefs,'Original',true,3000,new AbortController().signal,()=>{},{initial});
  assert.equal(seen.profile.id,'p2');assert.equal(seen.config.model,'two');
  assert.deepEqual(seen.resume,initial);assert.equal(seen.config.runtime.maxTokens,2400);
  assert.equal(result.tokens,800);assert.equal(result.steps[0].id,'old-step');
});
