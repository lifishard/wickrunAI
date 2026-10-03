const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCloudRelay}=require('../electron/cloud-relay.cjs');
const {createRunStore}=require('../electron/run-store.cjs');

const TASK='0f8f1c2e-8a5b-4f7e-9d61-3b2a1c0d9e8f';
function setup({signedIn=true,runResult={status:'completed',text:'答案'},tasks=[],requestHook}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-'));
  const calls=[],store=createRunStore(path.join(dir,'runs'));
  const queue=[...tasks];
  const remote=new Map(tasks.map(task=>[task.id,{...task,status:'waiting'}]));
  const account={signedIn:()=>signedIn,async relay(p,method,body){calls.push({p,method,body});
    const intercepted=await requestHook?.(p,method,body);
    if(intercepted!==undefined)return intercepted;
    if(p.endsWith('/claim')){const task=queue.shift();if(task){const row=remote.get(task.id);row.status='working';row.claimedBy=`device:${body.device}`;return {task:{...row}};}return {task:null};}
    const match=/\/tasks\/([^/]+)(?:\/(.+))?$/.exec(p);
    if(match){
      const row=remote.get(match[1])||{id:match[1],status:'working'};remote.set(row.id,row);
      if(method==='GET')return {task:{...row}};
      if(!['working','waiting'].includes(row.status))throw Object.assign(Error('Task already finished.'),{status:409});
      if(match[2]==='cancel')row.status='cancelled';
      if(match[2]==='submit')row.status='completed';
      if(match[2]==='block')row.status='blocked';
      return {task:{...row}};
    }
    return {ok:true};}};
  const runs=[],aborts=[];
  const runner={async run(args){runs.push({args,record:store.list().find(r=>r.id===args.runId)});return typeof runResult==='function'?runResult():runResult;},abort(id){aborts.push(id);}};
  const clients={async restore(){return [{kind:'claude',status:'ready',models:[{id:'default',label:'默认',efforts:[]}]},{kind:'codex',status:'login_required',models:[]}];}};
  const relay=createCloudRelay({userData:dir,account,clients,runner,store,hostname:'pc',pollMs:60000});
  return {dir,calls,store,relay,runs,aborts,remote,runner};
}
const task=()=>({id:TASK,title:'x',goal:'g',client:{kind:'claude',model:'default'}});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('condition did not settle');}

test('默认关闭，未登录不能打开', async () => {
  const {relay,calls}=setup({signedIn:false});
  assert.equal(relay.state().enabled,false);
  await relay.tick();
  assert.equal(calls.length,0);
  await assert.rejects(relay.setEnabled(true),/登录云账号/);
});

test('打开后上报在线并领取、只做对话、交回结果', async () => {
  const {relay,calls,store,runs,dir}=setup({tasks:[{id:TASK,title:'问个问题',goal:'## User\n你好',client:{kind:'claude',model:'opus',effort:'high'}}]});
  await relay.setEnabled(true);await relay.idle();relay.stop();
  const beat=calls.find(c=>c.p==='/api/cloud/relay/devices/heartbeat');
  assert.equal(beat.body.kind,'desktop');
  assert.deepEqual(beat.body.clients.map(c=>[c.kind,c.ready]),[['claude',true],['codex',false]],'未登录的客户端也报上去，网页版提示去登录');
  assert.match(beat.body.device,/^desktop-[0-9a-f]{12}$/);
  const claim=calls.find(c=>c.p.endsWith('/claim'));
  assert.deepEqual(claim.body.kinds,['claude']);
  assert.equal(runs.length,1);
  assert.equal(runs[0].args.prompt,'## User\n你好');
  assert.equal(runs[0].record.config.toolsEnabled,false);
  assert.deepEqual(runs[0].record.config.client,{kind:'claude',model:'opus',effort:'high'});
  const submit=calls.find(c=>c.p===`/api/cloud/relay/tasks/${TASK}/submit`);
  assert.equal(submit.body.text,'答案');
  assert.equal(submit.body.device,beat.body.device);
  assert.equal(store.list().length,0,'执行记录用完即删');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'cloud-relay.json'),'utf8')).enabled,true);
  await relay.setEnabled(false);
  assert.equal(relay.state().enabled,false);
});

test('客户端失败时报告受阻', async () => {
  const {relay,calls}=setup({runResult:{status:'failed',error:'未登录'},tasks:[{id:TASK,title:'x',goal:'g',client:{kind:'claude',model:'default'}}]});
  await relay.setEnabled(true);await relay.idle();relay.stop();
  const block=calls.find(c=>c.p.endsWith('/block'));
  assert.equal(block.body.reason,'未登录');
  assert.equal(calls.some(c=>c.p.endsWith('/submit')),false);
});

test('上次退出时未完成的任务报告受阻，不重跑', async () => {
  const {relay,calls,store,runs}=setup();
  store.save({id:'relay-'+TASK,relayTaskId:TASK,conversationId:'cloud-relay',answerId:'a',question:{id:'q',role:'user',content:'x',createdAt:1},config:{client:{kind:'claude',model:'default'},toolsEnabled:false},state:{working:[],status:'running'}});
  await relay.setEnabled(true);await relay.idle();relay.stop();
  const block=calls.find(c=>c.p===`/api/cloud/relay/tasks/${TASK}/block`);
  assert.match(block.body.reason,/未自动重跑/);
  assert.equal(runs.length,0);
  assert.equal(store.list().length,0);
});

test('disabling aborts the active runner, waits for it to settle, and discards late success',async t=>{
  const result=deferred(),f=setup({tasks:[task()],runResult:()=>result.promise});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  const state=await f.relay.setEnabled(false);
  assert.equal(state.enabled,false);assert.equal(state.current.status,'stopping');
  assert.deepEqual(f.aborts,['relay-'+TASK]);assert.equal(f.relay.busy(),true);
  result.resolve({status:'completed',text:'late output'});await f.relay.idle();
  assert.equal(f.calls.some(c=>c.p.endsWith('/submit')),false);
  assert.equal(f.calls.filter(c=>c.p.endsWith('/cancel')).length,1);
  assert.equal(f.relay.state().last.status,'cancelled');assert.equal(f.relay.busy(),false);
  assert.equal(f.store.list().length,0);
});

test('stop cancels active work even when the saved enabled preference stays on',async t=>{
  const result=deferred(),f=setup({tasks:[task()],runResult:()=>result.promise});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  f.relay.stop();f.relay.stop();
  assert.deepEqual(f.aborts,['relay-'+TASK]);
  assert.equal(f.relay.state().enabled,true);
  result.resolve({status:'failed',error:'aborted'});await f.relay.idle();
  assert.equal(f.calls.some(c=>c.p.endsWith('/block')||c.p.endsWith('/submit')),false);
  const count=f.calls.length;await f.relay.tick();assert.equal(f.calls.length,count);
});

test('cloud cancellation is polled through the existing task GET and aborts local work',async t=>{
  const result=deferred(),f=setup({tasks:[task()],runResult:()=>result.promise});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  f.remote.get(TASK).status='cancelled';await f.relay.tick();
  assert.deepEqual(f.aborts,['relay-'+TASK]);
  result.resolve({status:'completed',text:'ignored'});await f.relay.idle();
  assert.equal(f.calls.some(c=>c.p.endsWith('/submit')||c.p.endsWith('/block')||c.p.endsWith('/cancel')),false);
  assert.equal(f.relay.state().last.status,'cancelled');assert.equal(f.store.list().length,0);
});

test('a fast completed result checks remote cancellation before submitting',async t=>{
  let f;f=setup({tasks:[task()],runResult:()=>{f.remote.get(TASK).status='cancelled';return {status:'completed',text:'late'};}});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await f.relay.idle();
  assert.equal(f.calls.some(c=>c.p.endsWith('/submit')),false);
  assert.equal(f.relay.state().last.status,'cancelled');
});

test('a claim arriving after disable is cancelled without invoking the runner',async t=>{
  const claim=deferred(),f=setup({requestHook:p=>p.endsWith('/claim')?claim.promise:undefined});t.after(()=>f.relay.close());
  const enabling=f.relay.setEnabled(true);await until(()=>f.calls.some(c=>c.p.endsWith('/claim')));
  await f.relay.setEnabled(false);assert.equal(f.relay.busy(),true);
  claim.resolve({task:task()});await enabling;await f.relay.idle();
  assert.equal(f.runs.length,0);assert.equal(f.calls.some(c=>c.p.endsWith('/cancel')),true);
  assert.equal(f.relay.state().last.status,'cancelled');assert.equal(f.relay.busy(),false);
});

test('stop during progress reporting prevents dispatch after the response arrives',async t=>{
  const progress=deferred(),f=setup({tasks:[task()],requestHook:p=>p.endsWith('/progress')?progress.promise:undefined});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.calls.some(c=>c.p.endsWith('/progress')));
  f.relay.stop();progress.resolve({ok:true});await f.relay.idle();
  assert.equal(f.runs.length,0);assert.equal(f.calls.some(c=>c.p.endsWith('/submit')),false);
  assert.equal(f.relay.state().last.status,'cancelled');
});

test('failed cancellation is retained and retried on enable without replaying the runner',async t=>{
  let offline=true;const result=deferred(),f=setup({tasks:[task()],runResult:()=>result.promise,requestHook:p=>{if(p.endsWith('/cancel')&&offline)throw Error('offline');}});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  await f.relay.setEnabled(false);result.resolve({status:'completed',text:'late'});await f.relay.idle();
  assert.equal(f.store.list().length,1);assert.match(f.relay.state().error,/云端取消尚未确认/);
  assert.ok(f.store.job('relay-'+TASK,'relay-cancel'));
  offline=false;await f.relay.setEnabled(true);await f.relay.idle();
  assert.equal(f.store.list().length,0);assert.equal(f.runs.length,1);
  assert.equal(f.calls.some(c=>c.p.endsWith('/submit')),false);
  assert.equal(f.remote.get(TASK).status,'cancelled');
});

test('a failed recovery report keeps the journal instead of silently losing it',async t=>{
  const f=setup({requestHook:p=>{if(p.endsWith('/block'))throw Error('offline');}});t.after(()=>f.relay.close());
  f.store.save({id:'relay-'+TASK,relayTaskId:TASK,conversationId:'cloud-relay',answerId:'a',question:{id:'q',role:'user',content:'x',createdAt:1},config:{client:{kind:'claude',model:'default'},toolsEnabled:false},state:{status:'running',working:[]}});
  await f.relay.setEnabled(true);await f.relay.idle();
  assert.equal(f.store.list().length,1);assert.equal(f.runs.length,0);
  assert.equal(f.calls.some(c=>c.p.endsWith('/claim')),false);
  assert.match(f.relay.state().error,/记录已保留/);
});

test('a late submit response cannot replace the local cancellation status',async t=>{
  const submitted=deferred(),f=setup({tasks:[task()],requestHook:p=>p.endsWith('/submit')?submitted.promise:undefined});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.calls.some(c=>c.p.endsWith('/submit')));
  await f.relay.setEnabled(false);submitted.resolve({ok:true});await f.relay.idle();
  assert.equal(f.relay.state().last.status,'cancelled');assert.equal(f.store.list().length,0);
});

test('cancelled tasks removed before polling still stop the local runner',async t=>{
  let removed=false;const result=deferred(),f=setup({tasks:[task()],runResult:()=>result.promise,requestHook:(p,method)=>{
    if(removed&&method==='GET'&&p.endsWith(TASK))throw Object.assign(Error('not found'),{status:404});
  }});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  removed=true;await f.relay.tick();assert.deepEqual(f.aborts,['relay-'+TASK]);
  result.resolve({status:'completed',text:'late'});await f.relay.idle();
  assert.equal(f.calls.some(c=>c.p.endsWith('/submit')),false);assert.equal(f.store.list().length,0);
});

test('a stale poll response does not cancel a run after it already finished',async t=>{
  const result=deferred(),poll=deferred();let pollOnce=false;
  const f=setup({tasks:[task()],runResult:()=>result.promise,requestHook:(p,method)=>{
    if(pollOnce&&method==='GET'&&p.endsWith(TASK)){pollOnce=false;return poll.promise;}
  }});t.after(()=>f.relay.close());
  await f.relay.setEnabled(true);await until(()=>f.runs.length===1);
  pollOnce=true;const polling=f.relay.tick();
  result.resolve({status:'completed',text:'ok'});await f.relay.idle();
  poll.resolve({task:{id:TASK,status:'completed'}});await polling;
  assert.equal(f.relay.state().last.status,'completed');assert.deepEqual(f.aborts,[]);
  assert.equal(f.store.list().length,0);
});
