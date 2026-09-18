"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');

/** 项目记忆存在 store 的 kv 段里；这里换成内存版，只测截断策略本身。 */
const storePath=require.resolve('../electron/store.cjs');
const kv=new Map();
require.cache[storePath]={id:storePath,filename:storePath,loaded:true,exports:{
  kvGet:k=>kv.get(k)??null,
  async kvSet(k,v){kv.set(k,v);},
}};
const {projectMemoryWrite}=require('../electron/tools/knowledge.cjs');

const K='snc:projects:v1';
const ctx={projectId:'proj-1'};
function seed(memory=''){kv.set(K,JSON.stringify([{id:'proj-1',name:'测试项目',memory}]));}
function memory(){return JSON.parse(kv.get(K))[0].memory;}

test('没超上限时原样保留',async()=>{
  seed('起始内容');
  await projectMemoryWrite({text:'新的一条'},ctx);
  assert.match(memory(),/^起始内容/);
  assert.match(memory(),/新的一条$/);
});

test('超上限时开头逐字节不变 —— 前缀稳定，缓存才不会整段失配',async()=>{
  seed('A'.repeat(19000));
  await projectMemoryWrite({text:'B'.repeat(3000)},ctx);
  const first=memory();
  assert.ok(first.length<=20000+64,`截断后仍有 ${first.length} 字`);
  const head=first.slice(0,12000);

  await projectMemoryWrite({text:'C'.repeat(3000)},ctx);
  const second=memory();
  assert.equal(second.slice(0,12000),head,'再写一次后开头变了，前缀缓存会失配');

  await projectMemoryWrite({text:'D'.repeat(3000)},ctx);
  assert.equal(memory().slice(0,12000),head,'连续追加后开头仍须保持不变');
});

test('截断保留最新内容，并标明中间被挖掉',async()=>{
  // 21000 已经越过上限，追加任何一条都会触发截断
  seed('A'.repeat(21000));
  await projectMemoryWrite({text:'最新的结论'},ctx);
  assert.match(memory(),/最新的结论\s*$/);
  assert.match(memory(),/中间部分已归档/);
});

test('省略标记不会随每次追加累积',async()=>{
  seed('A'.repeat(19000));
  for(const t of ['一','二','三','四']) await projectMemoryWrite({text:t.repeat(2000)},ctx);
  assert.equal(memory().split('中间部分已归档').length-1,1);
});

test('replace 模式覆盖而不是追加',async()=>{
  seed('旧的记忆');
  await projectMemoryWrite({text:'全新的记忆',mode:'replace'},ctx);
  assert.equal(memory(),'全新的记忆');
});
