const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const fs=require('node:fs');
const {loader}=require('./load-ts.cjs');const load=loader({'./transport':{desktop:()=>null}});
const domain=load(path.resolve(__dirname,'../src/lib/collaboration.ts'));
let n=0;const newId=p=>`${p}-${++n}`;

test('导入的模板换新编号、先停用，并且不覆盖现有配置',()=>{
  const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/templates/readinglog-pilot.json'),'utf8'));
  const {members,workflows}=domain.importTemplate(raw,newId);
  assert.equal(members.length,3);
  assert.equal(members.every(m=>m.enabled===false),true,'导入后必须先停用，让人确认接入和模型再跑');
  assert.equal(members.every(m=>!raw.members.some(x=>x.id===m.id)),true,'编号必须全换，不能覆盖已有成员');
  const flow=workflows[0];
  assert.equal(flow.versions.length,0,'版本是当时跑的那一份的证据，换了编号就不是它了');
  const ids=new Set(flow.draft.nodes.map(x=>x.id));
  assert.equal(flow.draft.edges.every(e=>ids.has(e.from)&&ids.has(e.to)),true,'连线必须跟着换编号');
  const byName=new Map(members.map(m=>[m.name,m.id]));
  const agents=flow.draft.nodes.filter(x=>x.type==='agent');
  assert.equal(agents.every(x=>[...byName.values()].includes(x.memberId)),true,'节点上的成员引用必须指向导入后的成员');
});

test('试点流程本身是可运行的：启用成员后校验不报错',()=>{
  const raw=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/templates/readinglog-pilot.json'),'utf8'));
  const {members,workflows}=domain.importTemplate(raw,newId);
  const live=members.map(m=>({...m,enabled:true}));
  assert.deepEqual(domain.validateGraph(workflows[0].draft,live).filter(x=>x.severity==='error'),[]);
  // 只授权 omni 时，用本机 Claude Code 的席位必须被拦下来
  const restricted=domain.validateGraph(workflows[0].draft,live,[live[1].connectionId]);
  assert.ok(restricted.some(i=>/允许的模型接入|没有允许的模型接入/.test(i.message)));
});

test('不是模板的文件、缺名称的成员都要当场拒绝',()=>{
  assert.throws(()=>domain.importTemplate({format:'something-else',version:1,members:[],workflows:[]},newId),/配置模板/);
  assert.throws(()=>domain.importTemplate({format:'wickrunAI-project-template',version:1,members:[{id:'a',name:'  '}],workflows:[]},newId),/名称/);
});

// ---- R1：一键生成的自由协作流程，单人时不应该有讨论节点 ----

const member=(id,name)=>({id,name,instructions:'role',connectionId:'key',model:'m',effort:'medium',enabled:true,tools:[],maxTokens:30000,maxMinutes:10});
const task={title:'小改动',goal:'改一个文件',acceptance:'文件里出现某一行'};

test('只有一位成员时不生成讨论节点：同一个人先讨论再执行等于把活干两遍',()=>{
  const flow=domain.freeFlowGraph(task,[member('a','A')],'自由协作',newId);
  const types=flow.draft.nodes.map(x=>x.type);
  assert.deepEqual(types,['start','agent','end']);
  assert.equal(flow.draft.edges.length,2);
  // 实测里这条最贵：讨论节点把验收声明、程序核验、文件清单整套做了一遍，
  // 执行节点又原样重做，343k tokens 里将近三分之一烧在这
  assert.equal(types.includes('discussion'),false);
  const agent=flow.draft.nodes[1];
  assert.equal(agent.memberId,'a');
  assert.equal(agent.instructions,task.goal);
  assert.equal(agent.outputRequirement,task.acceptance);
  assert.equal(flow.draft.nodes.at(-1).outputRequirement,task.acceptance);
  assert.deepEqual(domain.validateGraph(flow.draft,[member('a','A')],[]).filter(x=>x.severity==='error'),[]);
});

test('两位以上成员才有讨论节点，且全员参与、顺序串起来',()=>{
  const members=[member('a','A'),member('b','B')];
  const flow=domain.freeFlowGraph(task,members,'自由协作',newId);
  const types=flow.draft.nodes.map(x=>x.type);
  assert.deepEqual(types,['start','discussion','agent','end']);
  assert.deepEqual(flow.draft.nodes[1].participants,['a','b']);
  assert.equal(flow.draft.edges.length,3);
  const ids=flow.draft.nodes.map(x=>x.id);
  assert.deepEqual(flow.draft.edges.map(e=>[ids.indexOf(e.from),ids.indexOf(e.to)]),[[0,1],[1,2],[2,3]]);
  assert.deepEqual(domain.validateGraph(flow.draft,members,[]).filter(x=>x.severity==='error'),[]);
});

test('停用的成员不算数：只剩一位启用成员照样是单人流程，一个都不剩就当场报错',()=>{
  const members=[member('a','A'),{...member('b','B'),enabled:false}];
  assert.deepEqual(domain.freeFlowGraph(task,members,'自由协作',newId).draft.nodes.map(x=>x.type),['start','agent','end']);
  assert.throws(()=>domain.freeFlowGraph(task,[{...member('a','A'),enabled:false}],'自由协作',newId),/至少一位成员/);
});

test('任务指定了负责人就派给他，不是默认第一个',()=>{
  const members=[member('a','A'),member('b','B')];
  assert.equal(domain.freeFlowGraph({...task,ownerId:'b'},members,'自由协作',newId).draft.nodes[2].memberId,'b');
  // 负责人已经不在成员里（改过配置）时退回第一位，而不是派给一个不存在的人
  assert.equal(domain.freeFlowGraph({...task,ownerId:'gone'},members,'自由协作',newId).draft.nodes[2].memberId,'a');
});

// ---- R5：运行页顶部总览条 ----

const baseRun=(patch={})=>({
  id:'run',taskId:'t',workflowId:'f',members:[member('a','A'),member('b','B')],
  version:{id:'v',number:1,createdAt:1,graph:{maxSteps:50,maxMinutes:30,maxTokens:400000,
    nodes:[{id:'n1',type:'agent',title:'执行',memberId:'a',maxVisits:3},{id:'n2',type:'end',title:'交付',maxVisits:1}],edges:[]}},
  status:'running',goal:'g',acceptance:'a',queue:[],arrivals:{},visits:{},traversals:{},
  attempts:[],events:[],tokens:100000,createdAt:1,updatedAt:1,reservations:{},memoryIds:[],memorySnapshot:[],
  projectSettings:{},config:{},...patch});
const attempt=(patch={})=>({id:'at',nodeId:'n1',visit:1,status:'running',startedAt:1,output:'',steps:[],...patch});

test('总览条一次说清：哪一步、谁在跑、在等什么、预算烧到哪',()=>{
  const o=domain.runOverview(baseRun({attempts:[attempt({notice:'A：命中限流，退避 20s 后重试（第 2 次）'})]}));
  assert.equal(o.nodeTitle,'执行');
  assert.equal(o.memberName,'A');
  assert.equal(o.waitingKind,'notice');
  assert.match(o.waiting,/退避 20s/);
  assert.equal(o.tokens,100000);
  assert.equal(o.cap,400000);
  assert.equal(o.ratio,0.25);
});

test('在等人的三种情况各自分开：批工具、核实、验收',()=>{
  const approval=domain.runOverview(baseRun({status:'waiting_user',attempts:[attempt({status:'waiting_user'})],
    pendingApproval:{nodeId:'n1',text:'A 请求 run_shell\n{"cmd":"ls"}'}}));
  assert.equal(approval.waitingKind,'approval');
  assert.equal(approval.waiting,'A 请求 run_shell');            // 只取第一行，参数留给下面的卡片

  const verify=domain.runOverview(baseRun({status:'uncertain',attempts:[attempt({status:'uncertain',error:'429 too many requests'})]}));
  assert.equal(verify.waitingKind,'verify');
  assert.equal(verify.waiting,'429 too many requests');

  const accept=domain.runOverview(baseRun({status:'waiting_user',queue:['n2'],attempts:[attempt({nodeId:'n2',status:'waiting_user'})]}));
  assert.equal(accept.waitingKind,'accept');
  assert.equal(accept.nodeTitle,'交付');
});

test('讨论节点列出全部参与者；已经核实过的步骤不再抢占「当前步骤」',()=>{
  const run=baseRun({attempts:[
    attempt({id:'old',status:'failed',error:'旧的',resolution:'retry: 已核实'}),
    attempt({id:'new',status:'running'}),
  ]});
  run.version.graph.nodes[0]={id:'n1',type:'discussion',title:'讨论',participants:['a','b'],maxVisits:3};
  const o=domain.runOverview(run);
  assert.equal(o.memberName,'A、B');
  assert.equal(o.waitingKind,'working');
});

test('总预算为 0 时不除零，跑完的运行标成已结束',()=>{
  const done=baseRun({status:'completed',attempts:[attempt({status:'completed'})]});
  done.version.graph.maxTokens=0;
  const o=domain.runOverview(done);
  assert.equal(o.ratio,0);
  assert.equal(o.waitingKind,'done');
});

// ---- R8：「运行此版本」默认选中的任务 ----

test('默认选中这个流程绑定的任务，而不是任务列表第一个',()=>{
  const project={
    tasks:[{id:'t-psyc',title:'PSYC 102',createdAt:1},{id:'t-phil',title:'PHIL 220',createdAt:2,workflowId:'f-phil'}],
    runs:[],
  };
  assert.equal(domain.taskForFlow(project,'f-phil'),'t-phil');
  // 绑了同一个流程的有多个时取新的那个
  project.tasks.push({id:'t-phil2',title:'PHIL 220 续',createdAt:3,workflowId:'f-phil'});
  assert.equal(domain.taskForFlow(project,'f-phil'),'t-phil2');
});

test('没有绑定关系时退回这个流程最近一次运行的任务，再没有才取第一个',()=>{
  const tasks=[{id:'t1',title:'一',createdAt:1},{id:'t2',title:'二',createdAt:2}];
  assert.equal(domain.taskForFlow({tasks,runs:[{workflowId:'f',taskId:'t2',createdAt:9}]},'f'),'t2');
  assert.equal(domain.taskForFlow({tasks,runs:[{workflowId:'other',taskId:'t2',createdAt:9}]},'f'),'t1');
  // 运行指向的任务已经删了就别选一个不存在的
  assert.equal(domain.taskForFlow({tasks,runs:[{workflowId:'f',taskId:'gone',createdAt:9}]},'f'),'t1');
  assert.equal(domain.taskForFlow({tasks:[],runs:[]},'f'),'');
});
