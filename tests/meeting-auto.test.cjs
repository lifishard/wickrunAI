'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createMeetingRooms}=require('../electron/meeting-room.cjs');
function setup(t,waitMs=1000){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-auto-'));
 const service=createMeetingRooms({userData:root,waitMs});
 t.after(()=>{service.close();assert.ok(root.startsWith(path.join(os.tmpdir(),'meeting-auto-')));fs.rmSync(root,{recursive:true,force:true});});
 const room=service.host('create',{projectId:'p',title:'共同改进方案',purpose:'比较依据并请用户决定',participants:['claude-desktop','chatgpt']});
 const host=(action,input={})=>service.host(action,{roomId:room.id,...input});
 const rpc=(p,method,args={})=>service.rpc(p,method,{roomId:room.id,...args});
 const state=()=>service.state('p')[0];
 const post=(p,kind='response')=>{const {invitation}=rpc(p,'meeting_read');return rpc(p,'meeting_post',{invitationId:invitation.id,kind,text:kind==='pass'?'暂无新的依据':'针对已有观点补充可验证的依据。'});};
 return {root,service,room,host,rpc,state,post};
}
test('two waiting clients receive alternating invitations without host intervention, bounded by rounds',async t=>{
 const f=setup(t);f.host('auto_start',{rounds:2,focus:'比较已有依据，提出改进'});
 const aWaiting=f.rpc('claude-desktop','meeting_wait');assert.equal(f.state().invitations.length,0);
 const bWaiting=f.rpc('chatgpt','meeting_wait');const a=await aWaiting;
 assert.equal(a.status,'invited');assert.equal(f.state().invitations.length,1);
 assert.throws(()=>f.rpc('claude-desktop','meeting_wait'),/已有参会/);
 const first=f.post('claude-desktop');const b=await bWaiting;
 assert.equal(b.status,'invited');assert.equal(f.state().invitations.at(-1).replyTo,first.message.id);
 const aNext=f.rpc('claude-desktop','meeting_wait',{sessionId:a.sessionId});
 f.post('chatgpt');assert.equal((await aNext).status,'invited');
 const bNext=f.rpc('chatgpt','meeting_wait',{sessionId:b.sessionId});
 f.post('claude-desktop');assert.equal((await bNext).status,'invited');f.post('chatgpt');
 assert.equal(f.state().auto.status,'completed');assert.equal(f.state().auto.remaining,0);
 assert.deepEqual(f.state().invitations.map(i=>i.provider),['claude-desktop','chatgpt','claude-desktop','chatgpt']);
 assert.equal((await f.rpc('chatgpt','meeting_wait',{sessionId:b.sessionId})).status,'stopped');
 assert.equal(f.state().minutes,undefined);
});
test('human question stops scheduling; human answer wakes waiting client with the exact latest decision',async t=>{
 const f=setup(t);f.host('auto_start',{rounds:2,focus:'需要用户决定时提问'});
 const aw=f.rpc('claude-desktop','meeting_wait'),bw=f.rpc('chatgpt','meeting_wait');const a=await aw;
 const {invitation}=f.rpc('claude-desktop','meeting_read');
 f.rpc('claude-desktop','meeting_ask_user',{invitationId:invitation.id,text:'选择哪个方向？',reason:'需要明确优先级',options:[]});
 const aw2=f.rpc('claude-desktop','meeting_wait',{sessionId:a.sessionId});
 assert.equal(f.state().invitations.length,1);assert.equal(f.state().auto.reason,'等待你决定');
 f.host('answer',{questionId:f.state().questions[0].id,text:'优先验证方案 A，不批准执行'});
 assert.equal((await bw).status,'invited');
 const bRead=f.rpc('chatgpt','meeting_read');assert.ok(bRead.room.messages.some(m=>m.kind==='decision'&&m.text==='优先验证方案 A，不批准执行'));
 f.post('chatgpt');assert.equal((await aw2).status,'invited');
 f.host('auto_pause');assert.equal(f.state().auto.status,'paused');
});
test('manual pause cancels pending invitations and resolves waits; old sessions cannot join a new round',async t=>{
 const f=setup(t);f.host('auto_start',{rounds:2,focus:'检查暂停'});
 const aw=f.rpc('claude-desktop','meeting_wait'),bw=f.rpc('chatgpt','meeting_wait'),a=await aw;
 const {invitation}=f.rpc('claude-desktop','meeting_read');f.host('auto_pause');
 assert.equal((await bw).status,'stopped');
 assert.throws(()=>f.rpc('claude-desktop','meeting_post',{invitationId:invitation.id,kind:'response',text:'迟到发言'}),/撤回/);
 f.host('auto_start',{rounds:1,focus:'重新开始'});
 assert.throws(()=>f.rpc('claude-desktop','meeting_wait',{sessionId:a.sessionId}),/已失效/);
 f.host('auto_pause');
});
test('all-pass rounds and restart never silently continue',async t=>{
 const f=setup(t);f.host('auto_start',{rounds:3,focus:'没有依据时明确暂无补充'});
 const aw=f.rpc('claude-desktop','meeting_wait'),bw=f.rpc('chatgpt','meeting_wait');await aw;f.post('claude-desktop','pass');await bw;f.post('chatgpt','pass');
 assert.equal(f.state().auto.status,'completed');assert.equal(f.state().invitations.length,2);
 f.host('auto_start',{rounds:1,focus:'检查重启'});
 const restored=createMeetingRooms({userData:f.root});t.after(()=>restored.close());
 assert.equal(restored.state('p')[0].auto.status,'paused');assert.match(restored.state('p')[0].auto.reason,/重启/);
});
test('deferring a decision or changing phase ends waiting clients instead of silently proceeding',async t=>{
 const f=setup(t);f.host('auto_start',{rounds:2,focus:'明确取舍'});
 const aw=f.rpc('claude-desktop','meeting_wait'),bw=f.rpc('chatgpt','meeting_wait');await aw;
 const {invitation}=f.rpc('claude-desktop','meeting_read');
 f.rpc('claude-desktop','meeting_ask_user',{invitationId:invitation.id,text:'是否扩展范围？',reason:'影响成本',options:[]});
 f.host('answer',{questionId:f.state().questions[0].id,text:'暂缓，先收集依据',defer:true});
 assert.equal((await bw).status,'stopped');assert.equal(f.state().auto.status,'paused');
 f.host('auto_start',{rounds:1,focus:'只补充依据'});const wait=f.rpc('claude-desktop','meeting_wait');
 f.host('phase',{phase:'discussion'});assert.equal((await wait).status,'stopped');
 assert.equal(f.state().questions[0].status,'deferred');
});
test('idle waits are bounded and paused clients cannot repeatedly rejoin to evade the bound',async t=>{
 const f=setup(t,2);f.host('auto_start',{rounds:1,focus:'另一成员尚未加入'});
 let result=await f.rpc('claude-desktop','meeting_wait');
 for(let i=1;i<8;i++)result=await f.rpc('claude-desktop','meeting_wait',{sessionId:result.sessionId});
 assert.equal(result.status,'stopped');assert.equal(f.state().auto.status,'paused');assert.equal(f.state().invitations.length,0);
 assert.equal((await f.rpc('claude-desktop','meeting_wait')).status,'stopped');
});
