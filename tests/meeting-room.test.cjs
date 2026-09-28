'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMeetingRooms}=require('../electron/meeting-room.cjs');
const {createNativeAiBridge}=require('../electron/native-ai-bridge.cjs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-meeting-'));
  t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'wickrun-meeting-')));fs.rmSync(root,{recursive:true,force:true});});
  const notifications=[];
  const service=createMeetingRooms({userData:root,onQuestion:q=>notifications.push(q)});
  const room=service.host('create',{projectId:'project-one',title:'比较方案',purpose:'明确取舍并提出可验证的下一步',material:'预算尚未决定',participants:['claude-desktop','chatgpt']});
  const host=(action,input={})=>service.host(action,{roomId:room.id,...input});
  const rpc=(p,method,args={})=>service.rpc(p,method,{roomId:room.id,...args});
  const invite=(p,input={})=>host('invite',{provider:p,focus:'阅读材料，提出建设性建议',...input});
  const contribute=(p,i,input={})=>rpc(p,'meeting_post',{invitationId:i.id,kind:'viewpoint',text:'建议先用小规模试验验证关键假设。',...input});
  return {root,service,room,host,rpc,invite,contribute,notifications};
}

test('two clients read, disagree with a specific statement, revise and pass; transcript survives restart',t=>{
  const f=fixture(t),a=f.invite('claude-desktop');
  assert.throws(()=>f.contribute('claude-desktop',a),/先.*读取/);
  f.rpc('claude-desktop','meeting_read');const first=f.contribute('claude-desktop',a).message;
  const b=f.invite('chatgpt',{replyTo:first.id});const read=f.rpc('chatgpt','meeting_read');
  assert.equal(read.room.messages.find(m=>m.id===first.id).author,'claude-desktop');
  assert.match(read.rules,/不强迫共识/);assert.match(read.rules,/质检/);
  const objection=f.contribute('chatgpt',b,{kind:'concern',replyTo:first.id,text:'我理解先试验的建议。预算未知，建议先确认投入上限再确定规模。'}).message;
  const c=f.invite('claude-desktop',{replyTo:objection.id});f.rpc('claude-desktop','meeting_read');
  f.contribute('claude-desktop',c,{kind:'response',text:'接受这个补充，我将方案调整为先确认预算。'});
  const d=f.invite('chatgpt');f.rpc('chatgpt','meeting_read');f.contribute('chatgpt',d,{kind:'pass',text:'暂无新的补充，预算仍需用户决定。'});
  const restored=createMeetingRooms({userData:f.root}).state('project-one')[0];
  assert.equal(restored.messages.length,8);assert.equal(restored.messages[3].replyTo,first.id);assert.equal(restored.messages[7].kind,'pass');
  assert.equal(restored.minutes,undefined);assert.deepEqual(f.service.state('different-project'),[]);
});

test('questions are public, decisions require human input and independent discussion remains possible',t=>{
  const f=fixture(t),a=f.invite('chatgpt');f.rpc('chatgpt','meeting_read');
  const args={invitationId:a.id,text:'预算上限是多少？',reason:'试验范围取决于可投入预算。',options:[{label:'小规模',impact:'成本低，覆盖有限'},{label:'扩大试验',impact:'覆盖更全面，需要更多投入'}],recommendation:'建议从小规模开始。'};
  f.rpc('chatgpt','meeting_ask_user',args);f.rpc('chatgpt','meeting_ask_user',args);
  assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].projectId,'project-one');
  let r=f.service.state('project-one')[0],q=r.questions[0];
  assert.equal(q.status,'pending');assert.equal(r.messages[1].kind,'ask_user');
  assert.throws(()=>f.host('phase',{phase:'decision'}),/等待你决定/);
  assert.throws(()=>f.host('minutes',{agreements:'所有人同意',basedOn:r.messages.length}),/等待你决定/);
  assert.throws(()=>f.invite('claude-desktop'),/等待你决定/);
  const other=f.invite('claude-desktop',{independent:true,focus:'讨论不依赖预算的评价指标'});f.rpc('claude-desktop','meeting_read');f.contribute('claude-desktop',other,{text:'评价指标可以先定义。'});
  assert.throws(()=>f.rpc('chatgpt','meeting_answer',{questionId:q.id,text:'同意'}),/不允许/);
  f.host('answer',{questionId:q.id,text:'先按小规模推进，上限另行确认',defer:true});
  r=f.service.state('project-one')[0];assert.equal(r.questions[0].status,'deferred');assert.equal(r.messages.at(-1).author,'user');
  assert.throws(()=>f.host('answer',{questionId:q.id,text:'重复回答'}),/已处理/);
  assert.throws(()=>f.invite('claude-desktop',{questionId:q.id}),/尚未回答/);
});

test('only invited identity can speak; duplicate, late and stale-phase contributions cannot rewrite records',t=>{
  const f=fixture(t),a=f.invite('claude-desktop');f.rpc('claude-desktop','meeting_read');
  assert.throws(()=>f.contribute('chatgpt',a),/不属于/);
  const first=f.contribute('claude-desktop',a);assert.equal(f.contribute('claude-desktop',a).message.id,first.message.id);
  assert.throws(()=>f.contribute('claude-desktop',a,{text:'改写原话'}),/不同的内容/);
  const b=f.invite('chatgpt');f.rpc('chatgpt','meeting_read');f.host('phase',{phase:'discussion'});
  assert.throws(()=>f.contribute('chatgpt',b),/撤回|阶段/);
  const solo=f.service.host('create',{projectId:'private',title:'仅一位成员',purpose:'测试隔离',participants:['claude-desktop']});
  assert.throws(()=>f.service.rpc('chatgpt','meeting_read',{roomId:solo.id}),/未获邀请/);
  assert.equal(f.service.rpc('chatgpt','meeting_list').rooms.some(r=>r.id===solo.id),false);
  assert.throws(()=>f.host('post',{text:'不存在的引用',replyTo:'missing'}),/不存在/);
});

test('new user questions block an already reading participant; host answer is read before continuation',t=>{
  const f=fixture(t),a=f.invite('claude-desktop'),b=f.invite('chatgpt');
  f.rpc('claude-desktop','meeting_read');f.rpc('chatgpt','meeting_read');
  f.rpc('claude-desktop','meeting_ask_user',{invitationId:a.id,text:'先做哪个方向？',reason:'需要确定优先级',options:[]});
  assert.throws(()=>f.contribute('chatgpt',b),/用户|等待/);
  const q=f.service.state('project-one')[0].questions[0];
  f.host('answer',{questionId:q.id,text:'先做方向 A'});
  assert.throws(()=>f.contribute('chatgpt',b),/新的用户答复/);
  f.rpc('chatgpt','meeting_read');f.contribute('chatgpt',b,{kind:'response',text:'根据你的决定，先分析 A。'});
  const r=f.service.state('project-one')[0];assert.equal(r.messages.at(-1).basedOn,r.messages.length-1);
});

test('minutes require a current transcript and never change existing quality checks or approve tasks',t=>{
  const f=fixture(t),qa=path.join(f.root,'collaboration-v1.json');const original=JSON.stringify({runs:[{status:'waiting_user',review:{verdict:'fail'}}]});fs.writeFileSync(qa,original);
  const m={agreements:'同意继续调研，未批准执行',disagreements:'规模仍有分歧',openQuestions:'需要验证成本',actions:'由用户决定下一步',basedOn:0};
  f.host('post',{text:'补充一个约束'});assert.throws(()=>f.host('minutes',m),/新发言/);
  assert.throws(()=>f.rpc('chatgpt','meeting_minutes',m),/不允许/);
  f.host('minutes',{...m,basedOn:1});f.host('phase',{phase:'closed'});
  assert.throws(()=>f.host('post',{text:'会议结束后追加决定'}),/已结束/);
  assert.equal(f.service.state('project-one')[0].minutes.confirmedBy,'user');
  assert.equal(fs.readFileSync(qa,'utf8'),original);
});

test('bounded contributions stop even if models try to prolong the meeting',t=>{
  const f=fixture(t);
  for(let n=0;n<30;n++){const i=f.invite('chatgpt');f.rpc('chatgpt','meeting_read');f.contribute('chatgpt',i,{kind:'pass',text:'暂无补充'});}
  assert.throws(()=>f.invite('chatgpt'),/30 次/);
});

test('real stdio clients exchange a meeting contribution and decision question through the authenticated bridge',async t=>{
  const f=fixture(t);
  const bridge=createNativeAiBridge({userData:f.root,appData:path.join(f.root,'appdata'),getSettings:()=>({keyProfiles:[]}),secretGet:()=>{throw Error('Meetings must not call a model API');},openExternal:async()=>{},meetings:f.service,deps:{runtime:()=>process.execPath,claudeConfigFiles:()=>[path.join(f.root,'claude','config.json')]}});
  t.after(()=>bridge.close());
  const clients=[];
  for(const p of ['claude-desktop','chatgpt']){
    const config=await bridge.config(p),client=new Client({name:'fixture-'+p,version:'1.0.0'});
    await client.connect(new StdioClientTransport({...config,args:[...config.args,'--meetings-only'],stderr:'pipe'}));
    clients.push(client);t.after(()=>client.close());
    assert.deepEqual((await client.listTools()).tools.map(t=>t.name).sort(),['wickrun_meeting_ask_user','wickrun_meeting_list','wickrun_meeting_post','wickrun_meeting_read','wickrun_meeting_wait']);
  }
  const call=async(c,name,args)=>{const result=await c.callTool({name:'wickrun_'+name,arguments:{roomId:f.room.id,...args}});assert.notEqual(result.isError,true,result.content[0].text);return JSON.parse(result.content[0].text);};
  const a=f.invite('claude-desktop');await call(clients[0],'meeting_read',{});
  const first=await call(clients[0],'meeting_post',{invitationId:a.id,kind:'proposal',text:'建议先确定成功标准，再比较方案。'});
  const b=f.invite('chatgpt',{replyTo:first.message.id});const read=await call(clients[1],'meeting_read',{});
  assert.ok(read.room.messages.some(m=>m.id===first.message.id));
  await call(clients[1],'meeting_ask_user',{invitationId:b.id,text:'你最看重成本还是覆盖？',reason:'评价标准决定取舍',options:[{label:'成本',impact:'控制投入'},{label:'覆盖',impact:'扩大验证范围'}],replyTo:first.message.id});
  assert.equal(f.service.state('project-one')[0].questions[0].asker,'chatgpt');
  f.host('answer',{questionId:f.service.state('project-one')[0].questions[0].id,text:'优先控制成本'});
  f.host('auto_start',{rounds:1,focus:'根据用户决定提出改进'});
  const aw=call(clients[0],'meeting_wait',{}),bw=call(clients[1],'meeting_wait',{});
  const aTurn=await aw;assert.equal(aTurn.status,'invited');
  const aRead=await call(clients[0],'meeting_read',{});
  await call(clients[0],'meeting_post',{invitationId:aRead.invitation.id,kind:'response',text:'依据用户决定，优先控制成本。'});
  const bTurn=await bw;assert.equal(bTurn.status,'invited');
  const bRead=await call(clients[1],'meeting_read',{});
  await call(clients[1],'meeting_post',{invitationId:bRead.invitation.id,kind:'response',text:'补充一个低成本的验证办法。'});
  assert.equal(f.service.state('project-one')[0].auto.status,'completed');
});
