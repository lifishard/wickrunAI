'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createBrainProxy}=require('../electron/brain-proxy.cjs');

function upstreamServer(){
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');seen.push({url:req.url,headers:req.headers,body});
    if(body.model==='bad'){res.writeHead(429,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:{message:'slow down'}}));}
    if(req.url.endsWith('/v1/messages')){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({id:'native',type:'message',content:[{type:'text',text:'native'}]}));}
    if(!body.stream){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'plain'}}],usage:{prompt_tokens:1,completion_tokens:1}}));}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\ndata: [DONE]\n\n');
    res.end();
  });
  return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({server,seen,url:`http://127.0.0.1:${server.address().port}/v1`})));
}

async function setup(t,protocol){
  const up=await upstreamServer();t.after(()=>up.server.close());
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const settings={keyProfiles:[{id:'p1',name:'Kimi',baseUrl:up.url,extraHeaders:{'X-Team':'a'},...(protocol?{protocol}:{})}]};
  const proxy=createBrainProxy({userData:dir,getSettings:()=>settings,secretGet:async()=>'sk-route-secret',deps:{port:0}});t.after(()=>proxy.close());
  return {up,proxy,dir,settings};
}
const call=(port,route,token,body,extra={})=>fetch(`http://127.0.0.1:${port}${route}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...extra},body:JSON.stringify(body)});

test('Claude Code stream goes through the route with the stored secret and the session model',async t=>{
  const {up,proxy}=await setup(t);
  const s=await proxy.openSession({profileId:'p1',model:'kimi-k3',extras:{reasoning_effort:'high'}});
  const res=await call(proxy.port(),'/v1/messages',s.token,{model:'claude-opus-5',max_tokens:100,stream:true,messages:[{role:'user',content:'hi'}]});
  assert.equal(res.status,200);
  const text=await res.text();
  assert.match(text,/event: message_start/);assert.match(text,/"text":"Hel"/);assert.match(text,/event: message_stop/);
  const sent=up.seen[0];
  assert.equal(sent.url,'/v1/chat/completions');
  assert.equal(sent.headers.authorization,'Bearer sk-route-secret');
  assert.equal(sent.headers['x-team'],'a');
  assert.equal(sent.body.model,'kimi-k3');
  assert.equal(sent.body.reasoning_effort,'high');
  proxy.closeSession(s.token);
  assert.equal((await call(proxy.port(),'/v1/messages',s.token,{messages:[]})).status,401);
});

test('Codex responses and upstream errors keep their protocol shape',async t=>{
  const {proxy}=await setup(t);
  const s=await proxy.openSession({profileId:'p1',model:'kimi-k3'});
  const ok=await call(proxy.port(),'/v1/responses',s.token,{model:'gpt',stream:false,input:'hi'});
  assert.equal((await ok.json()).output[0].content[0].text,'plain');
  const bad=await proxy.openSession({profileId:'p1',model:'bad'});
  const err=await call(proxy.port(),'/v1/responses',bad.token,{input:'x'});
  assert.equal(err.status,429);assert.equal((await err.json()).error.message,'slow down');
  const errA=await call(proxy.port(),'/v1/messages',bad.token,{messages:[]});
  assert.equal((await errA.json()).error.type,'rate_limit_error');
});

test('native Anthropic routes are forwarded with x-api-key, not translated',async t=>{
  const {up,proxy}=await setup(t,'anthropic');
  const s=await proxy.openSession({profileId:'p1',model:'claude-x'});
  const res=await call(proxy.port(),'/v1/messages',s.token,{model:'other',messages:[],thinking:{type:'enabled',budget_tokens:9}});
  assert.equal((await res.json()).id,'native');
  assert.equal(up.seen[0].url,'/v1/messages');
  assert.equal(up.seen[0].headers['x-api-key'],'sk-route-secret');
  assert.equal(up.seen[0].body.model,'claude-x');
  assert.equal(up.seen[0].body.thinking,undefined);
});

test('requests from browsers, wrong hosts and unknown tokens are refused',async t=>{
  const {proxy}=await setup(t);
  const s=await proxy.openSession({profileId:'p1',model:'m'});
  assert.equal((await call(proxy.port(),'/v1/messages',s.token,{},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call(proxy.port(),'/v1/messages','a'.repeat(64),{})).status,401);
  const count=await call(proxy.port(),'/v1/messages/count_tokens',s.token,{messages:[{role:'user',content:'x'.repeat(70)}]});
  assert.ok((await count.json()).input_tokens>0);
});

test('global sessions keep a stable token across restarts and follow the new route',async t=>{
  const {proxy,dir,settings}=await setup(t);
  const g=await proxy.setGlobal('claude',{profileId:'p1',model:'m1'});
  const g2=await proxy.setGlobal('claude',{profileId:'p1',model:'m2'});
  assert.equal(g.token,g2.token);
  proxy.close();
  const again=createBrainProxy({userData:dir,getSettings:()=>settings,secretGet:async()=>'s',deps:{port:0}});t.after(()=>again.close());
  await again.start();
  assert.equal(again.getGlobal('claude').token,g.token);
  assert.equal(again.getGlobal('claude').model,'m2');
  assert.equal(await again.setGlobal('claude',null),null);
  assert.equal(again.getGlobal('claude'),null);
});
