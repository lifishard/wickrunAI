const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./load-ts.cjs').loader(),domain=load(path.resolve('src/lib/collaboration.ts')),quick=load(path.resolve('src/lib/team-quick-start.ts'));
function fixture(){const p=domain.emptyTeamProject('p');p.settings.roots=['C:/first'];p.tasks.push({id:'t',title:'Files',goal:'Check the folder',acceptance:'Deliver checked output',intent:'deliver',status:'ready',entries:[],createdAt:1});return p;}
function choice(capability='read',style='direct'){return {profileId:'api',model:'fixture',style,fileScope:{root:'C:/second',capability}};}
test('file preparation uses an explicit task folder, bounded tools, and no run or old-member changes',()=>{
 for(const capability of ['read','edit','command']){
  const p=fixture();p.members.push({id:'old',name:'Old',enabled:true,tools:['run_command'],instructions:'keep',connectionId:'api',model:'fixture'});
  const old=structuredClone(p.members[0]),selected=choice(capability);quick.prepareQuickTask(p,'t',selected,['api']);
  assert.deepEqual(p.settings.roots,['C:/first','C:/second']);assert.deepEqual(p.tasks[0].fileScope,selected.fileScope);
  selected.fileScope.root='C:/mutated';assert.equal(p.tasks[0].fileScope.root,'C:/second');assert.equal(p.runs.length,0);assert.deepEqual(p.members[0],old);
  const member=p.members[1];assert.ok(member.tools.includes('list_dir'));assert.equal(member.tools.includes('write_file'),capability!=='read');assert.equal(member.tools.includes('run_command'),capability==='command');
  assert.deepEqual(member.skills,[]);assert.equal(member.failover.enabled,false);assert.equal(member.tools.includes('request_access'),false);
 }
});
test('file edits use artifact review, while read-only analysis uses text review; reviewer has no write tools',()=>{
 for(const capability of ['read','edit','command']){
  const p=fixture();quick.prepareQuickTask(p,'t',choice(capability,'review'),['api']);
  const graph=p.workflows[0].versions[0].graph,review=graph.nodes.find(n=>n.type==='review'),reviewer=p.members.find(m=>m.id===review.memberId);
  assert.equal(review.reviewMode,capability==='read'?'text':'files');assert.deepEqual(reviewer.tools,['list_dir','read_file','read_document','search_files']);
  assert.ok(graph.edges.some(e=>e.from===review.id&&e.port==='fail'&&e.loop));assert.match(review.instructions,capability==='read'?/引用具体原文/:/产物/);
  assert.deepEqual(domain.validateGraph(graph,p.members),[]);
 }
});
test('invalid file choices fail without partial tasks, permissions, members or workflows',()=>{
 const invalid=[choice('unknown'),choice('edit','discuss'),choice('read','explore'),{...choice(),fileScope:{root:'relative',capability:'read'}},{...choice(),fileScope:{root:'',capability:'read'}}];
 for(const value of invalid){const p=fixture(),before=structuredClone(p);assert.throws(()=>quick.prepareQuickTask(p,'t',value,['api']));assert.deepEqual(p,before);}
});
test('saving a file team preserves models and duties but never carries directory authorization',()=>{
 const p=fixture(),before=structuredClone(p.settings),value=choice('command','review');
 const id=quick.saveQuickPreset(p,'File helpers',value,['api']),preset=p.quickPresets.find(x=>x.id===id);
 assert.equal(preset.choice.fileScope,undefined);assert.deepEqual(p.settings,before);assert.equal(p.members.length,0);assert.equal(p.workflows.length,0);
 const q=fixture();quick.prepareQuickTask(q,'t',preset.choice,['api']);assert.equal(q.tasks[0].fileScope,undefined);assert.ok(q.members.every(m=>!m.tools.length));
});
