"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);

/** 用假 transport 装载 health.ts：体检只关心「上游吐没吐东西」，不需要真网络。 */
function withTransport(reply){
  return loader({'./transport':{getTransport:()=>({
    async chat(_req,events){reply(events);events.onDone?.();},
  })}})(file('src/lib/health.ts'));
}

const plain=loader()(file('src/lib/health.ts'));

test('200 但正文为空判为 hollow，不算体检通过',async()=>{
  const {probeModels}=withTransport(()=>{/* 什么都不吐 */});
  const out=await probeModels({profile:{id:'p',baseUrl:'https://x/v1'},apiKey:'k',models:['ghost']});
  assert.equal(out.health.ghost.status,'hollow');
  assert.notEqual(out.health.ghost.status,'ok');
  assert.match(out.health.ghost.reason,/正文是空的/);
});

test('正常吐内容的仍判为 ok，且不带 hollow 的说明',async()=>{
  const {probeModels}=withTransport(events=>{events.onContent?.('hi');});
  const out=await probeModels({profile:{id:'p',baseUrl:'https://x/v1'},apiKey:'k',models:['real']});
  assert.equal(out.health.real.status,'ok');
  assert.equal(out.health.real.reason,undefined);
});

test('hollow 留在列表里给人选，但不进自动派单候选',()=>{
  const h={status:'hollow',at:1,fails:0};
  assert.equal(plain.shouldHide(h),false,'hollow 不该从默认列表里藏起来');
  assert.equal(plain.dispatchable(h),false,'hollow 不该被自动交接选中');
});

test('dispatchable：没记录视为可用，坏掉和手动压下的不可用',()=>{
  assert.equal(plain.dispatchable(undefined),true);
  assert.equal(plain.dispatchable({status:'ok',at:1,fails:0}),true);
  assert.equal(plain.dispatchable({status:'ok',at:1,fails:0,muted:true}),false);
  assert.equal(plain.dispatchable({status:'broken',at:1,fails:2}),false);
  assert.equal(plain.dispatchable({status:'missing',at:1,fails:2}),false);
  // 限流和超时不是模型的锅，仍然可派
  assert.equal(plain.dispatchable({status:'ratelimited',at:1,fails:5}),true);
  assert.equal(plain.dispatchable({status:'timeout',at:1,fails:5}),true);
});

test('每个健康度档位都有可显示的名字',()=>{
  for(const s of ['ok','hollow','broken','missing','ratelimited','timeout','unknown'])
    assert.equal(typeof plain.HEALTH_LABEL[s],'string',`${s} 缺少标签`);
});
