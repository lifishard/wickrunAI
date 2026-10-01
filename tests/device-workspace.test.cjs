const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {chooseDeviceWorkspace,profilePath,adoptLocalButler}=require('../electron/device-workspace.cjs');
function fixture(t){const base=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-workspace-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));return base;}
function save(directory,kv,secrets={}){fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'store.json'),JSON.stringify({kv,secrets}));}
const original={'snc:conversations:v1':'[{"id":"old-chat"}]','snc:projects:v1':'[{"id":"old-project","memoryItems":[{"text":"remember"}]}]','snc:settings:v1':'{"keyProfiles":[{"id":"own-key"}]}'};
test('first login continues every device file without copying or replacing it',t=>{
  const base=fixture(t);save(base,original,{'own-key':{enc:true,v:'protected-key'}});
  fs.mkdirSync(path.join(base,'runtime-v2'));fs.writeFileSync(path.join(base,'runtime-v2','run.json'),'history');
  const before=fs.readFileSync(path.join(base,'store.json'));
  const registry={active:'alice',accounts:{alice:{}}};
  const result=chooseDeviceWorkspace(base,registry,'alice',{firstLogin:true});
  assert.equal(result.directory,base);assert.equal(registry.deviceWorkspaceOwner,'alice');
  assert.deepEqual(fs.readFileSync(path.join(base,'store.json')),before);
  assert.equal(fs.readFileSync(path.join(result.directory,'runtime-v2','run.json'),'utf8'),'history');
});
test('old lone empty account is repaired while account data and other identities prevent adoption',t=>{
  const base=fixture(t);save(base,original);
  const profile=profilePath(base,'alice');save(profile,{'snc:conversations:v1':'[]','snc:projects:v1':'[]','snc:settings:v1':'{"keyProfiles":[]}'});
  let registry={active:'alice',accounts:{alice:{}}};
  assert.equal(chooseDeviceWorkspace(base,registry,'alice').directory,base);
  assert(fs.existsSync(path.join(profile,'store.json')));
  registry={active:'alice',accounts:{alice:{}}};save(profile,{'snc:conversations:v1':'[{"id":"new-chat"}]'});
  assert.equal(chooseDeviceWorkspace(base,registry,'alice').directory,profile);assert.equal(registry.deviceWorkspaceOwner,undefined);
  save(profile,{});fs.mkdirSync(profilePath(base,'bob'),{recursive:true});
  assert.equal(chooseDeviceWorkspace(base,registry,'alice').directory,profile);
});
test('logout and a later identity never claim the first identity device workspace',t=>{
  const base=fixture(t);save(base,original);
  const registry={active:'bob',accounts:{bob:{}},deviceWorkspaceOwner:'alice'};
  assert.equal(chooseDeviceWorkspace(base,registry,'bob',{firstLogin:true}).directory,profilePath(base,'bob'));
  assert.equal(chooseDeviceWorkspace(base,registry,'alice').directory,base);
  assert.equal(registry.deviceWorkspaceOwner,'alice');
});
test('file sessions and meeting-only work prevent treating an account as empty',t=>{
  const base=fixture(t);save(base,original);const profile=profilePath(base,'alice');save(profile,{});
  fs.mkdirSync(path.join(profile,'team-files'));fs.writeFileSync(path.join(profile,'team-files','session.json'),'{}');
  assert.equal(chooseDeviceWorkspace(base,{accounts:{alice:{}}},'alice').directory,profile);
  const anotherBase=fixture(t);save(anotherBase,original);const other=profilePath(anotherBase,'alice');save(other,{});
  fs.writeFileSync(path.join(other,'meetings-v1.json'),'{"version":1,"rooms":[{"id":"room"}]}');
  assert.equal(chooseDeviceWorkspace(anotherBase,{accounts:{alice:{}}},'alice').directory,other);
});
test('standalone device histories prevent an old account profile from claiming guest work',t=>{
  for(const name of ['brain-sessions.json','brain-global.json','cloud-relay.json','chrome-connection.json']){
    const base=fixture(t);save(base,original);const profile=profilePath(base,'alice');save(profile,{});
    fs.writeFileSync(path.join(profile,name),'{}');
    assert.equal(chooseDeviceWorkspace(base,{accounts:{alice:{}}},'alice').directory,profile,name);
  }
  for(const name of ['native-ai','cloud-relay-runs','chrome-profile','conversation-clients','client-work']){
    const base=fixture(t);save(base,original);const profile=profilePath(base,'alice');save(profile,{});
    fs.mkdirSync(path.join(profile,name));fs.writeFileSync(path.join(profile,name,'work.json'),'{}');
    assert.equal(chooseDeviceWorkspace(base,{accounts:{alice:{}}},'alice').directory,profile,name);
  }
});
test('Butler encrypted empty defaults permit repair only after decoding; real history remains isolated',t=>{
  const base=fixture(t);save(base,original);const profile=profilePath(base,'alice');save(profile,{});
  const butler=path.join(profile,'butler-local');fs.mkdirSync(butler);
  const safeStorage={isEncryptionAvailable:()=>true,decryptString:buffer=>buffer.toString('utf8')};
  const encrypted=value=>({version:1,encrypted:true,data:Buffer.from(JSON.stringify(value)).toString('base64')});
  const choose=options=>chooseDeviceWorkspace(base,{accounts:{alice:{}}},'alice',options);
  fs.writeFileSync(path.join(butler,'collector.json'),JSON.stringify({consent:{browser:false},allowlist:{browser:[]},privacy:{categories:{contact:'redact',financial:'redact',health:'exclude'}}}));
  fs.writeFileSync(path.join(butler,'events.json'),JSON.stringify(encrypted([])));
  assert.throws(()=>choose(),/无法检查/);
  assert.equal(choose({safeStorage}).directory,base);
  fs.writeFileSync(path.join(butler,'collector.json'),JSON.stringify({consent:{browser:true}}));
  assert.equal(choose({safeStorage}).directory,profile);
  fs.writeFileSync(path.join(butler,'collector.json'),'{}');
  fs.writeFileSync(path.join(butler,'events.json'),JSON.stringify(encrypted([{at:1,text:'private activity'}])));
  assert.equal(choose({safeStorage}).directory,profile);
  fs.writeFileSync(path.join(butler,'events.json'),JSON.stringify({version:1,encrypted:true,data:'bad%%'}));
  assert.throws(()=>choose({safeStorage}),/格式无效/);
  fs.writeFileSync(path.join(butler,'events.json'),JSON.stringify(encrypted({not:'an array'})));
  assert.throws(()=>choose({safeStorage}),/结构无效/);
  assert.throws(()=>choose({safeStorage:{...safeStorage,decryptString:()=>{throw Error('locked');}}}),/无法解密/);
});
test('invalid stored records fail closed instead of concealing them behind an empty workspace',t=>{
  const base=fixture(t);save(base,{'snc:conversations:v1':'bad json'});
  assert.throws(()=>chooseDeviceWorkspace(base,{active:'alice',accounts:{alice:{}}},'alice'),SyntaxError);
});
test('adoption preserves private Butler records and checkpoints with a recovery copy',t=>{
  const base=fixture(t);
  const brain={schema:1,accountId:'guest',signals:[{id:'s',accountId:'guest',summary:'personal'}],jobs:[{id:'j',accountId:'guest',status:'paused'}],actionGrants:[]};
  save(base,{'wickrun:butler:brain:v1':JSON.stringify(brain),'wickrun:butler:checkpoints:v1':JSON.stringify({accountId:'guest',sessions:{j:{fingerprint:'saved'}}}),...original});
  const before=fs.readFileSync(path.join(base,'store.json'));
  assert.equal(adoptLocalButler(base,'alice'),true);
  assert.deepEqual(fs.readFileSync(path.join(base,'store.json.before-account-workspace')),before);
  const saved=JSON.parse(fs.readFileSync(path.join(base,'store.json'),'utf8'));
  assert.equal(JSON.parse(saved.kv['wickrun:butler:brain:v1']).signals[0].accountId,'alice');
  assert.equal(JSON.parse(saved.kv['wickrun:butler:checkpoints:v1']).sessions.j.fingerprint,'saved');
  assert.equal(saved.kv['snc:projects:v1'],original['snc:projects:v1']);
  assert.equal(adoptLocalButler(base,'bob'),false);
  assert.equal(adoptLocalButler(base,'alice'),false);
});
