'use strict';
// Offline acceptance reporter. Reads only the synthetic collaboration fixture;
// does not load credentials, run models, approve tasks, or mutate application data.
const fs=require('node:fs'),path=require('node:path');
const fixture=require('../tests/fixtures/team-strategy-case.cjs');
const dataDir=process.argv[2];
if(!dataDir)throw Error('Usage: node scripts/report-team-strategy-pilot.cjs <isolated-user-data>');
const data=JSON.parse(fs.readFileSync(path.join(dataDir,'collaboration-v1.json'),'utf8'));
const project=data.projects['strategy-pilot-2171'];
if(!project)throw Error('Expected the isolated strategy-pilot-2171 project');
const runs=project.runs.map(run=>{
 const requests=new Map();
 for(const attempt of run.attempts)for(const state of [attempt.state,...Object.values(attempt.memberStates??{})])for(const stat of state?.requestStats??[])if(stat.requestId)requests.set(stat.requestId,stat);
 const stats=[...requests.values()];
 const session=project.files.find(f=>f.taskId===run.id&&f.memberId==='executor');
 let check={passed:false,failures:['no_output']};
 if(session){
  try{check=fixture.validate(fs.readFileSync(path.join(session.isolatedRoot,'report.json'),'utf8'),fs.readFileSync(path.join(session.isolatedRoot,'input.csv')));}
  catch(e){check={passed:false,failures:[e.code==='ENOENT'?'no_output':'read_error']};}
 }
 const byRoute={};
 for(const stat of stats){
  const key=stat.profileId&&stat.model?stat.profileId+'::'+stat.model:'unknown';
  const group=byRoute[key]??={model:stat.model??null,requests:0,input:0,output:0,missingInput:0,missingOutput:0};
  group.requests++;group.input+=stat.actualInput??0;group.output+=stat.output??0;
  group.missingInput+=Number(stat.actualInput===undefined);group.missingOutput+=Number(stat.output===undefined);
 }
 const starts=run.events.filter(e=>e.kind==='start').map(e=>e.at);
 const ends=run.attempts.filter(a=>!['start','end'].includes(run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type)).map(a=>a.endedAt??a.state?.at??a.startedAt);
 return {runId:run.id,strategy:run.taskId,status:run.status,programCheck:check,
  elapsedExecutionMs:starts.length&&ends.length?Math.max(...ends)-Math.min(...starts):null,
  modelRoutes:Object.values(byRoute),tokensReservedOrSpent:run.tokens,
  reviews:run.attempts.filter(a=>a.review).map(a=>({attemptId:a.id,...a.review})),
  artifacts:run.attempts.flatMap(a=>a.artifacts??[]).map(a=>({id:a.id,version:a.version,digest:a.digest,files:a.files})),
  approvals:run.events.filter(e=>e.kind==='approval').map(e=>({at:e.at,approved:e.approved})),
  failures:run.attempts.filter(a=>a.error).map(a=>({nodeType:run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type,status:a.status,error:a.error})),
  requestOutcomes:stats.map(s=>({id:s.requestId,model:s.model??null,purpose:s.purpose,outcome:s.outcome,httpStatus:s.httpStatus??null,failureKind:s.failureKind??null})),
 };
});
process.stdout.write(JSON.stringify({version:1,fixture:fixture.id,inputHash:fixture.digest(fixture.input),
 usageSource:'gateway_reported_or_missing',sampleLimit:'One synthetic case per strategy; no quality ranking or monetary inference.',runs},null,2)+'\n');
