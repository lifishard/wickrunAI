const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createCloudAccount,ORIGIN}=require('../electron/cloud-account.cjs');

function fixture(t,fetcher){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-cloud-test-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const paths={userData:base,sessionData:base},opened=[];
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)};
  const options={app:{getPath:k=>paths[k],setPath:(k,v)=>{paths[k]=v;}},safeStorage,openExternal:async url=>opened.push(url),fetcher};
  return {base,paths,opened,options,create:()=>createCloudAccount(options)};
}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const requestId='a'.repeat(64), token='x'.repeat(43),user={id:'alice',email:'alice@example.test',name:'Alice'};
const start={requestId,code:'AABB0011',loginUrl:ORIGIN+'/api/cloud/desktop/approve?request='+requestId};

test('desktop browser login keeps credentials in main, serializes polling and isolates account storage',async t=>{
  let challenge,requests=0;
  const f=fixture(t,async(url,options)=>{
    assert.equal(new URL(url).origin,ORIGIN);assert.equal(options.redirect,'error');
    if(url.endsWith('/start')){challenge=JSON.parse(options.body).challenge;return response(start);}
    if(url.endsWith('/token')){requests++;const body=JSON.parse(options.body);assert.equal(createHash('sha256').update(body.verifier).digest('base64url'),challenge);await new Promise(r=>setTimeout(r,10));return response({token,user});}
    assert.equal(options.headers.Authorization,'Bearer '+token);
    return response({ok:true});
  });
  const account=f.create();assert.equal(account.activeId,null);
  await account.login();assert.deepEqual(f.opened,[start.loginUrl]);
  const results=await Promise.all([account.poll(),account.poll()]);assert.equal(requests,1);
  assert(!JSON.stringify(results).includes(token));assert(!JSON.stringify(account.state()).includes(token));
  account.activate();
  const registry=fs.readFileSync(path.join(f.base,'cloud-accounts.json'),'utf8');assert(!registry.includes(token));
  const signed=f.create();assert.equal(signed.activeId,'alice');assert.equal(f.paths.userData,path.join(f.base,'cloud-profiles',createHash('sha256').update('alice').digest('hex')));
  assert.equal(f.paths.sessionData,f.paths.userData);await signed.call('read');
  await signed.logout();assert.equal(JSON.parse(fs.readFileSync(path.join(f.base,'cloud-accounts.json'),'utf8')).active,null);
});

test('desktop rejects untrusted login destinations and plaintext credential storage',async t=>{
  const f=fixture(t,async()=>response({...start,loginUrl:'https://untrusted.example/'}));
  await assert.rejects(f.create().login(),/Invalid desktop authorization/);assert.equal(f.opened.length,0);
  f.options.safeStorage.getSelectedStorageBackend=()=> 'basic_text';
  await assert.rejects(f.create().login(),/Secure system storage/);
});

test('guest import exposes only selected data and imports keys without overwriting account keys',async t=>{
  const uploaded=[];
  const f=fixture(t,async(url,options)=>{
    if(url.endsWith('/keys'))return response({ids:['existing']});
    uploaded.push({url,body:JSON.parse(options.body)});return response({ok:true});
  });
  fs.writeFileSync(path.join(f.base,'cloud-accounts.json'),JSON.stringify({active:'alice',accounts:{alice:{user,token:Buffer.from('encrypted:'+token).toString('base64')}}}));
  fs.writeFileSync(path.join(f.base,'store.json'),JSON.stringify({kv:{'snc:settings:v1':JSON.stringify({keyProfiles:[{id:'existing'},{id:'new'}]}),'snc:projects:v1':'[]','private-device-data':'hidden'},secrets:{existing:{enc:false,v:'old-key'},new:{enc:true,v:Buffer.from('encrypted:import-key').toString('base64')}}}));
  const account=f.create();const data=account.guestData();assert.equal(data['private-device-data'],undefined);assert(!JSON.stringify(data).includes('import-key'));
  await account.call('importGuestKeys');assert.equal(uploaded.length,1);assert(uploaded[0].url.endsWith('/new'));assert.equal(uploaded[0].body.value,'import-key');
  await assert.rejects(account.call('keyGet',{id:'../../other'}),/Unsupported/);
});

test('relay requests stay under /api/cloud/relay/ and use the bearer token',async t=>{
  const seen=[];
  const f=fixture(t,async(url,options)=>{seen.push({url,auth:options.headers.Authorization});return response({task:null});});
  fs.writeFileSync(path.join(f.base,'cloud-accounts.json'),JSON.stringify({active:'alice',accounts:{alice:{user,token:Buffer.from('encrypted:'+token).toString('base64')}}}));
  const account=f.create();
  assert.equal(account.signedIn(),true);
  assert.deepEqual(await account.relay('/api/cloud/relay/devices/claim','POST',{device:'desktop-000000000000'}),{task:null});
  assert.equal(seen[0].url,ORIGIN+'/api/cloud/relay/devices/claim');
  assert.equal(seen[0].auth,'Bearer '+token);
  await assert.rejects(account.relay('/api/cloud/keys','GET'),/Unsupported relay/);
  await assert.rejects(account.relay('/api/cloud/relay/../keys','GET'),/Unsupported relay/);
});
