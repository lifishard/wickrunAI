const {test}=require('node:test');const assert=require('node:assert/strict');const path=require('node:path');const {loader}=require('./load-ts.cjs');
const f=p=>path.resolve(__dirname,'..',p),load=loader();const {discoverCompatibility}=load(f('src/lib/compatibility-probe.ts'));const {prepareBody}=load(f('src/lib/adaptive.ts'));const {defaultGenerationConfig}=load(f('src/lib/paramSchema.ts'));const cache=load(f('src/lib/compatibility-cache.ts'));
test('a gateway rejecting reasoning_effort discovers thinking toggle and sends exact fields',async()=>{const calls=[];const r=await discoverCompatibility('kimi-k3',async b=>{calls.push(b);const accepted=!b.reasoning_effort&&(!b.thinking||['enabled','disabled'].includes(b.thinking.type));return {accepted,status:accepted?200:400,note:'fixture'};});assert.equal(r.mode,'toggle');assert.deepEqual(r.requests.high,{thinking:{type:'enabled'}});assert.deepEqual(r.requests.off,{thinking:{type:'disabled'}});const cfg={...defaultGenerationConfig(),model:'kimi-k3',effortLevel:'max'};assert.deepEqual(prepareBody({model:cfg.model,reasoning_effort:'max',max_tokens:4096},cfg,{compatibility:r}),{model:'kimi-k3',thinking:{type:'enabled'},max_tokens:4096});assert.ok(calls.length<=16);assert.ok(calls.every(b=>b.max_tokens===128&&!b.tools));});
test('a gateway silently accepting nonsense is not reported as supporting intensity',async()=>{const r=await discoverCompatibility('anything',async()=>({accepted:true,status:200,note:'ignored'}));assert.equal(r.mode,'default');assert.deepEqual(r.requests,{off:{}});});
test('only accepted effort levels are selectable; unsupported selection is not silently downgraded',async()=>{const r=await discoverCompatibility('model',async b=>({accepted:!b.reasoning_effort||['low','high'].includes(b.reasoning_effort),status:b.reasoning_effort&&!['low','high'].includes(b.reasoning_effort)?400:200,note:''}));assert.equal(r.mode,'levels');assert.deepEqual(Object.keys(r.requests).sort(),['high','low','off']);const cfg={...defaultGenerationConfig(),model:'model',effortLevel:'max'};assert.throws(()=>prepareBody({model:'model'},cfg,{compatibility:r}),/未验证/);});
test('quota and authentication stop probing without poisoning capability knowledge',async()=>{let calls=0;const r=await discoverCompatibility('model',async()=>{calls++;return {accepted:false,status:429,note:'rate limited'};});assert.equal(calls,1);assert.equal(r.status,'inconclusive');});
test('output field is tested independently and cache isolates route, credential revision and headers',async()=>{const r=await discoverCompatibility('model',async b=>({accepted:b.max_tokens===undefined,status:b.max_tokens===undefined?200:400,note:''}));assert.equal(r.outputField,'max_completion_tokens');const p={id:'p',baseUrl:'https://gateway/v1',extraHeaders:{'X-Route':'private-value'}};cache.writeCompatibility(p,'m',r);assert.equal(cache.readCompatibility(p,'m'),r);assert.equal(cache.readCompatibility({...p,credentialRevision:2},'m'),undefined);assert.equal(cache.readCompatibility({...p,baseUrl:'https://other/v1'},'m'),undefined);assert.equal(cache.readCompatibility({...p,extraHeaders:{}},'m'),undefined);assert.ok(!cache.compatibilityKey(p,'m').includes('private-value'));});
test('aborted probe never reports compatibility',async()=>{const c=new AbortController();c.abort();await assert.rejects(discoverCompatibility('m',async()=>{throw Error('must not send');},c.signal),/已取消/);});
test('vision is judged by what the model actually saw, not by the gateway listing',async()=>{
 const {discoverVision}=load(f('src/lib/compatibility-probe.ts'));
 const bodies=[];const seen=await discoverVision('kimi-k3',async b=>{bodies.push(b);return {accepted:true,status:200,note:'',text:'Red'};});
 assert.deepEqual(seen,{result:'yes',format:'object'});assert.equal(bodies[0].messages[0].content[1].type,'image_url');assert.match(bodies[0].messages[0].content[1].image_url.url,/^data:image\/png;base64,/);
 assert.equal(await discoverVision('m',async()=>({accepted:true,status:200,note:'',text:'I cannot see any image.'})),undefined,'accepted but blind is not proof either way');
 assert.deepEqual(await discoverVision('m',async()=>({accepted:false,status:400,note:'image input is not supported by this model'})),{result:'no'});
 assert.equal(await discoverVision('m',async()=>({accepted:false,status:429,note:'inference exceeds tpm/rpm limit'})),undefined,'a rate limit says nothing about vision');
});
test('a tested vision result overrides a text-only listing, and a manual route setting overrides both',()=>{
 const cache=load(f('src/lib/compatibility-cache.ts')),media=load(f('src/lib/media-input.ts'));
 const p={id:'k-vision',name:'sensenova',baseUrl:'https://token.sensenova.cn/v1',hasSecret:true},info={id:'kimi-k3',inputModalities:['text']};
 assert.deepEqual(media.mediaCapabilities(p,'kimi-k3',info),['text']);assert.equal(media.visionUntested(p,'kimi-k3',info),true);
 cache.writeVision(p,'kimi-k3',{at:Date.now(),result:'yes'});
 assert.deepEqual(media.mediaCapabilities(p,'kimi-k3',info),['text','image']);assert.equal(media.visionUntested(p,'kimi-k3',info),false);
 const msg=[{id:'1',role:'user',content:'',createdAt:0,attachments:[{id:'a',name:'x.png',kind:'image',mime:'image/png',size:1,dataUrl:'data:'}]}];
 media.validateMediaRoute(msg,p,'kimi-k3',info);
 cache.writeVision(p,'glm',{at:Date.now(),result:'no'});assert.throws(()=>media.validateMediaRoute(msg,p,'glm',{id:'glm'}),/不支持图片/);
 const manual={...p,routeProfiles:{['https://token.sensenova.cn/v1::chat-completions::kimi-k3']:{inputModalities:['text']}}};
 assert.deepEqual(media.mediaCapabilities(manual,'kimi-k3',info),['text']);
});

test('the vision check turns thinking off, tries both image formats, and ignores unrelated 400s',async()=>{
 const {discoverVision}=load(f('src/lib/compatibility-probe.ts'));
 const report={outputField:'max_completion_tokens',requests:{off:{thinking:{type:'disabled'}}}};
 const bodies=[];
 const seen=await discoverVision('kimi-k3',async b=>{bodies.push(b);const obj=typeof b.messages[0].content[1].image_url==='object';return obj?{accepted:false,status:400,note:'invalid type for image_url: expected string'}:{accepted:true,status:200,note:'',text:'red'};},undefined,report);
 assert.deepEqual(seen,{result:'yes',format:'string'});
 assert.equal(bodies[0].max_completion_tokens,512);assert.deepEqual(bodies[0].thinking,{type:'disabled'});
 assert.equal(await discoverVision('m',async()=>({accepted:false,status:400,note:'max_tokens is not supported, use max_completion_tokens'})),undefined,'a parameter complaint is not a vision verdict');
 const media=load(f('src/lib/media-input.ts'));
 const body={messages:[{role:'user',content:[{type:'text',text:'x'},{type:'image_url',image_url:{url:'data:image/png;base64,AA'}}]}]};
 assert.equal(media.applyImageFormat(body,'string').messages[0].content[1].image_url,'data:image/png;base64,AA');
 assert.equal(media.applyImageFormat(body,'object'),body);
});

test('a text-only listing alone no longer blocks an image; only a tested "no" or a manual setting does',()=>{
 const cache=load(f('src/lib/compatibility-cache.ts')),media=load(f('src/lib/media-input.ts'));
 const p={id:'k-list',name:'sensenova',baseUrl:'https://token.sensenova.cn/v1',hasSecret:true},info={id:'deepseek-v4.1-flash',inputModalities:['text']};
 const msg=[{id:'u',role:'user',content:'看图',attachments:[{kind:'image',name:'a.png',dataUrl:'data:image/png;base64,AA'}],createdAt:1}];
 media.validateMediaRoute(msg,p,'deepseek-v4.1-flash',info);
 cache.writeVision(p,'deepseek-v4.1-flash',{at:Date.now(),result:'no'});
 assert.throws(()=>media.validateMediaRoute(msg,p,'deepseek-v4.1-flash',info),/不支持图片/);
});
