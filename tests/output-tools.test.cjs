const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.join(__dirname,'..',p);
const load=loader();
const output=load(file('src/lib/output-tools.ts'));
const {buildRequestBody}=load(file('src/lib/paramSchema.ts'));

test('renderer output tools are exposed in Chat without enabling file or command tools',()=>{
  const cfg={model:'kimi-k3',stream:false,toolsEnabled:false,enabledTools:[],thinkingStyle:'off',params:{},customBody:''};
  const body=buildRequestBody(cfg,[],['present_output','suggest_followups','write_file','run_command']);
  assert.deepEqual(body.tools.map(tool=>tool.function.name),['present_output','suggest_followups']);
  assert.equal(body.tool_choice,'auto');
});

test('output tools validate and render saved, approval-free display steps',()=>{
  assert.equal(output.runOutputTool('present_output',{title:'Draft',text:'Hello'}).ok,true);
  assert.equal(output.runOutputTool('present_output',{text:''}).ok,false);
  assert.equal(output.runOutputTool('suggest_followups',{questions:['What changes?']}).ok,true);
  assert.equal(output.runOutputTool('suggest_followups',{questions:['Choose option A']}).ok,false);
  const steps=output.nativeOutputSteps('<wickrun_output>{"title":"Draft","text":"Hello"}</wickrun_output><wickrun_followups>{"questions":["What changes?"]}</wickrun_followups>','turn');
  assert.equal(steps.length,2);
  assert.deepEqual(output.presentedOutputs(steps).map(item=>item.text),['Hello']);
  assert.deepEqual(output.followupPresentation('',steps).questions,['What changes?']);
});

test('only clearly labelled trailing suggestion questions are converted from prose',()=>{
  const prose='Here is the answer.\n\nA few things worth a second look:\n\n- What happens if the price changes?\n\n- How would you explain the commission?';
  assert.deepEqual(output.followupPresentation(prose,[]),{
    body:'Here is the answer.',questions:['What happens if the price changes?','How would you explain the commission?']
  });
  assert.deepEqual(output.followupPresentation('Choose a day:\n- Friday?\n- Monday?',[]).questions,[]);
  assert.deepEqual(output.followupPresentation('Questions in the document:\n1. What happens next?',[]).questions,[]);
});

test('native output markers inside a fenced example stay ordinary answer text',()=>{
  const marker='<wickrun_output>{"title":"Example","text":"Do not display"}</wickrun_output>';
  const examples=[
    'Example syntax:\n```xml\n'+marker+'\n```',
    'Example syntax:\n~~~~json\n'+marker+'\n~~~~',
    'Example syntax:\n````xml\n'+marker+'\n````',
    'Example syntax:\n> '+marker,
  ];
  for(const text of examples){
    assert.deepEqual(output.nativeOutputSteps(text,'turn'),[]);
    assert.equal(load(file('src/lib/native-progress.ts')).nativeVisibleText(text),text);
  }
  assert.deepEqual(output.followupPresentation('> A few things worth a second look:\n> - What happens next?',[]).questions,[]);
  assert.deepEqual(output.followupPresentation('```markdown\nA few things worth a second look:\n- What happens next?',[]).questions,[]);
});

test('a Chat response containing only output tool calls completes without another model request',async()=>{
  let requests=0;
  const states=[];
  let finish;
  const finished=new Promise(resolve=>finish=resolve);
  const transport={chat:async(_request,events)=>{
    requests++;
    events.onToolCalls([{id:'out-1',name:'present_output',arguments:JSON.stringify({title:'Draft',text:'Hello there'})}]);
    events.onStop({reason:'tool_calls',droppedCalls:0});
    events.onDone();
  },abort:async()=>{},callTool:async()=>{throw Error('host tool was called')}};
  const isolated=loader({[file('src/lib/transport.ts')]:{getTransport:()=>transport}});
  const cfg=isolated(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
  Object.assign(cfg,{model:'kimi-k3',stream:false,toolsEnabled:false,enabledTools:[]});
  isolated(file('src/lib/agent.ts')).runAgent({requestId:'chat-output',profile:{id:'profile',name:'test',baseUrl:'https://example.test/v1'},apiKey:'test',config:cfg,
    history:[{id:'user-1',role:'user',content:'Write a greeting',createdAt:1}],toolCtx:()=>({workspaceRoots:[]}),effortMappings:[],extraSystem:'',timeoutMs:1000,canRunHostTools:false,autoRetry:0,
    confirm:async()=>{throw Error('approval was requested')},grantAccess:async()=>{throw Error('access was requested')},
    events:{onContentDelta(){},onReasoningDelta(){},onStep(){},onSources(){},onUsage(){},onRound(){},onNotice(){},onStopReason(){},onRunState:state=>{states.push(state&&structuredClone(state));},onDone:()=>finish('completed'),onPaused:reason=>finish(reason),onError:error=>finish(error)}});
  assert.equal(await finished,'completed');
  assert.equal(requests,1);
  assert.equal(states.at(-2).content,'Hello there');
  assert.equal(states.at(-2).steps.at(-1).status,'ok');
});
