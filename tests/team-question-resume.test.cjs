const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');const load=loader({'./store':{uid:()=> 'id'}});
const {TeamRuntime}=load(path.resolve('src/lib/team-runtime.ts'));
function fixture(){
 const state={status:'paused',phase:'tools',toolCursor:0,spentTokens:400,userQuestion:{callId:'call',request:{id:'question',createdAt:1,questions:[{id:'color',question:'Color?',options:[]}]}}};
 const run={id:'run',status:'uncertain',queue:[],events:[],version:{graph:{nodes:[{id:'work',type:'agent'}]}},attempts:[{id:'attempt',nodeId:'work',status:'failed',output:'existing',memberStates:{m:state},state:structuredClone(state),steps:[{id:'done',status:'ok'}]}]};
 const runtime=new TeamRuntime();runtime.project=()=>({runs:[run]});runtime.runUpdate=async(p,id,fn)=>fn(run);let starts=0;runtime.start=async()=>{starts++;};
 return {runtime,run,state,get starts(){return starts;}};
}
test('answer resumes saved cursor while retaining successful operations, tokens and original attempt',async()=>{
 const f=fixture();await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:' blue '}});
 assert.equal(f.state.userQuestion.answers.color.text,'blue');assert.equal(f.state.toolCursor,0);assert.equal(f.state.spentTokens,400);assert.equal(f.run.attempts[0].steps[0].id,'done');assert.match(f.run.attempts[0].resolution,/^retry:/);assert.deepEqual(f.run.queue,['work']);assert.equal(f.starts,1);
 await assert.rejects(f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'red'}}),/已失效/);assert.equal(f.starts,1);
});
test('invalid, stale and unknown-effect answers cannot authorize a retry',async()=>{
 const f=fixture();await assert.rejects(f.runtime.answerQuestion('p','run','question',{}));assert.equal(f.starts,0);
 f.state.uncertainCallId='external-write';await assert.rejects(f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue'}}),/先核实/);assert.equal(f.state.userQuestion.answers,undefined);
 f.run.status='cancelled';await assert.rejects(f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue'}}),/已失效/);assert.equal(f.starts,0);
});
test('draft is persistent but does not count as an answer or start execution',async()=>{
 const f=fixture();await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue '}},true);assert.equal(f.state.userQuestion.draft.color.text,'blue ');assert.equal(f.state.userQuestion.answers,undefined);assert.equal(f.starts,0);
});
test('answering one member does not restart other unresolved operations',async()=>{
 const f=fixture();f.run.attempts.push({id:'other',nodeId:'other',status:'uncertain',memberStates:{},steps:[]});await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue'}});assert.equal(f.starts,0);assert.equal(f.run.status,'uncertain');
});
test('answer cannot verify a crashed in-flight operation before uncertainCallId is set',async()=>{
 const f=fixture();f.state.userQuestion.nonBlocking=true;f.state.steps=[{name:'write_file',callId:'write',status:'running'}];
 await assert.rejects(f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue'}}),/先核实/);assert.equal(f.starts,0);assert.equal(f.run.events.length,0);
 f.state.steps=[{name:'request_user_input',callId:'call',status:'running'}];await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'blue'}});assert.equal(f.starts,1);
});
test('parallel attempts using one member retain independently addressable question handles',async()=>{
 const f=fixture(),second=structuredClone(f.run.attempts[0]);second.id='other';second.nodeId='other';second.memberStates.m.userQuestion.request.id='question-2';f.run.attempts.push(second);const seen=[];
 for(const [id,q] of [['attempt','question'],['other','question-2']])f.runtime.questionHandles.set(`run:${id}:m`,{questionDraft:async(question)=>{assert.equal(question,q);seen.push(question);},answerQuestion:async(question)=>{assert.equal(question,q);seen.push(question);}});
 await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'one'}},true);await f.runtime.answerQuestion('p','run','question-2',{color:{selected:[],text:'two'}},true);
 f.runtime.questionHandles.delete('run:other:m');await f.runtime.answerQuestion('p','run','question',{color:{selected:[],text:'one'}});assert.deepEqual(seen,['question','question-2','question']);assert.equal(f.starts,0);
});
