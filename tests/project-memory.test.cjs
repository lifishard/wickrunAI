"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');

/** 项目记忆存在 store 的 kv 段里；这里换成内存版，测主进程的记忆工具。 */
const storePath=require.resolve('../electron/store.cjs');
const kv=new Map();
require.cache[storePath]={id:storePath,filename:storePath,loaded:true,exports:{
  kvGet:k=>kv.get(k)??null,
  async kvSet(k,v){kv.set(k,v);},
}};
const {projectMemoryWrite,projectMemoryRead,projectMemoryForget,nativeMemory}=require('../electron/tools/knowledge.cjs');

const K='snc:projects:v1';
const ctx={projectId:'proj-1'};
function seed(memory='',extra={}){kv.set(K,JSON.stringify([{id:'proj-1',name:'测试项目',memory,...extra}]));}
const project=()=>JSON.parse(kv.get(K))[0];

test('旧的整段记忆在第一次写入时迁移成条目，文字镜像保留给旧版本',async()=>{
  seed('[2026/9/1 10:00:00] 部署用 Railway\n\n[2026/9/2 11:00:00] 导出用 UTF-8 BOM');
  const r=await projectMemoryWrite({text:'以后回答用中文',kind:'preference'},ctx);
  assert.equal(r.ok,true);
  const items=project().memoryItems;
  assert.deepEqual(items.map(m=>m.text),['部署用 Railway','导出用 UTF-8 BOM','以后回答用中文']);
  assert.equal(items[2].kind,'preference');assert.equal(items[2].source,'model');
  assert.equal(project().memory,'部署用 Railway\n\n导出用 UTF-8 BOM\n\n以后回答用中文');
});

test('同样的内容不重复记；密钥被隐藏',async()=>{
  seed('');
  await projectMemoryWrite({text:'服务地址 https://x.example，token: abcdef1234567890'},ctx);
  const again=await projectMemoryWrite({text:'服务地址 https://x.example， token: abcdef1234567890'},ctx);
  assert.match(again.content,/已经有这条记忆/);
  assert.equal(project().memoryItems.length,1);
  assert.doesNotMatch(project().memory,/abcdef1234567890/);
});

test('读记忆带 id，可按关键词查；按 id 更新和删除',async()=>{
  seed('',{memoryItems:[]});
  await projectMemoryWrite({text:'部署统一用 Railway',kind:'decision'},ctx);
  await projectMemoryWrite({text:'CSV 导出用 UTF-8 BOM',kind:'lesson'},ctx);
  const all=await projectMemoryRead({},ctx);
  assert.match(all.content,/\[m_[\w]+\]（决定）部署统一用 Railway/);
  const q=await projectMemoryRead({query:'部署到哪'},ctx);
  assert.match(q.content,/Railway/);assert.doesNotMatch(q.content,/CSV/);
  const id=project().memoryItems.find(m=>/Railway/.test(m.text)).id;
  assert.equal((await projectMemoryWrite({id,text:'部署统一用 Fly.io'},ctx)).ok,true);
  assert.match(project().memory,/Fly\.io/);
  assert.equal((await projectMemoryForget({id},ctx)).ok,true);
  assert.doesNotMatch(project().memory,/Fly/);
  const grave=project().memoryItems.find(m=>m.id===id);
  assert.equal(grave.text,'');assert.ok(grave.deletedAt);
  assert.equal((await projectMemoryForget({id},ctx)).ok,false);
});

test('整段覆盖不再支持，给出改用 id 或删除的提示',async()=>{
  seed('旧的记忆');
  const r=await projectMemoryWrite({text:'全新的记忆',mode:'replace'},ctx);
  assert.equal(r.ok,false);assert.match(r.error,/project_memory_forget/);
  assert.equal(project().memory,'旧的记忆');
});

test('本机客户端提交的只是候选：不进对话，用户删过的不再冒出来',async()=>{
  seed('');
  await projectMemoryWrite({text:'部署用 Railway',kind:'decision'},ctx);
  const r=await nativeMemory.propose('proj-1',{text:'文档统一用简体中文',kind:'preference',sourceRef:'native:t1'});
  assert.equal(r.ok,true);
  const item=project().memoryItems.find(m=>m.id===r.id);
  assert.equal(item.status,'candidate');assert.equal(item.source,'client');
  assert.doesNotMatch(project().memory,/简体中文/,'候选不进文字镜像，也就不进对话');
  assert.deepEqual(nativeMemory.search('proj-1','部署').items.map(m=>m.text),['部署用 Railway']);
  await projectMemoryForget({id:r.id},ctx);
  const again=await nativeMemory.propose('proj-1',{text:'文档统一用简体中文'});
  assert.equal(again.duplicate,true,'用户删过的同一句不会再被提议');
  assert.throws(()=>nativeMemory.search(null,'x'),/不属于任何项目/);
});

test('模型写记忆时可以带适用条件、证据和关键词',async()=>{
  seed('');
  const r=await projectMemoryWrite({text:'导出 CSV 要带 BOM',kind:'lesson',applicability:'Excel 打开时',evidence:'用户确认',keywords:['CSV']},ctx);
  assert.equal(r.ok,true);
  const m=project().memoryItems[0];
  assert.equal(m.applicability,'Excel 打开时');assert.equal(m.evidence,'用户确认');assert.deepEqual(m.keywords,['CSV']);
});
