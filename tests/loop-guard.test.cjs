const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const {repeatedProse,repetitionWatchdog,repeatedReadCycle,lightRephraseStagnationHint,lightRephraseStagnationWatchdog,withLightRephraseStagnationHint}=loader()(path.resolve(__dirname,'../src/lib/loop-guard.ts'));
const rephraseCases=require('./fixtures/light-rephrase-stagnation-cases.cjs');
const plan='好的，我现在清楚了数据结构，开始实现以下两件事情。\n\n1. 扩展 data/courses-seed.json 的 readings，使用真实数据补全。\n\n2. 在学期视图增加阅读清单展开面板，先读取当前文件确认结构。\n\n';
test('streaming repeated promises trip before consuming the full response',()=>{
 const watch=repetitionWatchdog();let stopped=false;
 for(const chunk of (plan.repeat(20)).match(/.{1,24}|\n/g)||[])if(watch.push(chunk)){stopped=true;break;}
 assert.equal(stopped,true);assert.equal(repeatedProse(plan.repeat(4)),true);
});
test('normal code, changing lists, and short acknowledgments are not loops',()=>{
 assert.equal(repeatedProse('```js\n'+plan.repeat(20)+'\n```'),false);
 assert.equal(repeatedProse(Array.from({length:30},(_,i)=>`记录 ${i}：这份资料的内容已经核实，下一步检查不同的来源 ${i}。`).join('\n\n')),false);
 assert.equal(repeatedProse('好的。\n\n'.repeat(20)),false);
});

test('rephrased multi-step promises only produce a light-rephrase hint',()=>{
 const plans=[
  '我现在要完成两件事：\n1. 扩展 data/courses_seed.json 的 readings（用 Canvas 真实数据）\n2. 在学期视图加阅读清单展开面板',
  '现在清楚了，开始实现：\n1. 扩展 seed JSON 的 readings 字段（用 Canvas 真实数据）\n2. 在学期页加"阅读清单"展开面板',
  '先读取代码再实现：\n1. 扩展 seed JSON 的 readings 字段（用 Canvas 真实数据）\n2. 在学期页加阅读清单视图',
  '我将完成以下步骤：\n1. 扩展 seed JSON 的 readings 字段（用 Canvas 真实数据）\n2. 在学期页加阅读清单视图',
 ];
 assert.match(lightRephraseStagnationHint(plans.join('\n\n')),/轻度改写|保守提示/);
 assert.equal(repeatedProse(plans.join('\n\n')),false,'unverified similarity must not trigger the hard stop');
 assert.equal(lightRephraseStagnationHint(plans.map((p,i)=>p+'，课程编号 '+i).join('\n\n')),undefined);
});
test('light-rephrase hint watchdog reports at most once',()=>{
 const watch=lightRephraseStagnationWatchdog(),text=rephraseCases.find(item=>item.label).text;let reports=0;
 for(const chunk of text.match(/.{1,48}|\n/g)||[])if(watch.push(chunk))reports++;
 if(watch.finish())reports++;
 if(watch.finish())reports++;
 assert.equal(reports,1);
});
test('light-rephrase similarity cannot create a stop or retry without an independent completion issue',()=>{
 const hint=lightRephraseStagnationHint(rephraseCases.find(item=>item.label).text);
 assert.equal(withLightRephraseStagnationHint(undefined,hint),undefined);
 assert.match(withLightRephraseStagnationHint('没有成功操作的记录。',hint),/轻度改写.*没有成功操作/);
});
test('fixed light-rephrase samples report false positives and false negatives',t=>{
 const rows=rephraseCases.map(item=>{const hint=lightRephraseStagnationHint(item.text),combined=withLightRephraseStagnationHint(item.baseIssue,hint);
  return {...item,predicted:Boolean(hint)&&combined!==item.baseIssue};});
 const report={samples:rows.length,truePositive:rows.filter(x=>x.label&&x.predicted).length,trueNegative:rows.filter(x=>!x.label&&!x.predicted).length,
  falsePositive:rows.filter(x=>!x.label&&x.predicted).map(x=>x.id),falseNegative:rows.filter(x=>x.label&&!x.predicted).map(x=>x.id),precision:0,recall:0};
 report.precision=report.truePositive/(report.truePositive+report.falsePositive.length);
 report.recall=report.truePositive/(report.truePositive+report.falseNegative.length);
 t.diagnostic('light-rephrase stagnation fixture report: '+JSON.stringify(report));
 assert.equal(report.samples,15);assert.deepEqual(report.falsePositive,[]);assert.ok(report.falseNegative.length<=1);
});
test('alternating retrieval with unchanged evidence stops, changed evidence and new attempts do not',()=>{
 const step=(name,output)=>({name,args:{path:name},output,status:'ok',startedAt:2});
 const state={attemptStartedAt:1,steps:Array.from({length:6},(_,i)=>step(i%2?'read_file':'read_context','unchanged'))};
 assert.equal(repeatedReadCycle(state,'read_context',{path:'read_context'}),true);
 state.steps[4].output='new evidence';assert.equal(repeatedReadCycle(state,'read_context',{path:'read_context'}),false);
 state.attemptStartedAt=3;assert.equal(repeatedReadCycle(state,'read_context',{path:'read_context'}),false);
});
