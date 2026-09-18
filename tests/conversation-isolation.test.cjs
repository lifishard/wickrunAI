const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');

const load=loader();
const src=(f)=>path.join(__dirname,'..','src',f);
const {conversationQueue,nextQueuedIndex}=load(src('lib/run-queue.ts'));
const {teamNotifications}=load(src('lib/team-notify.ts'));

const input=(text,conversationId)=>({text,conversationId,attachments:[],quotes:[],quoteOnly:false});

test('排队输入只属于自己的会话', () => {
  const queue=[input('给 A 的','a'),input('给 B 的','b'),input('再给 A','a')];
  assert.deepEqual(conversationQueue(queue,'a').map(e=>[e.item.text,e.index]),[['给 A 的',0],['再给 A',2]]);
  assert.deepEqual(conversationQueue(queue,'b').map(e=>[e.item.text,e.index]),[['给 B 的',1]]);
  // 没有会话就什么也不显示，不该把别人的队列端过来
  assert.deepEqual(conversationQueue(queue,null),[]);
});

test('老数据里没写会话的条目归当前会话', () => {
  const queue=[input('旧的',null)];
  assert.equal(conversationQueue(queue,'a').length,1);
  assert.equal(nextQueuedIndex(queue,{activeId:'a',busyIds:[],pausedIds:[]}),0);
});

test('别的会话在跑不阻塞本会话的队列', () => {
  const queue=[input('给 A 的','a'),input('给 B 的','b')];
  // A 正在跑：A 的那条等着，B 的那条照发
  assert.equal(nextQueuedIndex(queue,{activeId:'a',busyIds:['a'],pausedIds:[]}),1);
  // 两个都在跑才没得发
  assert.equal(nextQueuedIndex(queue,{activeId:'a',busyIds:['a','b'],pausedIds:[]}),-1);
});

test('挂起只挂自己那条队列', () => {
  const queue=[input('给 A 的','a'),input('给 B 的','b')];
  assert.equal(nextQueuedIndex(queue,{activeId:'a',busyIds:[],pausedIds:['a']}),1);
  assert.equal(nextQueuedIndex(queue,{activeId:'a',busyIds:[],pausedIds:['a','b']}),-1);
});

const run=(id,status,taskId='t1')=>({id,status,taskId,goal:'目标',events:[{text:`${id} 到了 ${status}`}]});
const data=(runs)=>({projects:{p1:{id:'p1',runs,tasks:[{id:'t1',title:'季度复盘'}]}}});

test('协作空间首次观察不补发历史通知', () => {
  const seen=new Map();
  assert.deepEqual(teamNotifications(seen,data([run('r1','completed')]),true),[]);
  assert.equal(seen.get('r1'),'completed');
  // 状态没变就不再发
  assert.deepEqual(teamNotifications(seen,data([run('r1','completed')])),[]);
});

test('协作空间状态变化映射到与单 Agent 一致的通知类型', () => {
  const seen=new Map();
  teamNotifications(seen,data([run('r1','running')]),true);
  const [waiting]=teamNotifications(seen,data([run('r1','waiting_user')]));
  assert.equal(waiting.kind,'question');
  assert.equal(waiting.projectId,'p1');
  assert.match(waiting.body,/季度复盘/);
  assert.equal(teamNotifications(seen,data([run('r1','failed')]))[0].kind,'error');
  assert.equal(teamNotifications(seen,data([run('r1','uncertain')]))[0].kind,'paused');
  assert.equal(teamNotifications(seen,data([run('r1','completed')]))[0].kind,'completed');
  // 用户自己取消的不打扰
  assert.deepEqual(teamNotifications(seen,data([run('r1','cancelled')])),[]);
});

const {normalizeRoot,overlaps,holdersOf,claimRoots,releaseRoots,resetClaims}=load(src('lib/workspace-guard.ts'));

test('工作目录重叠判定跨平台一致', () => {
  assert.equal(normalizeRoot('C:\\Users\\me\\proj\\'),'c:/users/me/proj');
  assert.ok(overlaps('C:\\Users\\me\\proj','c:/users/me/proj/src'));
  assert.ok(overlaps('/home/me/proj/src','/home/me/proj'));
  assert.ok(!overlaps('/home/me/proj','/home/me/project'));
  assert.ok(!overlaps('/home/me/a','/home/me/b'));
});

test('两个会话不能同时占同一棵目录树', (t) => {
  t.after(resetClaims);
  resetClaims();
  claimRoots('a',['C:\\work\\repo']);
  assert.deepEqual(holdersOf('b',['C:\\work\\repo\\src']),['a']);
  // 自己不挡自己
  assert.deepEqual(holdersOf('a',['C:\\work\\repo\\src']),[]);
  // 不相干的目录照跑
  assert.deepEqual(holdersOf('b',['C:\\work\\other']),[]);
  releaseRoots('a');
  assert.deepEqual(holdersOf('b',['C:\\work\\repo\\src']),[]);
});

test('只读运行不登记也不被挡', (t) => {
  t.after(resetClaims);
  resetClaims();
  claimRoots('a',[]);
  assert.deepEqual(holdersOf('b',['C:\\work\\repo']),[]);
});

const {translate}=load(src('lib/i18n.ts'));

test('简体是源文案，繁体自动转换，英文查词典', () => {
  assert.equal(translate('zh-Hans','＋ 新对话'),'＋ 新对话');
  assert.equal(translate('zh-Hant','删除这个对话？'),'刪除這個對話？');
  assert.equal(translate('en','＋ 新对话'),'+ New chat');
});

test('英文查不到就退回简体，界面不会缺字', () => {
  assert.equal(translate('en','这句没进词典'),'这句没进词典');
  assert.equal(translate('zh-Hant','这句没进词典'),'這句沒進詞典');
});

test('插值在三种语言里都生效', () => {
  assert.equal(translate('zh-Hans','已配 {n} 个，再加一个',{n:3}),'已配 3 个，再加一个');
  assert.equal(translate('en','已配 {n} 个，再加一个',{n:3}),'3 set. Add another.');
  assert.match(translate('zh-Hant','已配 {n} 个，再加一个',{n:3}),/3/);
});
