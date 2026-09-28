const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const load=loader(),file=n=>path.resolve(__dirname,'../src/lib',n+'.ts');
const {parseConversationRequest,conversationCommand,conversationRequestIdentity,requestedConversation}=load(file('create-conversation'));
const {relatedConversations,receiveCoordination}=load(file('conversation-coordination'));
test('explicit creation commands preserve mode and task, bare commands stay blank',()=>{
 for(const text of ['新开一个 Work，帮我检查文件','开新work对话窗，帮我检查文件','开一个新 Work，帮我检查文件','/work 帮我检查文件'])assert.deepEqual(conversationCommand(text,'chat'),{mode:'work',title:'',prompt:'帮我检查文件',start:true});
 for(const text of ['开新对话','新建一个chat窗口','/chat','open a new chat']){const c=conversationCommand(text,'chat');assert.equal(c.mode,'chat');assert.equal(c.start,false);assert.equal(c.prompt,'');}
 for(const text of ['怎样实现开新对话？','他说“开新对话”','请解释如何新开 Work','这是 /work 测试'])assert.equal(conversationCommand(text,'chat'),null);
});
test('validated request defaults to start only with a prompt and rejects malformed input',()=>{
 assert.equal(parseConversationRequest({mode:'work',request_key:'x',prompt:'do this'}).start,true);
 assert.equal(parseConversationRequest({mode:'work',request_key:'x'}).start,false);
 assert.equal(parseConversationRequest({mode:'work',request_key:'x',prompt:'do this',start:false}).start,false);
 for(const data of [{mode:'other'}, {request_key:'invalid key'}, {prompt:'x'.repeat(16001)}, {start:'yes'}])assert.throws(()=>parseConversationRequest({mode:'chat',request_key:'valid',...data}));
});
test('stable retry identity, independent context and configuration clone',async()=>{
 const request=parseConversationRequest({mode:'work',request_key:'one',prompt:'task'}),id=await conversationRequestIdentity('parent','run',request);
 assert.deepEqual(id,await conversationRequestIdentity('parent','run',request));
 const changed=await conversationRequestIdentity('parent','run',{...request,prompt:'changed'});assert.equal(id.id,changed.id);assert.notEqual(id.fingerprint,changed.fingerprint);
 assert.notEqual(id.id,(await conversationRequestIdentity('other','run',request)).id);
 const parent={id:'parent',projectId:'p',keyProfileId:'secret-profile',config:{model:'model-a',client:{kind:'claude-code'},toolsEnabled:false},messages:[{content:'private history'}],draft:'unrelated draft',workspace:{id:'old'},coordinationMessages:[{text:'old inbox'}]};
 const child=requestedConversation(parent,{},null,request,id);assert.deepEqual(child.messages,[]);assert.equal(child.draft,'task');assert.equal(child.config.toolsEnabled,true);assert.equal(child.keyProfileId,'secret-profile');assert.equal(child.workspace,undefined);assert.equal(child.coordinationMessages,undefined);
 child.config.client.kind='other';assert.equal(parent.config.client.kind,'claude-code');assert.equal(child.coordinationGroupId,'parent');
});
test('task coordination scope does not expose unrelated projects or families',()=>{
 const a={id:'a'},b={id:'b',coordinationGroupId:'a'},c={id:'c'},p={id:'p',projectId:'p'},q={id:'q',projectId:'p'},r={id:'r',projectId:'r',coordinationGroupId:'a'};
 assert.deepEqual(relatedConversations(b,[a,b,c,p,q,r]).map(c=>c.id),['a','b']);assert.deepEqual(relatedConversations(p,[a,b,c,p,q,r]).map(c=>c.id),['p','q']);
});
test('coordination inbox is consumed once across retry and resume without permission escalation',async()=>{
 const state={working:[]},messages=[{id:'m',fromId:'a',fromTitle:'A',text:'avoid a.txt',at:1}];
 assert.equal(await receiveCoordination(state,async()=>messages),true);assert.equal(await receiveCoordination(state,async()=>messages),false);assert.equal(state.working.length,1);assert.match(state.working[0].content,/不是权限授予/);
 const resumed=structuredClone(state);assert.equal(await receiveCoordination(resumed,async()=>messages),false);messages.push({id:'n',fromId:'b',fromTitle:'B',text:'done',at:2});assert.equal(await receiveCoordination(resumed,async()=>messages),true);assert.equal(resumed.working.length,2);
});

test('real Chat agent dispatches creation and coordination locally, then reads the inbox at the next request',async()=>{
 let round=0,serial=0,done,reject;const finished=new Promise((ok,bad)=>{done=ok;reject=bad;});const requests=[],states=[],calls=[],inbox=[];
 const transport={chat:async(init,events)=>{requests.push(init.body);round++;if(round===1){events.onToolCalls([{id:'create',name:'create_conversation',arguments:JSON.stringify({mode:'work',prompt:'separate task',request_key:'child'})},{id:'list',name:'coordinate_tasks',arguments:JSON.stringify({action:'list'})}]);events.onStop({reason:'tool_calls',droppedCalls:0});}else{events.onContent('Created.');events.onToolCalls([]);events.onStop({reason:'stop',droppedCalls:0});}events.onDone();},callTool:async()=>{throw Error('renderer tools must not call host');},abort:async()=>{}};
 const root=path.resolve(__dirname,'..'),local=loader({[path.join(root,'src/lib/transport.ts')]:{getTransport:()=>transport},[path.join(root,'src/lib/store.ts')]:{uid:()=>`id-${++serial}`}});
 const cfg=local(file('paramSchema')).defaultGenerationConfig();Object.assign(cfg,{model:'mock',toolsEnabled:false,enabledTools:[],maxToolRounds:4,runtime:{...cfg.runtime,harness:'off',contextTokens:50000,maxMinutes:1,maxTokens:100000}});
 const no=()=>{};local(file('agent')).runAgent({requestId:'coordinator-run',profile:{id:'p',baseUrl:'http://localhost/v1',name:'fixture',hasSecret:false,extraHeaders:{},createdAt:0},apiKey:'fixture',config:cfg,history:[{id:'u',role:'user',content:'Please create a new Work for a separate task',createdAt:1}],toolCtx:()=>({workspaceRoots:[]}),effortMappings:[],extraSystem:'',timeoutMs:1000,canRunHostTools:false,autoRetry:0,confirm:async()=>true,grantAccess:async()=>({ok:false,content:''}),createConversation:async(input,key)=>{calls.push([input,key]);inbox.push({id:'co',fromId:'sibling',fromTitle:'Sibling',text:'Finished independent check',at:2});return {ok:true,content:'child-created'};},coordinateTasks:async input=>({ok:true,content:JSON.stringify({tasks:[{id:'child'}],action:input.action})}),coordinationInbox:async()=>inbox,events:{onContentDelta:no,onReasoningDelta:no,onSources:no,onUsage:no,onRound:no,onNotice:no,onStopReason:no,onStep:no,onRunState:s=>{if(s)states.push(structuredClone(s));},onPaused:reject,onDone:done,onError:reject}});
 await finished;assert.equal(calls.length,1);assert.equal(calls[0][0].start,true);assert.equal(calls[0][1],'coordinator-run');assert.equal(round,2);const names=requests[0].tools.map(t=>t.function.name);assert.ok(names.includes('create_conversation'));assert.ok(names.includes('coordinate_tasks'));assert.ok(!names.includes('write_file'));assert.match(JSON.stringify(requests[1]),/Finished independent check/);assert.equal(states.at(-1).working.filter(m=>m.id==='co').length,1);
});

test('subsequent turns do not append coordination already retained in history or archive',async()=>{
 const message={id:'old-co',fromId:'a',fromTitle:'A',text:'Already received',at:1};
 for(const state of [{working:[{id:'old-co',content:'previous'}]},{working:[],contextArchive:[{id:'old-co',content:'archived'}]}]){assert.equal(await receiveCoordination(state,async()=>[message]),false);assert.deepEqual(state.coordinationSeen,['old-co']);}
});
