const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const vm=require('node:vm');
const {createButlerSources,domainAllowlist,publicUrl,redactExcerpt,browserContentScript}=require('../electron/butler-sources.cjs');
const {windowsScript,readForegroundText,desktopSourceStatus}=require('../electron/butler-desktop-source.cjs');

const make=()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-test-'));
  const collector=createButlerSources({userData:dir,platform:'linux',env:{},desktopStatus:()=>({available:true,note:'test'}),
    readDesktop:async()=>({processName:'editor.exe',title:'AI skills notes',text:'AI skills and investment strategy'})});
  return {dir,collector};
};
const origin='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const post=(port,token,data,headers={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:'/ingest',method:'POST',headers:{origin,'x-butler-token':token,'content-type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
  req.on('error',reject);req.end(JSON.stringify(data));
});

test('browser collection is blocked until exact scope, device consent and runtime unlock',async t=>{
  const {dir,collector}=make();t.after(()=>collector.close());
  const local=path.join(dir,'butler-local');
  const first=await collector.action('status');assert.equal(first.sources.browser.consented,false);
  await assert.rejects(collector.action('consent',{source:'browser',consented:true}),/allowlist/);
  await collector.action('configure',{source:'browser',allowlist:['example.com','*.example.com','localhost','mail.google.com']});
  const installed=await collector.action('install-browser-extension');
  const manifest=JSON.parse(fs.readFileSync(path.join(installed.extensionPath,'manifest.json'),'utf8'));
  assert.deepEqual(manifest.content_scripts[0].matches,['https://example.com/*']);
  assert.equal(manifest.incognito,'not_allowed');
  assert.equal(manifest.host_permissions.some(x=>x.includes('*.' )),false);
  const content=fs.readFileSync(path.join(installed.extensionPath,'content.js'),'utf8');
  assert.match(content,/contenteditable/);assert.match(content,/getClientRects/);assert.match(content,/article, main/);
  const cfg=JSON.parse(fs.readFileSync(path.join(local,'collector.json'),'utf8'));
  const page={kind:'butler-page',url:'https://example.com/ai-skills?q=learn',title:'AI skills',text:'Prompt engineering and AI agent skills'};
  assert.equal(await post(cfg.port,cfg.token,page),403);
  await collector.action('consent',{source:'browser',consented:true});
  assert.equal(await post(cfg.port,cfg.token,page),403);
  await collector.action('suspend',{suspended:false,sources:{browser:true},mode:'redacted-context'});
  assert.equal(await post(cfg.port,'wrong',page),403);
  assert.equal(await post(cfg.port,cfg.token,page,{origin:'https://evil.example'}),403);
  assert.equal(await post(cfg.port,cfg.token,{...page,url:'https://other.example/ai-skills'}),400);
  assert.equal(await post(cfg.port,cfg.token,{...page,url:'https://example.com/messages/ai'}),400);
  assert.equal(await post(cfg.port,cfg.token,{...page,text:'password: my-secret-value AI skills'}),400);
  assert.equal(await post(cfg.port,cfg.token,page),204);
  const polled=await collector.action('poll');
  assert.equal(polled.signals.length,1);
  assert.equal(polled.signals[0].topic,'AI 工具与技能');
  assert.doesNotMatch(JSON.stringify(polled.signals),/example\.com|Prompt engineering|q=learn/);
  assert.equal(polled.contexts.length,1);
  const stored=JSON.parse(fs.readFileSync(path.join(local,'events.json'),'utf8'));
  assert.equal(stored.length,1);assert.equal(stored[0].url,'https://example.com/ai-skills');
  await collector.action('consent',{source:'browser',consented:false});
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(local,'events.json'),'utf8')),[]);
  assert.equal(await post(cfg.port,cfg.token,page),403);
});

test('redacted contexts are bounded and absent in local-topics mode',async t=>{
  const {collector}=make();t.after(()=>collector.close());
  await collector.action('configure',{source:'desktop',allowlist:['editor.exe']});
  await collector.action('consent',{source:'desktop',consented:true});
  await collector.action('suspend',{suspended:false,sources:{desktop:true},mode:'redacted-context'});
  const one=await collector.action('poll');
  assert.equal(one.signals[0].topic,'AI 工具与技能');
  assert.equal(one.contexts.length,1);
  assert.equal(one.contexts[0].text.length<=2000,true);
  await collector.action('suspend',{suspended:false,sources:{desktop:true},mode:'local-topics'});
  const two=await collector.action('poll');assert.equal(Object.hasOwn(two,'contexts'),false);
  assert.match(redactExcerpt('contact alice@example.com; token: abc123; +1 (604) 555-1234'),/\[email\]/);
  assert.doesNotMatch(redactExcerpt('contact alice@example.com; token: abc123; +1 (604) 555-1234'),/abc123|alice@example.com/);
});

test('share links are public HTTPS only and never claim page or video was read',async t=>{
  const {collector}=make();t.after(()=>collector.close());
  await collector.action('consent',{source:'share',consented:true});
  await collector.action('suspend',{suspended:false,sources:{share:true},mode:'redacted-context'});
  for(const url of ['http://example.com/ai','https://localhost/ai','https://127.0.0.1/ai','https://user:pass@example.com/ai','https://example.com/ai?token=abc'])
    await assert.rejects(collector.action('import-link',{url}),/public HTTPS/);
  const result=await collector.action('import-link',{url:'https://example.com/ai-skills'});
  assert.match(result.note,/未读取页面正文/);
  assert.equal(result.signals[0].topic,'AI 工具与技能');
  assert.doesNotMatch(JSON.stringify(result.signals),/example\.com/);
  assert.deepEqual(domainAllowlist(['example.com','*.example.com','localhost','mail.google.com']),['example.com']);
  assert.equal(publicUrl('https://example.com/ai?x=1'),null);
});

test('desktop probe script enforces process whitelist and skips password/edit/offscreen nodes',async()=>{
  const script=windowsScript(['editor.exe']);
  assert.match(script,/IsPassword/);assert.match(script,/IsOffscreen/);assert.match(script,/ControlType]::Edit/);
  assert.match(script,/\$allowed -notcontains \$processName/);
  let encoded='';
  const fakeExec=(_cmd,args,_opts,cb)=>{encoded=Buffer.from(args.at(-1),'base64').toString('utf16le');cb(null,JSON.stringify({processName:'editor.exe',title:'Notes',text:'AI skills'}));};
  const found=await readForegroundText({allowlist:['editor.exe'],platform:'win32',execFileImpl:fakeExec});
  assert.equal(found.text,'AI skills');assert.match(encoded,/IsPassword/);
  const other=await readForegroundText({allowlist:['different.exe'],platform:'win32',execFileImpl:fakeExec});
  assert.equal(other,null);
  assert.equal(desktopSourceStatus({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0',DISPLAY:':0'}}).available,false);
});

test('desktop collector rechecks returned process against consented allowlist',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-process-'));
  const collector=createButlerSources({userData:dir,platform:'linux',env:{},desktopStatus:()=>({available:true,note:'test'}),
    readDesktop:async()=>({processName:'other.exe',title:'AI skills',text:'AI agent investment'})});
  t.after(()=>collector.close());
  await collector.action('configure',{source:'desktop',allowlist:['editor.exe']});
  await collector.action('consent',{source:'desktop',consented:true});
  await collector.action('suspend',{suspended:false,sources:{desktop:true},mode:'redacted-context'});
  const result=await collector.action('poll');assert.deepEqual(result.signals,[]);
  assert.equal(Object.hasOwn(result,'contexts'),false);
});

test('old local records expire and retention is bounded to 500',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-retention-'));
  const local=path.join(dir,'butler-local');fs.mkdirSync(local);
  fs.writeFileSync(path.join(local,'events.json'),JSON.stringify(Array.from({length:550},(_,i)=>({id:String(i),source:'browser',at:i<10?1:1000,title:'AI',text:'AI skills'}))));
  const collector=createButlerSources({userData:dir,platform:'linux',env:{},desktopStatus:()=>({available:false,note:'test'}),now:()=>1000+24*60*60*1000});
  t.after(()=>collector.close());
  const retained=JSON.parse(fs.readFileSync(path.join(local,'events.json'),'utf8'));
  assert.equal(retained.length,500);assert.equal(retained[0].id,'50');
});

test('SPA capture waits for visible content changes and never resends unchanged text',()=>{
  const sent=[],listeners={},nodes=[{textContent:'AI skills',parentElement:{closest:()=>null}}];
  let callback,timer;
  const root={},documentElement={};
  const document={documentElement,title:'AI skills',visibilityState:'visible',querySelector:()=>root,
    createTreeWalker:()=>({currentNode:null,index:0,nextNode(){if(this.index>=nodes.length)return false;this.currentNode=nodes[this.index++];return true;}}),
    createRange:()=>({selectNodeContents(node){this.node=node;},getClientRects(){return this.node.rects??[{width:100,height:20,top:10,left:0,right:100,bottom:30}];}}),
    addEventListener:(name,fn)=>{listeners[name]=fn;}};
  const window={top:null,addEventListener:(name,fn)=>{listeners[name]=fn;}};window.top=window;
  const context={window,document,location:{protocol:'https:',pathname:'/reels',href:'https://example.com/reels'},
    NodeFilter:{SHOW_TEXT:4},innerHeight:800,innerWidth:1000,getComputedStyle:()=>({display:'block',visibility:'visible'}),
    chrome:{runtime:{sendMessage:message=>sent.push(message)}},
    MutationObserver:class{constructor(fn){callback=fn;}observe(target,opts){assert.equal(target,documentElement);assert.equal(opts.characterData,true);}},
    clearTimeout:()=>{timer=undefined;},setTimeout:(fn,delay)=>{assert.equal(delay,5000);timer=fn;return 1;}};
  vm.runInNewContext(browserContentScript(),context);
  assert.equal(sent.length,0);timer();assert.equal(sent.length,1);
  callback();timer();listeners.scroll();timer();assert.equal(sent.length,1);
  nodes[0].textContent='AI skills new reel';callback();timer();assert.equal(sent.length,2);
  nodes[0].rects=[{width:100,height:20,top:900,left:0,right:100,bottom:920}];callback();timer();assert.equal(sent.length,2);
  document.visibilityState='hidden';nodes[0].textContent='AI skills hidden';listeners.visibilitychange();timer();assert.equal(sent.length,2);
  document.visibilityState='visible';nodes[0].rects=[{width:100,height:20,top:10,left:0,right:100,bottom:30}];listeners.visibilitychange();timer();assert.equal(sent.length,3);
});

test('desktop unchanged content is stable across polls and pending records survive restart until ack',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-ack-'));
  const makeCollector=()=>createButlerSources({userData:dir,platform:'linux',env:{},desktopStatus:()=>({available:true,note:'test'}),
    readDesktop:async()=>({processName:'editor.exe',title:'AI skills notes',text:'AI skills and investment strategy'})});
  let collector=makeCollector();t.after(async()=>collector.close());
  await collector.action('configure',{source:'desktop',allowlist:['editor.exe']});
  await collector.action('consent',{source:'desktop',consented:true});
  await collector.action('suspend',{suspended:false,sources:{desktop:true},mode:'redacted-context'});
  const first=await collector.action('poll'),second=await collector.action('poll');
  assert.deepEqual(second.recordIds,first.recordIds);
  assert.deepEqual(second.signals.map(x=>x.id),first.signals.map(x=>x.id));
  assert.equal(second.contexts[0].id,first.contexts[0].id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'butler-local','events.json'),'utf8')).length,1);
  await collector.close();collector=makeCollector();
  await collector.action('suspend',{suspended:false,sources:{desktop:true},mode:'redacted-context'});
  const resumed=await collector.action('poll');assert.deepEqual(resumed.recordIds,first.recordIds);
  await collector.action('ack',{ids:resumed.recordIds});
  const after=await collector.action('poll');assert.deepEqual(after.recordIds,[]);assert.deepEqual(after.signals,[]);
});

test('desktop accessibility failure is surfaced in source status',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wickrun-butler-error-'));
  const collector=createButlerSources({userData:dir,platform:'darwin',env:{},desktopStatus:()=>({available:true,note:'AX permission required'}),
    readDesktop:async()=>{throw Error('Not authorized to send Apple events');}});
  t.after(()=>collector.close());
  await collector.action('configure',{source:'desktop',allowlist:['Notes']});
  await collector.action('consent',{source:'desktop',consented:true});
  await collector.action('suspend',{suspended:false,sources:{desktop:true}});
  const result=await collector.action('poll');
  assert.match(result.sources.desktop.note,/Not authorized to send Apple events/);
  assert.deepEqual(result.signals,[]);
});
