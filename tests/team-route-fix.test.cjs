const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const load=loader(),f=p=>path.resolve(__dirname,'..',p);
const {teamRouteFix,activeRoute}=load(f('src/lib/team-route-fix.ts'));
const {classifyError}=load(f('src/lib/errors.ts'));
const {shouldHandOff}=load(f('src/lib/failover.ts'));
const PLAN='Error: model is not available in the current token plan (code 7)';
const member=(id)=>({id,name:'成员'+id,connectionId:'kimi',model:'model-'+id,effort:'high',enabled:true,tools:[],maxTokens:1000,maxMinutes:1,instructions:''});
function run(attempt,extra={}){
 return {status:'failed',members:['a','b','c','d'].map(member),version:{graph:{nodes:[{id:'talk',type:'discussion',title:'四方评议讨论',participants:['a','b','c','d']}],edges:[]}},
  attempts:[{id:'att',nodeId:'talk',visit:1,status:'failed',startedAt:1,output:'',error:PLAN,memberStates:{},...attempt}],...extra};
}

test('an out-of-plan model is a route problem whatever the status code, and the fix says to switch models',()=>{
 for(const [message,status] of [[PLAN,400],[PLAN,403],[PLAN,undefined],['Your plan does not include glm-5',400],['当前套餐不支持该模型',400],['This model is not included in your subscription plan',403]]){
  const info=classifyError(message,status,{model:'k2'});
  assert.equal(info.kind,'route_unavailable',message);assert.equal(info.title,'{model} 不在这条接入的套餐里');assert.equal(info.vars.model,'k2');
  assert.equal(shouldHandOff(info),'这条路由当前不可用','a configured relay list still takes over');
 }
 assert.equal(classifyError('invalid parameter: temperature',400).kind,'bad_param');
});

test('the fix names the member that failed and the ones that have not run yet',()=>{
 const fix=teamRouteFix(run({routeLog:[{memberId:'a',profileId:'kimi',model:'model-a',at:1,status:'done'},{memberId:'b',profileId:'kimi',model:'model-b',at:2,status:'failed',httpStatus:400,error:PLAN}],memberOutputs:{a:'done'}}));
 assert.deepEqual(fix.failures.map(x=>[x.memberId,x.model,x.info.kind]),[['b','model-b','route_unavailable']]);
 assert.equal(fix.failures[0].error,'model is not available in the current token plan (code 7)');
 assert.deepEqual(fix.untested.map(m=>m.id),['c','d']);
 assert.equal(fix.sideEffectFree,true);assert.equal(fix.nodeTitle,'四方评议讨论');
});

test('recorded tool steps require verification before retrying',()=>{
 const fix=teamRouteFix(run({routeLog:[{memberId:'a',profileId:'kimi',model:'model-a',at:1,status:'failed',error:PLAN}],memberStates:{a:{steps:[{id:'s',name:'write_file',status:'ok'}]}}}));
 assert.equal(fix.sideEffectFree,false);
});

test('old runs without a route log still point at the single member of the step',()=>{
 const r=run({nodeId:'solo'});r.version.graph.nodes.push({id:'solo',type:'agent',title:'写作',memberId:'c'});
 const fix=teamRouteFix(r);
 assert.deepEqual(fix.failures.map(x=>[x.memberId,x.model]),[['c','model-c']]);
});

test('waiting, unclear failures, local clients and resolved attempts do not offer a route switch',()=>{
 const log=(error)=>({routeLog:[{memberId:'a',profileId:'kimi',model:'model-a',at:1,status:'failed',error}]});
 assert.equal(teamRouteFix(run(log('inference exceeds tpm/rpm limit'),)),null,'rate limits wait and retry on their own');
 assert.equal(teamRouteFix(run(log('something odd happened'))),null);
 assert.equal(teamRouteFix(run({routeLog:[{memberId:'a',profileId:'client:codex',model:'codex',at:1,status:'failed',error:PLAN}]})),null);
 assert.equal(teamRouteFix(run({...log(PLAN),resolution:'retry: done'})),null);
 assert.equal(teamRouteFix({...run(log(PLAN)),status:'running'}),null);
});

test('the latest route change wins and the member snapshot is untouched',()=>{
 const m=member('a'),r={routeOverrides:[{memberId:'a',profileId:'x',model:'one',effort:'off',at:1,previous:{profileId:'kimi',model:'model-a'}},{memberId:'a',profileId:'y',model:'two',effort:'low',at:2,previous:{profileId:'x',model:'one'}}]};
 assert.deepEqual(activeRoute(r,m),{profileId:'y',model:'two',effort:'low'});
 assert.deepEqual(activeRoute({},m),{profileId:'kimi',model:'model-a',effort:'high'});
 assert.equal(m.model,'model-a');
});
