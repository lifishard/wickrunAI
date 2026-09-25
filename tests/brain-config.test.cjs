'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const cfg=require('../electron/brain-config.cjs');

const session={token:'a'.repeat(64),model:'kimi-k3',anthropicBaseUrl:'http://127.0.0.1:18765',openaiBaseUrl:'http://127.0.0.1:18765/v1'};
function home(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'brain-home-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,env:{HOME:dir,USERPROFILE:dir}};}

test('brain choice validation and per-run environment',()=>{
  assert.deepEqual(cfg.cleanBrain(undefined),{source:'config'});
  assert.deepEqual(cfg.cleanBrain({source:'subscription',profileId:'x'}),{source:'subscription'});
  assert.throws(()=>cfg.cleanBrain({source:'route'}),/路由/);
  assert.throws(()=>cfg.cleanBrain({source:'magic'}),/无效/);
  const env=cfg.claudeBrainEnv(session);
  assert.equal(env.ANTHROPIC_BASE_URL,'http://127.0.0.1:18765');
  for(const k of ['ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','CLAUDE_CODE_SUBAGENT_MODEL'])assert.equal(env[k],'kimi-k3');
  assert.equal(env.ANTHROPIC_API_KEY,undefined);
});

test('Claude Code global apply keeps unrelated settings and restores the original connection',t=>{
  const {dir,env}=home(t);
  const file=path.join(dir,'.claude','settings.json');fs.mkdirSync(path.dirname(file),{recursive:true});
  const original={model:'opus',permissions:{allow:['Bash']},env:{ANTHROPIC_BASE_URL:'http://localhost:20128',ANTHROPIC_AUTH_TOKEN:'omni',KEEP_ME:'1'}};
  fs.writeFileSync(file,JSON.stringify(original));
  const g=cfg.createBrainGlobal({userData:path.join(dir,'data'),env});
  g.applyClaude('route',session,'high');
  let now=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(now.env.ANTHROPIC_BASE_URL,'http://127.0.0.1:18765');
  assert.equal(now.env.CLAUDE_CODE_EFFORT_LEVEL,'high');
  assert.equal(now.env.KEEP_ME,'1');assert.deepEqual(now.permissions,original.permissions);
  assert.ok(fs.existsSync(file+'.before-wickrun'));
  g.applyClaude('subscription');
  now=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(now.env.ANTHROPIC_BASE_URL,undefined);assert.equal(now.forceLoginMethod,'claudeai');
  assert.equal(g.status().claude,'subscription');
  g.applyClaude('restore');
  now=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.deepEqual(now,original);
  assert.equal(g.status().claude,null);
  assert.equal(g.applyClaude('restore').changed,false);
});

test('invalid Claude settings are never overwritten',t=>{
  const {dir,env}=home(t);
  const file=path.join(dir,'.claude','settings.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{broken');
  const g=cfg.createBrainGlobal({userData:path.join(dir,'data'),env});
  assert.throws(()=>g.applyClaude('route',session),/未改动/);
  assert.equal(fs.readFileSync(file,'utf8'),'{broken');
});

test('Codex global apply edits only managed keys and the wickrun provider table',t=>{
  const {dir,env}=home(t);
  const file=path.join(dir,'.codex','config.toml');fs.mkdirSync(path.dirname(file),{recursive:true});
  const original='model = "gpt-5.5"\napproval_policy = "on-request"\n\n[mcp_servers.docs]\ncommand = "docs"\n';
  fs.writeFileSync(file,original);
  const g=cfg.createBrainGlobal({userData:path.join(dir,'data'),env});
  g.applyCodex('route',session,'high');
  let text=fs.readFileSync(file,'utf8');
  assert.match(text,/^# wickrunAI managed\nmodel = "kimi-k3"\nmodel_provider = "wickrun"\nmodel_reasoning_effort = "high"/);
  assert.match(text,/approval_policy = "on-request"/);
  assert.match(text,/\[mcp_servers\.docs\]\ncommand = "docs"/);
  assert.match(text,/\[model_providers\.wickrun\]\nname = "wickrunAI"\nbase_url = "http:\/\/127\.0\.0\.1:18765\/v1"\nexperimental_bearer_token = "a{64}"\nwire_api = "responses"\n$/);
  assert.equal((text.match(/^model =/gm)||[]).length,1);
  g.applyCodex('route',{...session,model:'deepseek'},'low');
  text=fs.readFileSync(file,'utf8');
  assert.equal((text.match(/\[model_providers\.wickrun\]/g)||[]).length,1);
  assert.match(text,/model = "deepseek"/);
  g.applyCodex('subscription');
  text=fs.readFileSync(file,'utf8');
  assert.match(text,/model_provider = "openai"\nforced_login_method = "chatgpt"/);
  assert.doesNotMatch(text,/model_providers\.wickrun/);
  g.applyCodex('restore');
  text=fs.readFileSync(file,'utf8');
  assert.match(text,/^model = "gpt-5\.5"\n/);
  assert.doesNotMatch(text,/wickrun|forced_login_method|model_provider =/);
  assert.match(text,/approval_policy = "on-request"\n\n\[mcp_servers\.docs\]/);
});
