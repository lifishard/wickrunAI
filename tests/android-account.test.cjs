const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {loader}=require('./load-ts.cjs');
function fixture(user=null,platform='android'){
  const values=new Map(),calls=[];
  let active=user,fail=false;
  const plugin={state:async()=>{if(fail)throw Error('vault unavailable');return {user:active?{id:active}:null,pending:null,ready:null};},
    addListener:async()=>({remove:async()=>{}}),
    call:async({action,input})=>{calls.push({action,input});if(action==='keys')return {ids:['existing']};return {};},
    activate:async()=>{},logout:async()=>{throw Error('network unavailable');}};
  const api=loader({'@capacitor/core':{Capacitor:{getPlatform:()=>platform},registerPlugin:()=>plugin},
    '@capacitor/preferences':{Preferences:{get:async({key})=>({value:values.get(key)??null})}},
    './native-secrets':{nativeSecretGet:async id=>'key-for-'+id}})(path.resolve(__dirname,'../src/lib/android-account.ts'));
  return {api,values,calls,plugin,setUser:id=>{active=id;},fail:()=>{fail=true;}};
}
test('Android refuses storage access until encrypted account state has loaded',async()=>{
  const f=fixture('alice');assert.throws(()=>f.api.accountStorageKey('chat'));
  f.fail();await assert.rejects(f.api.initializeAndroidAccount());assert.throws(()=>f.api.accountStorageKey('chat'));
});
test('guest and distinct account namespaces preserve existing data across logout and relogin',async()=>{
  const f=fixture();await f.api.initializeAndroidAccount();
  const store=new Map([[f.api.accountStorageKey('chat'),'guest draft']]);
  f.setUser('alice');await f.api.initializeAndroidAccount();store.set(f.api.accountStorageKey('chat'),'alice chat');
  f.setUser('bob');await f.api.initializeAndroidAccount();assert.equal(store.get(f.api.accountStorageKey('chat')),undefined);
  f.setUser('alice');await f.api.initializeAndroidAccount();assert.equal(store.get(f.api.accountStorageKey('chat')),'alice chat');
  f.setUser(null);await f.api.initializeAndroidAccount();assert.equal(store.get(f.api.accountStorageKey('chat')),'guest draft');
  const ios=fixture(null,'ios');assert.equal(ios.api.accountStorageKey('chat'),'chat');
});
test('explicit guest import includes only account content and preserves existing remote secrets',async()=>{
  const f=fixture('alice');
  f.values.set('snc:settings:v1',JSON.stringify({keyProfiles:[{id:'existing'},{id:'new'}]}));
  f.values.set('snc:conversations:v1','["guest"]');f.values.set('unrelated','private');
  const data=await f.api.androidCloudBridge.cloudGuestData();assert.equal(data.unrelated,undefined);assert.equal(data['snc:conversations:v1'],'["guest"]');
  await f.api.androidCloudBridge.cloudCall('importGuestKeys');
  assert.deepEqual(f.calls.filter(x=>x.action==='keySet'),[{action:'keySet',input:{id:'new',value:'key-for-new'}}]);
  assert.equal(f.values.get('snc:conversations:v1'),'["guest"]');
});
test('native HTTP status reaches revision conflict handling and failed logout keeps the account scope',async()=>{
  const f=fixture('alice');await f.api.initializeAndroidAccount();
  f.plugin.call=async()=>{throw Object.assign(Error('conflict'),{code:'409'});};
  await assert.rejects(f.api.androidCloudBridge.cloudCall('write'),error=>error.status===409);
  await assert.rejects(f.api.androidCloudBridge.cloudSwitch(true),/network/);
  assert.equal(f.api.accountStorageKey('chat'),'wickrun:account:alice:chat');
});
