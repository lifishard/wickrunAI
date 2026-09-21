'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAcpClient}=require('../electron/acp-client.cjs');
const {createConversationClients}=require('../electron/conversation-clients.cjs');
const {createRunStore}=require('../electron/run-store.cjs');

function fixture(t,makeCall,kind='grok'){
  const root=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'grok-work-permission-'));
  const store=createRunStore(path.join(root,'runtime')),wire=[],notifications=[];
  store.save({id:'run',conversationId:'conversation',answerId:'answer',config:{toolsEnabled:true,client:{kind,model:'default'}},state:{working:[],status:'running'}});
  let promptRequest;
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  const send=message=>child.stdout.write(JSON.stringify(message)+'\n');
  child.stdin=new Writable({write(chunk,_encoding,done){
    for(const line of chunk.toString().trim().split('\n')){
      const request=JSON.parse(line);wire.push(request);
      queueMicrotask(()=>{
        if(request.method==='initialize')send({id:request.id,result:{protocolVersion:1,agentCapabilities:{}}});
        else if(request.method==='session/new')send({id:request.id,result:{sessionId:'session'}});
        else if(request.method==='session/prompt'){
          promptRequest=request;
          send({id:900,method:'session/request_permission',params:{sessionId:'session',toolCall:makeCall(root),options:[
            {optionId:'allow-edits-session',kind:'allow_always',name:'All edits'},
            {optionId:'allow-once',kind:'allow_once',name:'Yes'},
            {optionId:'reject-once',kind:'reject_once',name:'No'},
          ]}});
        }else if(request.id===900 && request.result)send({id:promptRequest.id,result:{stopReason:'end_turn'}});
      });
    }done();
  }});
  const host=createConversationClients({userData:root,store,getSettings:()=>({tools:{workspaceRoots:[root]}}),openExternal:async()=>{},deps:{discoverClient:()=>path.join(root,'grok.exe'),createAcpClient:options=>createAcpClient({...options,spawn:()=>child})}});
  t.after(()=>{host.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,host,store,wire,notifications,run(onApproval=event=>host.approve('request',event.id,true)){
    return host.run({runId:'run',requestId:'request',prompt:'Update the fixture',cwd:root},event=>{notifications.push(event);onApproval(event);});
  }};
}
const edit=(root,variant='SearchReplace')=>({toolCallId:'edit-1',kind:'edit',title:'Edit fixture',rawInput:{variant,file_path:path.join(root,'README.md'),...(variant==='Write'?{content:'# New\n'}:{old_string:'# Old',new_string:'# New',replace_all:false})},_meta:{'x.ai/tool':{version:1,input:{path:path.join(root,'README.md')}}}});

const command=()=>({toolCallId:'command-1',kind:'execute',title:'Execute command',rawInput:{variant:'Bash',command:'Get-ChildItem -Name | Select-String -Pattern README',description:'List matching files',is_background:false},_meta:{'x.ai/tool':{version:1,name:'run_terminal_command',input:{command:'Get-ChildItem -Name | Select-String -Pattern README'}}}});

test('captured Grok terminal command waits for explicit approval and grants only allow_once',async t=>{
  const f=fixture(t,command);
  let pending;
  const run=f.run(event=>{pending=event;});
  while(!pending)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.wire.some(message=>message.id===900&&message.result),false);
  assert.equal(pending.event.requiresExplicitApproval,true);
  assert.deepEqual(pending.event.execution,{cwd:f.root,scope:'host'});
  assert.deepEqual(pending.event.toolCall.rawInput,command().rawInput);
  f.host.approve('request',pending.id,true);
  assert.equal((await run).status,'completed');
  assert.equal(f.wire.find(message=>message.id===900&&message.result).result.outcome.optionId,'allow-once');
  assert.equal(f.store.job('run','approval-'+pending.id).approved,true);
});

test('Grok command rejection and cancellation cannot authorize execution',async t=>{
  for(const cancel of [false,true]){
    const f=fixture(t,command);
    const result=await f.run(event=>cancel?f.host.close():f.host.approve('request',event.id,false));
    assert.notEqual(result.status,'completed');
    assert.equal(f.wire.some(message=>message.id===900&&message.result?.outcome?.optionId==='allow-once'),false);
  }
});

test('Grok background and timeout parameters are preserved for command review',async t=>{
  for(const timeout of [null,0,60000,36000000]){
    const f=fixture(t,()=>{const call=command();call.rawInput.is_background=true;call.rawInput.timeout=timeout;return call;});
    assert.equal((await f.run()).status,'completed');
    assert.equal(f.notifications[0].event.toolCall.rawInput.timeout,timeout);
    assert.equal(f.notifications[0].event.toolCall.rawInput.is_background,true);
  }
});

test('unknown, conflicting, missing or truncated Grok commands are rejected before approval',async t=>{
  const invalid=[
    call=>{delete call.rawInput;}, call=>{call.rawInput.command='';},
    call=>{call.rawInput.command='x'.repeat(20001);delete call._meta;},
    call=>{call.rawInput.command+='\0';delete call._meta;},
    call=>{call.rawInput.env={SECRET:'hidden'};},
    call=>{call.rawInput.cwd='outside';},
    call=>{call.rawInput.variant='Unknown';},
    call=>{call.rawInput.is_background='true';},
    call=>{call.rawInput.timeout=-1;},call=>{call.rawInput.timeout=36000001;},call=>{call.rawInput.timeout='60000';},
    call=>{call._meta['x.ai/tool'].input.command='different command';},
  ];
  for(const change of invalid){
    const f=fixture(t,()=>{const call=command();change(call);return call;});
    assert.equal((await f.run()).status,'permission_required');assert.equal(f.notifications.length,0);
  }
  const kimi=fixture(t,command,'kimi');assert.equal((await kimi.run()).status,'permission_required');assert.equal(kimi.notifications.length,0);
});

test('real Grok Write and SearchReplace request shapes reach host approval without locations',async t=>{
  for(const variant of ['Write','SearchReplace']){
    const f=fixture(t,root=>edit(root,variant));
    const result=await f.run();assert.equal(result.status,'completed');assert.equal(f.notifications.length,1);
    const event=f.notifications[0];assert.deepEqual(event.event.toolCall.locations,[{path:path.join(f.root,'README.md')}]);
    assert.equal(event.event.toolCall.rawInput.variant,variant);assert.equal(event.event.toolCall._meta,undefined);
    assert.equal(f.wire.find(message=>message.id===900&&message.result).result.outcome.optionId,'allow-once');
    const record=f.store.job('run','approval-'+event.id);assert.equal(record.approved,true);assert.deepEqual(record.scopedPaths,[path.join(f.root,'README.md')]);
  }
});

test('Grok edit input never recovers scope from misleading titles or conflicting paths',async t=>{
  const invalid=[
    call=>{call.rawInput.file_path=path.join(os.tmpdir(),'outside.md');delete call._meta;},
    call=>{call.rawInput.file_path='../outside.md';delete call._meta;},
    call=>{call.rawInput.file_path='file:///outside.md';delete call._meta;},
    call=>{call.locations=[{path:path.join(os.tmpdir(),'outside.md')}];},
    call=>{call._meta['x.ai/tool'].input.path=path.join(os.tmpdir(),'outside.md');},
    call=>{call.locations=null;},
    call=>{call.locations='malformed';},
    call=>{call.locations=[{path:''}];},
    call=>{call.rawInput.file_path='x'.repeat(1000);},
    call=>{call.rawInput.file_path+='\0';},
    call=>{call.rawInput.variant='Execute';},
    call=>{call.rawInput.command='delete something';},
    call=>{delete call.rawInput.new_string;},
    call=>{call.rawInput.replace_all='true';},
    call=>{delete call.rawInput;},
    call=>{call.rawInput=null;},
    call=>{call.kind='execute';},
  ];
  for(const change of invalid){
    const f=fixture(t,root=>{const call=edit(root);change(call);return call;});
    const result=await f.run();assert.equal(result.status,'permission_required');assert.equal(f.notifications.length,0);
    assert.equal(f.wire.find(message=>message.id===900&&message.result).result.outcome.optionId,'reject-once');
  }
});

test('Grok target is rechecked when approving and cannot escape through a new junction',async t=>{
  const outside=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'grok-work-outside-'));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  const f=fixture(t,root=>edit(path.join(root,'nested')));
  const result=await f.run(event=>{
    fs.symlinkSync(outside,path.join(f.root,'nested'),process.platform==='win32'?'junction':'dir');
    f.host.approve('request',event.id,true);
  });
  assert.equal(result.status,'permission_required');assert.equal(f.notifications.length,1);
  assert.equal(f.store.job('run','approval-'+f.notifications[0].id).approved,false);
});

test('Grok preview is bounded without truncating the authorized path or persisting unrelated metadata',async t=>{
  const f=fixture(t,root=>{const call=edit(root,'Write');call.rawInput.content='a'.repeat(25000);call.secret='private';call._meta.private='private';return call;});
  assert.equal((await f.run()).status,'completed');const call=f.notifications[0].event.toolCall;
  assert.equal(call.inputPreviewTruncated,true);assert.ok(call.rawInput.content.length<=20001);assert.ok(call.rawInput.content.length<25000);
  assert.equal(call.rawInput.file_path,path.join(f.root,'README.md'));assert.doesNotMatch(JSON.stringify(call),/private/);
});

test('Grok rawInput compatibility does not broaden Kimi permissions or turn rejection into success',async t=>{
  const kimi=fixture(t,root=>edit(root),'kimi');assert.equal((await kimi.run()).status,'permission_required');assert.equal(kimi.notifications.length,0);
  const grok=fixture(t,root=>edit(root));assert.equal((await grok.run(event=>grok.host.approve('request',event.id,false))).status,'permission_required');
  assert.equal(grok.store.job('run','approval-'+grok.notifications[0].id).approved,false);
});
