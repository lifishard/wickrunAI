'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const rm=loader()(file('src/lib/routing-memory.ts'));

let n=0;
function task({route='r1',model='kimi-k3',kind='modify',status='completed',feedback,
  acc={},tools={total:0,ok:0,failed:0,denied:0,elapsedMs:0},active=1000,req={}}={}){
  return {id:`t${++n}`,recordId:`rec${n}`,kind,status,
    attempts:[{id:`a${n}`,route,model,activeMs:active}],
    feedback:feedback?{outcome:feedback,at:1}:undefined,
    acceptance:{coverage:'model_defined',total:0,passed:0,failed:0,unverifiable:0,unchecked:0,program:0,model:0,...acc},
    requests:{total:1,actualInput:800,actualOutput:200,missingInput:0,missingOutput:0,...req},
    tools};
}
const store=tasks=>({version:1,epoch:'e',createdAt:1,tasks,droppedTasks:0,writeFailures:0,ignoredRecordIds:[]});
const passed=k=>({total:k,passed:k,program:k});

test('用户反馈最硬，有就听它的',()=>{
  assert.equal(rm.verdictOf(task({feedback:'usable',acc:{total:1,failed:1}})),'done');
  assert.equal(rm.verdictOf(task({feedback:'unresolved',acc:passed(2)})),'not_done');
  assert.equal(rm.verdictOf(task({feedback:'partial'})),'not_done');
});

test('没有反馈时，只认「程序核验过且全通过」',()=>{
  assert.equal(rm.verdictOf(task({acc:passed(2)})),'done');
  assert.equal(rm.verdictOf(task({acc:{total:2,passed:2,program:0,model:2}})),'unknown',
    '模型自己复核通过不算独立验证，统计时不能又算成功');
  assert.equal(rm.verdictOf(task({acc:{total:2,passed:1,failed:1,program:1}})),'not_done');
});

test('说不清就是说不清 —— 不往任何一边靠',()=>{
  assert.equal(rm.verdictOf(task({status:'paused'})),'unknown');
  assert.equal(rm.verdictOf(task({acc:{total:0}})),'unknown','没声明验收也没反馈，无从判断');
});

test('做成率的分母不含 unknown',()=>{
  // 8 条判得出来（6 成 2 败）+ 12 条说不清
  const tasks=[...Array(6)].map(()=>task({feedback:'usable'}))
    .concat([...Array(2)].map(()=>task({feedback:'unresolved'})))
    .concat([...Array(12)].map(()=>task({status:'paused'})));
  const [s]=rm.routeScores(store(tasks));
  assert.equal(s.done,6); assert.equal(s.notDone,2); assert.equal(s.unknown,12);
  assert.equal(s.doneRate,6/8,'分母是 8 不是 20');
  assert.equal(s.samples,20,'样本量仍然如实报 20');
});

test('样本不足不给数字，而不是给一个小样本算出来的数字',()=>{
  const few=[...Array(3)].map(()=>task({feedback:'usable'}));
  const [s]=rm.routeScores(store(few));
  assert.equal(s.doneRate,null,'3/3 不该报成 100%');
  assert.equal(s.rankable,false);
  assert.equal(s.done,3,'原始计数仍然如实给出');
});

test('成本门槛更高，且用量有缺口就不给',()=>{
  const many=[...Array(20)].map(()=>task({feedback:'usable'}));
  assert.equal(rm.routeScores(store(many))[0].tokensPerDone,1000,'20 次 × 1000 token ÷ 20 次做成');
  const gap=[...Array(20)].map((_,i)=>task({feedback:'usable',req:i?{}:{missingOutput:1}}));
  const [s]=rm.routeScores(store(gap));
  assert.equal(s.tokensPerDone,null);
  assert.equal(s.costIncomplete,true,'缺口要说出来，不是悄悄算');
});

test('同一个模型挂在两份凭据下算两条路由',()=>{
  const rows=rm.routeScores(store([task({route:'alias-a'}),task({route:'alias-b'})]));
  assert.equal(rows.length,2,'路由别名含凭据，不能按模型名合并');
});

test('耗时用中位数，不被长尾拖走',()=>{
  const [s]=rm.routeScores(store([task({active:100}),task({active:200}),task({active:99999})]));
  assert.equal(s.medianActiveMs,200);
});

test('错误完成率：声称完成但验收没过／没核验',()=>{
  const tasks=[...Array(8)].map((_,i)=>task({status:'completed',
    acc:i<2?{total:1,passed:0,unverifiable:1}:passed(1)}));
  const [s]=rm.routeScores(store(tasks));
  assert.equal(s.falseDoneRate,2/8);
  assert.equal(rm.falseDone(task({status:'completed',acc:{total:1,unchecked:1}})),true);
  assert.equal(rm.falseDone(task({status:'paused',acc:{total:1,failed:1}})),false,'没声称完成就谈不上错误完成');
});

test('按任务类型筛，旧记录不会被塞进某一类',()=>{
  const tasks=[task({kind:'modify'}),task({kind:'push'}),{...task(),kind:undefined}];
  assert.equal(rm.routeScores(store(tasks),'modify')[0].samples,1);
  assert.equal(rm.routeScores(store(tasks),'push')[0].samples,1);
  assert.equal(rm.routeScores(store(tasks),'unknown')[0].samples,1,'没有 kind 的归 unknown');
  assert.equal(rm.routeScores(store(tasks),'all')[0].samples,3);
});

test('能排名的排前面，攒不够的排后面等着',()=>{
  const tasks=[...Array(10)].map(()=>task({route:'ready',feedback:'usable'}))
    .concat([task({route:'new',feedback:'usable'})]);
  const rows=rm.routeScores(store(tasks));
  assert.equal(rows[0].route,'ready');
  assert.equal(rows[0].rankable,true);
  assert.equal(rows[1].rankable,false);
});

/* ---- 按需回想旧任务（2.6.0） ---- */
const {recallFrom}=loader()(file('src/lib/recall.ts'));
let m=0;
const rec=({q,project=null,conv='c1',model='kimi-k3',at=1000,reqs=[]}={})=>({
  id:`r${++m}`,conversationId:conv,answerId:'a',projectId:project,title:q,
  question:{id:'u',role:'user',content:q,createdAt:at},config:{model},
  state:{at,requirements:reqs}});

test('默认零关联仍然成立：没有关键词就什么都不返回',()=>{
  assert.deepEqual(recallFrom([rec({q:'修复日期错误'})],null,{query:''}),[]);
  assert.deepEqual(recallFrom([rec({q:'修复日期错误'})],null,{query:'完全无关的词'}),[]);
});

test('只查同一个项目 —— 跨项目翻找不是「想不起来」',()=>{
  const records=[rec({q:'修复日期错误',project:'p1'}),rec({q:'修复日期错误',project:'p2'}),rec({q:'修复日期错误'})];
  assert.equal(recallFrom(records,null,{query:'日期',projectId:'p1'}).length,1);
  assert.equal(recallFrom(records,null,{query:'日期',projectId:null}).length,1,'不在项目里就只查同样不属于任何项目的');
});

test('不查当前这条对话 —— 它本来就在上下文里',()=>{
  const records=[rec({q:'修复日期',conv:'now'}),rec({q:'修复日期',conv:'old'})];
  const found=recallFrom(records,null,{query:'日期',excludeConversationId:'now'});
  assert.equal(found.length,1);
});

test('命中词多的排前面，同样多的最近的在前',()=>{
  const records=[rec({q:'修复日期错误并推送',at:100}),rec({q:'修复日期',at:200}),rec({q:'修复日期',at:300})];
  const found=recallFrom(records,null,{query:'修复 日期 推送'});
  assert.match(found[0].title,/推送/,'三个词全中的在最前');
  assert.equal(found[1].at,300,'同样命中两词时最近的在前');
});

test('带上当时做成没有，判据跟记分用同一套',()=>{
  const r=rec({q:'修复日期'});
  const s=store([{...task({feedback:'usable'}),recordId:r.id}]);
  assert.equal(recallFrom([r],s,{query:'日期'})[0].verdict,'done');
  const s2=store([{...task({status:'paused'}),recordId:r.id}]);
  assert.equal(recallFrom([r],s2,{query:'日期'})[0].verdict,'unknown','说不清就说不清');
});

test('返回的是摘要不是原文',()=>{
  const r=rec({q:'修复日期错误',reqs:[{id:'x',revision:1,verification:{status:'passed',revision:1}},{id:'y',revision:1}]});
  const [found]=recallFrom([r],null,{query:'日期'});
  assert.equal(found.acceptance,'2 条验收，通过 1 条');
  assert.equal(found.model,'kimi-k3');
  assert.ok(!('content' in found),'不该把原文带回来');
});

test('条数有上限',()=>{
  const records=[...Array(20)].map(()=>rec({q:'修复日期'}));
  assert.equal(recallFrom(records,null,{query:'日期'}).length,5,'默认 5 条');
  assert.equal(recallFrom(records,null,{query:'日期',limit:100}).length,10,'上限 10 条');
});

/* ---- 压缩代价换算（2.6.0） ---- */
const {compactionCost}=loader()(file('src/lib/adaptive.ts'));

test('要重算的量大约是当前输入的两倍：摘要读一遍，之后第一轮再算一遍',()=>{
  assert.deepEqual(compactionCost(60000),{tokens:120000,turns:20});
  assert.deepEqual(compactionCost(1000),{tokens:2000,turns:20});
});

test('「相当于几轮缓存命中」是个常数，不随上下文大小变',()=>{
  assert.equal(compactionCost(5000).turns,compactionCost(500000).turns,
    '这个比值本来就不随规模变，报成随规模变的是假精确');
});

test('没有上下文就没有代价',()=>{
  assert.deepEqual(compactionCost(0),{tokens:0,turns:0});
  assert.deepEqual(compactionCost(-1),{tokens:0,turns:0});
});
