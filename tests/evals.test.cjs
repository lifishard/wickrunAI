'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const kv=new Map();
const e=loader({[file('src/lib/transport.ts')]:{getTransport:()=>({
  kvGet:async k=>kv.get(k)??null,kvSet:async(k,v)=>{kv.set(k,v);}})}})(file('src/lib/evals.ts'));

let n=0;
const ecase=(o={})=>({id:`c${++n}`,title:'t',task:'做点什么',acceptance:[],split:'dev',createdAt:1,uses:0,...o});
const res=(caseId,config,done,o={})=>({caseId,config,at:o.at??1,done,activeMs:o.activeMs??1000,tokens:o.tokens??500,falseDone:o.falseDone??false});
const st=(cases,results)=>({version:1,cases,results});

test('回归题来自真实失败，原样保留要求',()=>{
  const record={id:'r1',question:{content:'  修复  日期错误 '},state:{requirements:[{check:{kind:'file_exists',path:'a'}}]}};
  const c=e.caseFromRecord(record);
  assert.equal(c.task,'  修复  日期错误 ','原文不改写：改写过的就不是当初那道题了');
  assert.equal(c.split,'dev','新题先进 dev');
  assert.deepEqual(c.acceptance,[{kind:'file_exists',path:'a'}]);
  assert.equal(c.fromRecordId,'r1');
});

test('dev 和 holdout 绝不混着算',()=>{
  const cases=[ecase({split:'dev'}),ecase({split:'holdout'})];
  const results=[res(cases[0].id,'A',true),res(cases[1].id,'A',false)];
  assert.equal(e.report(st(cases,results),'dev')[0].doneRate,1);
  assert.equal(e.report(st(cases,results),'holdout')[0].doneRate,0);
});

test('同一题同一配置跑多次只算最近一次',()=>{
  const c=ecase();
  const store=st([c],[res(c.id,'A',false,{at:1}),res(c.id,'A',true,{at:2})]);
  const [r]=e.report(store,'dev');
  assert.equal(r.cases,1,'不该把重跑算成两道题');
  assert.equal(r.done,1);
});

test('holdout 被看太多次就退化，要提醒轮换',()=>{
  const fresh=ecase({split:'holdout',uses:1}),stale=ecase({split:'holdout',uses:3});
  assert.deepEqual(e.staleHoldout([fresh,stale]).map(c=>c.id),[stale.id]);
  assert.deepEqual(e.staleHoldout([ecase({split:'dev',uses:99})]),[],'dev 本来就是用来看的');
});

test('preserve-and-extend：有一条退步就不采用，哪怕净赚',()=>{
  const a=ecase(),b=ecase(),c=ecase();
  const store=st([a,b,c],[
    res(a.id,'base',true), res(b.id,'base',false), res(c.id,'base',false),
    res(a.id,'cand',false),res(b.id,'cand',true), res(c.id,'cand',true),
  ]);
  const cmp=e.compare(store,'base','cand','dev');
  assert.deepEqual(cmp.regressed,[a.id]);
  assert.equal(cmp.gained.length,2);
  assert.equal(cmp.adopt,false,'修好两个弄坏一个不是进步 —— 坏掉的那个是之前已经能做对的');
});

test('有收益且零退步才采用',()=>{
  const a=ecase(),b=ecase();
  const store=st([a,b],[res(a.id,'base',true),res(b.id,'base',false),
                        res(a.id,'cand',true),res(b.id,'cand',true)]);
  assert.equal(e.compare(store,'base','cand','dev').adopt,true);
});

test('没有收益就不采用 —— 持平不是理由',()=>{
  const a=ecase();
  const store=st([a],[res(a.id,'base',true),res(a.id,'cand',true)]);
  const cmp=e.compare(store,'base','cand','dev');
  assert.equal(cmp.gained.length,0);
  assert.equal(cmp.adopt,false);
});

test('只比两边都跑过的题',()=>{
  const a=ecase(),b=ecase();
  const store=st([a,b],[res(a.id,'base',true),res(b.id,'cand',true)]);
  const cmp=e.compare(store,'base','cand','dev');
  assert.equal(cmp.compared,0);
  assert.equal(cmp.adopt,false,'没有共同题目就下不了结论');
});

test('存取能往返，结果有上限而题目没有',async()=>{
  const cases=[...Array(50)].map(()=>ecase());
  const results=[...Array(3000)].map((_,i)=>res(cases[0].id,'A',true,{at:i}));
  await e.saveEvals(st(cases,results));
  const back=await e.loadEvals();
  assert.equal(back.cases.length,50,'题目是资产，全留');
  assert.equal(back.results.length,2000,'结果是快照，留最近的');
});

test('读不到就给空的，不抛',async()=>{
  kv.clear();
  assert.deepEqual(await e.loadEvals(),{version:1,cases:[],results:[]});
  kv.set('anyai:evals:v1','这不是 JSON');
  assert.deepEqual((await e.loadEvals()).cases,[]);
});
