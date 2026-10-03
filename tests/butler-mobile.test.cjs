const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');

function fixture() {
  const calls=[];
  const state={enabled:false,active:false,serviceGranted:true,notificationGranted:true,allowedPackages:['example.reader'],deniedPackages:[],privateCount:0,
    privacy:{excludedTerms:[],encryptedOnlyTerms:[],categories:{contact:'redact',financial:'redact',health:'exclude'},encryptedStorage:true},background:{supported:true,unrestricted:true}};
  const plugin={getStatus:async()=>({...state}),listApps:async()=>({apps:[]}),
    setDataScopeConsent:async input=>{calls.push({action:'scope',...input});if(!input.version||!input.android){state.enabled=false;state.active=false;}return {...state};},
    setEnabled:async input=>{calls.push({action:'enable',...input});state.enabled=input.enabled;state.active=input.enabled;return {...state};},
    revokeSource:async input=>{calls.push({action:'revoke',...input});state.enabled=false;state.active=false;return {...state};},
    poll:async()=>({items:[]})};
  const load=loader({'@capacitor/core':{Capacitor:{getPlatform:()=> 'android'},registerPlugin:()=>plugin}});
  const api=load(path.resolve(__dirname,'../src/lib/butler-mobile.ts'));
  const {BUTLER_CONSENT_VERSION:version}=load(path.resolve(__dirname,'../src/lib/proactive-butler.ts'));
  return {call:api.androidButlerCollector,plugin,calls,state,version,unlock:{suspended:false,sources:{android:true},dataScopeVersion:version}};
}

test('old runtime unlocks cannot start Android collection without the current data scope',async()=>{
  const f=fixture();let polls=0;f.plugin.poll=async()=>{polls++;return {items:[]};};
  await f.call('suspend',{suspended:false,sources:{android:true}});
  assert.ok(f.calls.every(c=>c.action!=='enable'||!c.enabled));assert.equal(f.calls.find(c=>c.action==='scope').version,0);
  await f.call('poll');assert.equal(polls,0);
  await assert.rejects(f.call('consent',{source:'android',consented:true}),/数据范围/);
  await f.call('suspend',f.unlock);
  assert.ok(f.calls.some(c=>c.action==='enable'&&c.enabled&&c.dataScopeVersion===f.version));
});

test('device source consent while paused does not start native collection',async()=>{
  const f=fixture();await f.call('consent',{source:'android',consented:true,dataScopeVersion:f.version});
  assert.equal(f.calls.length,0);
  await f.call('suspend',{suspended:false,sources:{share:true},dataScopeVersion:f.version});
  assert.deepEqual(f.calls.find(c=>c.action==='scope'),{action:'scope',version:f.version,share:true,android:false});
  assert.ok(f.calls.every(c=>c.action!=='enable'||!c.enabled));
});

test('pause during the native availability check prevents a late capture enable',async()=>{
  const f=fixture();let entered,release;const ready=new Promise(r=>{entered=r;});
  f.plugin.getStatus=()=>{f.plugin.getStatus=async()=>({...f.state});entered();return new Promise(r=>{release=r;});};
  const pending=f.call('suspend',f.unlock);await ready;
  const stopped=f.call('suspend',{suspended:true});release({...f.state});await Promise.all([pending,stopped]);
  assert.ok(f.calls.every(c=>c.action!=='enable'||!c.enabled));assert.equal(f.calls.filter(c=>c.action==='scope').at(-1).version,0);
});

test('a pending native enable settles before revocation and cannot leave capture on',async()=>{
  const f=fixture();let entered,release;const ready=new Promise(r=>{entered=r;});
  const original=f.plugin.setEnabled;f.plugin.setEnabled=async input=>{
    if(input.enabled){entered();await new Promise(r=>{release=r;});}return original(input);
  };
  const pending=f.call('suspend',f.unlock);await ready;
  const revoked=f.call('suspend',{suspended:true});release();await Promise.all([pending,revoked]);
  assert.equal(f.state.enabled,false);assert.equal(f.calls.filter(c=>c.action==='scope').at(-1).version,0);
});

test('a poll completing after pause does not return activity for inference',async()=>{
  const f=fixture();await f.call('suspend',f.unlock);
  let entered,release;const ready=new Promise(r=>{entered=r;});
  f.plugin.poll=()=>{entered();return new Promise(r=>{release=r;});};
  const pending=f.call('poll');await ready;await f.call('suspend',{suspended:true});
  release({items:[{id:'late',kind:'accessibility',packageName:'example.reader',text:'AI skills',capturedAt:100}]});
  const result=await pending;assert.deepEqual(result,{sources:{}});
});

test('a stale runtime source snapshot cannot re-enable collection after a newer revoke',async()=>{
  const f=fixture();await f.call('suspend',{...f.unlock,sourceEpoch:1});assert.equal(f.state.enabled,true);
  await f.call('consent',{source:'android',consented:false,sourceEpoch:2});assert.equal(f.state.enabled,false);
  const count=f.calls.length;await f.call('suspend',{...f.unlock,sourceEpoch:1});
  assert.equal(f.calls.length,count);assert.equal(f.state.enabled,false);
});
