const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');const {createCollaborationStore}=require('../electron/collaboration-store.cjs');

/*
 * 实测：项目设置里的「批准方式」改不动 —— 下拉里选了新值，一失焦就弹回旧值，磁盘上永远是旧的。
 *
 * 根因不在存储层（存储层接受这次改动，见下面第一个用例），而在 `runtime.update()` 的时序：
 * 它先同步 `emit()` 再把回调排到 promise 里跑。emit 会立刻重渲染，把受控 <select> 的
 * DOM 值按 store 里的旧值复位；等回调真正执行时再去读 `e.target.value`，读到的已经是复位后的旧值，
 * 于是把旧值原样写回 —— 看上去就是「点了没反应」。
 *
 * 所以事件里的值必须在调用 update 之前就取出来。数字输入框一直是好的，正是因为它本来就先
 * `const value=Number(e.target.value)` 再调 update。
 */

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-team-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createCollaborationStore(root);
  const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(rev,p)=>store.update(rev,p),collaborationClaim:async(p,id)=>store.claim(p,id),toolAbort:async()=>{}};
  const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=>'fake-local-fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
    './transport':{desktop:()=>bridge},'./agent':{runAgent(){return {abort(){}};}}});
  const {TeamRuntime}=load(path.resolve('src/lib/team-runtime.ts')),domain=load(path.resolve('src/lib/collaboration.ts'));
  return {runtime:new TeamRuntime(),domain};
}

test('存储层本来就接受改批准方式：这个 bug 不在存储层',async t=>{
  const f=fixture(t);await f.runtime.load();
  await f.runtime.update('p',p=>Object.assign(p,f.domain.emptyTeamProject('p')));
  await f.runtime.update('p',p=>{p.settings.approvalMode='all';});
  assert.equal(f.runtime.project('p').settings.approvalMode,'all');
});

test('update 的回调是延后跑的，而且它先通知了一次重渲染——事件里的值必须提前取出来',async t=>{
  const f=fixture(t);await f.runtime.load();
  await f.runtime.update('p',p=>Object.assign(p,f.domain.emptyTeamProject('p')));
  let notifiedBeforeCallback=false,callbackRan=false;
  f.runtime.subscribe(()=>{if(!callbackRan)notifiedBeforeCallback=true;});
  const pending=f.runtime.update('p',p=>{callbackRan=true;p.settings.maxConcurrent=3;});
  assert.equal(callbackRan,false,'回调不是同步执行的');
  assert.equal(notifiedBeforeCallback,true,'回调跑之前已经通知过重渲染：受控输入这时会被复位成旧值');
  await pending;
  assert.equal(f.runtime.project('p').settings.maxConcurrent,3);
});

test('协作界面里没有「在 update 回调里读 e.target」的写法',()=>{
  const files=['src/components/collaboration/TeamWorkspace.tsx','src/components/collaboration/WorkflowDesigner.tsx'];
  const offenders=[];
  for(const file of files){
    const source=fs.readFileSync(path.resolve(file),'utf8');
    // update( ... ) 的回调体里出现 e.target —— 这个值到执行时已经被重渲染复位了
    for(const m of source.matchAll(/update\((?:projectId,)?\s*p?\s*=>\s*\{([^{}]|\{[^{}]*\})*?e\.target/g))
      offenders.push(`${file}: …${m[0].slice(-90)}`);
  }
  assert.deepEqual(offenders,[],'事件值要在调用 update 之前取出来，例如 const mode=e.target.value');
});
