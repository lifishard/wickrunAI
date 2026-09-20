const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');
const {loader}=require('./load-ts.cjs');const file=p=>path.resolve(__dirname,'..',p);const load=loader();
const team=load(file('src/lib/team-observations.ts'));
const scoring=load(file('src/lib/routing-memory.ts'));
const o=load(file('src/lib/observations.ts'));
const now=Date.now();

const node=(id,type,extra={})=>({id,type,title:'PRIVATE_TITLE_'+id,instructions:'PRIVATE_INSTRUCTIONS',inputRefs:[],
  outputRequirement:'PRIVATE_REQUIREMENT',maxVisits:3,join:'all',x:0,y:0,ports:[],...extra});
const run=(over={})=>({
  id:'run-1',taskId:'task-1',workflowId:'flow-1',
  version:{id:'v1',number:2,createdAt:now,graph:{maxSteps:50,maxMinutes:30,maxTokens:50000,edges:[],
    nodes:[node('n0','start'),node('n1','agent',{memberId:'m1'}),node('n2','discussion',{participants:['m1','m2']}),node('n3','end')]}},
  members:[{id:'m1',name:'PRIVATE_MEMBER',instructions:'',connectionId:'client:claude',model:'claude-opus-5',effort:'high',enabled:true,tools:[],maxTokens:1000,maxMinutes:10},
    {id:'m2',name:'PRIVATE_MEMBER_2',instructions:'',connectionId:'omni',model:'glm-4.7',effort:'medium',enabled:true,tools:[],maxTokens:1000,maxMinutes:10}],
  config:{model:'x'},status:'completed',goal:'修改 reading log 的科目预填并跑测试',acceptance:'PRIVATE_ACCEPTANCE',
  queue:[],arrivals:{},visits:{},traversals:{},events:[{id:'e1',at:now,kind:'created',text:'PRIVATE_EVENT_TEXT'},{id:'e2',at:now+1,kind:'paused',text:'PRIVATE_PAUSE_TEXT'}],
  attempts:[
    {id:'a0',nodeId:'n0',visit:1,status:'completed',startedAt:now,endedAt:now+10,output:'PRIVATE_OUTPUT',steps:[],outcome:'next'},
    {id:'a1',nodeId:'n1',visit:1,status:'completed',startedAt:now,endedAt:now+5000,output:'PRIVATE_OUTPUT',outcome:'next',
      steps:[{id:'s1',name:'write_file',status:'ok',startedAt:now,elapsedMs:12,output:'PRIVATE_TOOL_OUTPUT'}]},
    {id:'a2',nodeId:'n2',visit:1,status:'completed',startedAt:now,endedAt:now+9000,output:'PRIVATE_OUTPUT',steps:[],outcome:'next'},
    {id:'a3',nodeId:'n3',visit:1,status:'completed',startedAt:now,endedAt:now+9100,output:'用户已确认',steps:[],outcome:'pass'},
  ],
  tokens:1234,createdAt:now,updatedAt:now+9100,projectSettings:{roots:[],allowedConnections:[],maxConcurrent:1,maxTokens:1,maxMinutes:1,approvalMode:'ask'},
  memorySnapshot:[],reservations:{},memoryIds:[],...over});
const routes=new Map([['client:claude::claude-opus-5','route-claude'],['omni::glm-4.7','route-omni'],['omni::kimi-k2','route-kimi']]);
const store=tasks=>({version:1,epoch:'e',createdAt:now,tasks,droppedTasks:0,writeFailures:0,ignoredRecordIds:[]});

test('协作运行进观测，且不把正文带进索引',()=>{
  const t=team.projectTeamObservation(undefined,run(),routes);
  assert.equal(t.source,'team');
  assert.equal(t.recordId,'team:run-1');
  assert.doesNotMatch(JSON.stringify(t),/PRIVATE_/);
  // 开始与结束节点没有执行者，不占样本；讨论节点两位成员各记一条
  assert.deepEqual(t.attempts.map(a=>a.route),['route-claude','route-claude','route-omni']);
  assert.equal(t.tools.total,1);
});

test('只有人工验收算判据，模型自评不算',()=>{
  const done=team.projectTeamObservation(undefined,run(),routes);
  assert.equal(done.feedback.outcome,'usable');
  assert.equal(scoring.verdictOf(done),'done');

  const rejected=run({status:'paused',attempts:run().attempts.map(a=>a.nodeId==='n3'?{...a,outcome:'fail'}:a)});
  assert.equal(scoring.verdictOf(team.projectTeamObservation(undefined,rejected,routes)),'not_done');

  assert.equal(scoring.verdictOf(team.projectTeamObservation(undefined,run({status:'failed'}),routes)),'not_done');
  // 跑到一半停着的既不算成功也不算失败
  const midway=team.projectTeamObservation(undefined,run({status:'paused',attempts:run().attempts.slice(0,2)}),routes);
  assert.equal(midway.feedback,undefined);
  assert.equal(scoring.verdictOf(midway),'unknown');
});

test('两位成员合做的一步，耗时不参与中位数；用量不冒充精确',()=>{
  const t=team.projectTeamObservation(undefined,run(),routes);
  assert.equal(t.attempts[0].activeMs,5000);            // 单人步骤，起止明确
  assert.equal(t.attempts[1].activeMs,0);               // 讨论节点，拆不出每人耗时
  assert.equal(t.attempts[2].activeMs,0);
  const [score]=scoring.routeScores(store([t]),'all','team');
  assert.equal(score.tokensPerDone,null);
  assert.equal(score.costIncomplete,true);
});

test('稳定请求编号去重累积检查点，并保留用途和真实用量',()=>{
  const first={requestId:'req-agent',profileId:'client:claude',model:'claude-opus-5',route:'private-route',effort:'medium',purpose:'agent',estimatedInput:110,actualInput:100,reservedOutput:30,output:20,at:now+100,dispatchedAt:now+110,elapsedMs:50,outcome:'accepted'};
  const compact={requestId:'req-compact',profileId:'client:claude',model:'claude-opus-5',route:'private-route',effort:'medium',purpose:'compaction',estimatedInput:45,actualInput:40,reservedOutput:10,output:5,at:now+200,dispatchedAt:now+210,elapsedMs:30,outcome:'accepted'};
  const oldState={working:[],round:1,at:now+150,stoppedBy:'unknown',requestStats:[first]};
  const latestState={working:[],round:2,at:now+300,stoppedBy:'unknown',requestStats:[first,compact],compactions:[{id:'compact-1',throughId:'m',throughIndex:1,facts:[],decisions:[],unresolved:[],nextSteps:[],beforeTokens:5000,afterTokens:1200,createdAt:now+250}]};
  const attempts=run().attempts.filter(a=>a.nodeId!=='n2').map(a=>a.nodeId==='n1'?{...a,state:oldState,memberStates:{m1:oldState}}:a);
  attempts.push({...attempts.find(a=>a.nodeId==='n1'),id:'a1-retry',visit:2,state:latestState,memberStates:{m1:latestState}});
  const t=team.projectTeamObservation(undefined,run({attempts}),routes);
  assert.deepEqual(t.requests,{total:2,accepted:2,failed:0,rejected:0,cancelled:0,pending:0,actualInput:140,actualOutput:25,
    missingInput:0,missingOutput:0,estimatedInput:155,reservedOutput:40,requestMs:80,missingDispatch:0});
  assert.deepEqual(t.routeRequests['route-claude'],t.requests,'续跑重复检查点不能把同一请求累加两次');
  assert.deepEqual(t.events.filter(e=>e.type==='request').map(e=>[e.data.purpose,e.data.route]),[['agent','route-claude'],['compaction','route-claude']]);
  assert.equal(t.compactions.total,1);assert.equal(t.compactions.latestBeforeTokens,5000);assert.equal(t.compactions.latestAfterTokens,1200);
  assert.equal(t.missing.some(x=>/稳定编号|token 成本/.test(x)),false);
  assert.equal(scoring.routeScores(store([t]),'all','team')[0].costIncomplete,false);

  const mixedAttempts=run().attempts.map(a=>a.nodeId==='n1'?{...a,state:latestState,memberStates:{m1:latestState}}:a);
  const mixed=team.projectTeamObservation(undefined,run({attempts:mixedAttempts}),routes);
  assert.equal(mixed.requests.total,2);
  assert.equal(mixed.requests.missingInput,0);
  assert.equal(mixed.routeRequests['route-claude'].actualInput,140);
  assert.equal(mixed.routeRequests['route-omni'],undefined,'没发出请求的路由不得分到整个任务用量');
});

test('接力运行把每个请求精确归到派发时的连接和模型，pending 快照不重复计费',()=>{
  const primary={requestId:'req-primary',profileId:'omni',model:'glm-4.7',route:'endpoint-a',effort:'medium',purpose:'agent',estimatedInput:120,actualInput:100,reservedOutput:30,output:20,at:now+100,dispatchedAt:now+105,elapsedMs:40,outcome:'accepted'};
  const pending={requestId:'req-fallback',profileId:'omni',model:'kimi-k2',route:'endpoint-b',effort:'high',purpose:'final',estimatedInput:80,reservedOutput:25,at:now+300,dispatchedAt:now+305,outcome:'pending'};
  const finished={...pending,actualInput:70,output:15,elapsedMs:35,outcome:'accepted'};
  const oldState={working:[],round:2,at:now+350,stoppedBy:'unknown',requestStats:[primary,pending]};
  const latestState={...oldState,at:now+450,requestStats:[primary,finished]};
  const attempts=run().attempts.filter(a=>a.nodeId!=='n2').map(a=>a.nodeId==='n1'?{...a,
    routeLog:[{memberId:'m1',profileId:'omni',model:'glm-4.7',at:now+200,status:'failed'},
      {memberId:'m1',profileId:'omni',model:'kimi-k2',at:now+500,status:'done'}],
    state:oldState,memberStates:{m1:latestState}}:a);
  const t=team.projectTeamObservation(undefined,run({attempts}),routes);
  const requests=t.events.filter(e=>e.type==='request');
  assert.deepEqual(requests.map(e=>[e.data.route,e.data.purpose,e.data.outcome,e.attemptId]),[
    ['route-omni','agent','accepted','a1:m1:0'],
    ['route-kimi','final','accepted','a1:m1:1'],
  ]);
  assert.equal(t.requests.total,2);assert.equal(t.requests.actualInput,170);assert.equal(t.requests.actualOutput,35);
  assert.equal(t.requests.pending,0);assert.equal(t.requests.missingInput,0);
  assert.deepEqual(Object.fromEntries(Object.entries(t.routeRequests).map(([route,s])=>[route,[s.total,s.actualInput,s.actualOutput,s.pending]])),{
    'route-omni':[1,100,20,0],'route-kimi':[1,70,15,0],
  });
  assert.equal(Object.values(t.routeRequests).reduce((n,s)=>n+s.actualInput+s.actualOutput,0),
    t.requests.actualInput+t.requests.actualOutput,'已归属路由之和必须等于已知任务 token');
  assert.equal(t.unassignedRequests,undefined);
});

test('有稳定编号但缺少派发身份的旧请求保留总量并明确标为未知路由',()=>{
  const stat={requestId:'identified-old',route:'private-route',effort:'medium',purpose:'agent',estimatedInput:100,actualInput:90,reservedOutput:20,output:10,at:now,outcome:'accepted'};
  const state={working:[],round:1,at:now,stoppedBy:'unknown',requestStats:[stat]};
  const attempts=run().attempts.filter(a=>a.nodeId!=='n2').map(a=>a.nodeId==='n1'?{...a,state,memberStates:{m1:state}}:a);
  const t=team.projectTeamObservation(undefined,run({attempts}),routes);
  assert.equal(t.requests.total,1);assert.equal(t.requests.actualInput,90);assert.equal(t.requests.missingInput,0);
  assert.deepEqual(t.routeRequests,{});
  assert.equal(t.unassignedRequests.total,1);assert.equal(t.unassignedRequests.actualInput,90);assert.equal(t.unassignedRequests.actualOutput,10);
  assert.equal(Object.values(t.routeRequests).reduce((n,s)=>n+s.actualInput+s.actualOutput,0)
    +t.unassignedRequests.actualInput+t.unassignedRequests.actualOutput,t.requests.actualInput+t.requests.actualOutput);
  assert.equal(t.events.find(e=>e.type==='request').data.route,null);
  assert.ok(t.missing.some(x=>x.includes('缺少派发时的连接或模型')));
});

test('mixed legacy requests cannot make a known route appear cost-complete',()=>{
 const known={requestId:'known',profileId:'omni',model:'glm-4.7',effort:'medium',purpose:'agent',estimatedInput:80,actualInput:80,reservedOutput:10,output:10,at:now,outcome:'accepted'};
 const legacy={...known};delete legacy.requestId;
 const state={working:[],round:2,at:now,requestStats:[known,legacy]};
 const attempts=run().attempts.filter(a=>a.nodeId!=='n2').map(a=>a.nodeId==='n1'?{...a,state,memberStates:{m1:state}}:a);
 const t=team.projectTeamObservation(undefined,run({attempts}),routes);
 assert.equal(t.requests.actualInput,80);assert.equal(t.unassignedRequests.total,0);assert.equal(t.unassignedRequests.missingInput,1);
 const samples=Array.from({length:20},(_,i)=>({...t,id:'mixed-'+i}));
 // The fixture member identity can be older than its request route; query a matching observed route.
 for(const sample of samples)sample.attempts=sample.attempts.map(a=>({...a,route:'route-omni',model:'glm-4.7'}));
 const score=scoring.routeScores(store(samples),'all','team')[0];assert.equal(score.costIncomplete,true);assert.equal(score.tokensPerDone,null);
});

test('compatibility discussion checkpoint uses request identity instead of guessing the first member',()=>{
 const stat={requestId:'discussion',profileId:'omni',model:'glm-4.7',purpose:'agent',effort:'medium',estimatedInput:10,reservedOutput:5,actualInput:10,output:5,at:now,outcome:'accepted'};
 const state={working:[],round:1,at:now,requestStats:[stat]};
 const attempts=run().attempts.filter(a=>a.nodeId!=='n1').map(a=>a.nodeId==='n2'?{...a,state}:a);
 const t=team.projectTeamObservation(undefined,run({attempts}),routes);
 assert.equal(t.events.find(e=>e.type==='request').attemptId,'a2:m2:0');
});

test('旧请求没有稳定编号时不猜测去重，明确保留成本缺口',()=>{
  const legacy={route:'private-route',effort:'medium',purpose:'agent',estimatedInput:100,actualInput:90,reservedOutput:20,output:10,at:now,outcome:'accepted'};
  const attempts=run().attempts.map(a=>a.nodeId==='n1'?{...a,state:{working:[],round:1,at:now,stoppedBy:'unknown',requestStats:[legacy]},memberStates:{m1:{working:[],round:1,at:now,stoppedBy:'unknown',requestStats:[legacy]}}}:a);
  const t=team.projectTeamObservation(undefined,run({attempts}),routes);
  assert.equal(t.requests.total,0);assert.equal(t.requests.actualInput,0);assert.ok(t.requests.missingInput>0);
  assert.ok(t.missing.some(x=>x.includes('缺少稳定编号')));
  assert.equal(t.events.some(e=>e.type==='request'),false);
});

test('路由汇总不依赖只保留 200 条的事件明细',()=>{
  const requestStats=[...Array(250)].map((_,i)=>({requestId:`bulk-${i}`,profileId:'client:claude',model:'claude-opus-5',
    route:'private-route',effort:'medium',purpose:i%2?'agent':'compaction',estimatedInput:2,actualInput:1,
    reservedOutput:3,output:2,at:now+100+i,dispatchedAt:now+101+i,elapsedMs:4,outcome:'accepted'}));
  const state={working:[],round:1,at:now+500,stoppedBy:'unknown',requestStats};
  const attempts=run().attempts.filter(a=>a.nodeId!=='n2').map(a=>a.nodeId==='n1'?{...a,state,memberStates:{m1:state}}:a);
  const t=team.projectTeamObservation(undefined,run({attempts}),routes);
  assert.equal(t.events.length,o.MAX_EVENTS);assert.ok(t.droppedEvents>0);
  assert.equal(t.events.filter(e=>e.type==='request').length<250,true);
  assert.equal(t.routeRequests['route-claude'].total,250);
  assert.equal(t.routeRequests['route-claude'].actualInput,250);
  assert.equal(t.routeRequests['route-claude'].actualOutput,500);
  assert.equal(t.requests.actualInput+t.requests.actualOutput,750);
});

test('默认不和对话路径混算，切到协作空间才看得到',()=>{
  const chat={...team.projectTeamObservation(undefined,run(),routes),source:'chat',recordId:'chat-1'};
  const both=store([team.projectTeamObservation(undefined,run(),routes),chat]);
  assert.equal(scoring.routeScores(both).every(s=>s.source==='chat'),true);
  assert.equal(scoring.routeScores(both,'all','chat').reduce((n,s)=>n+s.samples,0),2);
  assert.equal(scoring.routeScores(both,'all','team').reduce((n,s)=>n+s.samples,0),2);
  assert.equal(scoring.routeScores(both,'all','all').reduce((n,s)=>n+s.samples,0),4);
});

test('投影是纯的：同一次运行投两遍，事件不会翻倍',()=>{
  const first=team.projectTeamObservation(undefined,run(),routes);
  const second=team.projectTeamObservation(first,run(),routes);
  assert.equal(second.id,first.id);
  assert.equal(second.events.length,first.events.length);
});

test('清空统计之后，协作记录不会因为没有 RunRecord 被顺手删掉',()=>{
  const t=team.projectTeamObservation(undefined,run(),routes);
  const s=store([t,{...t,id:'x',recordId:'chat-gone',source:'chat',conversationId:'c1',answerId:'a1'}]);
  const kept=s.tasks.filter(x=>x.source==='team'||[].includes(x.recordId));
  assert.deepEqual(kept.map(x=>x.recordId),['team:run-1']);
  assert.equal(typeof o.observationEvent,'function');
});

test('中途换过路由：失败的那条单独记一行，不记成接手那条的成绩',()=>{
  const r=run({attempts:run().attempts.map(a=>a.nodeId==='n1'?{...a,
    routeLog:[{memberId:'m1',profileId:'omni',model:'glm-4.7',at:now+2000,status:'failed'},
              {memberId:'m1',profileId:'omni',model:'kimi-k2',at:now+5000,status:'done'}]}:a)});
  const t=team.projectTeamObservation(undefined,r,routes);
  const first=t.attempts.slice(0,2);
  assert.deepEqual(first.map(a=>a.route),['route-omni','route-kimi']);
  assert.deepEqual(first.map(a=>a.status),['paused','completed']);
  assert.deepEqual(first.map(a=>a.activeMs),[2000,3000]);
  assert.ok(t.missing.some(m=>m.includes('换过路由')));
});
