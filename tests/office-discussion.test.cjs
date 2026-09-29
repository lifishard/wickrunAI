const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
const catalog=require('../src/data/agency-catalog.json');
const load=loader({'../data/agency-catalog.json':{default:catalog}}),file=p=>path.resolve(__dirname,'..',p);
const planner=load(file('src/lib/office-planner.ts')),domain=load(file('src/lib/collaboration.ts'));
const a='marketing-content-creator',b='product-trend-researcher';
const routes=[{profileId:'one',model:'model-a',label:'A'},{profileId:'two',model:'model-b',label:'B'}];
const brain={profileId:'one',model:'model-a'};
function draft(){return {title:'Evaluate a database proposal',goal:'Discuss scope, not implementation',deliverable:'Priorities, dissent, and open questions',acceptance:'Claims distinguish supplied text from verified evidence',assumptions:['No deployment'],departments:[{name:'Research',purpose:'Assess scope',roleIds:[a,b]}],steps:[{roleId:a,instruction:'Read the proposal',output:'Initial assessment'},{roleId:b,instruction:'Challenge coverage',output:'Evidence gaps'}],mode:'parallel',reviewRoleId:a,discussion:{roleIds:[a,b],rounds:2,focus:'Respond to concrete disagreements',output:'Supported conclusions and remaining disagreement',synthesisRoleId:b},modelAssignments:[{roleId:a,...brain},{roleId:b,profileId:'two',model:'model-b'}]};}
function fixture(){const p=domain.emptyTeamProject('p'),turn={id:'draft',role:'assistant',text:'Proposed discussion',proposal:draft()};p.office={departments:[],modules:[],planning:[{id:'user',role:'user',text:'Original Claude proposal: this claim is NOT verified.'},turn,{id:'later',role:'user',text:'A later unrelated request'}]};return {p,turn};}
test('adoption produces a routed discussion, synthesis, distinct reviewer and human acceptance without starting',()=>{
 const {p,turn}=fixture();planner.adoptProposal(p,turn,brain,catalog,routes);
 const graph=p.workflows[0].draft,rounds=graph.nodes.filter(n=>n.type==='discussion'),workers=graph.nodes.filter(n=>n.type==='agent'),review=graph.nodes.find(n=>n.type==='review');
 assert.equal(rounds.length,2);assert.equal(workers.length,3);assert.ok(rounds[1].inputRefs.includes(rounds[0].id));assert.ok(workers.at(-1).inputRefs.includes(rounds[1].id));assert.ok(review.inputRefs.includes(workers.at(-1).id));
 assert.ok(!rounds[0].participants.includes(review.memberId));assert.ok(workers.every(n=>n.memberId!==review.memberId));assert.deepEqual(rounds[0].participants.map(id=>p.members.find(m=>m.id===id).model),['model-a','model-b']);
 assert.ok(rounds[0].participants.every(id=>p.members.find(m=>m.id===id).tools.includes('request_user_input')));assert.deepEqual(p.members.find(m=>m.id===review.memberId).tools,[]);
 assert.equal(p.tasks[0].status,'草稿');assert.equal(p.runs.length,0);assert.equal(graph.edges.filter(e=>e.from===review.id).length,3);assert.deepEqual(domain.validateGraph(graph,p.members).filter(i=>i.severity==='error'),[]);
 const material=p.tasks[0].entries.find(e=>e.kind==='instruction');assert.equal(material.author,'你 → 所有成员');assert.match(material.text,/Original Claude proposal/);assert.doesNotMatch(material.text,/later unrelated/);
});
test('unavailable assigned routes fail atomically without creating partial teams',()=>{
 const {p,turn}=fixture(),before=JSON.stringify(p);assert.throws(()=>planner.adoptProposal(p,turn,brain,catalog,[routes[0]]),/不可用/);assert.equal(JSON.stringify(p),before);
 p.settings.allowedConnections=['one'];const restricted=JSON.stringify(p);assert.throws(()=>planner.adoptProposal(p,turn,brain,catalog,routes),/不可用/);assert.equal(JSON.stringify(p),restricted);
});
test('repairing an older draft keeps that draft’s original materials without later unrelated requests',()=>{
 const {p,turn}=fixture(),repaired={...turn,id:'repaired',sourceTurnId:turn.id};p.office.planning.push(repaired);planner.adoptProposal(p,repaired,brain,catalog,routes);
 const material=p.tasks[0].entries.find(e=>e.kind==='instruction').text;assert.match(material,/Original Claude proposal/);assert.doesNotMatch(material,/later unrelated/);
});
test('duplicate discussion participants, unknown roles and invalid rounds are rejected',()=>{
 for(const edit of [p=>p.discussion.roleIds=[a,a],p=>p.discussion.synthesisRoleId='unknown',p=>p.discussion.rounds=4,p=>p.modelAssignments.push(p.modelAssignments[0])]){const proposal=draft();edit(proposal);assert.throws(()=>planner.parsePlannerReply(JSON.stringify({message:'Draft',proposal}),catalog));}
});
test('a plain reply to an explicit multi-model request gets one bounded repair to a usable discussion',async()=>{
 let calls=0;const corrected={message:'Ready to adopt',proposal:draft()};const result=await planner.repairPlannerReply(JSON.stringify({message:'You should build a workflow'}),catalog,routes,async prompt=>{calls++;assert.match(prompt,/discussion/);return JSON.stringify(corrected);},true);
 assert.equal(calls,1);assert.deepEqual(result.proposal,corrected.proposal);
 calls=0;await planner.repairPlannerReply(JSON.stringify({message:'Which scope?',questions:[{text:'Scope?',options:['Global','G20']}]}),catalog,routes,async()=>{calls++;return '';},true);assert.equal(calls,0);
});
test('failed repair retains readable message and original reply without an unbounded loop',async()=>{
 let calls=0;const raw=JSON.stringify({message:'Your original material is retained.',proposal:{}});
 await assert.rejects(planner.repairPlannerReply('invalid',catalog,routes,async()=>{calls++;return raw;}),error=>error instanceof planner.PlannerDraftError&&error.rawReply===raw&&planner.plannerMessage(error.rawReply)==='Your original material is retained.');assert.equal(calls,1);
});
test('model catalog excludes missing credentials and project-disallowed connections',()=>{
 const p=domain.emptyTeamProject('p');p.settings.allowedConnections=['one'];const settings={keyProfiles:[{id:'one',name:'One',hasSecret:true},{id:'two',name:'Two',hasSecret:true},{id:'empty',name:'Empty',hasSecret:false}],cachedModels:{one:[{id:'model-a'},{id:'model-c'}],two:[{id:'model-b'}],empty:[{id:'unusable'}]}};
 assert.deepEqual(planner.plannerRoutes(settings,p,brain).map(r=>r.model),['model-a','model-c']);
});
test('discussion intent survives supplying the missing proposal and respects explicit cancellation',()=>{
 assert.equal(planner.wantsDiscussion(['我想邀请各个模型就需求和Claude提案讨论','这里是提案，先不管落地']),true);assert.equal(planner.wantsDiscussion(['多个模型讨论','取消讨论，先写一份报告']),false);assert.equal(planner.wantsDiscussion(['Write a report']),false);
 assert.equal(planner.wantsDiscussion(['多个模型讨论','取消讨论，先写一份报告','报告范围限于欧洲']),false);assert.equal(planner.wantsDiscussion(['多个模型讨论','取消讨论','重新开始讨论']),true);
});
test('compiled pipeline dispatches separate models and carries earlier speeches into replies and the next round',async t=>{
 const fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-office-discussion-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=require('../electron/collaboration-store.cjs').createCollaborationStore(root),calls=[];
 const bridge={collaborationRead:async()=>store.read(),collaborationUpdate:async(rev,p)=>store.update(rev,p),collaborationClaim:async(p,id)=>store.claim(p,id),toolAbort:async()=>{}};
 const runtimeLoad=loader({'./store':{uid:()=>crypto.randomUUID(),secretGet:async()=> 'local-test-key',toolContextOf:()=>({grants:{extraRoots:[],screen:false,admin:false}})},'./transport':{desktop:()=>bridge},'./agent':{runAgent(args){calls.push(args);queueMicrotask(()=>{args.events.onContentDelta(calls.length===8?JSON.stringify({verdict:'unverifiable',artifactIds:store.read().projects.p.runs[0].attempts.at(-1).inputTexts.map(t=>t.id),textEvidence:[],changes:'Supplied external claims have not been verified.'}):'Fixture speech '+calls.length);args.events.onDone();});return {abort(){}};}}});
 const runtime=new (runtimeLoad(file('src/lib/team-runtime.ts')).TeamRuntime)(),cfg=runtimeLoad(file('src/lib/paramSchema.ts')).defaultGenerationConfig();
 runtime.settings=()=>({defaultConfig:cfg,keyProfiles:[{id:'one',name:'A',baseUrl:'https://example.invalid'},{id:'two',name:'B',baseUrl:'https://example.invalid'}],effortMappings:[],requestTimeoutMs:1000,autoRetry:0});
 await runtime.load();const {p,turn}=fixture();planner.adoptProposal(p,turn,brain,catalog,routes);await runtime.update('p',target=>Object.assign(target,p));
 const id=await runtime.createRun('p',p.tasks[0].id,p.workflows[0].id,p.workflows[0].versions[0].id,cfg);await runtime.start('p',id);
 const run=runtime.project('p').runs[0];assert.equal(run.status,'waiting_user',JSON.stringify(run.events));assert.equal(calls.length,8);assert.deepEqual(calls.slice(2,6).map(c=>c.config.model),['model-a','model-b','model-a','model-b']);
 const prompts=calls.map(c=>JSON.stringify(c.history));assert.match(prompts[0],/Original Claude proposal/);assert.match(prompts[3],/Fixture speech 3/);assert.match(prompts[4],/Fixture speech 4/);assert.match(prompts[6],/Fixture speech 6/);assert.match(prompts[7],/Fixture speech 6/);
 assert.ok(calls[2].config.enabledTools.includes('request_user_input'));assert.equal(run.attempts.find(a=>a.nodeId===run.version.graph.nodes.find(n=>n.type==='review').id).textReview.verdict,'unverifiable');
});
