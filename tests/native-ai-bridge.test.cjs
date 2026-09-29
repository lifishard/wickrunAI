'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {createNativeAiBridge,claudeDesktopConfigFiles}=require('../electron/native-ai-bridge.cjs');
function fixture(t,overrides={},memory=null){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-native-ai-'));
  const settings={keyProfiles:[{id:'key',name:'Worker API',baseUrl:'https://worker.invalid/v1',extraHeaders:{'X-Test':'yes'}}]};
  const requests=[],opened=[];
  const bridge=createNativeAiBridge({userData:root,appData:path.join(root,'roaming'),getSettings:()=>settings,secretGet:()=> 'fixture-secret',openExternal:async url=>opened.push(url),memory,deps:{runtime:()=>process.execPath,claudeConfigFiles:()=>[path.join(root,'roaming','Claude','claude_desktop_config.json')],fetch:async(url,init)=>{requests.push({url,...init});return new Response(JSON.stringify({choices:[{message:{content:'工作模型返回的证据'}}],usage:{prompt_tokens:20,completion_tokens:30}}));},...overrides}});
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
  const list=await client.listTools();assert.equal(list.tools.length,18);
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

test('installing the Claude extension replaces the config-file entry so tools are not duplicated',async t=>{
  const f=fixture(t);const file=path.join(f.root,'roaming','Claude','claude_desktop_config.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({mcpServers:{keep:{command:'x'}}}));
  await f.bridge.configureClaude();
  assert.ok(JSON.parse(fs.readFileSync(file,'utf8')).mcpServers.wickrun_ai);
  const built=[];
  f.bridge.close();
  const bridge=createNativeAiBridge({userData:f.root,appData:path.join(f.root,'roaming'),getSettings:()=>f.settings,secretGet:()=>'',openExternal:async()=>{},deps:{claudeConfigFiles:()=>[file],buildMcpb:o=>{built.push(o);fs.writeFileSync(o.outFile,'zip');return {file:o.outFile};}}});
  t.after(()=>bridge.close());
  const result=await bridge.buildExtension({version:'2.19.3'});
  assert.equal(result.removedConfig,1);assert.ok(fs.existsSync(result.file));
  assert.equal(built[0].connectionFile,path.join(f.root,'native-ai','claude-desktop.json'));
  assert.ok(fs.existsSync(built[0].serverFile));
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(saved.mcpServers.wickrun_ai,undefined);assert.equal(saved.mcpServers.keep.command,'x');
  assert.equal(result.state.connections[0].configured,true);
  const endpoint=JSON.parse(fs.readFileSync(built[0].connectionFile,'utf8'));assert.match(endpoint.endpoint,/^http:\/\/127\.0\.0\.1:\d+\/rpc$/);
});

test('project memory: search is read-only and scoped to the task project; proposals are candidates with a cap',async t=>{
  const calls=[];
  const memory={
    search:(projectId,query,limit)=>{calls.push(['search',projectId,query,limit]);if(!projectId)throw Error('这个任务不属于任何项目，没有项目记忆可查');return {project:'P',total:1,items:[{id:'m1',kind:'decision',text:'部署用 Railway',pinned:false}]};},
    propose:async(projectId,input)=>{calls.push(['propose',projectId,input]);return {ok:true,id:'m_'+calls.length};},
  };
  const f=fixture(t,{},memory);await f.bridge.config('claude-desktop');
  const task=f.bridge.create({provider:'claude-desktop',goal:'整理部署说明',projectId:'proj-1',workers:[],maxJobs:1,maxOutputTokens:512}).task;
  const call=async(method,args)=>(await f.rpc('claude-desktop',method,args)).json();
  const found=await call('memory_search',{taskId:task.id,query:'部署'});
  assert.equal(found.items[0].text,'部署用 Railway');
  assert.deepEqual(calls[0],['search','proj-1','部署',undefined]);
  const proposed=await call('memory_propose',{taskId:task.id,text:'文档统一用简体中文',kind:'preference'});
  assert.equal(proposed.ok,true);
  assert.equal(calls[1][1],'proj-1');assert.equal(calls[1][2].sourceRef,`native:${task.id}`);
  for(let i=0;i<4;i++)assert.equal((await call('memory_propose',{taskId:task.id,text:'约定 '+i})).ok,true);
  const capped=await call('memory_propose',{taskId:task.id,text:'第六条'});
  assert.match(capped.error,/最多提交 5 条/);
  // 不属于项目的任务查不到任何项目的记忆
  const loose=f.bridge.create({provider:'claude-desktop',goal:'随便问问',workers:[],maxJobs:1,maxOutputTokens:512}).task;
  assert.match((await call('memory_search',{taskId:loose.id})).error,/不属于任何项目/);
});


test('MCP returns real image blocks with provider isolation and no binary in task metadata',async t=>{
  const f=fixture(t);const config=await f.bridge.config('claude-desktop');await f.bridge.config('chatgpt');
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8MsAAAAASUVORK5CYII=';
  const image={name:'pixel.png',dataUrl:'data:image/png;base64,'+png};const task=f.create({images:[image],requestKey:'image-test'});
  assert.equal(JSON.stringify(f.bridge.state()).includes(png),false);
  assert.throws(()=>f.create({images:[{...image,name:'changed.png'}],requestKey:'image-test'}),/不同内容/);
  assert.equal((await f.rpc('claude-desktop','read_task_image',{taskId:task.id,imageId:'image-1'})).status,400);
  const client=new Client({name:'image-fixture',version:'1'});t.after(()=>client.close());await client.connect(new StdioClientTransport({...config,stderr:'pipe'}));
  await client.callTool({name:'wickrun_claim_task',arguments:{}});
  const result=await client.callTool({name:'wickrun_read_task_image',arguments:{taskId:task.id,imageId:'image-1'}});
  assert.equal(result.isError,undefined);assert.equal(result.content[1].type,'image');assert.equal(result.content[1].data,png);assert.equal(result.content[1].mimeType,'image/png');
  assert.equal((await f.rpc('chatgpt','read_task_image',{taskId:task.id,imageId:'image-1'})).status,400);
  f.bridge.cancel(task.id);assert.equal((await f.rpc('claude-desktop','read_task_image',{taskId:task.id,imageId:'image-1'})).status,400);
  assert.throws(()=>f.create({images:[{name:'fake.png',dataUrl:'data:image/png;base64,YQ=='}]}),/格式/);
});


test('exact task handoff and real generated files return through MCP, with bounded idempotent writes',async t=>{
 const f=fixture(t);const cfg=await f.bridge.config('claude-desktop');await f.bridge.config('chatgpt');
 const first=f.create(),second=f.create({goal:'make a file'});
 const client=new Client({name:'artifact-test',version:'1'});await client.connect(new StdioClientTransport({...cfg,stderr:'pipe'}));t.after(()=>client.close());
 const call=async(name,args)=>client.callTool({name:'wickrun_'+name,arguments:args});
 const claimed=await call('claim_task',{taskId:second.id});assert.equal(claimed.structuredContent.task.id,second.id);assert.equal(f.bridge.state().tasks.find(t=>t.id===first.id).status,'waiting');
 const input={taskId:second.id,name:'result.md',requestKey:'one',text:'# Delivered\n\nActual content'};
 const result=await call('publish_artifact',input);assert.notEqual(result.isError,true);const a=result.structuredContent.artifact;assert.equal(fs.readFileSync(a.path,'utf8'),input.text);
 assert.equal((await call('publish_artifact',input)).structuredContent.artifact.id,a.id);
 assert.equal((await call('publish_artifact',{...input,text:'different'})).isError,true);
 assert.equal((await call('publish_artifact',{...input,name:'../secret.txt',requestKey:'bad'})).isError,true);
 assert.equal((await f.rpc('chatgpt','publish_artifact',input)).status,400);
 assert.equal((await call('publish_artifact',{...input,taskId:first.id})).isError,true);
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8MsAAAAASUVORK5CYII=';
 const image=await call('publish_artifact',{taskId:second.id,name:'picture.png',requestKey:'image',base64:png});assert.equal(fs.readFileSync(image.structuredContent.artifact.path).toString('base64'),png);
 assert.equal(JSON.stringify(f.bridge.state()).includes(png),false);
 await call('submit_result',{taskId:second.id,text:'Both files delivered'});assert.equal(f.bridge.state().tasks.find(t=>t.id===second.id).artifacts.length,2);
 assert.equal((await call('publish_artifact',{...input,requestKey:'after'})).isError,true);
});


test('large native artifacts use scoped binary chunks, survive restart, and verify before publishing',async t=>{
 const f=fixture(t);await f.bridge.config('claude-desktop');const task=f.create();
 const call=async(method,args)=>{const response=await f.rpc('claude-desktop',method,{taskId:task.id,...args});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};
 await call('claim_task',{});
 const bytes=Buffer.alloc(6*1024*1024+17,65),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const input={action:'begin',name:'large.txt',requestKey:'large-file',size:bytes.length,sha256},upload=await call('upload_artifact',input);
 assert.equal(upload.chunkCount,13);assert.equal((await call('upload_artifact',input)).uploadId,upload.uploadId);
 assert.ok(!JSON.stringify(f.bridge.state()).includes(upload.transfer.headers.Authorization));
 const put=async(index,data=bytes.subarray(index*upload.chunkSize,(index+1)*upload.chunkSize),auth=upload.transfer.headers)=>fetch(upload.transfer.urlTemplate.replace('{index}',index),{method:'PUT',headers:auth,body:data});
 assert.equal((await put(0,undefined,{})).status,401);assert.equal((await put(0)).status,200);assert.equal((await(await put(0)).json()).duplicate,true);
 const changed=Buffer.alloc(upload.chunkSize,66);assert.equal((await put(0,changed)).status,409);
 const incomplete=await f.rpc('claude-desktop','upload_artifact',{taskId:task.id,action:'finish',uploadId:upload.uploadId});assert.equal(incomplete.status,400);assert.equal(f.bridge.state().tasks[0].artifacts?.length||0,0);
 f.bridge.close();const next=createNativeAiBridge({userData:f.root,appData:path.join(f.root,'roaming'),getSettings:()=>f.settings,secretGet:()=>'',openExternal:async()=>{},deps:{claudeConfigFiles:()=>[]}});t.after(()=>next.close());await next.start();
 const resumed=await call('upload_artifact',{action:'status',uploadId:upload.uploadId});assert.equal(resumed.received,1);assert.equal(resumed.missing.length,12);
 for(const index of resumed.missing){const res=await fetch(resumed.transfer.urlTemplate.replace('{index}',index),{method:'PUT',headers:resumed.transfer.headers,body:bytes.subarray(index*resumed.chunkSize,(index+1)*resumed.chunkSize)});assert.equal(res.status,200,await res.text());}
 const finished=await call('upload_artifact',{action:'finish',uploadId:upload.uploadId});assert.deepEqual(fs.readFileSync(finished.artifact.path),bytes);assert.equal(next.state().tasks[0].artifacts.length,1);
 assert.equal((await call('upload_artifact',{action:'finish',uploadId:upload.uploadId})).duplicate,true);
 assert.equal((await call('upload_artifact',input)).artifact.id,finished.artifact.id);
});
