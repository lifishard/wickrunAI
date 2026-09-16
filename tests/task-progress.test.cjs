const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./load-ts.cjs').loader(),file=n=>path.resolve(__dirname,'../src/lib/'+n+'.ts');
const {updatePlan,readContext}=load(file('context-memory'));
const {conversationMemory}=load(file('handoff'));
const {verifyRequirements,updateRequirements}=load(file('delivery'));
const {visibleProgress,qualityLoop}=load(file('task-progress'));
const {applyNativeProgress}=load(file('native-progress'));
const q={id:'q',role:'user',content:'检查并交付报告',createdAt:1};
const check={id:'check',milestoneId:'m',revision:1,title:'报告检查',sourceId:'q',sourceQuote:q.content,check:{kind:'file_exists',path:'C:/report.txt'},at:1,history:[]};
const state=()=>({working:[q],steps:[],contextArchiveSteps:[{id:'proof',name:'write_file',status:'ok',output:'已交付'}],requirementSourceIds:['q'],milestones:[{id:'m',title:'交付报告',status:'verifying',evidence:['proof'],updatedAt:1}],requirements:[structuredClone(check)]});
const verdict=status=>async()=>({ok:true,content:JSON.stringify({status,detail:status==='passed'?'文件存在':'文件缺失'})});

test('completion requires current checks; failures revoke completion and three failures stop the loop',async()=>{
  const s=state(),done={milestones:[{id:'m',title:'交付报告',status:'completed',evidence:['proof']}]};
  assert.equal(updatePlan(s,done).ok,false);
  await verifyRequirements(s,{ids:['check']},verdict('passed'));
  assert.equal(updatePlan(s,done).ok,true);
  await verifyRequirements(s,{ids:['check']},verdict('failed'));
  assert.equal(s.milestones[0].status,'verifying');assert.match(s.milestones[0].history.at(-1).reason,/质检未通过/);
  await verifyRequirements(s,{ids:['check']},verdict('failed'));
  assert.equal(qualityLoop(s),undefined);
  await verifyRequirements(s,{ids:['check']},verdict('failed'));
  assert.match(qualityLoop(s),/连续三次/);assert.equal(s.milestones[0].status,'blocked');
  assert.match(readContext(s,{section:'progress'}).content,/文件缺失/);
  await verifyRequirements(s,{ids:['check']},verdict('passed'));assert.equal(qualityLoop(s),undefined);
  assert.equal(updatePlan(s,done).ok,true);
});

test('verified items cannot be silently reopened or have acceptance changed; history keeps evidence',async()=>{
  const s=state();await verifyRequirements(s,{ids:['check']},verdict('passed'));
  assert.equal(updatePlan(s,{milestones:[{id:'m',title:'交付报告',status:'completed'}]}).ok,true);
  const reopen={id:'m',title:'更正报告',status:'in_progress'};
  assert.equal(updatePlan(s,{milestones:[reopen]}).ok,false);
  assert.equal(updatePlan(s,{milestones:[{...reopen,reason:'用户补充要求，需要更正报告日期'}]}).ok,true);
  assert.deepEqual(s.milestones[0].history.at(-1).evidence,['proof']);
  assert.match(s.milestones[0].history.at(-1).reason,/更正报告日期/);
});

test('cross-turn memory carries plan and failed checks but does not count archived tools as new work',async()=>{
  const s=state();await verifyRequirements(s,{ids:['check']},verdict('failed'));
  const a={id:'a',role:'assistant',taskId:'run',content:'进度已保存',milestones:s.milestones,delivery:{requirements:s.requirements},createdAt:2};
  const record={answerId:'a',question:q,state:s,config:{model:'old'}};
  const history=[q,a,{id:'q2',role:'user',content:'换模型继续',createdAt:3}];
  const memory=conversationMemory(history,()=>record);
  assert.equal(memory.milestones[0].id,'m');assert.equal(memory.requirements[0].verification.status,'failed');
  assert.equal(memory.evidence.length,1);assert.equal(memory.steps,undefined);
  memory.milestones[0].title='new';assert.equal(s.milestones[0].title,'交付报告');
  const changed=conversationMemory([{...q,content:'已编辑的目标'},a],()=>record);assert.equal(changed.milestones,undefined);
  const isolated=conversationMemory([...history,{id:'isolated',role:'user',content:'单独问答',quoteOnly:true}],()=>record);assert.equal(isolated.milestones,undefined);
  const sidebar=visibleProgress([...history,{id:'a2',role:'assistant',steps:[{id:'new-step'}],milestones:[]}]);
  assert.equal(sidebar.milestones.length,1);assert.equal(sidebar.requirements[0].verification.status,'failed');
});

test('native clients can update the same plan and complete only after host verification',async()=>{
  const s=state();
  const marker='<wickrun_progress>'+JSON.stringify({verification:{ids:['check']},milestones:[{id:'m',title:'交付报告',status:'completed',evidence:['proof']} ]})+'</wickrun_progress>';
  await assert.rejects(applyNativeProgress(s,'交付完成'+marker,verdict('failed')),/完成前必须/);
  assert.notEqual(s.milestones[0].status,'completed');
  assert.equal(await applyNativeProgress(s,'交付完成'+marker,verdict('passed')),'交付完成');
  assert.equal(s.milestones[0].status,'completed');
});


test('supplementing a task preserves passed items until a related requirement actually changes',async()=>{
  const s=state();await verifyRequirements(s,{ids:['check']},verdict('passed'));
  updatePlan(s,{milestones:[{id:'m',title:'交付报告',status:'completed'}]});
  const next=load(file('delivery')).addRunInput(s,{id:'q2',content:'继续处理剩下的事项',createdAt:4});
  assert.equal(next.milestones[0].status,'completed');assert.equal(next.requirements[0].verification.status,'passed');
});

test('failed acceptance cannot be moved away or detached by omitting the milestone link',async()=>{
  const s=state();s.milestones.push({id:'other',title:'其他任务',status:'pending',evidence:[],updatedAt:1});
  await verifyRequirements(s,{ids:['check']},verdict('failed'));
  assert.equal(updateRequirements(s,{requirements:[{...check,milestoneId:'other'}]}).ok,false);
  assert.equal(updateRequirements(s,{requirements:[{...check,milestoneId:undefined,check:{kind:'file_exists',path:'C:/new-report.txt'}}]}).ok,true);
  assert.equal(s.requirements[0].milestoneId,'m');assert.equal(s.requirements[0].verification,undefined);
});
