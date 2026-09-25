'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {EventEmitter}=require('node:events'),{PassThrough,Writable}=require('node:stream');
const {createAcpClient}=require('../electron/acp-client.cjs');
const {createConversationClients}=require('../electron/conversation-clients.cjs');
const {createRunStore}=require('../electron/run-store.cjs');

function fixture(t,makeCall,kind='grok'){
  // 与 grok-work-permissions 相同的假 ACP 进程，只是打开了「逐项修改前确认」
  const storage=fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()),'grok-work-permission-'));
  const root=path.join(storage,'project');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'README.md'),'# Old\nbody\n');
  const store=createRunStore(path.join(storage,'runtime')),wire=[],notifications=[];
  store.save({id:'run',conversationId:'conversation',answerId:'answer',config:{toolsEnabled:true,client:{kind,model:'default'}},state:{working:[],status:'running'}});
  let promptRequest,launchOptions;
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
          send({id:900,method:'session/request_permission',params:{sessionId:'session',toolCall:makeCall(root,launchOptions,send),options:[
            {optionId:'allow-edits-session',kind:'allow_always',name:'All edits'},
            {optionId:'allow-once',kind:'allow_once',name:'Yes'},
            {optionId:'reject-once',kind:'reject_once',name:'No'},
          ]}});
        }else if(request.id===900 && request.result)send({id:promptRequest.id,result:{stopReason:'end_turn'}});
      });
    }done();
  }});
  const host=createConversationClients({userData:storage,store,getSettings:()=>({tools:{workspaceRoots:[root],reviewCodeChanges:true}}),openExternal:async()=>{},deps:{discoverClient:()=>path.join(root,'grok.exe'),createAcpClient:options=>{launchOptions=options;return createAcpClient({...options,spawn:()=>child});}}});
  t.after(()=>{host.close();fs.rmSync(storage,{recursive:true,force:true});});
  return {root,host,store,wire,notifications,run(onApproval=event=>host.approve('request',event.id,true)){
    return host.run({runId:'run',requestId:'request',prompt:'Update the fixture',cwd:root},event=>{notifications.push(event);if(event.type==='approval')onApproval(event);});
  }};
}
const edit=(root,variant='SearchReplace')=>({toolCallId:'edit-1',kind:'edit',title:'Edit fixture',rawInput:{variant,file_path:path.join(root,'README.md'),...(variant==='Write'?{content:'# New\n'}:{old_string:'# Old',new_string:'# New',replace_all:false})},_meta:{'x.ai/tool':{version:1,input:{path:path.join(root,'README.md')}}}});
const command=()=>({toolCallId:'command-1',kind:'execute',title:'Execute command',rawInput:{variant:'Bash',command:'Get-ChildItem -Name | Select-String -Pattern README',description:'List matching files',is_background:false},_meta:{'x.ai/tool':{version:1,name:'run_terminal_command',input:{command:'Get-ChildItem -Name | Select-String -Pattern README'}}}});

test('review mode: a Grok edit arrives with a pending diff and a matching write passes the final check',async t=>{
  const f=fixture(t,root=>edit(root));
  const result=await f.run(event=>{
    // 模拟 Grok：批准后自己写入，内容与预览一致
    fs.writeFileSync(path.join(f.root,'README.md'),'# New\nbody\n');f.host.approve('request',event.id,true);
  });
  assert.equal(result.status,'completed');
  const [change]=f.notifications[0].event.codeChanges;
  assert.equal(change.status,'pending');assert.equal(change.kind,'modified');assert.equal(change.additions,1);assert.equal(change.deletions,1);
  assert.equal(f.wire.find(m=>m.id===900&&m.result).result.outcome.optionId,'allow-once');
  assert.deepEqual(result.codeAuditWarnings||[],[]);
  assert.equal(result.codeChanges.length,1);
});

test('review mode: a write that differs from the approved diff, or an unapproved file, is flagged',async t=>{
  const f=fixture(t,root=>edit(root));
  const result=await f.run(event=>{
    fs.writeFileSync(path.join(f.root,'README.md'),'# Something else\n');fs.writeFileSync(path.join(f.root,'extra.txt'),'x\n');
    f.host.approve('request',event.id,true);
  });
  assert.ok(result.codeAuditWarnings.some(w=>/实际写入与审核的内容不一致/.test(w)),result.codeAuditWarnings);
  assert.ok(result.codeAuditWarnings.some(w=>/有未经审核的改动.*extra\.txt/.test(w)),result.codeAuditWarnings);
});

test('review mode: Grok commands are declined without asking, and the reason is reported',async t=>{
  const f=fixture(t,command);
  const result=await f.run();
  assert.equal(f.notifications.filter(n=>n.type==='approval').length,0);
  assert.equal(f.wire.find(m=>m.id===900&&m.result).result.outcome.optionId,'reject-once');
  assert.ok(result.codeAuditWarnings.some(w=>/命令可能产生未经审核的改动/.test(w)));
});

test('review mode: edits that cannot be previewed are declined instead of approved blind',async t=>{
  for(const change of [c=>{c.rawInput.old_string='# Missing';},c=>{c.rawInput.old_string='d';c.rawInput.new_string='D';}]){
    const f=fixture(t,root=>{const c=edit(root);change(c);return c;});
    const result=await f.run();
    assert.equal(f.notifications.filter(n=>n.type==='approval').length,0);
    assert.equal(f.wire.find(m=>m.id===900&&m.result).result.outcome.optionId,'reject-once');
    assert.ok(result.codeAuditWarnings.some(w=>/无法预览这次修改/.test(w)),result.codeAuditWarnings);
    assert.equal(fs.readFileSync(path.join(f.root,'README.md'),'utf8'),'# Old\nbody\n');
  }
});

test('review mode still refuses clients that cannot show a diff before writing, with a way forward',async t=>{
  const f=fixture(t,root=>edit(root),'kimi');
  await assert.rejects(f.run(),error=>/Kimi 申请修改时只给出文件路径/.test(error.message)&&/换成 Grok/.test(error.message)&&/设置 → 工具/.test(error.message));
});
