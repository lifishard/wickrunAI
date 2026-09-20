'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function completion(content, totalTokens = 30, toolCalls) {
  return { id: crypto.randomUUID(), object: 'chat.completion', choices: [{ index: 0,
    message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
    finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: Math.max(1, totalTokens - 5), completion_tokens: 5, total_tokens: totalTokens } };
}
function toolCall(id, name, args) { return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }; }
function waitForFile(file, timeout = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (fs.existsSync(file)) return resolve();
      if (Date.now() - started > timeout) return reject(new Error(`timed out waiting for ${file}`));
      setTimeout(poll, 25);
    }; poll();
  });
}
function runWorker(mode, root, baseUrl) {
  const file = path.resolve(__dirname, 'fixtures/team-long-worker.cjs');
  const child = spawn(process.execPath, [file, mode, root, baseUrl], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, exited };
}

test('long team task survives compaction, route switch, process loss, and guarded side effects', { timeout: 60000 }, async t => {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, 'wickrun-team-long-'));
  t.after(() => { assert.equal(path.dirname(root), tempRoot); assert.ok(path.basename(root).startsWith('wickrun-team-long-')); fs.rmSync(root, { recursive: true, force: true }); });

  const routeLog = [];
  let agentRequest = 0;
  let correctionSeen = false;
  let correctionSeenOnFirstRequest;
  let evidenceReturned = false;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const serialized = JSON.stringify(body.messages);
    correctionSeen ||= serialized.includes('用户更正：不要执行原计划中的额外动作');
    evidenceReturned ||= body.messages.some(m => m.role === 'tool' && String(m.content).includes('ORIGINAL_EVIDENCE'));
    const compact = body.messages.some(m => m.role === 'system' && String(m.content).includes('整理以下历史材料'));
    const route = req.url.split('/')[1];
    routeLog.push({ route, model: body.model, purpose: compact ? 'compaction' : 'agent' });
    let status = 200, response;
    if (compact) {
      const payload = JSON.parse(body.messages.at(-1).content), source = payload.source || [], sourceId = source.at(-1)?.id;
      response = completion(JSON.stringify({ facts: [{ text: '压缩前证据仍可按来源取回', sources: [sourceId] }], decisions: [], unresolved: [{ text: '继续遵守用户更正', sources: [sourceId] }], nextSteps: ['继续受控验收'] }), 35);
    } else {
      agentRequest++;
      if (agentRequest === 1) { correctionSeenOnFirstRequest = serialized.includes('用户更正：'); response = completion('Initial checkpoint completed before the correction.', 30); }
      else if (agentRequest === 2) response = completion('', 30, [toolCall('safe-effect', 'project_memory_write', { text: 'SAFE_EFFECT_ONCE', mode: 'append' })]);
      else if (agentRequest === 3) { status = 429; response = { error: { message: 'temporary rate limit for route handoff' } }; }
      else if (agentRequest >= 4 && agentRequest <= 12) response = completion('', 30, [toolCall(`read-${agentRequest}`, 'read_file', { path: `C:/fixture/evidence-${agentRequest}.txt` })]);
      else if (agentRequest === 13) {
        const id = serialized.match(/teamtask-[a-z0-9]+/)?.[0];
        assert.ok(id, 'stable source id should be exposed to the model');
        response = completion('', 30, [toolCall('read-original', 'read_context', { id, offset: 0, limit: 12000 })]);
      } else if (agentRequest === 14) {
        assert.equal(evidenceReturned, true, 'original evidence must be returned before the unknown operation');
        response = completion('', 30, [toolCall('unknown-effect', 'project_memory_write', { text: 'UNKNOWN_EFFECT', mode: 'append' })]);
      } else if (agentRequest === 15) response = completion('', 30, [toolCall('safe-effect-repeated-id', 'project_memory_write', { text: 'SAFE_EFFECT_ONCE', mode: 'append' })]);
      else response = completion('Final result cites ORIGINAL_EVIDENCE alpha-42 and follows the latest correction.', 40);
    }
    res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(response));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const first = runWorker('first', root, baseUrl);
  await waitForFile(path.join(root, 'unknown-started'));
  first.child.kill();
  const firstExit = await first.exited;
  assert.notEqual(firstExit.code, 0, `the first process must be interrupted\n${firstExit.stderr}`);

  const second = runWorker('recover', root, baseUrl);
  const secondExit = await second.exited;
  assert.equal(secondExit.code, 0, `recovery worker failed\nstdout:\n${secondExit.stdout}\nstderr:\n${secondExit.stderr}`);
  const result = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
  const effects = fs.readFileSync(path.join(root, 'effects.jsonl'), 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  if (process.env.WICKRUN_LONG_DEBUG) console.error(JSON.stringify({ result, effects, routeLog }, null, 2));

  assert.equal(result.recoveredStatus, 'uncertain');
  assert.equal(result.recoveryEvents, 1);
  assert.match(result.claimError, /尚未就绪|需要核实/);
  assert.equal(result.firstRetryStatus, 'uncertain', 'the native operation journal must refuse blind replay after the first verification');
  assert.equal(result.firstRetryUncertainCallId, 'unknown-effect');
  assert.equal(result.beforeApprovalStatus, 'waiting_user');
  assert.equal(result.finalStatus, 'completed');
  assert.ok(result.compactions >= 2, `expected at least two semantic compactions, got ${result.compactions}`);
  assert.equal(result.durableOriginalEvidence, true);
  assert.equal(correctionSeen, true);
  assert.equal(correctionSeenOnFirstRequest, false, 'the correction must be introduced after the initial work, not baked into the original prompt');
  assert.equal(evidenceReturned, true);
  assert.ok(result.routeLog.some(entry => entry.profileId === 'primary' && entry.status === 'failed'));
  assert.ok(result.routeLog.some(entry => entry.profileId === 'primary' && entry.status === 'done'));
  assert.ok(result.requestProfiles.includes('primary:primary-model'));
  assert.ok(result.requestProfiles.includes('fallback:fallback-model'), 'fallback request attribution must survive the process loss');
  assert.equal(effects.filter(e => e.kind === 'safe-completed').length, 1, 'the completed once-only effect must not execute again');
  assert.equal(effects.filter(e => e.kind === 'unknown-dispatched').length, 1);
  assert.equal(effects.filter(e => e.kind === 'unknown-retried').length, 1, 'the unknown effect runs again only after explicit verification');
  assert.equal(result.verifications.length, 2);
  assert.ok(routeLog.filter(x => x.purpose === 'compaction').length >= 2);
  assert.deepEqual([...new Set(routeLog.filter(x => x.purpose === 'agent').map(x => x.route))], ['primary', 'fallback']);
});
