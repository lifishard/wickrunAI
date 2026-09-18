'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const {nextRoute,shouldHandOff,sameRoute}=loader()(file('src/lib/failover.ts'));

const R=(profileId,model)=>({profileId,model});
const ORDER=[R('free','glm-4.7'),R('paid','kimi-k3'),R('paid','claude-5')];
const err=(patch={})=>({kind:'unknown',title:'t',detail:'d',fixes:[],retryable:false,blameModel:false,...patch});
const go=(patch={})=>nextRoute({current:ORDER[0],order:ORDER,health:{},info:err({kind:'rate_limit'}),...patch});

test('名单为空就什么都不做 —— 用户没排顺序，程序不替他排',()=>{
  assert.equal(go({order:[]}),null);
});

test('路由自己坏了，立刻交给名单下一位',()=>{
  const d=go({info:err({kind:'model_broken',blameModel:true})});
  assert.deepEqual(d.route,R('paid','kimi-k3'));
  assert.equal(d.reason,'这条路由自己坏了');
});

test('换人解决不了的三类留在原地',()=>{
  for(const kind of ['bad_param','loop_detected','unknown']){
    assert.equal(shouldHandOff(err({kind})),null,`${kind} 不该触发交接`);
    assert.equal(go({info:err({kind})}),null);
  }
});

test('额度、鉴权、工具不支持、看不了图、窗口装不下、连不通都换',()=>{
  for(const kind of ['rate_limit','quota','auth','route_unavailable','routing_policy',
                     'tools_unsupported','multimodal','context_too_long','network','timeout']){
    assert.ok(shouldHandOff(err({kind})),`${kind} 应当触发交接`);
  }
});

test('从当前这条的下一位开始，绕一圈回到它前面',()=>{
  assert.deepEqual(go({current:ORDER[1]}).route,R('paid','claude-5'));
  assert.deepEqual(go({current:ORDER[2]}).route,R('free','glm-4.7'),'最后一位之后绕回第一位');
});

test('跳过已知坏掉的和只回空正文的',()=>{
  const health={paid:{'kimi-k3':{status:'broken',at:1,fails:2}}};
  assert.deepEqual(go({health}).route,R('paid','claude-5'));
  const hollow={paid:{'kimi-k3':{status:'hollow',at:1,fails:0}}};
  assert.deepEqual(go({health:hollow}).route,R('paid','claude-5'),'hollow 不该被自动交接选中');
});

test('限流和超时的路由仍然可以接手 —— 那不是模型的锅',()=>{
  const health={paid:{'kimi-k3':{status:'ratelimited',at:1,fails:9}}};
  assert.deepEqual(go({health}).route,R('paid','kimi-k3'));
});

test('已经试过的不再试，一次任务最多把名单走一遍',()=>{
  assert.deepEqual(go({tried:[R('paid','kimi-k3')]}).route,R('paid','claude-5'));
  assert.equal(go({tried:[R('paid','kimi-k3'),R('paid','claude-5')]}),null,'全试过就该停下来等人');
});

test('用户手动压下的不接手',()=>{
  const health={paid:{'kimi-k3':{status:'ok',at:1,fails:0,muted:true}}};
  assert.deepEqual(go({health}).route,R('paid','claude-5'));
});

test('当前路由不在名单里就从名单头上找',()=>{
  assert.deepEqual(go({current:R('other','x')}).route,R('free','glm-4.7'));
});

test('sameRoute 认凭据也认模型',()=>{
  assert.equal(sameRoute(R('a','m'),R('a','m')),true);
  assert.equal(sameRoute(R('a','m'),R('b','m')),false);
  assert.equal(sameRoute(R('a','m'),R('a','n')),false);
});

/* ---- 三层继承：会话 > 项目 > 应用全局（2.4.2） ---- */
const {resolveFailover}=loader()(file('src/lib/failover.ts'));
const cfg=(enabled,n=1)=>({enabled,routes:Array.from({length:n},(_,i)=>R('p',`m${i}`))});

test('哪一层先有设置就用哪一层',()=>{
  assert.equal(resolveFailover(cfg(true),cfg(false),cfg(false)).from,'session');
  assert.equal(resolveFailover(undefined,cfg(true),cfg(false)).from,'project');
  assert.equal(resolveFailover(undefined,undefined,cfg(true)).from,'app');
});

test('三层都没设置就是不交接',()=>{
  const r=resolveFailover(undefined,undefined,undefined);
  assert.equal(r.from,'none');
  assert.equal(r.config.enabled,false);
  assert.deepEqual(r.config.routes,[]);
});

test('「这一层明确关掉」不等于「这一层没意见」',()=>{
  // 设了全局之后，用户必须还能为单次任务把它关掉
  const r=resolveFailover({enabled:false,routes:[]},undefined,cfg(true,3));
  assert.equal(r.from,'session');
  assert.equal(r.config.enabled,false,'会话层明确关闭不该被全局顶回来');
});

test('空名单也算「这一层设了」，不再往上继承',()=>{
  const r=resolveFailover({enabled:true,routes:[]},undefined,cfg(true,3));
  assert.equal(r.from,'session');
  assert.deepEqual(r.config.routes,[]);
});

test('项目层挡在会话和全局之间',()=>{
  const r=resolveFailover(undefined,{enabled:false,routes:[]},cfg(true,2));
  assert.equal(r.from,'project');
  assert.equal(r.config.enabled,false);
});
