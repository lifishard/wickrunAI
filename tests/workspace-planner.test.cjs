const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs'),catalog=require('../src/data/agency-catalog.json');
const load=loader({'../data/agency-catalog.json':{default:catalog}}),file=f=>path.resolve(__dirname,'..',f),w=load(file('src/lib/workspace-planner.ts')),c=load(file('src/lib/collaboration.ts')),ops=load(file('src/lib/workspace-operations.ts'));
function fixture(){const p=c.emptyTeamProject('p');p.office={departments:[],modules:[],brain:{profileId:'key',model:'model-a'}};return {p,env:{roles:catalog,skills:[],settings:{keyProfiles:[{id:'key',hasSecret:true,name:'API'}],cachedModels:{key:[{id:'model-a'},{id:'model-b'}]},activeKeyProfileId:'key',defaultConfig:{model:'model-a'}}}};}
function program(){return {title:'Research and publish plan',summary:'Research, discuss, check, ask, hand off and deliver.',changes:[
 {kind:'department',ref:'dept',name:'Research',purpose:'Assess evidence'},
 {kind:'member',ref:'writer',name:'Researcher',instructions:'Read sources and write.',department:'dept',profileId:'key',model:'model-a',tools:['request_user_input']},
 {kind:'member',ref:'critic',name:'Critic',instructions:'Challenge evidence.',department:'dept',profileId:'key',model:'model-b',tools:['request_user_input']},
 {kind:'workflow',ref:'flow',name:'Full workflow',nodes:[
  {id:'start',type:'start',title:'Start'},
  {id:'fork',type:'parallel',title:'Prepare independently'},
  {id:'a',type:'agent',title:'Draft',member:'writer',instructions:'Write evidence brief',outputRequirement:'Brief'},
  {id:'b',type:'agent',title:'Challenge',member:'critic',instructions:'Identify gaps',outputRequirement:'Gaps'},
  {id:'join',type:'join',title:'Gather'},
  {id:'discussion',type:'discussion',title:'Discuss',participants:['writer','critic'],instructions:'Respond to each other',outputRequirement:'Dissent and consensus',inputRefs:['a','b']},
  {id:'condition',type:'condition',title:'Check scope',condition:{source:'discussion',contains:'ready'}},
  {id:'qa',type:'review',title:'Independent QA',member:'writer',reviewMode:'text',instructions:'Check evidence',outputRequirement:'Cited review',inputRefs:['discussion','a','b']},
  {id:'approve',type:'approval',title:'Ask the user',instructions:'Choose whether to proceed'},
  {id:'handoff',type:'handoff',title:'Handoff',member:'critic',instructions:'Prepare next steps',outputRequirement:'Handoff brief'},
  {id:'end',type:'end',title:'User acceptance',outputRequirement:'Review the deliverable'}],
 edges:[['start','fork'],['fork','a'],['fork','b'],['a','join'],['b','join'],['join','discussion'],['discussion','condition'],['condition','qa','pass'],['condition','approve','fail'],['condition','approve','default'],['qa','handoff','pass'],['qa','a','fail'],['qa','approve','default'],['approve','handoff','pass'],['approve','end','fail'],['approve','end','default'],['handoff','end']].map(([from,to,port='next'])=>({from,to,port,loop:from==='qa'&&to==='a',maxTraversals:2}))},
 {kind:'task',ref:'first',title:'First task',goal:'Research',acceptance:'Evidence cited',workflow:'flow'},
 {kind:'task',ref:'second',title:'Follow-up task',goal:'Integrate accepted results',acceptance:'Results traced',workflow:'flow',dependsOn:['first']},
 {kind:'schedule',ref:'daily',name:'Daily research',workflow:'flow',goal:'Research',acceptance:'Evidence',timezone:'America/Vancouver',hour:9,minute:30}
 ],operations:[{kind:'start_task',task:'first'},{kind:'schedule_control',schedule:'daily',enabled:true}]};}
test('full workspace plan compiles all ten node kinds, independent QA, dependencies and a disabled schedule',()=>{
 const {p,env}=fixture(),before=JSON.stringify(p),{project:q,result}=w.prepareWorkspacePlan(p,program(),env,'Original user material');assert.equal(JSON.stringify(p),before);
 assert.equal(new Set(q.workflows[0].draft.nodes.map(n=>n.type)).size,10);assert.equal(q.runs.length,0);assert.equal(q.tasks.length,2);assert.deepEqual(q.tasks[1].dependsOn,[result.ids.first]);assert.equal(q.schedules[0].enabled,false);
 const graph=q.workflows[0].draft;assert.notEqual(graph.nodes.find(n=>n.type==='review').memberId,result.ids.writer);assert.equal(q.members.length,3);assert.deepEqual(c.validateGraph(graph,q.members).filter(i=>i.severity==='error'),[]);assert.match(q.tasks[0].entries[0].text,/Original user material/);
});
test('invalid graph, tools, model, skills, directory and cyclic task dependencies fail before changing any live state',()=>{
 for(const change of [x=>x.changes[3].edges.pop(),x=>x.changes[1].tools=['imaginary_tool'],x=>x.changes[1].model='invented',x=>x.changes[1].skills=['not-installed'],x=>x.changes[4].fileScope={root:'C:/unapproved',capability:'command'},x=>x.changes[4].dependsOn=['second']]){const {p,env}=fixture(),before=JSON.stringify(p),plan=program();change(plan);assert.throws(()=>w.prepareWorkspacePlan(p,plan,env));assert.equal(JSON.stringify(p),before);}
});
test('configuration stamps ignore chat but detect member changes and immutable run snapshots remain untouched',()=>{
 const {p,env}=fixture(),{project:q,result}=w.prepareWorkspacePlan(p,program(),env);q.runs=[{id:'existing-run',members:structuredClone(q.members),version:structuredClone(q.workflows[0].versions[0]),status:'completed'}];const frozen=JSON.stringify(q.runs),stamp=w.workspaceStamp(q);q.office.planning=[{id:'message',role:'user',text:'hello'}];assert.equal(w.workspaceStamp(q),stamp);
 const next=w.prepareWorkspacePlan(q,{title:'Update duties',summary:'New future duty',changes:[{kind:'member',ref:'updated',existingId:result.ids.writer,name:'Updated researcher',instructions:'Revised duties',profileId:'key',model:'model-b'}]},env).project;
 assert.notEqual(w.workspaceStamp(next),stamp);assert.equal(JSON.stringify(next.runs),frozen);
});
test('structured context includes actual operations, graph schema, tools, models and existing work',()=>{
 const {p,env}=fixture(),context=w.workspaceContext(p,env);assert.ok(context.schema.properties.operations);assert.ok(context.tools.some(t=>t.name==='request_user_input'));assert.ok(context.departmentTemplates.length);assert.equal(context.project.id,'p');assert.doesNotMatch(JSON.stringify(context),/apiKey/);
});
test('runtime and meeting operations call actual boundaries and refuse cross-project or fabricated targets',async()=>{
 const {p,env}=fixture(),prepared=w.prepareWorkspacePlan(p,program(),env),q=prepared.project,calls=[];q.runs=[{id:'run',status:'paused'}];
 const operator={project:()=>q,update:async fn=>fn(q),runtime:{pause:async(...args)=>calls.push(['pause',...args]),start:async(...args)=>calls.push(['resume',...args])},bridge:{meetingState:async()=>[{id:'room',projectId:'p'}],meetingAction:async(...args)=>{calls.push(args);return {id:'new-room'};},teamFilesDiff:async()=>{throw Error('Should not reach unknown session');}},launch:id=>calls.push(['preflight',id])};
 await ops.operateWorkspace({kind:'start_task',task:'first'},prepared.result,operator);assert.deepEqual(calls[0],['preflight',prepared.result.ids.first]);assert.equal(q.runs.length,1);
 await ops.operateWorkspace({kind:'run_control',run:'run',action:'pause'},prepared.result,operator);assert.deepEqual(calls[1],['pause','p','run',false]);
 const meeting=await ops.operateWorkspace({kind:'create_meeting',ref:'meet',title:'Discussion',purpose:'Evaluate',material:'Original proposal',participants:['chatgpt','claude-desktop']},prepared.result,operator);assert.equal(meeting.ids.meet,'new-room');assert.equal(calls[2][1].projectId,'p');
 await ops.operateWorkspace({kind:'meeting_control',room:'room',action:'auto_start',rounds:2,focus:'Respond to objections'},prepared.result,operator);assert.equal(calls[3][0],'auto_start');
 await assert.rejects(ops.operateWorkspace({kind:'meeting_control',room:'foreign-room',action:'auto_pause'},prepared.result,operator));await assert.rejects(ops.operateWorkspace({kind:'inspect_files',session:'foreign-session'},prepared.result,operator));
 await ops.operateWorkspace({kind:'task_message',task:'first',text:'Prioritize the original data sources'},prepared.result,operator);assert.equal(q.tasks[0].entries.at(-1).author,'你 → 所有成员');
 await ops.operateWorkspace({kind:'schedule_control',schedule:'daily',enabled:true},prepared.result,operator);assert.equal(q.schedules[0].enabled,true);assert.ok(q.schedules[0].nextAt>Date.now());
 q.runs[0].status='uncertain';await assert.rejects(ops.operateWorkspace({kind:'run_control',run:'run',action:'resume'},prepared.result,operator),/处理提问/);
});
