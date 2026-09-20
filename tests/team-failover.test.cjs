const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');const {createCollaborationStore}=require('../electron/collaboration-store.cjs');

/** 跟 team-runtime.test.cjs 同一套夹具，只多一份接力名单。 */
function fixture(t,execute,failover,_opts){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-team-failover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createCollaborationStore(root),calls=[];
  const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(rev,p)=>store.update(rev,p),collaborationClaim:async(p,id)=>store.claim(p,id),toolAbort:async()=>{}};
  const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=>'fake-local-fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
    './transport':{desktop:()=>bridge},
    './agent':{runAgent(args){calls.push(args);queueMicrotask(()=>void (async()=>{try{await execute(args,calls.length);}catch(e){args.events.onError(e.message,{kind:'unknown'});}})());return {abort(){args.events.onPaused&&args.events.onPaused('cancelled');}};}}});
  const runtimeModule=load(path.resolve('src/lib/team-runtime.ts')),{TeamRuntime}=runtimeModule,domain=load(path.resolve('src/lib/collaboration.ts')),runtime=new TeamRuntime();
  const cfg=load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();
  runtime.settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'key',name:'First',baseUrl:'https://one.invalid'},{id:'backup',name:'Backup',baseUrl:'https://two.invalid'}],
    effortMappings:[],requestTimeoutMs:1000,autoRetry:0,modelHealth:{},failover});
  return {store,runtime,calls,cfg,domain,runtimeModule};
}
async function setup(f,memberPatch={},graph={}){
  await f.runtime.load();
  const p=f.domain.emptyTeamProject('p');
  p.settings.allowedConnections=[];
  if(graph.maxTokens)p.settings.maxTokens=graph.maxTokens;
  p.members=[{id:'a',name:'A',instructions:'role',connectionId:'key',model:'first-model',effort:'medium',enabled:true,tools:[],maxTokens:4000,maxMinutes:1,...memberPatch}];
  const flow=f.domain.newWorkflow('Flow'),s=flow.draft.nodes[0],e=flow.draft.nodes[1],a=f.domain.newNode('agent');
  a.memberId='a';a.instructions='写一份说明';a.outputRequirement='说明正文';e.outputRequirement='review result';
  flow.draft.nodes=[s,a,e];
  flow.draft.edges=[[s,a],[a,e]].map(([from,to])=>({id:crypto.randomUUID(),from:from.id,to:to.id,port:'next',label:'next',maxTraversals:5}));
  flow.draft.maxTokens=graph.maxTokens??10000;if(graph.maxVisits)for(const n of flow.draft.nodes)n.maxVisits=graph.maxVisits;flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];
  p.workflows=[flow];p.tasks=[{id:'task',title:'Fixture',goal:'Goal',acceptance:'Evidence',entries:[],status:'ready',createdAt:1}];
  await f.runtime.update('p',target=>Object.assign(target,p));
  return f.runtime.createRun('p','task',flow.id,'v',f.cfg);
}
const limited={kind:'rate_limit',blameModel:false};

test('路由限流时按名单交给下一位，检查点带过去，进度不重来',async t=>{
  const f=fixture(t,async(args,n)=>{
    if(n===1){args.events.onContentDelta('半成品');await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:100});args.events.onError('429 too many requests',limited);}
    else{assert.equal(args.config.model,'backup-model');assert.equal(args.resume.content,'半成品');args.events.onContentDelta('已完成');args.events.onDone();}
  },{enabled:true,routes:[{profileId:'key',model:'first-model'},{profileId:'backup',model:'backup-model'}]});
  const id=await setup(f);
  await f.runtime.start('p',id);
  const run=f.runtime.project('p').runs[0];
  assert.equal(f.calls.length,2);
  assert.equal(run.status,'waiting_user');                       // 走到交付确认，而不是整次挂掉
  assert.equal(run.members[0].model,'first-model');              // 成员快照是审计基线，换人不改写它
  const log=run.attempts.find(a=>a.routeLog)?.routeLog;
  assert.deepEqual(log.map(x=>[x.model,x.status]),[['first-model','failed'],['backup-model','done']]);
  assert.ok(run.events.some(e=>e.kind==='failover'));
});

test('名单为空就是原来的行为：停在原地等人核实，不自己换人',async t=>{
  const f=fixture(t,async args=>args.events.onError('429 too many requests',limited),undefined);
  const id=await setup(f);
  await f.runtime.start('p',id);
  assert.equal(f.calls.length,1);
  assert.equal(f.runtime.project('p').runs[0].status,'uncertain');
});

test('换了人也解决不了的错误留在原地，不把名单挨个烧一遍',async t=>{
  const f=fixture(t,async args=>args.events.onError('参数写错了',{kind:'bad_param',blameModel:false}),
    {enabled:true,routes:[{profileId:'key',model:'first-model'},{profileId:'backup',model:'backup-model'}]});
  const id=await setup(f);
  await f.runtime.start('p',id);
  assert.equal(f.calls.length,1);
});

test('成员自己的名单优先于应用全局',async t=>{
  const f=fixture(t,async(args,n)=>{
    if(n===1)args.events.onError('429',limited);
    else{assert.equal(args.config.model,'member-pick');args.events.onContentDelta('好了');args.events.onDone();}
  },{enabled:true,routes:[{profileId:'backup',model:'app-pick'}]});
  const id=await setup(f,{failover:{enabled:true,routes:[{profileId:'backup',model:'member-pick'}]}});
  await f.runtime.start('p',id);
  assert.equal(f.calls.length,2);
});

test('本机订阅客户端不参与自动交接',async t=>{
  const f=fixture(t,async args=>args.events.onError('429',limited),
    {enabled:true,routes:[{profileId:'backup',model:'backup-model'}]});
  const id=await setup(f,{connectionId:'client:claude'});
  await f.runtime.start('p',id).catch(()=>{});
  assert.equal(f.calls.length,0);   // 本机客户端根本不走 runAgent
});

test('任务消息的 id 跨派发稳定，续跑后还能声明验收',async t=>{
  const f=fixture(t,async(args,n)=>{
    if(n===1){await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10});args.events.onError('模型自己断了',{kind:'unknown'});}
    else{args.events.onContentDelta('好了');args.events.onDone();}
  });
  const id=await setup(f);
  await f.runtime.start('p',id);
  await f.runtime.resolveUncertain('p',id,'retry','已核实，接着跑');
  await f.runtime.start('p',id);
  assert.equal(f.calls.length,2);
  // 原来每次派发都新生成 uid：检查点里记的 requirementSourceIds 指向旧 id，
  // 续跑后 update_requirements 永远报「要求必须引用真实用户消息 ID」
  assert.equal(f.calls[0].history[0].id,f.calls[1].history[0].id);
  assert.match(f.calls[0].history[0].id,/^teamtask-[0-9a-z]{7,8}$/);
  // 短到模型能原样抄回 sourceId —— 第一版是三个 uuid 拼起来的 140 字符，实测弱模型直接编一个
  assert.ok(f.calls[0].history[0].id.length<=20,f.calls[0].history[0].id);
  // 而且要明确告诉它该填什么，别让它猜
  assert.ok(f.calls[0].history[0].content.includes(`sourceId 必须写 ${f.calls[0].history[0].id}`));
});

// ---- R4：轮次/阶段预算用完且没东西要核实时自己接着跑 ----

test('轮次用完但没有待核实的操作时自动续跑，不用人点一次恢复',async t=>{
  const f=fixture(t,async(args,n)=>{
    if(n===1){await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10});args.events.onPaused('本阶段轮次已到');}
    else{assert.equal(args.resume.content,'半成品');args.events.onContentDelta('好了');args.events.onDone();}
  });
  const id=await setup(f);
  await f.runtime.start('p',id);          // 只启动一次，中间没有任何人工动作
  const run=f.runtime.project('p').runs[0];
  assert.equal(f.calls.length,2);
  assert.equal(run.status,'waiting_user');                        // 一路走到交付确认
  assert.equal(run.events.filter(e=>e.kind==='auto_continue').length,1);
  assert.match(run.events.find(e=>e.kind==='auto_continue').text,/第 1 次自动续跑/);
});

test('有未确认的工具调用就不自动续：副作用可能已经生效，必须人来核实',async t=>{
  const f=fixture(t,async args=>{
    await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10,uncertainCallId:'call-1'});
    args.events.onPaused('本阶段轮次已到');
  });
  const id=await setup(f);
  await f.runtime.start('p',id);
  const run=f.runtime.project('p').runs[0];
  assert.equal(f.calls.length,1);
  assert.equal(run.status,'uncertain');
  assert.equal(run.events.some(e=>e.kind==='auto_continue'),false);
});

test('自动续跑有次数上限，不会原地打转',async t=>{
  const f=fixture(t,async args=>{
    await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:1});
    args.events.onPaused('本阶段轮次已到');
  },undefined,{maxVisits:20,maxTokens:400000});
  const id=await setup(f,{},{maxVisits:20,maxTokens:400000});
  await f.runtime.start('p',id);
  const run=f.runtime.project('p').runs[0];
  assert.equal(run.events.filter(e=>e.kind==='auto_continue').length,3);   // MAX_AUTO_CONTINUE
  assert.equal(f.calls.length,4);
  assert.equal(run.status,'uncertain');                                    // 最后还是交回给人
});

test('用户按的暂停不算「轮次用完」，绝不自动续',async t=>{
  let f;
  f=fixture(t,async args=>{
    await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10});
    await f.runtime.pause('p',f.runtime.project('p').runs[0].id);          // 人按了暂停
    args.events.onPaused('本阶段轮次已到');
  });
  const id=await setup(f);
  await f.runtime.start('p',id);
  const run=f.runtime.project('p').runs[0];
  assert.equal(f.calls.length,1);
  assert.equal(run.events.some(e=>e.kind==='auto_continue'),false);
});

// ---- R3：每段预算下限 ----

test('剩余预算开不了一段就直说剩多少、该调哪个设置，而不是派一段注定跑不动的',async t=>{
  const f=fixture(t,async args=>{args.events.onContentDelta('ok');args.events.onDone();});
  const id=await setup(f,{maxTokens:30000},{maxTokens:400000});
  await f.runtime.update('p',p=>{const r=p.runs.find(x=>x.id===id);r.tokens=395000;});
  await f.runtime.start('p',id);
  const run=f.runtime.project('p').runs[0];
  assert.equal(f.calls.length,0);                                          // 根本没派出去
  const note=run.events.at(-1).text;
  assert.match(note,/还剩 5000 tokens/);
  assert.match(note,/至少要 20000/);
  assert.match(note,/上限/);
});

test('小预算流程按比例缩放下限，不会因为绝对下限一次都跑不起来',t=>{
  const f=fixture(t,async()=>{});
  const {stageFloor,MIN_STAGE_TOKENS}=f.runtimeModule;
  assert.equal(stageFloor(400000),MIN_STAGE_TOKENS);
  assert.equal(stageFloor(10000),2000);
  assert.equal(stageFloor(1),1);
});

test('large task budget never raises a small member cap and real tool guard accepts the reservation',async t=>{
  let f;f=fixture(t,async args=>{
    const run=f.runtime.project('p').runs[0],attempt=run.attempts.find(a=>a.status==='running');
    assert.equal(args.config.runtime.maxTokens,4000);
    const {createTeamExecutionGuard}=require('../electron/team-execution-guard.cjs');
    const guard=createTeamExecutionGuard({collaboration:{read:()=>f.store.read()},teamFiles:{}});
    assert.deepEqual(guard.tool('read_file',{teamExecution:{projectId:'p',runId:run.id,attemptId:attempt.id,memberId:'a'}}).workspaceRoots,[]);
    args.events.onContentDelta('done');args.events.onDone();
  });
  const id=await setup(f,{tools:['read_file']},{maxTokens:400000});
  await f.runtime.start('p',id);
  assert.equal(f.calls.length,1);assert.equal(f.runtime.project('p').runs[0].status,'waiting_user');
});

test('stage allocation respects remaining and member caps across competing slots',t=>{
 const f=fixture(t,async()=>{}),{stageReservation}=f.runtimeModule;
 assert.equal(stageReservation(400000,4000,400000,2),4000);
 assert.equal(stageReservation(400000,100000,25000,2),20000);
 assert.equal(stageReservation(400000,4000,5000,3),4000);
 assert.throws(()=>stageReservation(400000,30000,5000,1),/至少要 20000/);
 assert.throws(()=>stageReservation(400000,0,5000,1),/无效/);
});

// ---- R2：review 类验收要引用的证据编号，直接列进提示 ----

test('续跑时把上一段的成功步骤编号列进提示，别让模型猜 callId',async t=>{
  const f=fixture(t,async(args,n)=>{
    if(n===1){
      args.events.onStep({id:'s1',callId:'call-aaa',name:'read_file',status:'ok',args:{}});
      await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10,
        steps:[{id:'s1',callId:'call-aaa',name:'read_file',status:'ok'},{id:'s2',callId:'call-bbb',name:'write_file',status:'error'}]});
      args.events.onError('模型自己断了',{kind:'unknown'});
    } else {args.events.onContentDelta('好了');args.events.onDone();}
  });
  const id=await setup(f);
  await f.runtime.start('p',id);
  await f.runtime.resolveUncertain('p',id,'retry','已核实');
  await f.runtime.start('p',id);
  const prompt=f.calls[1].history[0].content;
  assert.match(prompt,/可引用的证据编号/);
  assert.ok(prompt.includes('call-aaa（read_file）'),prompt);
  assert.equal(prompt.includes('call-bbb'),false);                          // 失败的步骤不是证据
  // 第一段没有可引用的编号时，也要说清楚该拿什么当证据
  assert.match(f.calls[0].history[0].content,/review 类验收的证据/);
});

test('隔离副本没有 .git 这件事要先告诉成员，别让它白撞一次 git',async t=>{
  const f=fixture(t,async args=>{args.events.onContentDelta('ok');args.events.onDone();});
  const id=await setup(f);
  await f.runtime.start('p',id);
  const prompt=f.calls[0].history[0].content;
  // 这次夹具没有配工作目录，所以不该出现这段；有隔离副本时才提示
  assert.equal(/不含 \.git/.test(prompt),false);
});
