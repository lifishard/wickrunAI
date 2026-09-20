const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);

test('runAgent records the dispatch-time profile and model on each request',async()=>{
  const states=[];let resolve;
  const finished=new Promise(r=>resolve=r);
  const transport={
    async chat(_init,events){
      events.onContent('fixture result');
      events.onStop({reason:'stop',droppedCalls:0});
      events.onUsage({prompt_tokens:12,completion_tokens:3,total_tokens:15});
      events.onDone();
    },
    async callTool(){return{ok:true,content:''};},
    async abort(){},
  };
  let serial=0;
  const load=loader({[file('src/lib/transport.ts')]:{getTransport:()=>transport},[file('src/lib/store.ts')]:{uid:()=>`fixture-${++serial}`}});
  const config=load(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(config,{model:'dispatch-model',stream:false,toolsEnabled:false,enabledTools:[],runtime:{...config.runtime,maxTokens:100000,maxMinutes:1}});
  load(file('src/lib/agent.ts')).runAgent({
    requestId:'dispatch-run',profile:{id:'provider-fixture',name:'Provider fixture',baseUrl:'https://provider.invalid/v1'},apiKey:'fake',config,
    history:[{id:'goal',role:'user',content:'Explain the fixture',createdAt:1}],toolCtx:()=>({workspaceRoots:[]}),effortMappings:[],extraSystem:'',timeoutMs:1000,
    canRunHostTools:true,autoRetry:0,confirm:async()=>true,grantAccess:async()=>({ok:true,content:''}),
    events:{onContentDelta(){},onReasoningDelta(){},onSources(){},onUsage(){},onRound(){},onNotice(){},onStopReason(){},onStep(){},
      onRunState:s=>{if(s)states.push(structuredClone(s));},onDone:resolve,onPaused:resolve,onError:resolve},
  });
  await finished;
  const stats=states.at(-1).requestStats;
  assert.equal(stats.length,1);
  assert.equal(stats[0].requestId,'dispatch-run-r1-a1');
  assert.equal(stats[0].profileId,'provider-fixture');
  assert.equal(stats[0].model,'dispatch-model');
  assert.equal(stats[0].purpose,'agent');
});
