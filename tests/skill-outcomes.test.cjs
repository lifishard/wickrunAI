'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const s=loader()(file('src/lib/skills.ts'));

const mk=(name,outcomes,uses=0)=>({id:name,name,description:`${name} 的说明`,body:'x',source:'手写',
  enabled:true,installedAt:1,uses,outcomes});

test('记成败只记到当时用过的技能头上',()=>{
  const next=s.recordSkillOutcome([mk('a'),mk('b')],['a'],true);
  assert.deepEqual(next[0].outcomes,{used:1,usable:1});
  assert.equal(next[1].outcomes,undefined,'没用到的技能不该被记账');
});

test('没做成也要记 —— 只记成功等于只看好消息',()=>{
  const next=s.recordSkillOutcome([mk('a',{used:3,usable:3})],['a'],false);
  assert.deepEqual(next[0].outcomes,{used:4,usable:3});
});

test('样本不足返回 -1：不当成 0（判它有罪）也不当成 1（新技能天然第一）',()=>{
  assert.equal(s.successRate(mk('new')),-1);
  assert.equal(s.successRate(mk('few',{used:4,usable:4})),-1);
  assert.equal(s.successRate(mk('enough',{used:5,usable:4})),0.8);
});

test('排序先看做成率，再看频次 —— 用得多不等于用得对',()=>{
  const often=mk('often',{used:10,usable:2},999);
  const good=mk('good',{used:10,usable:9},1);
  assert.deepEqual(s.matchSkills([often,good],'').map(x=>x.name),['good','often']);
});

test('有数据的排在没数据的前面，没数据的之间仍按频次',()=>{
  const proven=mk('proven',{used:8,usable:5},1);
  const fresh=mk('fresh',undefined,50), fresher=mk('fresher',undefined,5);
  assert.deepEqual(s.matchSkills([fresher,fresh,proven],'').map(x=>x.name),['proven','fresh','fresher']);
});

test('名字前缀命中仍然压过一切 —— 用户打出来的字最硬',()=>{
  const proven=mk('zzz',{used:9,usable:9},99), typed=mk('abc',{used:9,usable:1},0);
  assert.equal(s.matchSkills([proven,typed],'ab')[0].name,'abc');
});

test('空名单不动',()=>{
  const list=[mk('a')];
  assert.equal(s.recordSkillOutcome(list,[],true),list);
});
