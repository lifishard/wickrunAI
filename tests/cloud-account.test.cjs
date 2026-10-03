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

test('desktop sign-in uses the public first-party account origin and shows structured server errors',async t=>{
  assert.equal(ORIGIN,'https://wickrunai.com');
  const urls=[];
  const f=fixture(t,async url=>{urls.push(url);return response({error:{message:'Sign-in temporarily unavailable'}},403);});
  await assert.rejects(f.create().login(),error=>error.status===403&&error.message==='Sign-in temporarily unavailable');
  assert.deepEqual(urls,[ORIGIN+'/api/cloud/desktop/start']);
  const html=fixture(t,async()=>new Response('<h1>Forbidden</h1>',{status:403,headers:{'Content-Type':'text/html'}}));
  await assert.rejects(html.create().login(),error=>error.status===403&&error.message==='Cloud request failed (403).');
});

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
  const signed=f.create();assert.equal(signed.activeId,'alice');assert.equal(f.paths.userData,f.base);assert.equal(signed.state().continuesLocalWorkspace,true);
  assert.equal(f.paths.sessionData,f.paths.userData);await signed.call('read');
  await signed.logout();assert.equal(JSON.parse(fs.readFileSync(path.join(f.base,'cloud-accounts.json'),'utf8')).active,null);
  const localAgain=f.create();assert.equal(localAgain.state().user,null);assert.equal(localAgain.state().workspaceAccountId,'alice');
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
  const account=f.create();const data=await account.guestData();assert.equal(data['private-device-data'],undefined);assert(!JSON.stringify(data).includes('import-key'));
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

function signedFixture(t,fetcher){
  const f=fixture(t,fetcher);
  fs.writeFileSync(path.join(f.base,'cloud-accounts.json'),JSON.stringify({active:'alice',accounts:{alice:{user,token:Buffer.from('encrypted:'+token).toString('base64')}}}));
  return f;
}
function gate(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('media preserves body-read timeout classification for safe control retries',async t=>{
  const f=signedFixture(t,async()=>({ok:true,json:async()=>{throw new DOMException('body timed out','TimeoutError');}}));
  await assert.rejects(f.create().media('begin'),error=>error.name==='TimeoutError');
});

test('media exposes structured rate limits and checks the initiating account before requesting',async t=>{
  let calls=0;
  const f=signedFixture(t,async()=>{calls++;return new Response(JSON.stringify({error:'busy',code:'limited'}),{status:429,headers:{'Retry-After':'7'}});});
  const account=f.create();assert.equal(account.mediaAccountId(),'alice');
  await assert.rejects(account.media('begin',{}, {accountId:'bob'}),/账号已切换/);assert.equal(calls,0);
  await assert.rejects(account.media('begin',{}, {accountId:'alice'}),error=>error.status===429&&error.code==='limited'&&error.retryAfter==='7');
});

test('media merges caller cancellation with timeout and cleans caller listeners',async t=>{
  const entered=gate();let cancelled=false;
  const f=signedFixture(t,async(_url,{signal})=>{entered.resolve();return new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true});
  });});
  const account=f.create(),controller=new AbortController();
  const pending=account.media('partUrls',{}, {signal:controller.signal,accountId:'alice'});
  await entered.promise;controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');assert(cancelled);
  assert.equal(require('node:events').getEventListeners(controller.signal,'abort').length,0);
  await assert.rejects(account.media('begin',{}, {signal:controller.signal}),error=>error.name==='AbortError');
});

test('account logout cancels an in-flight media request before accepting its result',async t=>{
  const entered=gate();let cancelled=false;
  const f=signedFixture(t,async(url,{signal})=>{
    if(url.endsWith('/logout'))return response({ok:true});
    entered.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true}));
  });
  const account=f.create();const pending=account.media('complete',{id:'same-id'});
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  await entered.promise;await account.logout();await rejected;assert(cancelled);assert.equal(account.mediaAccountId(),null);
  await assert.rejects(account.media('begin',{}, {accountId:'alice'}),/账号已切换/);
});

test('failed logout retires the old upload lifetime while keeping future media available',async t=>{
  const f=signedFixture(t,async url=>url.endsWith('/logout')?response({error:'offline'},503):response({ok:true}));
  const account=f.create(),old=account.mediaSignal();
  await assert.rejects(account.logout(),error=>error.status===503);assert(old.aborted);
  assert(!account.mediaSignal().aborted);assert.equal(account.mediaAccountId(),'alice');
  assert.deepEqual(await account.media('status'),{ok:true});
});

test('production account wiring cancels a suspended storage PUT immediately on logout',async t=>{
  const entered=gate();let cancelled=false,completed=false;
  const f=signedFixture(t,async(url,options)=>{
    if(url.endsWith('/logout'))return response({ok:true});
    const {operation,input}=JSON.parse(options.body);
    if(operation==='begin')return response({...input,id:'same-id',mode:'multipart',status:'pending',partSize:16*1024**2,partCount:1,completedParts:[]});
    if(operation==='partUrls')return response({parts:[{partNumber:1,url:'https://r2.test/put'}]});
    completed=true;return response({id:'same-id',status:'ready'});
  });
  const account=f.create(),file=path.join(f.base,'sample.bin');fs.writeFileSync(file,'bytes');
  const uploader=require('../electron/media-upload.cjs').createMediaUploader({
    call:(op,input,options)=>account.media(op,input,options),getAccountId:()=>account.mediaAccountId(),getAccountSignal:()=>account.mediaSignal(),
    fetchImpl:async(_url,{signal})=>{entered.resolve();return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled=true;reject(signal.reason);},{once:true}));},
  });
  const pending=uploader.upload({filePath:file}),rejected=assert.rejects(pending,error=>error.name==='AbortError');
  await entered.promise;await account.logout();await rejected;assert(cancelled);assert(!completed);
});

test('scoped shared-file IPC errors preserve retry metadata without exposing signed URLs',async t=>{
 let calls=0;const f=signedFixture(t,async()=>{calls++;return new Response(JSON.stringify({error:'https://signed.invalid?token=private',code:'rate_limited'}),{status:429,headers:{'Retry-After':'7'}});});
 const account=f.create();await assert.rejects(account.call('collaboration',{operation:'fileR2Begin',input:{},expectedAccountId:'bob'}),/账号已切换/);assert.equal(calls,0);
 const result=await account.call('collaboration',{operation:'fileR2Begin',input:{},expectedAccountId:'alice'});
 assert.equal(result.fileTransferError.status,429);assert.equal(result.fileTransferError.retryAfter,'7');assert.equal(result.fileTransferError.code,'rate_limited');assert(!JSON.stringify(result).includes('signed.invalid'));
});

test('scoped shared-file IPC ignores a late response after its account lifetime expires',async t=>{
 const entered=gate(),late=gate();
 const f=signedFixture(t,async(url)=>{if(url.endsWith('/logout'))return response({error:'retry'},503);entered.resolve();await late.promise;return response({status:'ready'});});
 const account=f.create(),pending=account.call('collaboration',{operation:'fileR2Finish',input:{},expectedAccountId:'alice'});
 await entered.promise;await assert.rejects(account.logout());late.resolve();const result=await pending;
 assert.equal(result.fileTransferError.name,'AbortError');assert.equal(result.status,undefined);
});
