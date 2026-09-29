const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {loader}=require('./load-ts.cjs');
const f=p=>path.resolve(__dirname,'..',p);
const LIMIT='inference exceeds tpm/rpm limit (code ModelAccountTpmRateLimitExceeded)';
const profile={id:'key',name:'API',baseUrl:'https://gateway.test/v1',hasSecret:true};

/** Real assistant-request, pacing policy and error classification; only the wire is faked. */
function setup(replies){
 const calls=[],transport={
  async chat(init,h){calls.push(init);const reply=replies[calls.length-1];
   if(reply.error){h.onResponse?.(reply.status,reply.headers??{});h.onError(reply.error,reply.status);return;}
   h.onDispatch?.();h.onResponse?.(200,reply.headers??{});h.onContent(reply.text);h.onDone();},
  async abort(){}};
 const load=loader({'./transport':{getTransport:()=>transport},'./store':{secretGet:async()=>'sk-test',uid:()=>'id'}});
 const {requestAssistant}=load(f('src/lib/assistant-request.ts')),{defaultGenerationConfig}=load(f('src/lib/paramSchema.ts')),adaptive=load(f('src/lib/adaptive.ts'));
 return {calls,requestAssistant,adaptive,config:{...defaultGenerationConfig(),model:'m',stream:false}};
}

test('butler request waits out a TPM/RPM limit like the single agent, learns it, and retries on the shared ledger',async()=>{
 const {calls,requestAssistant,adaptive,config}=setup([{error:LIMIT,status:429,headers:{'retry-after':'1'}},{text:'{"message":"ok"}'}]);
 const learned=[],waits=[],started=Date.now();
 const text=await requestAssistant(profile,config,'plan',new AbortController().signal,'system',undefined,{autoRetry:2,onLearnLimit:l=>learned.push(l),onWait:ms=>waits.push(ms)});
 assert.equal(text,'{"message":"ok"}');assert.equal(calls.length,2);
 assert.ok(Date.now()-started>=900,'honours Retry-After before retrying');
 assert.ok(waits.some(ms=>ms>0)&&waits.at(-1)===0,'reports the countdown and clears it');
 assert.equal(learned.length,1);assert.match(learned[0].from,/ModelAccountTpmRateLimitExceeded/);
 for(const init of calls){assert.equal(init.paceKey,adaptive.quotaKey(profile));assert.ok(init.paceTokens>init.paceInput&&init.paceInput>0,'reserves input and output tokens');}
});

test('with automatic retry off the rate limit is reported at once and still learned',async()=>{
 const {calls,requestAssistant,config}=setup([{error:LIMIT,status:429}]);const learned=[];
 await assert.rejects(requestAssistant(profile,config,'plan',new AbortController().signal,'system',undefined,{autoRetry:0,onLearnLimit:l=>learned.push(l)}),/ModelAccountTpmRateLimitExceeded/);
 assert.equal(calls.length,1);assert.equal(learned.length,1);
});

test('stopping during the wait cancels without sending again',async()=>{
 const {calls,requestAssistant,config}=setup([{error:LIMIT,status:429,headers:{'retry-after':'30'}}]);const c=new AbortController();
 const pending=requestAssistant(profile,config,'plan',c.signal,'system',undefined,{autoRetry:2,onWait:ms=>{if(ms>0)c.abort();}});
 await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(calls.length,1);
});

test('other failures and callers without a retry policy keep the single attempt',async()=>{
 let s=setup([{error:'invalid parameter',status:400}]);
 await assert.rejects(s.requestAssistant(profile,s.config,'x',new AbortController().signal,'system',undefined,{autoRetry:2}),/invalid parameter/);assert.equal(s.calls.length,1);
 s=setup([{error:LIMIT,status:429}]);
 await assert.rejects(s.requestAssistant(profile,s.config,'x',new AbortController().signal,'system'),/tpm\/rpm/);assert.equal(s.calls.length,1);
});

test('one shared 429 wait: upstream deadline first, otherwise a full minute window',()=>{
 const {rateLimitDelay,retryAfterMs}=loader()(f('src/lib/pacer.ts'));
 assert.equal(rateLimitDelay(retryAfterMs({'retry-after':'5'})),5000);
 assert.equal(rateLimitDelay(retryAfterMs({})),62000);
 assert.equal(rateLimitDelay(retryAfterMs({'retry-after':'not a date'})),62000);
 assert.equal(rateLimitDelay(retryAfterMs({'retry-after':new Date(Date.now()-5000).toUTCString()})),1000);
 assert.equal(rateLimitDelay(undefined,8000),8000);
});
