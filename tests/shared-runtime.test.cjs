const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');

const lib=path.resolve(__dirname,'../src/lib');
const shared=loader({[path.join(lib,'cloud-api.ts')]:{cloudCall:async()=>({})}})(path.join(lib,'shared-resources.ts'));
const runtime=loader({[path.join(lib,'shared-resources.ts')]:shared,[path.join(lib,'cloud-api.ts')]:{cloudCall:async()=>({})},[path.join(lib,'transport.ts')]:{getTransport:()=>({})}})(path.join(lib,'shared-runtime.ts'));
const BINDINGS='wickrun:shared:workflow-bindings:v1';
const store=(rows=[])=>{
  const values=new Map(rows.length?[[BINDINGS,JSON.stringify(rows)]]:[]);
  return {values,storage:{kvGet:async key=>values.get(key)??null,kvSet:async(key,value)=>{values.set(key,value);}}};
};
const binding={itemId:'shared-flow',sourceId:'local-flow',accountId:'alice'};
const graph={nodes:[{id:'start',type:'start',title:'Start',x:0,y:0,inputRefs:[],ports:[]}],edges:[],maxSteps:5,maxMinutes:5,maxTokens:1000};
const run=(id,taskId)=>({id,taskId,workflowId:'local-flow',status:'completed',goal:id,acceptance:'done',createdAt:1,updatedAt:2,events:[],attempts:[]});
const data={revision:1,projects:{p:{id:'p',members:[],workflows:[{id:'local-flow',name:'Flow',archived:false,draft:graph}],schedules:[],tasks:[
  {id:'private-task',sourceConversationId:'fork'}, {id:'public-task',sourceConversationId:'public'}],runs:[run('run-private','private-task'),run('run-public','public-task')]}}};

test('empty bindings cause no account check or network access',async()=>{
  const io=store();let accountCalls=0,networkCalls=0;
  await runtime.syncSharedWorkflowRuns(data,[],{storage:io.storage,account:async()=>{accountCalls++;return 'alice';},call:async()=>{networkCalls++;},now:()=>1});
  assert.equal(accountCalls,0);assert.equal(networkCalls,0);
});

test('runtime preserves remote definition edits, retries CAS and excludes transitive private forks',async()=>{
  const io=store([binding]);
  const excluded=shared.sharedPrivateConversationIds([
    {id:'butler',privacy:'personal-butler',config:{}},{id:'fork',forkedFrom:'butler',config:{}},{id:'public',config:{}}
  ]);
  const calls=[];
  const remote=(revision,description)=>({item:{id:'shared-flow',kind:'workflow',revision,payload:{description,definition:{...graph,reviewMode:'manual'},agents:[],schedules:[],runs:[{id:'remote-run',createdAt:0}]},policy:{visibility:'private'}},role:'owner',permissions:{edit:true}});
  let reads=0;
  const services={storage:io.storage,account:async()=> 'alice',now:()=>10,call:async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='get')return remote(++reads===1?4:5,reads===1?'Earlier edit':'Latest collaborator edit');
    if(calls.filter(x=>x.operation==='update').length===1)throw Object.assign(Error('conflict'),{status:409});
    return {};
  }};
  await runtime.syncSharedWorkflowRuns(data,excluded,services);
  const writes=calls.filter(x=>x.operation==='update');
  assert.equal(writes.length,2);
  assert.deepEqual(writes.map(x=>x.input.expectedRevision),[4,5]);
  assert.equal(writes[1].input.payload.description,'Latest collaborator edit');
  assert.equal(writes[1].input.payload.definition.reviewMode,'manual');
  assert.deepEqual(writes[1].input.payload.runs.map(x=>x.id),['remote-run','run-public']);
  assert.equal(JSON.stringify(writes[1]).includes('run-private'),false);
  const count=calls.length;
  await runtime.syncSharedWorkflowRuns(data,excluded,services);
  assert.equal(calls.length,count,'same run snapshot is not republished');
});

test('revoked shared access is cooled down before another read',async()=>{
  const io=store([binding]);let reads=0,time=100;
  const services={storage:io.storage,account:async()=> 'alice',now:()=>time,call:async()=>{reads++;throw Object.assign(Error('revoked'),{status:403});}};
  await assert.rejects(runtime.syncSharedWorkflowRuns(data,[],services),/revoked/);
  assert.equal(reads,1);
  assert.equal(JSON.parse(io.values.get(BINDINGS))[0].retryAt,time+300000);
  time+=1000;
  await runtime.syncSharedWorkflowRuns(data,[],services);
  assert.equal(reads,1);
});
