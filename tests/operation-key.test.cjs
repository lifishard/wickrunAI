'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');

/* 把账本和两个会真做事的工具换成内存版，只测操作编号本身的语义。 */
const storePath=require.resolve('../electron/store.cjs');
const runStorePath=require.resolve('../electron/run-store.cjs');
const githubPath=require.resolve('../electron/tools/github.cjs');
const filesPath=require.resolve('../electron/tools/files.cjs');

const kv=new Map();
const stub=(p,exports)=>{require.cache[p]={id:p,filename:p,loaded:true,exports};};
stub(storePath,{kvGet:k=>kv.get(k)??null,async kvSet(k,v){kv.set(k,v);},secretGet:()=>null});

const jobs=new Map(),ops=new Map();
stub(runStorePath,{runtimeStore:()=>({
  job:(r,c)=>jobs.get(`${r}:${c}`),
  saveJob:(r,c,v)=>{jobs.set(`${r}:${c}`,structuredClone(v));},
  op:(r,k)=>ops.get(`${r}:${k}`),
  saveOp:(r,k,v)=>{ops.set(`${r}:${k}`,structuredClone(v));},
  saveResult:()=>'ref',
})});

const calls=[];
stub(githubPath,{
  githubApi:async a=>{calls.push(['github_api',a]);return {ok:true,content:'{}',summary:`GitHub ${a.method||'GET'} ${a.path}`};},
  githubSearch:async()=>({ok:true,content:'[]'}),
});
stub(filesPath,{
  writeFile:async a=>{calls.push(['write_file',a]);return {ok:true,content:'written'};},
  readFile:async a=>{calls.push(['read_file',a]);return {ok:true,content:'body'};},
  listDir:async()=>({ok:true,content:'[]'}),editFile:async()=>({ok:true,content:''}),searchFiles:async()=>({ok:true,content:''}),
});

const {runTool}=require('../electron/tools/index.cjs');
const RUN='run-1';
const ctx=callId=>({workspaceRoots:[],execution:{runId:RUN,callId}});
function reset(){jobs.clear();ops.clear();calls.length=0;}

test('换了位置键也拦得住：同一个写操作不会做第二遍',async()=>{
  reset();
  const args={path:'/repos/a/b/issues',method:'POST',body:{title:'修一下日期'}};
  const first=await runTool('github_api',args,ctx('3-0-call_aaa'));
  assert.equal(first.ok,true);

  // 换模型接手：轮次、批内序号、模型自己生成的调用 id 全变了
  const second=await runTool('github_api',args,ctx('7-2-call_zzz'));
  assert.equal(second.ok,false);
  assert.ok(second.repeated,'应当标记为重复操作');
  assert.equal(second.repeated.callId,'3-0-call_aaa');
  assert.match(second.error,/已经做过完全相同的操作/);
  assert.equal(calls.length,1,'第二次不该真的发出去');
});

test('参数字段顺序不同不影响操作编号',async()=>{
  reset();
  await runTool('github_api',{method:'POST',path:'/x',body:{b:2,a:1}},ctx('1-0-aaa'));
  const again=await runTool('github_api',{body:{a:1,b:2},path:'/x',method:'POST'},ctx('2-0-bbb'));
  assert.equal(again.ok,false,'换个字段顺序不该算成另一件事');
  assert.equal(calls.length,1);
});

test('参数确实不同就照做',async()=>{
  reset();
  await runTool('github_api',{method:'POST',path:'/x',body:{title:'一'}},ctx('1-0-aaa'));
  const other=await runTool('github_api',{method:'POST',path:'/x',body:{title:'二'}},ctx('2-0-bbb'));
  assert.equal(other.ok,true);
  assert.equal(calls.length,2);
});

test('GET 记账但不拦：读同一个接口两次是正常的',async()=>{
  reset();
  await runTool('github_api',{method:'GET',path:'/x'},ctx('1-0-aaa'));
  const again=await runTool('github_api',{method:'GET',path:'/x'},ctx('2-0-bbb'));
  assert.equal(again.ok,true);
  assert.equal(calls.length,2);
  assert.equal(ops.size,1,'仍应记在操作账本里，供核实时查');
});

test('write_file 记账但不拦：同样内容写第二遍是幂等的',async()=>{
  reset();
  const args={path:'a.txt',content:'x'};
  await runTool('write_file',args,ctx('1-0-aaa'));
  const again=await runTool('write_file',args,ctx('2-0-bbb'));
  assert.equal(again.ok,true);
  assert.equal(calls.length,2);
  assert.equal(ops.size,1);
});

test('只读工具不进操作账本',async()=>{
  reset();
  await runTool('read_file',{path:'a.txt'},ctx('1-0-aaa'));
  assert.equal(ops.size,0);
});

test('位置键落空时，按操作编号找回上一次的结果',async()=>{
  reset();
  const args={path:'/repos/a/b/issues',method:'POST',body:{title:'t'}};
  await runTool('github_api',args,ctx('3-0-call_aaa'));

  // 核实调用本身不进账本（agent.ts 调它时不带 execution），否则会记成一次新操作
  const seen=await runTool('reconcile_operation',
    {runId:RUN,callId:'9-1-call_new',name:'github_api',args},{workspaceRoots:[]});
  assert.equal(seen.operationStatus,'completed');
  assert.match(seen.summary,/已由调用 3-0-call_aaa 完成/);
});

test('上一次只发起没完成：答 uncertain，不当成没做过',async()=>{
  reset();
  const args={path:'/x',method:'POST'};
  // 先正常跑一次拿到真实的操作编号，再把它改成「已发起、无完成记录」
  await runTool('github_api',args,ctx('1-0-aaa'));
  const key=[...ops.keys()][0];
  ops.set(key,{name:'github_api',status:'started',callId:'1-0-aaa',at:Date.now()});
  jobs.delete(`${RUN}:1-0-aaa`);

  const seen=await runTool('reconcile_operation',
    {runId:RUN,callId:'5-0-bbb',name:'github_api',args},{workspaceRoots:[]});
  assert.equal(seen.operationStatus,'uncertain');
  assert.equal(seen.uncertain,true);
  assert.notEqual(seen.operationStatus,'not_started');
});

test('项目记忆的追加同样只认内容，不认发起位置',async()=>{
  reset();
  kv.set('snc:projects:v1',JSON.stringify([{id:'p1',name:'项目',memory:''}]));
  const c=cid=>({workspaceRoots:[],projectId:'p1',execution:{runId:RUN,callId:cid}});
  const args={text:'这条结论要记下来'};
  const first=await runTool('project_memory_write',args,c('1-0-aaa'));
  assert.equal(first.ok,true);
  const after=JSON.parse(kv.get('snc:projects:v1'))[0].memory;

  const again=await runTool('project_memory_write',args,c('6-3-zzz'));
  assert.equal(again.ok,false,'同一条记忆不该被追加两遍');
  assert.equal(JSON.parse(kv.get('snc:projects:v1'))[0].memory,after);
});

test('覆盖写不算重复：replace 本来就是幂等的',async()=>{
  reset();
  kv.set('snc:projects:v1',JSON.stringify([{id:'p1',name:'项目',memory:''}]));
  const c=cid=>({workspaceRoots:[],projectId:'p1',execution:{runId:RUN,callId:cid}});
  const args={text:'整份记忆',mode:'replace'};
  await runTool('project_memory_write',args,c('1-0-aaa'));
  const again=await runTool('project_memory_write',args,c('2-0-bbb'));
  assert.equal(again.ok,true);
});
