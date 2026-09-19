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
