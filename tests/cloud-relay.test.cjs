const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCloudRelay}=require('../electron/cloud-relay.cjs');
const {createRunStore}=require('../electron/run-store.cjs');

const TASK='0f8f1c2e-8a5b-4f7e-9d61-3b2a1c0d9e8f';
function setup({signedIn=true,runResult={status:'completed',text:'答案'},tasks=[]}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-'));
  const calls=[],store=createRunStore(path.join(dir,'runs'));
  const queue=[...tasks];
  const account={signedIn:()=>signedIn,async relay(p,method,body){calls.push({p,method,body});
    if(p.endsWith('/claim'))return {task:queue.shift()||null};
    return {ok:true};}};
  const runs=[];
  const runner={async run(args){runs.push({args,record:store.list().find(r=>r.id===args.runId)});return typeof runResult==='function'?runResult():runResult;}};
  const clients={async restore(){return [{kind:'claude',status:'ready',models:[{id:'default',label:'默认',efforts:[]}]},{kind:'codex',status:'login_required',models:[]}];}};
  const relay=createCloudRelay({userData:dir,account,clients,runner,store,hostname:'pc',pollMs:60000});
  return {dir,calls,store,relay,runs};
}

test('默认关闭，未登录不能打开', async () => {
  const {relay,calls}=setup({signedIn:false});
  assert.equal(relay.state().enabled,false);
  await relay.tick();
  assert.equal(calls.length,0);
  await assert.rejects(relay.setEnabled(true),/登录云账号/);
});

test('打开后上报在线并领取、只做对话、交回结果', async () => {
  const {relay,calls,store,runs,dir}=setup({tasks:[{id:TASK,title:'问个问题',goal:'## User\n你好',client:{kind:'claude',model:'opus',effort:'high'}}]});
  await relay.setEnabled(true);relay.stop();
  await relay.idle();
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
  await relay.setEnabled(true);relay.stop();await relay.idle();
  const block=calls.find(c=>c.p.endsWith('/block'));
  assert.equal(block.body.reason,'未登录');
  assert.equal(calls.some(c=>c.p.endsWith('/submit')),false);
});

test('上次退出时未完成的任务报告受阻，不重跑', async () => {
  const {relay,calls,store,runs}=setup();
  store.save({id:'relay-'+TASK,relayTaskId:TASK,conversationId:'cloud-relay',answerId:'a',question:{id:'q',role:'user',content:'x',createdAt:1},config:{client:{kind:'claude',model:'default'},toolsEnabled:false},state:{working:[],status:'running'}});
  await relay.setEnabled(true);relay.stop();await relay.idle();
  const block=calls.find(c=>c.p===`/api/cloud/relay/tasks/${TASK}/block`);
  assert.match(block.body.reason,/未自动重跑/);
  assert.equal(runs.length,0);
  assert.equal(store.list().length,0);
});
