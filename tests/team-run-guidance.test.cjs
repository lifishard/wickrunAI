const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const {teamRunGuidance,teamPendingQuestions}=loader()(path.resolve('src/lib/team-run-guidance.ts'));
function run(status='running',state={}){return {status,queue:[],events:[],members:[],version:{graph:{nodes:[{id:'end',type:'end'}]}},attempts:[{id:'a',nodeId:'work',status:'running',output:'',steps:[],memberStates:{m:state}}]};}
test('structured retry state is distinct from generic progress and clears on terminal states',()=>{
 const r=run('running',{status:'waiting',waitKind:'quota',nextRetryAt:100});assert.equal(teamRunGuidance(r).kind,'retry');assert.equal(teamRunGuidance(r).retryAt,100);
 r.attempts[0].notice='429 retry soon';r.attempts[0].memberStates={};assert.equal(teamRunGuidance(r).kind,'working');
 r.status='completed';assert.equal(teamRunGuidance(r).kind,'done');
});
test('question, approval, delivery and unknown effects produce different actions',()=>{
 const r=run('uncertain',{userQuestion:{request:{id:'q',questions:[]},callId:'call'}});assert.equal(teamRunGuidance(r).kind,'question');assert.equal(teamPendingQuestions(r).length,1);
 r.attempts[0].memberStates.m.uncertainCallId='write';assert.equal(teamRunGuidance(r).kind,'verify');delete r.attempts[0].memberStates.m.uncertainCallId;
 r.pendingApproval={nodeId:'a',text:'tool'};assert.equal(teamRunGuidance(r).kind,'approval');r.pendingApproval.nodeId='end';assert.equal(teamRunGuidance(r).kind,'accept');
 r.status='cancelled';assert.equal(teamPendingQuestions(r).length,0);
});
test('superseded or answered questions are never shown again',()=>{
 const r=run('paused',{userQuestion:{request:{id:'q',questions:[]},callId:'call'}});r.attempts.push({...r.attempts[0],id:'b',memberStates:{}});assert.equal(teamPendingQuestions(r).length,0);
 r.attempts.pop();r.attempts[0].memberStates.m.userQuestion.answers={q:{selected:[],text:'answer'}};assert.equal(teamPendingQuestions(r).length,0);
});
