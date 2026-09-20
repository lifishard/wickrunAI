const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');let serial=0;
const load=loader({'./store':{uid:prefix=>`${prefix}-${++serial}`},'./i18n':{tr:(key,args={})=>key.replace(/\{(\w+)\}/g,(_,k)=>args[k]??k)}});
const {readDiscoveryPlan,discoveryPlanDraft,discoverySelectionIssues,importDiscoveryTasks,adoptedPlanTasks}=load(path.resolve(__dirname,'../src/lib/team-discovery-plan.ts'));
const row=(id,dependsOn=[],extra={})=>({id,title:`Task ${id}`,goal:`Goal ${id}`,acceptance:`Acceptance ${id}`,dependsOn,...extra});
const text=tasks=>'Two possible directions; no work is authorized.\n```wickrun-plan\n'+JSON.stringify({version:1,tasks})+'\n```';
function fixture(rows=[row('a'),row('b',['a'])]){
 const source={id:'idea',title:'Idea',goal:'Explore options',acceptance:'Explore only',intent:'explore',entries:[],createdAt:1,status:'done'};
 const run={id:'plan-run',taskId:source.id,intent:'explore',status:'completed',queue:[],version:{graph:{nodes:[{id:'agent',type:'agent'},{id:'end',type:'end'}]}},attempts:[{id:'output',nodeId:'agent',status:'completed',output:text(rows)}]};
 const project={id:'p',tasks:[source],runs:[run],workflows:[],members:[],files:[],memories:[],schedules:[]};
 return {project,source,run,draft:discoveryPlanDraft(source,run)};
}
test('multi-task advice and legacy briefs are read without importing executable settings',()=>{
 const plan=readDiscoveryPlan(text([row('a',[],{tools:['run_command'],workflowId:'injected',selected:false,model:'paid'})]));
 assert.deepEqual(Object.keys(plan.items[0]).sort(),['acceptance','dependsOn','goal','id','selected','title']);
 assert.equal(plan.items[0].selected,true);assert.doesNotMatch(plan.body,/wickrun-plan/);
 const legacy=readDiscoveryPlan('```wickrun-plan\n'+JSON.stringify({title:'T',goal:'G',acceptance:'A',dependsOn:['evil']})+'\n```');
 assert.deepEqual(legacy.items[0],{id:'next',title:'T',goal:'G',acceptance:'A',dependsOn:[],selected:true});
});
test('malformed, ambiguous, oversized and cyclic plans fail as a whole',()=>{
 const good=text([row('a')]);
 for(const value of [good+'\n'+good,good+'\n```wickrun-plan\n{',text(Array.from({length:9},(_,i)=>row('a'+i))),text([row('a'),row('a')]),text([row('a',['a'])]),text([row('a',['missing'])]),text([row('a',['b']),row('b',['a'])]),text([row('a',[],{goal:'x'.repeat(12001)})]),text([row('../unsafe')]),text([row('a',[],{choiceGroup:{}})])])assert.equal(readDiscoveryPlan(value),null,value.slice(0,160));
});
test('selection cannot omit an uncreated prerequisite or select competing alternatives',()=>{
 const f=fixture();f.draft.items[0].selected=false;assert.match(discoverySelectionIssues(f.project,f.draft)[0],/前置任务/);
 const c=fixture([row('a',[],{choiceGroup:'route'}),row('b',[],{choiceGroup:'route'})]);
 assert.deepEqual(c.draft.items.map(item=>item.selected),[true,false]);c.draft.items[1].selected=true;
 assert.match(discoverySelectionIssues(c.project,c.draft)[0],/备选方向/);
});
test('saving chosen tasks atomically maps prerequisites and retains only editable content and provenance',()=>{
 const f=fixture();f.draft.items[0].title='  Edited task  ';
 const ids=importDiscoveryTasks(f.project,f.draft),created=f.project.tasks.slice(1);
 assert.equal(created[0].title,'Edited task');assert.deepEqual(created[1].dependsOn,[ids[0]]);
 assert.equal(created[1].sourceTaskId,'idea');assert.equal(created[1].sourceRunId,'plan-run');assert.equal(created[1].sourceProposalId,'b');
 for(const task of created){assert.equal(task.intent,'deliver');for(const field of ['workflowId','ownerId','tools','model','config'])assert.equal(Object.hasOwn(task,field),false);}
 assert.equal(f.project.runs.length,1);assert.equal(f.project.workflows.length,0);assert.equal(f.project.members.length,0);
 assert.throws(()=>importDiscoveryTasks(f.project,f.draft),/已经建立/);assert.equal(f.project.tasks.length,3);
});
test('later adoption can depend on an already-created suggestion without duplicating it',()=>{
 const f=fixture();f.draft.items[1].selected=false;const [first]=importDiscoveryTasks(f.project,f.draft);
 f.draft.items[0].selected=false;f.draft.items[1].selected=true;
 const [second]=importDiscoveryTasks(f.project,f.draft);assert.deepEqual(f.project.tasks.find(task=>task.id===second).dependsOn,[first]);assert.equal(f.project.tasks.length,3);
});
test('invalid edited selection or incomplete source cannot partially persist tasks',()=>{
 const f=fixture(),before=structuredClone(f.project);f.draft.items[1].goal='';
 assert.throws(()=>importDiscoveryTasks(f.project,f.draft),/补全/);assert.deepEqual(f.project,before);
 f.draft.items[1].goal='Edited';f.run.status='failed';assert.throws(()=>importDiscoveryTasks(f.project,f.draft),/不可用/);assert.equal(f.project.tasks.length,1);
});
test('waiting exploration can be edited but must be accepted before tasks are saved',()=>{
 const f=fixture();f.run.status='waiting_user';f.run.pendingApproval={nodeId:'end',text:'Review planning'};
 assert.deepEqual(discoverySelectionIssues(f.project,f.draft),[]);assert.throws(()=>importDiscoveryTasks(f.project,f.draft),/结束本轮/);
 f.run.status='completed';delete f.run.pendingApproval;assert.equal(importDiscoveryTasks(f.project,f.draft).length,2);
});

test('legacy adopted single-task advice is not duplicated after upgrade',()=>{
 const f=fixture();f.run.attempts[0].output='```wickrun-plan\n'+JSON.stringify({title:'T',goal:'G',acceptance:'A'})+'\n```';
 const draft=discoveryPlanDraft(f.source,f.run);
 f.project.tasks.push({id:'old-task',title:'Edited previously',goal:'Old goal',acceptance:'Old acceptance',entries:[],createdAt:2,sourceTaskId:f.source.id,sourceRunId:f.run.id});
 assert.equal(adoptedPlanTasks(f.project,draft).get('next').id,'old-task');
 assert.throws(()=>importDiscoveryTasks(f.project,draft),/已经建立/);assert.equal(f.project.tasks.length,2);
 const another={...draft,sourceRunId:'other'};assert.equal(adoptedPlanTasks(f.project,another).size,0);
 assert.equal(adoptedPlanTasks(f.project,f.draft).size,0,'do not invent an item mapping for a multi-task plan');
});
