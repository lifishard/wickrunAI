'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const t=require('../electron/brain-translate.cjs');

const session={model:'kimi-k3',extras:{reasoning_effort:'high',model:'hijack',messages:[]},outputField:'max_tokens'};

test('Anthropic request becomes a chat request pinned to the session model and effort',()=>{
  const body=t.anthropicToChat({model:'claude-opus-5',system:[{type:'text',text:'sys'}],max_tokens:900,stream:true,thinking:{type:'enabled',budget_tokens:4000},
    tools:[{name:'Read',description:'read file',input_schema:{type:'object',properties:{path:{type:'string'}}}}],tool_choice:{type:'any'},
    messages:[{role:'user',content:'hi'},{role:'assistant',content:[{type:'text',text:'ok'},{type:'tool_use',id:'tu1',name:'Read',input:{path:'a'}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:'tu1',content:[{type:'text',text:'file body'}]},{type:'text',text:'next'},{type:'image',source:{type:'base64',media_type:'image/png',data:'AAA'}}]}]},session);
  assert.equal(body.model,'kimi-k3');
  assert.equal(body.reasoning_effort,'high');
  assert.equal(body.thinking,undefined,'client thinking is replaced by the session effort');
  assert.ok(Array.isArray(body.messages)&&body.messages[0].role==='system');
  assert.deepEqual(body.messages.map(m=>m.role),['system','user','assistant','tool','user']);
  assert.equal(body.messages[2].tool_calls[0].function.arguments,'{"path":"a"}');
  assert.equal(body.messages[3].tool_call_id,'tu1');
  assert.equal(body.messages[4].content[1].image_url.url,'data:image/png;base64,AAA');
  assert.equal(body.tool_choice,'required');
  assert.equal(body.tools[0].function.name,'Read');
  assert.deepEqual(body.stream_options,{include_usage:true});
});

test('output field mapping follows the route setting',()=>{
  assert.equal(t.anthropicToChat({messages:[],max_tokens:5},{model:'m',outputField:'max_completion_tokens'}).max_completion_tokens,5);
  assert.equal(t.anthropicToChat({messages:[],max_tokens:5},{model:'m',outputField:'none'}).max_tokens,undefined);
});

test('chat result maps back to Anthropic blocks and stop reasons',()=>{
  const r=t.chatToAnthropic({choices:[{finish_reason:'tool_calls',message:{content:'thinking aloud',tool_calls:[{id:'c1',function:{name:'Bash',arguments:'{"cmd":"ls"}'}}]}}],usage:{prompt_tokens:10,completion_tokens:3}},'kimi-k3','msg_1');
  assert.equal(r.stop_reason,'tool_use');
  assert.deepEqual(r.content[1],{type:'tool_use',id:'c1',name:'Bash',input:{cmd:'ls'}});
  assert.deepEqual(r.usage,{input_tokens:10,output_tokens:3});
});

test('streamed chat chunks become a well-formed Anthropic event sequence',()=>{
  const events=[];const s=t.createAnthropicStream((e,d)=>events.push([e,d]),'m','msg_x');
  s.push({choices:[{delta:{content:'Hel'}}]});s.push({choices:[{delta:{content:'lo'}}]});
  s.push({choices:[{delta:{tool_calls:[{index:0,id:'c9',function:{name:'Edit',arguments:'{"a"'}}]}}]});
  s.push({choices:[{delta:{tool_calls:[{index:0,function:{arguments:':1}'}}]},finish_reason:'tool_calls'}]});
  s.push({choices:[],usage:{prompt_tokens:4,completion_tokens:2}});s.end();s.end();
  const names=events.map(e=>e[0]);
  assert.deepEqual(names,['message_start','content_block_start','content_block_delta','content_block_delta','content_block_stop','content_block_start','content_block_delta','content_block_delta','content_block_stop','message_delta','message_stop']);
  assert.equal(events[5][1].content_block.id,'c9');
  assert.equal(events[6][1].delta.partial_json+events[7][1].delta.partial_json,'{"a":1}');
  assert.equal(events[9][1].delta.stop_reason,'tool_use');
  assert.equal(events[9][1].usage.output_tokens,2);
});

test('Responses request keeps call order and wraps freeform tools',()=>{
  const {body,custom}=t.responsesToChat({model:'gpt-x',instructions:'be codex',stream:true,reasoning:{effort:'low'},max_output_tokens:50,
    tools:[{type:'function',name:'shell',parameters:{type:'object'}},{type:'custom',name:'apply_patch',description:'patch'},{type:'web_search'}],
    input:[{type:'message',role:'developer',content:[{type:'input_text',text:'dev'}]},{type:'message',role:'user',content:[{type:'input_text',text:'go'}]},
      {type:'reasoning',summary:[]},{type:'function_call',call_id:'a',name:'shell',arguments:'{"c":1}'},{type:'custom_tool_call',call_id:'b',name:'apply_patch',input:'*** Begin'},
      {type:'function_call_output',call_id:'a',output:'ok'},{type:'custom_tool_call_output',call_id:'b',output:'done'}]},session);
  assert.equal(body.model,'kimi-k3');
  assert.equal(body.reasoning,undefined);
  assert.equal(body.reasoning_effort,'high');
  assert.deepEqual(body.messages.map(m=>m.role),['system','system','user','assistant','tool','tool']);
  assert.equal(body.messages[3].tool_calls.length,2);
  assert.equal(body.messages[3].tool_calls[1].function.arguments,'{"input":"*** Begin"}');
  assert.equal(body.tools.length,2);
  assert.ok(custom.has('apply_patch'));
  assert.equal(body.max_tokens,50);
});

test('streamed chat chunks become Responses events with completed items',()=>{
  const events=[];const custom=new Set(['apply_patch']);
  const s=t.createResponsesStream((e,d)=>events.push(d),'m',custom,'resp_1');
  s.push({choices:[{delta:{content:'Hi'}}]});
  s.push({choices:[{delta:{tool_calls:[{index:0,id:'c1',function:{name:'shell',arguments:'{"c"'}}]}}]});
  s.push({choices:[{delta:{tool_calls:[{index:0,function:{arguments:':1}'}},{index:1,id:'c2',function:{name:'apply_patch',arguments:'{"input":"P"}'}}]}}]});
  s.push({choices:[],usage:{prompt_tokens:7,completion_tokens:5}});s.end();
  const done=events.filter(e=>e.type==='response.output_item.done').map(e=>e.item);
  assert.deepEqual(done.map(i=>i.type),['message','function_call','custom_tool_call']);
  assert.equal(done[1].arguments,'{"c":1}');
  assert.equal(done[2].input,'P');
  const completed=events.at(-1);
  assert.equal(completed.type,'response.completed');
  assert.equal(completed.response.output.length,3);
  assert.equal(completed.response.usage.total_tokens,12);
  assert.deepEqual(events.map(e=>e.sequence_number),events.map((_,i)=>i));
});

test('non-stream Responses result and SSE parser',()=>{
  const r=t.chatToResponses({choices:[{message:{content:'x',tool_calls:[{id:'k',function:{name:'f',arguments:'{}'}}]}}]},'m',new Set(),'resp_2');
  assert.deepEqual(r.output.map(o=>o.type),['message','function_call']);
  const got=[];let done=false;const parse=t.createSseParser(v=>got.push(v),()=>{done=true;});
  parse('data: {"a":1}\n\ndata: {"b"');parse(':2}\r\n: comment\ndata: [DONE]\n');
  assert.deepEqual(got,[{a:1},{b:2}]);assert.equal(done,true);
});
