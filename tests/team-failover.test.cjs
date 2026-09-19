const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');const {createCollaborationStore}=require('../electron/collaboration-store.cjs');

/** 跟 team-runtime.test.cjs 同一套夹具，只多一份接力名单。 */
function fixture(t,execute,failover){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-team-failover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createCollaborationStore(root),calls=[];
  const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(rev,p)=>store.update(rev,p),collaborationClaim:async(p,id)=>store.claim(p,id),toolAbort:async()=>{}};
  const load=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=>'fake-local-fixture-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},
    './transport':{desktop:()=>bridge},
    './agent':{runAgent(args){calls.push(args);queueMicrotask(()=>void (async()=>{try{await execute(args,calls.length);}catch(e){args.events.onError(e.message,{kind:'unknown'});}})());return {abort(){args.events.onPaused&&args.events.onPaused('cancelled');}};}}});
  const {TeamRuntime}=load(path.resolve('src/lib/team-runtime.ts')),domain=load(path.resolve('src/lib/collaboration.ts')),runtime=new TeamRuntime();
  const cfg=load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();
  runtime.settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'key',name:'First',baseUrl:'https://one.invalid'},{id:'backup',name:'Backup',baseUrl:'https://two.invalid'}],
    effortMappings:[],requestTimeoutMs:1000,autoRetry:0,modelHealth:{},failover});
  return {store,runtime,calls,cfg,domain};
}
async function setup(f,memberPatch={}){
  await f.runtime.load();
  const p=f.domain.emptyTeamProject('p');
  p.settings.allowedConnections=[];
  p.members=[{id:'a',name:'A',instructions:'role',connectionId:'key',model:'first-model',effort:'medium',enabled:true,tools:[],maxTokens:4000,maxMinutes:1,...memberPatch}];
  const flow=f.domain.newWorkflow('Flow'),s=flow.draft.nodes[0],e=flow.draft.nodes[1],a=f.domain.newNode('agent');
  a.memberId='a';a.instructions='写一份说明';a.outputRequirement='说明正文';e.outputRequirement='review result';
  flow.draft.nodes=[s,a,e];
  flow.draft.edges=[[s,a],[a,e]].map(([from,to])=>({id:crypto.randomUUID(),from:from.id,to:to.id,port:'next',label:'next',maxTraversals:5}));
  flow.draft.maxTokens=10000;flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];
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
    if(n===1){await args.events.onRunState({working:[],round:1,at:1,stoppedBy:'unknown',status:'paused',content:'半成品',spentTokens:10});args.events.onError('本阶段轮次已到',{kind:'unknown'});}
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
  assert.match(f.calls[0].history[0].id,/^teamtask-/);
});

test('隔离副本没有 .git 这件事要先告诉成员，别让它白撞一次 git',async t=>{
  const f=fixture(t,async args=>{args.events.onContentDelta('ok');args.events.onDone();});
  const id=await setup(f);
  await f.runtime.start('p',id);
  const prompt=f.calls[0].history[0].content;
  // 这次夹具没有配工作目录，所以不该出现这段；有隔离副本时才提示
  assert.equal(/不含 \.git/.test(prompt),false);
});

