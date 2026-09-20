const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const load=loader();
const domain=load(path.resolve('src/lib/collaboration.ts'));
const quick=load(path.resolve('src/lib/team-quick-start.ts'));

function fixture(id='t'){
 const project=domain.emptyTeamProject('p');
 project.settings.maxTokens=18000;project.settings.maxMinutes=8;
 project.settings.allowedConnections=['api-a','api-b'];
 project.tasks.push({id,title:`Task ${id}`,goal:'Deliver exact text.',acceptance:'Include the required sentence.',intent:'deliver',status:'ready',entries:[],createdAt:1});
 return project;
}
function member(id,overrides={}){
 return {id,name:id,instructions:`old ${id}`,connectionId:'api-a',model:'old-model',effort:'high',enabled:true,
  tools:['read_file','write_file'],skills:['private-skill'],maxTokens:50000,maxMinutes:50,
  failover:{enabled:true,routes:[{profileId:'api-b',model:'backup'}]},...overrides};
}
function roleChoice(style,roles){return {profileId:'api-a',model:'base-model',style,roles};}
function preparedMembers(project){return project.members.filter(item=>item.id!=='source'&&item.id!=='source-b');}

test('role catalogue keeps stable defaults and exploration orders direction before plan',()=>{
 assert.deepEqual(quick.quickTaskRoles('direct').map(role=>role.id),['executor']);
 assert.deepEqual(quick.quickTaskRoles('discuss').map(role=>role.id),['executor','partner']);
 assert.deepEqual(quick.quickTaskRoles('review').map(role=>role.id),['executor','partner']);
 const explore=quick.quickTaskRoles('explore');
 assert.deepEqual(explore.map(role=>role.id),['partner','executor']);
 assert.match(explore[0].instructions,/至少两个方向/);assert.match(explore[1].instructions,/整理可选方向/);
 assert.doesNotMatch(explore[1].instructions,/wickrun-plan|JSON/);
 assert.throws(()=>quick.quickTaskRoles('unknown'),/工作方式/);
});

test('discussion assigns independent routes and duties without losing its two-member exchange',()=>{
 const project=fixture();
 quick.prepareQuickTask(project,'t',roleChoice('discuss',{
  executor:{profileId:'api-a',model:'writer-v2',instructions:'Write the final response.'},
  partner:{profileId:'api-b',model:'debater-v3',instructions:'Challenge assumptions first.'},
 }),['api-a','api-b']);
 const created=preparedMembers(project),executor=created.find(item=>item.model==='writer-v2'),partner=created.find(item=>item.model==='debater-v3');
 assert.ok(executor&&partner);assert.equal(executor.instructions,'Write the final response.');
 assert.equal(partner.instructions,'Challenge assumptions first.');
 const graph=project.workflows[0].versions[0].graph;
 const discussion=graph.nodes.find(node=>node.type==='discussion'),execute=graph.nodes.find(node=>node.type==='agent');
 assert.deepEqual(new Set(discussion.participants),new Set([executor.id,partner.id]));
 assert.equal(discussion.instructions,'Challenge assumptions first.');
 assert.equal(execute.memberId,executor.id);assert.equal(execute.instructions,'Write the final response.');
 assert.deepEqual(domain.validateGraph(graph,project.members,project.settings.allowedConnections),[]);
});

test('text review uses a distinct reviewer route and retains the evidence protocol',()=>{
 const project=fixture();
 quick.prepareQuickTask(project,'t',roleChoice('review',{
  executor:{profileId:'api-a',model:'writer',instructions:'Produce the answer.'},
  partner:{profileId:'api-b',model:'critic',instructions:'Check every stated requirement.'},
 }),['api-a','api-b']);
 const graph=project.workflows[0].versions[0].graph;
 const execute=graph.nodes.find(node=>node.type==='agent'),review=graph.nodes.find(node=>node.type==='review');
 const executor=project.members.find(item=>item.id===execute.memberId),reviewer=project.members.find(item=>item.id===review.memberId);
 assert.notEqual(executor.id,reviewer.id);assert.equal(executor.model,'writer');assert.equal(reviewer.model,'critic');
 assert.equal(review.reviewMode,'text');assert.match(review.instructions,/Check every stated requirement/);
 assert.match(review.instructions,/引用具体原文/);assert.match(review.instructions,/无法仅凭文本核实/);
 assert.ok(graph.edges.some(edge=>edge.from===review.id&&edge.to===execute.id&&edge.port==='fail'&&edge.loop));
});

test('exploration keeps direction then structured planning and cannot edit away the plan contract',()=>{
 const project=fixture();project.tasks[0].intent='explore';project.tasks[0].goal='Maybe start a local club';
 quick.prepareQuickTask(project,'t',roleChoice('explore',{
  partner:{profileId:'api-b',model:'explorer',instructions:'Offer contrasting directions.'},
  executor:{profileId:'api-a',model:'planner',instructions:'Turn the discussion into a short brief.'},
 }),['api-a','api-b']);
 const graph=project.workflows[0].versions[0].graph,[start,direction,plan,end]=graph.nodes;
 assert.deepEqual(graph.nodes.map(node=>node.type),['start','agent','agent','end']);
 assert.equal(project.members.find(item=>item.id===direction.memberId).model,'explorer');
 assert.equal(project.members.find(item=>item.id===plan.memberId).model,'planner');
 assert.equal(direction.instructions,'Offer contrasting directions.');
 assert.match(plan.instructions,/Turn the discussion into a short brief/);assert.match(plan.instructions,/wickrun-plan/);assert.match(plan.instructions,/不执行任务/);
 assert.deepEqual(plan.inputRefs,[direction.id]);
 assert.deepEqual(graph.edges.map(edge=>[edge.from,edge.to]),[[start.id,direction.id],[direction.id,plan.id],[plan.id,end.id]]);
});

test('copying a member validates its identity but never carries effort, limits or permissions',()=>{
 const project=fixture();const source=member('source');project.members.push(source);
 project.runs.push({id:'old-run',taskId:'old-task',members:[structuredClone(source)],status:'completed'});
 const sourceBefore=structuredClone(source),runBefore=structuredClone(project.runs[0]);
 quick.prepareQuickTask(project,'t',roleChoice('direct',{
  executor:{memberId:'source',profileId:'api-b',model:'new-model',instructions:'New task only.'},
 }),['api-a','api-b']);
 const created=preparedMembers(project)[0];
 assert.notEqual(created.id,'source');assert.equal(created.connectionId,'api-b');assert.equal(created.model,'new-model');
 assert.equal(created.instructions,'New task only.');assert.equal(created.effort,'medium');
 assert.equal(created.maxTokens,18000);assert.equal(created.maxMinutes,8);
 assert.deepEqual(created.tools,[]);assert.deepEqual(created.skills,[]);assert.deepEqual(created.failover,{enabled:false,routes:[]});
 assert.deepEqual(project.members.find(item=>item.id==='source'),sourceBefore);assert.deepEqual(project.runs[0],runBefore);
});

test('direct preparation and saved-preset preparation create the same visible member configuration',()=>{
 const project=fixture('direct');project.settings.maxTokens=100000;project.settings.maxMinutes=60;
 project.members.push(member('source',{effort:'xhigh',maxTokens:90000,maxMinutes:55}));
 const choice=roleChoice('direct',{executor:{memberId:'source',profileId:'api-b',model:'task-model',instructions:'Task-specific duty.'}});
 quick.prepareQuickTask(project,'direct',choice,['api-a','api-b']);
 const direct=project.members.find(item=>item.id===project.tasks.find(task=>task.id==='direct').ownerId);
 const presetId=quick.saveQuickPreset(project,'Reusable',choice,['api-a','api-b']);
 project.tasks.push({id:'loaded',title:'Loaded',goal:'Deliver another text.',acceptance:'Match.',intent:'deliver',status:'ready',entries:[],createdAt:2});
 const preset=project.quickPresets.find(item=>item.id===presetId);
 quick.prepareQuickTask(project,'loaded',structuredClone(preset.choice),['api-a','api-b']);
 const loaded=project.members.find(item=>item.id===project.tasks.find(task=>task.id==='loaded').ownerId);
 const visible=item=>({connectionId:item.connectionId,model:item.model,instructions:item.instructions,effort:item.effort,
  maxTokens:item.maxTokens,maxMinutes:item.maxMinutes,tools:item.tools,skills:item.skills,failover:item.failover});
 assert.deepEqual(visible(loaded),visible(direct));
 assert.deepEqual({effort:loaded.effort,maxTokens:loaded.maxTokens,maxMinutes:loaded.maxMinutes},{effort:'medium',maxTokens:30000,maxMinutes:20});
 assert.equal(preset.choice.roles.executor.memberId,undefined);
});

test('invalid role sources, routes and text fail atomically',()=>{
 const cases=[
  [project=>{},roleChoice('direct',{executor:{memberId:'missing',profileId:'api-a',model:'m',instructions:'x'}}),/失效/],
  [project=>project.members.push(member('source',{enabled:false})),roleChoice('direct',{executor:{memberId:'source',profileId:'api-a',model:'m',instructions:'x'}}),/失效/],
  [project=>project.members.push(member('source',{connectionId:'client:codex'})),roleChoice('direct',{executor:{memberId:'source',profileId:'api-a',model:'m',instructions:'x'}}),/失效/],
  [project=>project.members.push(member('source',{connectionId:'api-c'})),roleChoice('direct',{executor:{memberId:'source',profileId:'api-a',model:'m',instructions:'x'}}),/失效|允许范围/],
  [project=>{},roleChoice('direct',{executor:{profileId:'api-c',model:'m',instructions:'x'}}),/可用|允许范围/],
  [project=>{},roleChoice('direct',{executor:{profileId:'api-a',model:'x'.repeat(201),instructions:'x'}}),/接入和模型/],
  [project=>{},roleChoice('direct',{executor:{profileId:'api-a',model:'m',instructions:'x'.repeat(12001)}}),/12000/],
  [project=>{},roleChoice('direct',{executor:{profileId:'api-a',model:'m',instructions:'   '}}),/职责/],
  [project=>{},roleChoice('direct',{executor:null}),/设置格式/],
  [project=>{},roleChoice('direct',{executor:{model:'m',instructions:'x'}}),/接入和模型/],
  [project=>{},roleChoice('direct',{partner:{profileId:'api-a',model:'m',instructions:'x'}}),/不使用/],
  [project=>{},roleChoice('direct',{intruder:{profileId:'api-a',model:'m',instructions:'x'}}),/未知角色/],
 ];
 for(const [setup,choice,message] of cases){const project=fixture();setup(project);const before=structuredClone(project);
  assert.throws(()=>quick.prepareQuickTask(project,'t',choice,['api-a','api-b']),message);assert.deepEqual(project,before);
 }
 const disallowedSource=fixture();disallowedSource.members.push(member('source',{connectionId:'api-c'}));const before=structuredClone(disallowedSource);
 assert.throws(()=>quick.prepareQuickTask(disallowedSource,'t',roleChoice('direct',{
  executor:{memberId:'source',profileId:'api-a',model:'m',instructions:'x'},
 }),['api-a','api-b','api-c']),/不在项目允许范围/);assert.deepEqual(disallowedSource,before);
});

test('presets expand role defaults, strip source ids, round-trip, and delete without collateral changes',()=>{
 const project=fixture('one');project.members.push(member('source'),member('source-b',{connectionId:'api-b',model:'old-b'}));
 const choice=roleChoice('review',{
  executor:{memberId:'source',profileId:'api-a',model:'writer',instructions:'Write precisely.'},
  partner:{memberId:'source-b',profileId:'api-b',model:'critic',instructions:'Review independently.'},
 });
 const before={members:structuredClone(project.members),tasks:structuredClone(project.tasks),runs:structuredClone(project.runs),workflows:structuredClone(project.workflows)};
 const id=quick.saveQuickPreset(project,'  Careful pair  ',choice,['api-a','api-b']);
 assert.equal(project.quickPresets.length,1);const preset=project.quickPresets[0];
 assert.equal(preset.id,id);assert.equal(preset.name,'Careful pair');
 assert.deepEqual(Object.keys(preset.choice.roles),['executor','partner']);
 assert.equal(preset.choice.roles.executor.memberId,undefined);assert.equal(preset.choice.roles.partner.memberId,undefined);
 assert.deepEqual({members:project.members,tasks:project.tasks,runs:project.runs,workflows:project.workflows},before);
 choice.roles.executor.instructions='mutated caller object';assert.equal(preset.choice.roles.executor.instructions,'Write precisely.');
 project.tasks.push({id:'two',title:'Task two',goal:'Second output',acceptance:'Exact',intent:'deliver',status:'ready',entries:[],createdAt:2});
 quick.prepareQuickTask(project,'two',structuredClone(preset.choice),['api-a','api-b']);
 const graph=project.workflows[0].versions[0].graph,execute=graph.nodes.find(node=>node.type==='agent'),review=graph.nodes.find(node=>node.type==='review');
 assert.equal(project.members.find(item=>item.id===execute.memberId).model,'writer');
 assert.equal(project.members.find(item=>item.id===review.memberId).model,'critic');
 const stateBeforeDelete=structuredClone({...project,quickPresets:undefined});
 quick.removeQuickPreset(project,id);assert.deepEqual(project.quickPresets,[]);
 assert.deepEqual({...project,quickPresets:undefined},stateBeforeDelete);
});

test('preset validation is strict and atomic, including maximum count',()=>{
 const invalidChoices=[
  roleChoice('direct',{executor:{profileId:'api-a',model:'m',instructions:'x'.repeat(12001)}}),
  roleChoice('direct',{intruder:{profileId:'api-a',model:'m',instructions:'x'}}),
  {profileId:'api-a',model:'m',style:'unknown'},
 ];
 for(const choice of invalidChoices){const project=fixture(),before=structuredClone(project);
  assert.throws(()=>quick.saveQuickPreset(project,'Preset',choice,['api-a','api-b']));assert.deepEqual(project,before);
 }
 for(const name of ['',`x`.repeat(81)]){const project=fixture(),before=structuredClone(project);
  assert.throws(()=>quick.saveQuickPreset(project,name,roleChoice('direct'),['api-a','api-b']),/1–80/);assert.deepEqual(project,before);
 }
 const duplicate=fixture();quick.saveQuickPreset(duplicate,'Careful Pair',roleChoice('direct'),['api-a','api-b']);
 const duplicateBefore=structuredClone(duplicate);
 assert.throws(()=>quick.saveQuickPreset(duplicate,'  careful pair  ',roleChoice('direct'),['api-a','api-b']),/已有同名团队方案/);
 assert.deepEqual(duplicate,duplicateBefore);
 const project=fixture();project.quickPresets=Array.from({length:20},(_,index)=>({id:`p${index}`,name:`p${index}`,createdAt:index,choice:roleChoice('direct')}));
 const before=structuredClone(project);assert.throws(()=>quick.saveQuickPreset(project,'one more',roleChoice('direct'),['api-a','api-b']),/20/);assert.deepEqual(project,before);
 assert.throws(()=>quick.removeQuickPreset(project,'missing'),/不存在/);assert.deepEqual(project,before);
});
