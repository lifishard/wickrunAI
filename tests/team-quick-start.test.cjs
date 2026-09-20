const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const load=loader();
const domain=load(path.resolve('src/lib/collaboration.ts')),{prepareQuickTask}=load(path.resolve('src/lib/team-quick-start.ts'));
function fixture(){const p=domain.emptyTeamProject('p');p.settings.maxTokens=18000;p.settings.maxMinutes=8;
 p.tasks.push({id:'t',title:'Task',goal:'Deliver exact text.',acceptance:'Include the exact required sentence.',status:'ready',entries:[],createdAt:1});return p;}
test('a vague idea prepares two distinct planning steps with real dependency and no execution access',()=>{
 const p=fixture();p.tasks[0].intent='explore';p.tasks[0].goal='Maybe a community event';
 const before=structuredClone(p);assert.throws(()=>prepareQuickTask(p,'t',{profileId:'api',model:'fixture',style:'direct'},['api']),/匹配/);assert.deepEqual(p,before);
 prepareQuickTask(p,'t',{profileId:'api',model:'fixture',style:'explore'},['api']);
 const graph=p.workflows[0].versions[0].graph,[start,explore,plan,end]=graph.nodes;
 assert.deepEqual(graph.nodes.map(n=>n.type),['start','agent','agent','end']);
 assert.notEqual(explore.memberId,plan.memberId);assert.deepEqual(plan.inputRefs,[explore.id]);
 assert.match(plan.instructions,/wickrun-plan/);assert.match(plan.instructions,/不执行/);
 assert.deepEqual(graph.edges.map(e=>[e.from,e.to]),[[start.id,explore.id],[explore.id,plan.id],[plan.id,end.id]]);
 assert.deepEqual(domain.validateGraph(graph,p.members),[]);assert.equal(p.runs.length,0);
 assert.equal(p.tasks[0].goal,'Maybe a community event');assert.ok(p.members.every(m=>!m.tools.length&&!m.skills.length&&!m.failover.enabled));
});
test('quick setup creates editable, versioned flows without running or broadening access',()=>{
 for(const style of ['direct','discuss','review']){const p=fixture(),settings=structuredClone(p.settings);
  const prepared=prepareQuickTask(p,'t',{profileId:'api',model:'fixture',style},['api']);
  const flow=p.workflows[0],graph=flow.versions[0].graph;
  assert.deepEqual(domain.validateGraph(graph,p.members,p.settings.allowedConnections),[]);
  assert.equal(prepared.versionId,flow.versions[0].id);assert.equal(p.tasks[0].workflowId,flow.id);
  assert.equal(p.members.length,style==='direct'?1:2);assert.equal(p.runs.length,0);
  assert.equal(graph.nodes.filter(n=>n.type==='discussion').length,style==='discuss'?1:0);
  assert.equal(graph.nodes.filter(n=>n.type==='review').length,style==='review'?1:0);
  assert.ok(graph.nodes.some(n=>n.type==='end'));
  assert.equal(graph.maxTokens,18000);assert.equal(graph.maxMinutes,8);
  assert.deepEqual(p.settings,settings);
  for(const m of p.members){assert.deepEqual(m.tools,[]);assert.deepEqual(m.failover,{enabled:false,routes:[]});assert.equal(m.maxTokens,18000);assert.equal(m.maxMinutes,8);}
  flow.draft.nodes[0].instructions='Changed draft';assert.notEqual(graph.nodes[0].instructions,'Changed draft');
 }
});
test('quick setup rejects missing requirements and disallowed routes without partial writes',()=>{
 for(const alter of [p=>{p.tasks[0].goal='';},p=>{p.tasks[0].acceptance='';},p=>{p.settings.allowedConnections=['other'];},p=>{p.tasks[0].ownerId='custom-owner';}]){
  const p=fixture();alter(p);const before=structuredClone(p);
  assert.throws(()=>prepareQuickTask(p,'t',{profileId:'api',model:'fixture',style:'review'},['api']));assert.deepEqual(p,before);
 }
 for(const profileId of ['removed','client:codex']){const p=fixture();assert.throws(()=>prepareQuickTask(p,'t',{profileId,model:'fixture',style:'direct'},['api','client:codex']));assert.equal(p.members.length,0);}
});
test('preparing twice preserves existing custom configuration and never duplicates a team',()=>{
 const p=fixture();p.members.push({id:'old',name:'Existing',enabled:false,tools:['write_file']});const old=structuredClone(p.members[0]);
 prepareQuickTask(p,'t',{profileId:'api',model:'fixture',style:'direct'},['api']);const after=structuredClone(p);
 assert.throws(()=>prepareQuickTask(p,'t',{profileId:'api',model:'other',style:'review'},['api']),/已有流程/);
 assert.deepEqual(p,after);assert.deepEqual(p.members[0],old);
});
