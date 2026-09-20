const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('./load-ts.cjs').loader(),harness=load(path.resolve('src/lib/harness.ts')),config=load(path.resolve('src/lib/paramSchema.ts')).defaultGenerationConfig();config.toolsEnabled=true;
test('file completion uses the actual goal rather than orchestration help and still requires a read',()=>{
 const history=[{id:'task',role:'user',content:'任务：读取文件。系统说明：创建文件、修改文件、运行测试、git push。',createdAt:1}];
 const seed=harness.taskSeed(history,config,undefined,'读取工作目录中的 note.txt 并报告完整内容；不得修改任何文件。');
 assert.equal(seed.sourceId,'task');assert.equal(seed.action,true);assert.doesNotMatch(seed.goal,/系统说明/);
 assert.deepEqual(harness.goalDemands(seed.goal),{modify:false,test:false,push:false});
 assert.match(harness.completionIssue({harness:seed,steps:[]},'已检查材料。',config),/没有成功/);
 const state={harness:seed,steps:[{id:'s',callId:'c',name:'read_file',status:'ok'}]};
 assert.equal(harness.completionIssue(state,'已检查：文件内容如下。',config),undefined);
 assert.match(harness.completionIssue(state,'我先检查材料，接下来处理。',config),/只有下一步计划/);
});
test('actual edit and test requirements retain their evidence gates',()=>{
 const seed=harness.taskSeed([{id:'task',role:'user',content:'protocol',createdAt:1}],config,undefined,'修改文件并运行测试');
 assert.equal(seed.action,true);assert.deepEqual(harness.goalDemands(seed.goal),{modify:true,test:true,push:false});
 assert.match(harness.completionIssue({harness:seed,steps:[{name:'read_file',status:'ok'}]},'已完成修改和测试。',config),/只有查阅/);
 assert.match(harness.completionIssue({harness:seed,steps:[{name:'write_file',status:'ok'}]},'已完成修改和测试。',config),/测试/);
});
test('a negative boundary never removes a positive action in another clause',()=>{
 for(const goal of ['修改 README；不得修改其他文件','Edit README; do not edit other files','不要修改其他文件，但修改 README','Do not edit other files, but edit README']){
  assert.equal(harness.goalDemands(goal).modify,true,goal);
  const seed=harness.taskSeed([{id:'t',role:'user',content:goal,createdAt:1}],config);
  assert.equal(seed.action,true,goal);assert.match(harness.completionIssue({harness:seed,steps:[{name:'read_file',status:'ok'}]},'已完成检查。',config),/只有查阅/,goal);
 }
 assert.deepEqual(harness.goalDemands('运行测试；不得修改文件或推送'),{modify:false,test:true,push:false});
 assert.deepEqual(harness.goalDemands('修改文件，但不要运行测试或推送'),{modify:true,test:false,push:false});
});
