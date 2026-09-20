'use strict';
// Read-only verification of the isolated synthetic desktop fixture. Never writes app data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const data=process.argv[2],httpLog=process.argv[3];
assert.ok(data&&httpLog,'usage: node verify-desktop.cjs <isolated-userData> <synthetic-http.jsonl>');
const project=JSON.parse(fs.readFileSync(path.join(data,'collaboration-v1.json'),'utf8')).projects['stagnation-review-2173'];
assert.ok(project,'Only the named synthetic desktop fixture is supported');
const runs=[...project.runs].sort((a,b)=>a.createdAt-b.createdAt),run=runs.at(-1);
const type=a=>run.version.graph.nodes.find(n=>n.id===a.nodeId).type;
const work=run.attempts.filter(a=>type(a)==='agent'),reviews=run.attempts.filter(a=>type(a)==='review');
assert.equal(run.status,'completed');assert.equal(work.length,2);assert.equal(reviews.length,3);
assert.deepEqual(reviews.map(a=>a.textReview.verdict),['fail','fail','fail']);
assert.equal(work[0].output,work[1].output);
assert.deepEqual(reviews[2].inputTexts,reviews[1].inputTexts);
assert.deepEqual(reviews[2].reviewStagnation,reviews[1].reviewStagnation);
assert.match(reviews[1].resolution,/^retry:/);assert.match(reviews[2].resolution,/^accept:/);
for(const review of reviews){assert.equal(JSON.parse(review.state.content).verdict,'fail');assert.equal(review.state.spentTokens,200);}
assert.equal(run.tokens,1000);assert.deepEqual(run.reservations,{});
const requests=run.attempts.flatMap(a=>a.state?.requestStats??[]);
assert.equal(requests.length,5);assert.equal(new Set(requests.map(r=>r.requestId)).size,5);
assert.equal(requests.reduce((sum,r)=>sum+r.actualInput+r.output,0),1000);
assert.ok(requests.every(r=>r.httpStatus===200&&r.route.startsWith('http://127.0.0.1:9340::')));
const wire=fs.readFileSync(httpLog,'utf8').trim().split(/\r?\n/).map(line=>JSON.parse(line)).filter(r=>r.at>=run.createdAt);
assert.equal(wire.length,5);assert.equal(wire.filter(r=>r.kind==='fixed_text').length,2);
const repo=path.resolve(__dirname,'../../..'),hash=file=>crypto.createHash('sha256').update(fs.readFileSync(path.join(repo,file))).digest('hex');
const report={fixture:'Actual Electron UI + real runAgent + localhost synthetic HTTP',version:'2.17.3',runId:run.id,
  createdAt:run.createdAt,status:run.status,rendererReloadBeforeExplicitRetry:true,osProcessRestartTested:false,
  qualityConclusion:'Control flow accepted manually; all model review verdicts remain fail. No supplier quality claim.',
  totals:{workerCalls:work.length,reviewCalls:reviews.length,requests:requests.length,fixtureTokens:run.tokens},
  sourceHashes:Object.fromEntries(['src/lib/team-runtime.ts','src/lib/team-stagnation.ts','src/lib/collaboration.ts','dist/index.html'].map(f=>[f,hash(f)])),
  attempts:run.attempts.map(a=>({id:a.id,type:type(a),visit:a.visit,status:a.status,outcome:a.outcome,output:a.output,
    inputTexts:a.inputTexts,textReview:a.textReview,reviewStagnation:a.reviewStagnation,resolution:a.resolution,
    checkpoint:a.state?{content:a.state.content,spentTokens:a.state.spentTokens,requestStats:a.state.requestStats}:undefined})),
  events:run.events,wire,
  earlierTrials:runs.slice(0,-1).map(r=>({id:r.id,status:r.status,tokens:r.tokens,createdAt:r.createdAt,
    errors:r.attempts.filter(a=>a.error).map(a=>a.error)}))};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
