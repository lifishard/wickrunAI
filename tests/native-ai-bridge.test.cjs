'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {createNativeAiBridge,claudeDesktopConfigFiles}=require('../electron/native-ai-bridge.cjs');
function fixture(t,overrides={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-native-ai-'));
  const settings={keyProfiles:[{id:'key',name:'Worker API',baseUrl:'https://worker.invalid/v1',extraHeaders:{'X-Test':'yes'}}]};
  const requests=[],opened=[];
  const bridge=createNativeAiBridge({userData:root,appData:path.join(root,'roaming'),getSettings:()=>settings,secretGet:()=> 'fixture-secret',openExternal:async url=>opened.push(url),deps:{runtime:()=>process.execPath,claudeConfigFiles:()=>[path.join(root,'roaming','Claude','claude_desktop_config.json')],fetch:async(url,init)=>{requests.push({url,...init});return new Response(JSON.stringify({choices:[{message:{content:'工作模型返回的证据'}}],usage:{prompt_tokens:20,completion_tokens:30}}));},...overrides}});
  t.after(()=>{bridge.close();fs.rmSync(root,{recursive:true,force:true});});
  const create=(extra={})=>bridge.create({provider:'claude-desktop',goal:'评估两个方案并给出结论',workers:[{profileId:'key',model:'worker-one'}],maxJobs:2,maxOutputTokens:512,...extra}).task;
  const rpc=async(p,method,args={},extra={})=>{const config=JSON.parse(fs.readFileSync(path.join(root,'native-ai',p+'.json'),'utf8'));return fetch(config.endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json',...extra},body:JSON.stringify({method,args})});};
  return {root,settings,requests,opened,bridge,create,rpc};
}
test('real stdio MCP handshake, bounded delegation and final result round trip',async t=>{
  const f=fixture(t);const config=await f.bridge.config('claude-desktop');
  assert.equal(f.bridge.state().connections[0].connected,false);
  const client=new Client({name:'fixture-desktop',version:'1.0.0'});
  const transport=new StdioClientTransport({...config,stderr:'pipe'});
  t.after(()=>client.close());await client.connect(transport);
  const list=await client.listTools();assert.equal(list.tools.length,8);
  const task=f.create();
  const call=async(name,args)=>{const result=await client.callTool({name:'wickrun_'+name,arguments:args});assert.notEqual(result.isError,true,result.content[0].text);return JSON.parse(result.content[0].text);};
  const detail=await call('get_task',{taskId:task.id});
  assert.equal(detail.task.goal,task.goal);assert.equal(JSON.stringify(detail).includes('fixture-secret'),false);assert.equal(JSON.stringify(detail).includes('worker.invalid'),false);
  assert.equal(f.bridge.state().connections[0].connected,true);
  const bad=await client.callTool({name:'wickrun_delegate_task',arguments:{taskId:task.id,workerId:'nope',requestKey:'bad',prompt:'x'}});assert.equal(bad.isError,true);
  const args={taskId:task.id,workerId:'worker-1',requestKey:'once',prompt:'请比较成本，说明不确定性'};
  const first=await call('delegate_task',args),duplicate=await call('delegate_task',args);
  assert.equal(first.job.id,duplicate.job.id);
  const done=await call('read_worker_result',{taskId:task.id,jobId:first.job.id,waitMs:8000});
  assert.equal(done.job.status,'completed');assert.equal(f.requests.length,1);
  const body=JSON.parse(f.requests[0].body);assert.equal(body.max_tokens,512);assert.equal(body.model,'worker-one');assert.equal(body.tools,undefined);assert.equal(f.requests[0].headers.Authorization,'Bearer fixture-secret');
  await call('report_progress',{taskId:task.id,text:'已完成比较，正在审查证据'});
  await call('submit_result',{taskId:task.id,text:'最终结论来自工作模型证据与主脑审查'});
  await call('submit_result',{taskId:task.id,text:'最终结论来自工作模型证据与主脑审查'});
  assert.equal(f.bridge.state().tasks[0].status,'completed');
  await f.bridge.open('claude-desktop',task.id);assert.match(f.opened[0],/^claude:\/\/claude\.ai\/new\?q=/);assert.match(decodeURIComponent(f.opened[0]),/wickrun_submit_result/);
});
test('configuration preserves existing servers and rejects malformed files',async t=>{
  const f=fixture(t);const file=path.join(f.root,'roaming','Claude','claude_desktop_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({theme:'dark',mcpServers:{existing:{command:'somewhere'}}}));
  const result=await f.bridge.configureClaude();assert.match(result.message,/重新打开/);
  const changed=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(changed.theme,'dark');assert.equal(changed.mcpServers.existing.command,'somewhere');assert.equal(changed.mcpServers.wickrun_ai.command,process.execPath);assert.ok(fs.existsSync(file+'.prev'));
  fs.writeFileSync(file,'invalid json');await assert.rejects(f.bridge.configureClaude(),/数据读取失败/);assert.equal(fs.readFileSync(file,'utf8'),'invalid json');
});

test('conversation handoff permits no workers and stable request key prevents duplicate desktop tasks',async t=>{
  const f=fixture(t);const first=f.create({workers:[],requestKey:'conversation-turn'});
  const again=f.create({workers:[],requestKey:'conversation-turn'});
  assert.equal(first.id,again.id);assert.equal(f.bridge.state().tasks.length,1);assert.equal(first.workers.length,0);
  assert.throws(()=>f.create({goal:'different task',workers:[],requestKey:'conversation-turn'}),/不同内容/);
  const handoff=await f.bridge.open('claude-desktop',first.id);
  assert.match(handoff.prompt,/未授权工作模型/);assert.match(handoff.prompt,/独立完成/);
  assert.doesNotMatch(handoff.prompt,/wickrun_delegate_task/);assert.match(handoff.prompt,/wickrun_submit_result/);
  await f.bridge.config('claude-desktop');
  const response=await f.rpc('claude-desktop','submit_result',{taskId:first.id,text:'独立完成后的结果'});
  assert.equal(response.status,200);assert.equal(f.requests.length,0);
});
test('provider isolation, origin rejection, cancellation and call budget are enforced in host',async t=>{
  const f=fixture(t);await f.bridge.config('claude-desktop');await f.bridge.config('chatgpt');const task=f.create({maxJobs:1});
  assert.equal((await f.rpc('chatgpt','get_task',{taskId:task.id})).status,400);
  assert.equal((await f.rpc('claude-desktop','get_task',{taskId:task.id},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await f.rpc('claude-desktop','get_task',{taskId:task.id},{Authorization:'Bearer '+'é'.repeat(64)})).status,401);
  const args={taskId:task.id,workerId:'worker-1',requestKey:'one',prompt:'bounded'};
  const first=await(await f.rpc('claude-desktop','delegate_task',args)).json();
  assert.equal((await f.rpc('claude-desktop','delegate_task',{...args,prompt:'changed'})).status,400);
  await f.rpc('claude-desktop','read_worker_result',{taskId:task.id,jobId:first.job.id,waitMs:8000});
  assert.equal((await f.rpc('claude-desktop','delegate_task',{...args,requestKey:'two'})).status,400);
  f.bridge.cancel(task.id);assert.equal((await f.rpc('claude-desktop','submit_result',{taskId:task.id,text:'late'})).status,400);
  assert.equal(f.requests.length,1);f.bridge.remove(task.id);assert.equal(f.bridge.state().tasks.length,0);
});
test('changed API config is refused, output parameters honored, and failures are not retried',async t=>{
  const f=fixture(t,{fetch:async(url,init)=>{f.requests.push({url,...init});return new Response('no',{status:429});}});
  await f.bridge.config('claude-desktop');const a=f.create();f.settings.keyProfiles[0].baseUrl='https://changed.invalid/v1';
  const args={taskId:a.id,workerId:'worker-1',requestKey:'one',prompt:'task'};
  const first=await(await f.rpc('claude-desktop','delegate_task',args)).json();
  let done=await(await f.rpc('claude-desktop','read_worker_result',{taskId:a.id,jobId:first.job.id,waitMs:8000})).json();assert.equal(done.job.status,'failed');assert.equal(f.requests.length,0);
  const b=f.create({workers:[{profileId:'key',model:'another',outputField:'max_completion_tokens'}]});
  const second=await(await f.rpc('claude-desktop','delegate_task',{...args,taskId:b.id})).json();
  done=await(await f.rpc('claude-desktop','read_worker_result',{taskId:b.id,jobId:second.job.id,waitMs:8000})).json();assert.match(done.job.error,/429/);assert.equal(f.requests.length,1);assert.equal(JSON.parse(f.requests[0].body).max_completion_tokens,512);
});
test('interrupted jobs remain uncertain after restart, token remains usable at updated endpoint',async t=>{
  const f=fixture(t);await f.bridge.config('claude-desktop');const task=f.create();
  const file=path.join(f.root,'native-ai','tasks.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));data.tasks[0].jobs.push({id:'job',status:'running'});fs.writeFileSync(file,JSON.stringify(data));
  const previous=JSON.parse(fs.readFileSync(path.join(f.root,'native-ai','claude-desktop.json'),'utf8'));f.bridge.close();
  const reopened=createNativeAiBridge({userData:f.root,appData:path.join(f.root,'roaming'),getSettings:()=>f.settings,secretGet:()=>'',openExternal:async()=>{},deps:{claudeConfigFiles:()=>[path.join(f.root,'roaming','Claude','claude_desktop_config.json')]}});t.after(()=>reopened.close());await reopened.start();
  assert.equal(reopened.state().tasks[0].jobs[0].status,'uncertain');
  const next=JSON.parse(fs.readFileSync(path.join(f.root,'native-ai','claude-desktop.json'),'utf8'));assert.equal(next.token,previous.token);assert.notEqual(next.endpoint,previous.endpoint);
  const response=await f.rpc('claude-desktop','get_task',{taskId:task.id});assert.equal(response.status,200);
});

test('Claude claims queued tasks one at a time and can report a blocker',async t=>{
  const f=fixture(t);await f.bridge.config('claude-desktop');
  const call=async(method,args)=>{const r=await f.rpc('claude-desktop',method,args);const v=await r.json();if(v.error)throw Error(v.error);return v;};
  assert.deepEqual((await call('claim_task')).idle,true);
  const first=f.create({workers:[],requestKey:'a'}),second=f.create({workers:[],goal:'第二个任务',requestKey:'b'});
  const got=await call('claim_task');
  assert.equal(got.task.id,first.id);assert.equal(got.task.status,'working');assert.match(got.instructions,/wickrun_report_blocked/);
  assert.equal((await call('claim_task')).task.id,second.id,'a claimed task is never handed out twice');
  assert.equal((await call('claim_task')).idle,true);
  await assert.rejects(call('report_blocked',{taskId:first.id,reason:''}),/受阻原因/);
  await call('report_blocked',{taskId:first.id,reason:'需要访问 D 盘的权限'});
  const saved=f.bridge.state().tasks.find(x=>x.id===first.id);
  assert.equal(saved.status,'blocked');assert.equal(saved.blockedReason,'需要访问 D 盘的权限');
  await assert.rejects(call('submit_result',{taskId:first.id,text:'x'}),/已经结束/);
});

test('Microsoft Store Claude Desktop config location is written alongside the standard one',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-msix-'));
  try{
    const local=path.join(root,'Local'),roaming=path.join(root,'Roaming');
    fs.mkdirSync(path.join(local,'Packages','Claude_pzs8sxrjxfjjc'),{recursive:true});fs.mkdirSync(path.join(local,'Packages','Other_x'),{recursive:true});
    const onlyStore=claudeDesktopConfigFiles(roaming,{LOCALAPPDATA:local},'win32');
    assert.deepEqual(onlyStore,[path.join(local,'Packages','Claude_pzs8sxrjxfjjc','LocalCache','Roaming','Claude','claude_desktop_config.json')]);
    fs.mkdirSync(path.join(roaming,'Claude'),{recursive:true});
    assert.equal(claudeDesktopConfigFiles(roaming,{LOCALAPPDATA:local},'win32').length,2);
    assert.deepEqual(claudeDesktopConfigFiles(roaming,{},'darwin'),[path.join(roaming,'Claude','claude_desktop_config.json')]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('a wickrun_ai entry written by another wickrunAI copy is updated; a foreign one needs confirmation',async t=>{
  const f=fixture(t);const file=path.join(f.root,'roaming','Claude','claude_desktop_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  // 开发模式 / 旧名字的安装版：数据目录不同，但同样是 wickrunAI 写的
  const other={command:'node',args:[path.join(f.root,'old-userdata','native-ai','wickrun-mcp.cjs'),path.join(f.root,'old-userdata','native-ai','claude-desktop.json')]};
  fs.writeFileSync(file,JSON.stringify({mcpServers:{wickrun_ai:other,keep:{command:'x'}}}));
  const updated=await f.bridge.configureClaude();
  assert.equal(updated.conflicts.length,0);assert.match(updated.message,/另一个 wickrunAI/);
  let saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.ok(saved.mcpServers.wickrun_ai.args[0].startsWith(path.join(f.root,'native-ai')));assert.equal(saved.mcpServers.keep.command,'x');
  // 别的程序写的同名连接：不改文件，返回冲突说明
  const foreign={command:'python',args:['C:/tools/someone-else/server.py']};
  fs.writeFileSync(file,JSON.stringify({mcpServers:{wickrun_ai:foreign}}));
  const blocked=await f.bridge.configureClaude();
  assert.equal(blocked.conflicts.length,1);assert.match(blocked.message,/server\.py/);assert.deepEqual(blocked.files,[]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).mcpServers.wickrun_ai,foreign);
  const replaced=await f.bridge.configureClaude({replace:true});
  assert.equal(replaced.files.length,1);assert.match(replaced.message,/\.prev/);
  saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.mcpServers.wickrun_ai.command,process.execPath);
  assert.deepEqual(JSON.parse(fs.readFileSync(file+'.prev','utf8')).mcpServers.wickrun_ai,foreign);
});

test('tests can never reach the real Claude Desktop configuration',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-guard-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const bridge=createNativeAiBridge({userData:root,appData:path.join(root,'roaming'),getSettings:()=>({}),secretGet:()=>'',openExternal:async()=>{},deps:{runtime:()=>process.execPath}});
  t.after(()=>bridge.close());
  await assert.rejects(bridge.configureClaude(),/claudeConfigFiles/);
});
