'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const file=p=>path.resolve(__dirname,'..',p);
const s=loader({'./transport':{getTransport(){throw Error('not used');}},'./store':{uid:()=> 'fixture-id'},'./i18n':{tr:text=>text}})(file('src/lib/skills.ts'));

const skill=(name,len,description='把交付写成清单')=>({id:name,name,description,
  body:`# ${name}\n开头这段说明这个技能是干什么的。\n`+'规范正文。'.repeat(Math.max(0,Math.ceil(len/5))),
  source:'手写',enabled:true,installedAt:1,uses:0});
const short=skill('tiny',100), long=skill('stop-slop',20000);

test('短技能照旧整份进 system',()=>{
  const block=s.skillSystemBlock([short]);
  assert.ok(block.includes(short.body),'短的不该被折叠');
  assert.doesNotMatch(block,/folded="true"/);
  assert.deepEqual(s.foldedSkillNames([short]),[]);
});

test('超限的折叠，正文不进前缀',()=>{
  const block=s.skillSystemBlock([long]);
  assert.match(block,/folded="true"/);
  assert.ok(!block.includes(long.body),'正文不该整份进 system');
  assert.ok(block.length<long.body.length/4,'折叠后应当显著更短');
  assert.deepEqual(s.foldedSkillNames([long]),['stop-slop']);
});

test('折叠保留判断要不要取回所需的信息 —— 不是只放代号',()=>{
  const block=s.skillSystemBlock([long]);
  assert.ok(block.includes('stop-slop'),'要有名字');
  assert.ok(block.includes('把交付写成清单'),'要有描述，否则模型只能每个都取一遍');
  assert.ok(block.includes('开头这段说明这个技能是干什么的'),'要有开头');
  assert.match(block,/read_skill\(name="stop-slop"\)/,'要告诉它怎么取回');
  assert.match(block,/不能当作已知/,'要挡住「我猜里面写了什么」');
});

test('取回正文，并且能分页',()=>{
  const r=s.readSkill([long],{name:'stop-slop',limit:500});
  assert.equal(r.ok,true);
  const page=JSON.parse(r.content);
  assert.equal(page.total,long.body.length);
  assert.equal(page.text,long.body.slice(0,500));
  assert.equal(page.nextOffset,500);
  const rest=JSON.parse(s.readSkill([long],{name:'stop-slop',offset:500,limit:500}).content);
  assert.equal(rest.text,long.body.slice(500,1000));
  const tail=JSON.parse(s.readSkill([short],{name:'tiny'}).content);
  assert.equal(tail.nextOffset,null,'读完了就没有下一页');
});

test('取一个本轮没唤起的技能：如实报错并列出有哪些',()=>{
  const r=s.readSkill([long],{name:'不存在的'});
  assert.equal(r.ok,false);
  assert.match(r.error,/stop-slop/,'要告诉它本轮实际有哪些，别让它乱猜');
});

test('阈值可调，边界按正文长度算',()=>{
  assert.deepEqual(s.foldedSkillNames([short],50),['tiny']);
  assert.deepEqual(s.foldedSkillNames([long],1e9),[]);
});

test('多个技能时折叠只影响超限的那个',()=>{
  const block=s.skillSystemBlock([short,long]);
  assert.ok(block.includes(short.body),'短的仍然整份在');
  assert.ok(!block.includes(long.body));
  assert.deepEqual(s.foldedSkillNames([short,long]),['stop-slop']);
});

test('停用技能不注入也不能按本轮技能读取',()=>{
  const disabled={...short,enabled:false};
  assert.equal(s.skillSystemBlock([disabled]),'');
  assert.deepEqual(s.foldedSkillNames([{...long,enabled:false}]),[]);
  const read=s.readSkill([disabled],{name:disabled.name});
  assert.equal(read.ok,false);assert.match(read.error,/没有启用/);
});

test('技能块标明来源，并声明当前要求和验收优先',()=>{
  const sourced={...short,source:'github:owner/repo/skills/tiny'};
  const block=s.skillSystemBlock([sourced]);
  assert.match(block,/来源：github:owner\/repo\/skills\/tiny/);
  assert.match(block,/当前用户要求、项目规范和明确验收条件优先/);
  assert.match(block,/不是任务已完成的证据/);
});

/* ---- 压缩后重新读回正在改的文件（2.5.1） ---- */
const cm=loader()(file('src/lib/context-memory.ts'));
const step=(id,files)=>({id,callId:id,name:'write_file',status:'ok',files});
const out=p=>({path:p,direction:'output'});

test('只挑本次真正写出去的文件，最近的排前面',()=>{
  const state={steps:[step('s1',[out('a.ts')]),step('s2',[out('b.ts')]),step('s3',[out('c.ts')])]};
  assert.deepEqual(cm.recentOutputFiles(state),['c.ts','b.ts','a.ts']);
});

test('读进来的文件不算 —— 重读的是「我改了什么」，不是「我看过什么」',()=>{
  const state={steps:[step('s1',[{path:'read-only.md',direction:'input'}]),step('s2',[out('written.ts')])]};
  assert.deepEqual(cm.recentOutputFiles(state),['written.ts']);
});

test('同一个文件改了多次只算一次',()=>{
  const state={steps:[step('s1',[out('a.ts')]),step('s2',[out('a.ts')]),step('s3',[out('b.ts')])]};
  assert.deepEqual(cm.recentOutputFiles(state),['b.ts','a.ts']);
});

test('有上限，且默认很小 —— 重读的量必须远小于刚腾出来的量',()=>{
  const state={steps:Array.from({length:10},(_,i)=>step(`s${i}`,[out(`f${i}.ts`)]))};
  assert.equal(cm.recentOutputFiles(state).length,3);
  assert.deepEqual(cm.recentOutputFiles(state),['f9.ts','f8.ts','f7.ts']);
  assert.equal(cm.recentOutputFiles(state,1).length,1);
});

test('没写过任何文件就不重读',()=>{
  assert.deepEqual(cm.recentOutputFiles({steps:[]}),[]);
  assert.deepEqual(cm.recentOutputFiles({}),[]);
  assert.deepEqual(cm.recentOutputFiles({steps:[step('s1',undefined)]}),[]);
});
