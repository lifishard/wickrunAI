'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {loader}=require('./load-ts.cjs');
const {createCollaborationStore}=require('../electron/collaboration-store.cjs');
const {createTeamExecutionGuard}=require('../electron/team-execution-guard.cjs'),nativeScope=require('../electron/team-file-scope.cjs');
const fixtures=require('./team-store-fixtures.cjs');
const load=loader(),scopeLib=load(path.resolve('src/lib/team-file-scope.ts'));

function roots(t,label='wickrun-file-scope-'){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),label)),a=path.join(data,'a'),b=path.join(data,'b'),isolated=path.join(data,'isolated');
 fs.mkdirSync(a);fs.mkdirSync(b);fs.mkdirSync(isolated);t.after(()=>fs.rmSync(data,{recursive:true,force:true}));return {data,a,b,isolated};
}
function scopedProject(t,capability='edit'){
 const root=roots(t),project=fixtures.project(root.a);project.settings.roots=[root.a,root.b];project.settings.approvalMode='all';
 project.tasks[0].intent='deliver';project.tasks[0].fileScope={root:root.b,capability};
 project.members[0].tools=scopeLib.teamFileTools(capability);project.members[0].skills=[];project.members[0].failover={enabled:false,routes:[]};
 return {root,project};
}
function frozenRun(project,id='r'){const run=fixtures.run(project,id);run.intent='deliver';run.fileScope=structuredClone(project.tasks[0].fileScope);return run;}

test('scope helper exposes exact capabilities and validates review mode and member authority',()=>{
 assert.deepEqual(scopeLib.teamFileTools('read'),['list_dir','read_file','read_document','search_files']);
 assert.deepEqual(scopeLib.teamFileTools('edit'),['list_dir','read_file','read_document','search_files','write_file','edit_file','write_document']);
 assert.deepEqual(scopeLib.teamFileTools('command'),['list_dir','read_file','read_document','search_files','write_file','edit_file','write_document','run_command']);
 assert.deepEqual(scopeLib.teamFileTools('command',true),scopeLib.teamFileTools('read'));
 const graph={nodes:[{id:'s',type:'start'},{id:'a',type:'agent',memberId:'writer'},{id:'e',type:'end'}]},member={id:'writer',connectionId:'api',tools:scopeLib.teamFileTools('edit'),skills:[],failover:{enabled:false,routes:[]}};
 assert.doesNotThrow(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'edit'},'deliver',graph,[member]));
 const marked={...structuredClone(member),fileScope:{root:'C:\\work',capability:'edit'}};
 assert.doesNotThrow(()=>scopeLib.validateTeamFileSnapshot({root:'c:/work/',capability:'edit'},'deliver',graph,[marked]));
 assert.throws(()=>scopeLib.validateTeamFileSnapshot(undefined,'deliver',graph,[marked]),/流程成员/);
 assert.throws(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\other',capability:'edit'},'deliver',graph,[marked]),/流程成员/);
 assert.throws(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'read'},'deliver',graph,[marked]),/流程成员/);
 for(const mutate of [
  value=>value.graph.nodes.splice(1,0,{id:'d',type:'discussion'}),
  value=>value.graph.nodes[1].type='handoff',
  value=>value.member.tools.push('run_command'),
  value=>value.member.skills.push('secret'),
  value=>value.member.failover={enabled:true,routes:[]},
  value=>value.member.connectionId='client:codex',
 ]){const value={graph:structuredClone(graph),member:structuredClone(member)};mutate(value);assert.throws(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'edit'},'deliver',value.graph,[value.member]));}
 const reviewGraph={nodes:[...structuredClone(graph.nodes.slice(0,2)),{id:'review',type:'review',memberId:'reviewer',reviewMode:'files'},{id:'e',type:'end'}]};
 const reviewer={...structuredClone(member),id:'reviewer',tools:scopeLib.teamFileTools('read')};
 assert.doesNotThrow(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'command'},'deliver',reviewGraph,[member,reviewer]));
 reviewer.tools.push('write_file');assert.throws(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'command'},'deliver',reviewGraph,[member,reviewer]),/超出/);
 reviewer.tools=scopeLib.teamFileTools('read');assert.throws(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'read'},'deliver',reviewGraph,[member,reviewer]),/复核方式/);
 reviewGraph.nodes.find(node=>node.type==='review').reviewMode='text';member.tools=scopeLib.teamFileTools('read');
 assert.doesNotThrow(()=>scopeLib.validateTeamFileSnapshot({root:'C:\\work',capability:'read'},'deliver',reviewGraph,[member,reviewer]));
});

test('renderer and main scope validators reject non-canonical picker paths consistently',t=>{
 const root=roots(t),valid={root:root.b,capability:'read'};
 assert.doesNotThrow(()=>scopeLib.validateTeamFileScope(valid,[root.a,root.b]));assert.doesNotThrow(()=>nativeScope.validateTeamFileScope(valid,[root.a,root.b]));
 for(const candidate of [root.b+' ',root.b+'\r\n',root.b+'\0',`${root.b}${path.sep}child${path.sep}..`]){
  assert.throws(()=>scopeLib.validateTeamFileScope({root:candidate,capability:'read'},[candidate]));
  assert.throws(()=>nativeScope.validateTeamFileScope({root:candidate,capability:'read'},[candidate]));
 }
});

test('durable store requires saved task provenance and rejects forged roots capabilities and tools atomically',async t=>{
 await t.test('valid snapshot',t=>{const {root,project}=scopedProject(t),store=createCollaborationStore(root.data);store.update(0,project);project.runs.push(frozenRun(project));assert.equal(store.update(1,project).projects.p.runs[0].fileScope.root,root.b);});
 await t.test('task root outside project roots',t=>{const {root,project}=scopedProject(t);project.tasks[0].fileScope.root=path.join(root.data,'outside');const store=createCollaborationStore(root.data);assert.throws(()=>store.update(0,project),/已授权目录/);});
 for(const [label,mutate,message] of [
  ['run root',(run,_project,root)=>run.fileScope.root=root.a,/项目授权/],
  ['run capability',run=>run.fileScope.capability='read',/项目授权/],
  ['extra tool',(_run,project)=>{project.members[0].tools.push('fetch_url');},/超出所选权限/],
  ['discussion node',(_run,project)=>{project.workflows[0].versions[0].graph.nodes[1].type='discussion';project.workflows[0].versions[0].graph.nodes[1].participants=['m'];delete project.workflows[0].versions[0].graph.nodes[1].memberId;},/只支持直接完成或独立复核/],
 ])await t.test(label,t=>{const {root,project}=scopedProject(t);if(label==='extra tool'||label==='discussion node')mutate(undefined,project,root);const store=createCollaborationStore(root.data);store.update(0,project);const run=frozenRun(project);if(label!=='extra tool'&&label!=='discussion node')mutate(run,project,root);project.runs.push(run);const before=store.read();assert.throws(()=>store.update(before.revision,project),message);assert.deepEqual(store.read(),before);});
});

test('run scope is immutable while an old run survives later task and project root changes',t=>{
 const {root,project}=scopedProject(t),store=createCollaborationStore(root.data);store.update(0,project);project.runs.push(frozenRun(project));store.update(1,project);
 let data=store.read(),next=data.projects.p;next.runs[0].fileScope.root=root.a;assert.throws(()=>store.update(data.revision,next),/快照不可改写/);
 data=store.read();next=data.projects.p;next.tasks[0].fileScope={root:root.a,capability:'read'};next.settings.roots=[root.a];store.update(data.revision,next);
 const claimed=store.claim('p','r').projects.p.runs[0];assert.equal(claimed.status,'running');assert.deepEqual(claimed.fileScope,{root:root.b,capability:'edit'});assert.deepEqual(claimed.projectSettings.roots,[root.a,root.b]);
});

test('member scope marker prevents a saved file flow from crossing task scope boundaries',async t=>{
 await t.test('same scope passes',t=>{const {root,project}=scopedProject(t);project.members[0].fileScope=structuredClone(project.tasks[0].fileScope);const store=createCollaborationStore(root.data);store.update(0,project);project.runs.push(frozenRun(project));assert.doesNotThrow(()=>store.update(1,project));});
 for(const [label,change] of [
  ['missing task scope',(project)=>{delete project.tasks[0].fileScope;}],
  ['different root',(project,root)=>{project.tasks[0].fileScope={root:root.a,capability:'edit'};}],
  ['different capability',(project)=>{project.tasks[0].fileScope={...project.tasks[0].fileScope,capability:'read'};project.members[0].tools=scopeLib.teamFileTools('read');}],
 ])await t.test(label,t=>{const {root,project}=scopedProject(t);project.members[0].fileScope={root:root.b,capability:'edit'};change(project,root);const store=createCollaborationStore(root.data);store.update(0,project);project.runs.push(frozenRun(project));assert.throws(()=>store.update(1,project),/流程成员/);});
 await t.test('run snapshot cannot delete source marker',t=>{const {root,project}=scopedProject(t);project.members[0].fileScope=structuredClone(project.tasks[0].fileScope);const store=createCollaborationStore(root.data);store.update(0,project);const run=frozenRun(project);delete run.members[0].fileScope;project.runs.push(run);assert.throws(()=>store.update(1,project),/项目授权/);});
});

test('legacy tasks and runs without scope keep their prior store behavior',t=>{
 const root=roots(t),store=createCollaborationStore(root.data),project=fixtures.project(root.a);store.update(0,project);project.runs.push(fixtures.run(project));
 assert.equal(store.update(1,project).projects.p.runs[0].fileScope,undefined);assert.equal(store.claim('p','r').projects.p.runs[0].status,'running');
});

function guardFixture(t,{capability='edit',review=false,legacy=false}={}){
 const root=roots(t),member={id:'m',enabled:true,connectionId:'key',model:'fixture',tools:legacy?['list_directory']:scopeLib.teamFileTools(review?'read':capability),skills:[],failover:{enabled:false,routes:[]},maxTokens:100};
 const node={id:'node',type:review?'review':'agent',memberId:'m',reviewMode:review?'files':undefined},writer={...structuredClone(member),id:'writer',tools:scopeLib.teamFileTools(capability)};
 const graph={nodes:review?[{id:'start',type:'start'},{id:'write',type:'agent',memberId:'writer'},node,{id:'end',type:'end'}]:[{id:'start',type:'start'},node,{id:'end',type:'end'}],maxTokens:500};
 const run={id:'r',intent:'deliver',fileScope:legacy?undefined:{root:root.b,capability},status:'running',members:review&&!legacy?[writer,member]:[member],projectSettings:{roots:[root.a,root.b],allowedConnections:['key']},version:{graph},attempts:[{id:'attempt',nodeId:'node',status:'running'}],tokens:0,reservations:{'attempt:m':100}};
 const file={id:'file',projectId:'p',taskId:'r',memberId:'m',root:root.b,isolatedRoot:root.isolated,status:'isolated'},creates=[];
 const project={id:'p',files:[{id:'file'}],runs:[run]},guard=createTeamExecutionGuard({collaboration:{read:()=>({projects:{p:project}})},teamFiles:{get:()=>file,create:(...args)=>{creates.push(args);return file;}}});
 const ctx={teamExecution:{projectId:'p',runId:'r',memberId:'m',attemptId:'attempt',fileSessionId:'file'}};
 return {root,member,node,run,file,project,guard,ctx,creates};
}

test('main guard enforces scoped tools and exact session root while preserving legacy review spelling',t=>{
 const edit=guardFixture(t);assert.deepEqual(edit.guard.tool('write_file',edit.ctx).workspaceRoots,[edit.root.isolated]);
 edit.member.tools.push('run_command');assert.throws(()=>edit.guard.tool('run_command',edit.ctx),/超出所选权限|超出本次任务/);edit.member.tools.pop();
 edit.file.root=edit.root.a;assert.throws(()=>edit.guard.tool('read_file',edit.ctx),/隔离范围/);edit.file.root=edit.root.b;
 const createArgs={projectId:'p',taskId:'r',memberId:'m',root:edit.root.b};assert.equal(edit.guard.createFileSession(createArgs),edit.file);assert.deepEqual(edit.creates[0][1],[edit.root.b]);
 assert.throws(()=>edit.guard.createFileSession({...createArgs,root:edit.root.a}),/冻结/);
 const review=guardFixture(t,{capability:'command',review:true});review.member.tools.push('run_command');assert.throws(()=>review.guard.tool('run_command',review.ctx),/质检步骤|超出/);
 const legacy=guardFixture(t,{review:true,legacy:true});legacy.file.root=legacy.root.a;legacy.run.projectSettings.roots=[legacy.root.a];assert.doesNotThrow(()=>legacy.guard.tool('list_directory',legacy.ctx));
});

test('runtime freezes scope, selects its root, forces approval, and keeps read work text-only',async t=>{
 const root=roots(t),store=createCollaborationStore(root.data),calls=[],sessions=[];let published=0;
 const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(revision,project)=>store.update(revision,project),collaborationClaim:async(projectId,runId)=>store.claim(projectId,runId),toolAbort:async()=>{},
  teamFilesCreate:async(projectId,runId,memberId,selected)=>{sessions.push(selected);return {id:`session-${runId}`,projectId,taskId:runId,memberId,root:selected,isolatedRoot:root.isolated,status:'isolated',files:[],createdAt:Date.now()};},
  teamArtifactsPublish:async(scope,sessionId)=>{published++;return {id:`artifact-${published}`,sessionId,projectId:scope.projectId,taskId:scope.runId,memberId:scope.memberId,nodeId:'node',attemptId:scope.attemptId,version:1,createdAt:Date.now(),digest:'empty',files:[]};}};
 const isolatedLoad=loader({'./store':{uid:(prefix='id')=>`${prefix}-${crypto.randomUUID()}`,secretGet:async()=> 'fixture-key',toolContextOf:()=>({})},'./transport':{desktop:()=>bridge},'./agent':{runAgent(args){calls.push(args);queueMicrotask(()=>{args.events.onContentDelta('done');args.events.onDone();});return {abort(){}};}}});
 const {TeamRuntime}=isolatedLoad(path.resolve('src/lib/team-runtime.ts')),domain=isolatedLoad(path.resolve('src/lib/collaboration.ts')),runtime=new TeamRuntime();
 const config=isolatedLoad(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();runtime.settings=()=>({defaultConfig:config,keyProfiles:[{id:'key',name:'Fixture',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
 await runtime.load();const project=domain.emptyTeamProject('p');project.settings={...project.settings,roots:[root.a,root.b],allowedConnections:['key'],approvalMode:'all',maxConcurrent:2,maxTokens:100000,maxMinutes:60};
 project.members=[{id:'m',name:'Writer',instructions:'Edit only',connectionId:'key',model:'fixture',effort:'medium',enabled:true,tools:scopeLib.teamFileTools('edit'),skills:[],failover:{enabled:false,routes:[]},fileScope:{root:root.b,capability:'edit'},maxTokens:30000,maxMinutes:20}];
 const flow=domain.newWorkflow('Files'),start=flow.draft.nodes[0],end=flow.draft.nodes[1],agent=domain.newNode('agent');agent.id='node';agent.memberId='m';agent.instructions='Edit requested files';agent.outputRequirement='Changed files';end.outputRequirement='User accepts';flow.draft.nodes=[start,agent,end];flow.draft.edges=[{id:'s-a',from:start.id,to:agent.id,port:'next',label:'next',maxTraversals:3},{id:'a-e',from:agent.id,to:end.id,port:'next',label:'next',maxTraversals:3}];flow.draft.maxTokens=100000;flow.draft.maxMinutes=60;flow.versions=[{id:'v',number:1,createdAt:1,graph:structuredClone(flow.draft)}];project.workflows=[flow];project.tasks=[{id:'task',title:'Files',goal:'Edit the files',acceptance:'Requested edits exist',intent:'deliver',fileScope:{root:root.b,capability:'edit'},status:'ready',entries:[],createdAt:1}];
 await runtime.update('p',target=>Object.assign(target,project));const runId=await runtime.createRun('p','task',flow.id,'v',config);assert.deepEqual(runtime.project('p').runs[0].fileScope,{root:root.b,capability:'edit'});
 await runtime.start('p',runId);assert.deepEqual(sessions,[root.b]);assert.equal(calls.length,1);assert.equal(calls[0].config.approvalMode,'ask');assert.deepEqual(calls[0].config.enabledTools,scopeLib.teamFileTools('edit'));assert.equal(runtime.project('p').runs[0].projectSettings.approvalMode,'all');assert.equal(published,1);
 assert.match(calls[0].history[0].content,/"readOnly":false/);assert.match(calls[0].history[0].content,/"capability":"edit"/);
 await runtime.update('p',target=>{target.tasks.push(
  {id:'plain-task',title:'Plain',goal:'Reuse as text',acceptance:'Text',intent:'deliver',status:'ready',entries:[],createdAt:2},
  {id:'wrong-cap',title:'Wrong cap',goal:'Read',acceptance:'Text',intent:'deliver',fileScope:{root:root.b,capability:'read'},status:'ready',entries:[],createdAt:3},
  {id:'wrong-root',title:'Wrong root',goal:'Edit',acceptance:'Files',intent:'deliver',fileScope:{root:root.a,capability:'edit'},status:'ready',entries:[],createdAt:4});});
 for(const taskId of ['plain-task','wrong-cap','wrong-root'])await assert.rejects(()=>runtime.createRun('p',taskId,flow.id,'v',config),/流程成员/);
 assert.equal(runtime.project('p').runs.length,1);
 await runtime.update('p',target=>{target.members[0].tools=scopeLib.teamFileTools('read');target.members[0].fileScope={root:root.b,capability:'read'};target.tasks.push({id:'read-task',title:'Read',goal:'Read the files and summarize',acceptance:'A grounded summary',intent:'deliver',fileScope:{root:root.b,capability:'read'},status:'ready',entries:[],createdAt:5});});
 const readRunId=await runtime.createRun('p','read-task',flow.id,'v',config);await runtime.start('p',readRunId);
 assert.deepEqual(sessions,[root.b,root.b]);assert.equal(calls.length,2);assert.deepEqual(calls[1].config.enabledTools,scopeLib.teamFileTools('read'));assert.equal(calls[1].config.approvalMode,'ask');assert.equal(published,1);
 const readRun=runtime.project('p').runs.find(run=>run.id===readRunId),work=readRun.attempts.find(attempt=>attempt.nodeId==='node');assert.equal(work.output,'Writer\ndone');assert.equal(work.artifacts,undefined);
});
