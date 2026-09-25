'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createClaudeCode, safeExtraArgs, localLoginEnvironment, resolveNative } = require('../electron/tools/claudecode.cjs');
const root = path.resolve(__dirname, '..');
const ctx = { workspaceRoots: [root], claudeBin: path.join(root, 'fake-claude.exe') };
const success = { type: 'result', subtype: 'success', is_error: false, session_id: 'fixture-session', result: 'verified fixture output' };
function fixture(options = {}) {
  const calls = [], timers = [];
  let child;
  const run = createClaudeCode({ platform: 'win32', exists: () => true, validateBinary:()=>{}, env: { PATH: 'fixture', SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'fixture-connection-key', ANTHROPIC_BASE_URL: 'https://custom.example/anthropic', NODE_OPTIONS: 'fixture' },
    ...(options.connection ? {readClaudeConnection:()=>options.connection} : {}),
    setTimeout: fn => { timers.push(fn); return fn; }, clearTimeout: () => {},
    spawn: (command, args, config) => {
      calls.push({ command, args, config });
      if (command.endsWith('taskkill.exe')) { queueMicrotask(() => child.emit('close', null, 'SIGTERM')); return new EventEmitter(); }
      if (options.throwLaunch) throw Error('fixture');
      child = new EventEmitter(); child.pid = 23456; child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = input => { calls[0].input = input; if (!options.hang) queueMicrotask(() => { child.stdout.emit('data', Buffer.from(options.output ?? JSON.stringify(success))); child.stderr.emit('data', 'private-diagnostic-fixture'); child.emit('close', options.code ?? 0, null); }); };
      child.kill = () => true; return child;
    },
  });
  return { run, calls, timers };
}
test('untrusted prompt travels verbatim over stdin with native shell:false and filtered auth', async () => {
  const f = fixture(), prompt = 'hello & echo bad | cmd $(bad) `bad` "\n中文';
  const result = await f.run({ prompt }, ctx);
  assert.equal(result.ok, true); assert.equal(result.execution.sessionId, 'fixture-session');
  assert.equal(result.execution.status, 'succeeded'); assert.equal(f.calls[0].input, prompt);
  assert.equal(f.calls[0].config.shell, false); assert.equal(f.calls[0].args.includes(prompt), false);
  assert.equal(f.calls[0].config.env.ANTHROPIC_API_KEY, 'fixture-connection-key');
  assert.equal(f.calls[0].config.env.NODE_OPTIONS, undefined);
  assert.equal(f.calls[0].args.includes('--dangerously-skip-permissions'), false);
  assert.equal(f.calls[0].args.includes('dontAsk'), true);
});

test('Claude receives actual image blocks through JSON stdin while Chat tools remain disabled',async()=>{
  const f=fixture(),image='data:image/png;base64,aGVsbG8=';
  const result=await f.run({prompt:'Inspect image',images:[image]},{...ctx,chatOnly:true});
  assert.equal(result.ok,true);
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--input-format')+1],'stream-json');
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--output-format')+1],'stream-json');assert.ok(f.calls[0].args.includes('--verbose'));
  assert.deepEqual(JSON.parse(f.calls[0].input),{type:'user',message:{role:'user',content:[{type:'text',text:'Inspect image'},{type:'image',source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}}]}});
  assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--tools')+1],'');
  assert.equal(f.calls[0].args.includes(image),false);
});

test('Claude image stream requires exactly one final terminal result, not an assistant delta',async()=>{
  const start=JSON.stringify({type:'system',subtype:'init'}),partial=JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'partial'}]}}),end=JSON.stringify(success);
  for(const output of [start+'\n'+partial+'\n'+end+'\n',start+'\r\n'+end+'\r\n']){
    assert.equal((await fixture({output}).run({prompt:'Inspect',images:['data:image/png;base64,aGVsbG8=']},ctx)).ok,true);
  }
  for(const output of [partial,start+'\n'+end+'\n'+end,end+'\n'+partial,start+'\ninvalid\n'+end]){
    const result=await fixture({output}).run({prompt:'Inspect',images:['data:image/png;base64,aGVsbG8=']},ctx);
    assert.equal(result.ok,false);assert.equal(result.uncertain,true);
  }
});

test('a compatible gateway model ID with a provider path reaches Claude Code verbatim',async()=>{
 const f=fixture(),result=await f.run({prompt:'fixture'},{...ctx,claudeExtraArgs:'--model company/model-v1'});
 assert.equal(result.ok,true);const args=f.calls[0].args;assert.equal(args[args.indexOf('--model')+1],'company/model-v1');
 assert.throws(()=>safeExtraArgs('--model company/model;echo'),/附加参数/);
});
test('nonzero exit remains failed even with valid output; stderr never leaks', async () => {
  const f = fixture({ code: 1 }), result = await f.run({ prompt: 'fixture' }, ctx);
  assert.equal(result.ok, false); assert.equal(result.execution.exitCode, 1);
  assert.equal(result.execution.sessionId, 'fixture-session');
  assert.equal(JSON.stringify(result).includes('private-diagnostic-fixture'), false);
});
test('vendor error in successful process is not task success', async () => {
  const f = fixture({ output: JSON.stringify({ ...success, is_error: true, subtype: 'error_during_execution' }) });
  assert.equal((await f.run({ prompt: 'fixture' }, ctx)).ok, false);
});
test('denied tools remain permission-required and do not broaden permissions', async () => {
  const f = fixture({ output: JSON.stringify({ ...success, permission_denials: [{ tool_name: 'Bash' }] }) });
  const result = await f.run({ prompt: 'fixture' }, ctx);
  assert.equal(result.ok, false); assert.equal(result.execution.status, 'permission_required');
});
test('plain stdout and malformed success are unverified', async () => {
  for (const output of ['done', JSON.stringify({ result: 'done' })]) {
    const result = await fixture({ output }).run({ prompt: 'fixture' }, ctx);
    assert.equal(result.ok, false); assert.equal(result.uncertain, true);
  }
});
test('timeout kills process tree and records uncertain execution without success', async () => {
  const f = fixture({ hang: true }), pending = f.run({ prompt: 'fixture' }, ctx);
  f.timers[0](); const result = await pending;
  assert.equal(result.execution.status, 'timeout'); assert.equal(result.uncertain, true);
  assert.deepEqual(f.calls[1].args, ['/pid', '23456', '/t', '/f']); assert.equal(f.calls[1].config.shell, false);
});
test('cancellation works before and during process execution', async () => {
  const a = new AbortController(); a.abort(); const first = fixture();
  assert.equal((await first.run({ prompt: 'fixture' }, { ...ctx, signal: a.signal })).cancelled, true); assert.equal(first.calls.length, 0);
  const b = new AbortController(), second = fixture({ hang: true }); const pending = second.run({ prompt: 'fixture' }, { ...ctx, signal: b.signal }); b.abort();
  const result = await pending; assert.equal(result.cancelled, true); assert.equal(result.uncertain, true);
});
test('permission and authentication overrides cannot pass extra args', () => {
  for (const args of ['--dangerously-skip-permissions', '--allowedTools Bash', '--settings x', '--model x --model y', '--resume session', '--effort high --add-dir elsewhere']) assert.throws(() => safeExtraArgs(args));
  assert.deepEqual(safeExtraArgs('--model "claude-sonnet-4-6" --effort high --max-turns 5'), ['--model', 'claude-sonnet-4-6', '--effort', 'high', '--max-turns', '5']);
});
test('reject shell shims and launch failure is explicit', async () => {
  assert.throws(() => resolveNative(path.join(root, 'claude.cmd'), {}, 'win32', () => true));
  assert.throws(() => resolveNative('claude.exe', {}, 'win32', () => true));
  const result = await fixture({ throwLaunch: true }).run({ prompt: 'fixture' }, ctx);
  assert.equal(result.execution.status, 'launch_failed');
});
test('credential families are excluded from environment', () => {
  const env = localLoginEnvironment({ HOME: 'fixture-home', CLAUDE_CODE_OAUTH_TOKEN: 'fixture', ANTHROPIC_AUTH_TOKEN: 'fixture', CLAUDE_CODE_USE_BEDROCK: '1', AWS_PROFILE: 'fixture', NODE_OPTIONS: 'fixture' });
  assert.deepEqual(Object.keys(env).sort(), ['FORCE_COLOR', 'HOME', 'NO_COLOR']);
});

test('user-configured Claude routing is passed only via environment with settings and hooks still isolated',async()=>{
 const connection={baseUrl:'http://127.0.0.1:20128',env:{ANTHROPIC_BASE_URL:'http://127.0.0.1:20128',ANTHROPIC_AUTH_TOKEN:'private-route-token',ANTHROPIC_DEFAULT_OPUS_MODEL:'auto/claude-opus'}};
 const f=fixture({connection}),result=await f.run({prompt:'fixture'},ctx);
 assert.equal(result.ok,true);assert.equal(f.calls[0].config.env.ANTHROPIC_AUTH_TOKEN,'private-route-token');assert.equal(f.calls[0].config.env.ANTHROPIC_DEFAULT_OPUS_MODEL,'auto/claude-opus');
 assert.equal(f.calls[0].args[f.calls[0].args.indexOf('--setting-sources')+1],'');assert.equal(f.calls[0].args.includes('{"disableAllHooks":true}'),true);
 assert.doesNotMatch(JSON.stringify(result),/private-route-token/);assert.equal(result.execution.authSource,'claude-user-routing-config');
});

test('brain and subscription modes replace the user routing config for this run only',async()=>{
  const brain=fixture();
  const env={ANTHROPIC_BASE_URL:'http://127.0.0.1:18765',ANTHROPIC_AUTH_TOKEN:'c'.repeat(64),ANTHROPIC_MODEL:'kimi-k3',ANTHROPIC_API_KEY:'must-not-pass',NODE_OPTIONS:'bad'};
  assert.equal((await brain.run({prompt:'go'},{...ctx,brainEnv:env})).ok,true);
  const e=brain.calls[0].config.env;
  assert.equal(e.ANTHROPIC_BASE_URL,'http://127.0.0.1:18765');assert.equal(e.ANTHROPIC_MODEL,'kimi-k3');
  assert.equal(e.ANTHROPIC_API_KEY,undefined,'user API keys never leak into a brain run');assert.equal(e.NODE_OPTIONS,undefined);
  const bad=await fixture().run({prompt:'go'},{...ctx,brainEnv:{...env,ANTHROPIC_BASE_URL:'https://elsewhere.example'}});
  assert.equal(bad.ok,false);
  const sub=fixture();
  assert.equal((await sub.run({prompt:'go'},{...ctx,subscription:true})).ok,true);
  assert.equal(sub.calls[0].config.env.ANTHROPIC_API_KEY,undefined);assert.equal(sub.calls[0].config.env.ANTHROPIC_BASE_URL,undefined);
  assert.equal(JSON.parse(sub.calls[0].args[sub.calls[0].args.indexOf('--settings')+1]).forceLoginMethod,'claudeai');
});
