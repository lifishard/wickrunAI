const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const ts=loader()(path.resolve(__dirname,'../src/lib/team-limits.ts')),native=require('../electron/team-limits.cjs');

function run(extra={}){
 return {id:'r',status:'paused',workflowId:'flow',createdAt:Date.now(),tokens:1000,queue:[],visits:{},traversals:{},events:[],
  members:[{id:'a',name:'A',maxTokens:30000},{id:'b',name:'B',maxTokens:30000}],
  version:{graph:{maxTokens:300000,maxSteps:40,maxMinutes:120,
   nodes:[{id:'work',type:'agent',title:'写作',memberId:'a',maxVisits:2},{id:'review',type:'review',title:'独立忠实度复核',memberId:'b',maxVisits:3},{id:'talk',type:'discussion',title:'四方评议讨论',participants:['a','b'],maxVisits:1}],
   edges:[{id:'back',from:'review',to:'work',label:'返工',maxTraversals:2}]}},
  attempts:[],...extra};
}
const project=(graph)=>({workflows:[{id:'flow',versions:[{number:1,graph:run().version.graph},{number:2,graph}]}],members:[{id:'a',maxTokens:80000},{id:'b',maxTokens:30000}]});

test('renderer and main process compute the same effective limits',()=>{
 const r=run({limitRaises:[{kind:'visits',target:'review',value:5,at:1},{kind:'visits',target:'review',value:7,at:2},{kind:'runTokens',value:500000,at:3},{kind:'memberTokens',target:'a',value:60000,at:4},{kind:'traversals',target:'back',value:4,at:5}]});
 const node=r.version.graph.nodes[1],edge=r.version.graph.edges[0],m=r.members[0];
 for(const lib of [ts,native]){assert.equal(lib.maxVisitsOf(r,node),7);assert.equal(lib.maxTraversalsOf(r,edge),4);assert.equal(lib.memberTokensOf(r,m),60000);assert.equal(lib.runTokensOf(r),500000);assert.equal(lib.runStepsOf(r),40);assert.equal(lib.runMinutesOf(r),120);}
 assert.deepEqual(ts.LIMIT_CAPS,{...native.LIMIT_CAPS});
});

test('the store accepts only raises above the limit in effect, for real targets, within the cap',()=>{
 const r=run();
 native.validateLimitRaise({kind:'visits',target:'review',value:4,at:1},r);
 native.validateLimitRaise({kind:'runTokens',value:450000,at:1},r);
 for(const bad of [{kind:'visits',target:'review',value:3,at:1},{kind:'visits',target:'missing',value:9,at:1},{kind:'runTokens',value:2e9,at:1},{kind:'runTokens',target:'x',value:400000,at:1},{kind:'magic',value:5,at:1},{kind:'visits',target:'review',value:4.5,at:1}])assert.throws(()=>native.validateLimitRaise(bad,r),bad.kind);
 assert.throws(()=>native.validateLimitRaise({kind:'visits',target:'review',value:5,at:1},run({limitRaises:[{kind:'visits',target:'review',value:6,at:1}]})),/只能调高/);
});

test('a used-up step is reported with the higher value already saved in the design',()=>{
 const graph=structuredClone(run().version.graph);graph.nodes[1].maxVisits=6;graph.maxTokens=600000;
 const r=run({queue:['review'],visits:{review:3},attempts:[{id:'x',nodeId:'review',visit:3,status:'completed',output:'fail'}]});
 const stops=ts.limitStops(r,project(graph));
 assert.deepEqual(stops.map(s=>[s.kind,s.target,s.current,s.used,s.design]),[['visits','review',3,3,6]]);
 assert.equal(ts.limitLabel(r,'visits','review'),'「独立忠实度复核」最多执行次数');
 assert.deepEqual(ts.limitStops({...r,limitRaises:[{kind:'visits',target:'review',value:6,at:1}]},project(graph)),[],'raised in place, nothing blocks');
 assert.deepEqual(ts.limitStops({...r,status:'running'},project(graph)),[]);
});

test('continuing the same visit never counts as a new run of the step',()=>{
 assert.equal(ts.continuesVisit({resolution:'retry: 自动续跑'}),true);
 assert.equal(ts.continuesVisit({resolution:'accept: ok'}),false);assert.equal(ts.continuesVisit(undefined),false);
 const r=run({queue:['review'],visits:{review:3},attempts:[{id:'x',nodeId:'review',visit:3,status:'failed',error:'budget',resolution:'retry: 自动续跑'}]});
 assert.deepEqual(ts.limitStops(r),[]);
});

test('run totals, a blocked return edge and a spent segment budget each get a raise',()=>{
 const graph=structuredClone(run().version.graph);graph.maxTokens=600000;
 const spent=run({tokens:300000});assert.deepEqual(ts.limitStops(spent,project(graph)).map(s=>[s.kind,s.current,s.design]),[['runTokens',300000,600000]]);
 const short=run({status:'failed',attempts:[{id:'x',nodeId:'work',visit:1,status:'failed',error:'本次运行还剩 800 tokens（上限 300000，已用 299200），不足以再开一段（至少要 20000）。'}]});
 assert.equal(ts.limitStops(short)[0].kind,'runTokens');
 const edge=run({traversals:{back:2},events:[{id:'e',at:1,kind:'limit',text:'连线「返工」达到次数上限',nodeId:'review',edgeId:'back'}]});
 assert.deepEqual(ts.limitStops(edge).map(s=>[s.kind,s.target,s.current]),[['traversals','back',2]]);
 const stage=run({status:'uncertain',attempts:[{id:'x',nodeId:'talk',visit:1,status:'uncertain',error:'Error: 剩余阶段预算不足以发送下一轮；接着跑会开启下一阶段预算'}]});
 assert.deepEqual(ts.limitStops(stage,project(graph)).map(s=>[s.kind,s.target,s.design]),[['memberTokens','a',80000],['memberTokens','b',undefined]]);
});

test('the time limit counts only time spent running, not time the run sat stopped',()=>{
 const m=60_000,now=Date.now(),t0=now-30*60*m;
 const r=run({createdAt:t0,attempts:[
  {id:'a',nodeId:'work',visit:1,status:'completed',startedAt:t0,endedAt:t0+10*m},
  {id:'b',nodeId:'review',visit:1,status:'completed',startedAt:t0+5*m,endedAt:t0+20*m},
  {id:'c',nodeId:'talk',visit:1,status:'uncertain',startedAt:t0+60*m}],
  events:[{id:'s',at:t0+60*m,kind:'start',text:'四方评议讨论'},{id:'p',at:t0+90*m,kind:'pause',text:'用户停止运行'}]});
 assert.equal(ts.activeMinutes(r,now),50,'overlapping steps count once; an interrupted step runs until the stop');
 assert.deepEqual(ts.limitStops(r,undefined,now),[],'thirty hours stopped does not use up a 120-minute limit');
 const long=run({attempts:[{id:'a',nodeId:'work',visit:1,status:'running',startedAt:now-150*m}]});
 assert.deepEqual(ts.limitStops(long,undefined,now).map(s=>[s.kind,s.current,s.used]),[['runMinutes',120,150]]);
});

test('a design value already used up is not offered as the fix',()=>{
 const graph=structuredClone(run().version.graph);graph.maxTokens=320000;
 assert.deepEqual(ts.limitStops(run({tokens:350000}),project(graph)).map(s=>[s.kind,s.current,s.used,s.design]),[['runTokens',300000,350000,undefined]]);
 graph.maxTokens=600000;
 assert.deepEqual(ts.limitStops(run({tokens:350000}),project(graph)).map(s=>s.design),[600000]);
});
