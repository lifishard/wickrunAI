'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { createConversationClients } = require('../electron/conversation-clients.cjs');
const { createRunStore } = require('../electron/run-store.cjs');
const { killProcessTree } = require('../electron/process-tree.cjs');
const { appendTail, createCheckpointWriter, createEventBatcher } = require('../electron/client-progress.cjs');
const { createAcpClient } = require('../electron/acp-client.cjs');

function fixture(t, createAcpClientDep) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wickrun-load-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = createRunStore(path.join(root, 'runtime'));
  // Count and time every write the host makes while a turn runs.
  const writes = { sync: 0, async: 0, bytes: 0, blockedMs: 0 };
  const store = {
    ...real,
    saveJob(runId, callId, value) {
      const began = process.hrtime.bigint();
      real.saveJob(runId, callId, value);
      writes.blockedMs += Number(process.hrtime.bigint() - began) / 1e6;
      writes.sync += 1; writes.bytes += JSON.stringify(value).length;
    },
    async saveJobProgress(runId, callId, value) {
      writes.async += 1; writes.bytes += JSON.stringify(value).length;
      return real.saveJobProgress(runId, callId, value);
    },
  };
  const record = { id: 'run-1', conversationId: 'c1', answerId: 'a1', config: { toolsEnabled: false, client: { kind: 'grok', model: 'grok-4.6' } }, state: { working: [], status: 'running' } };
  real.save(record);
  const host = createConversationClients({
    userData: root, store, getSettings: () => ({ tools: { workspaceRoots: [root] } }), openExternal: async () => {},
    deps: { discoverClient: () => path.join(root, 'grok.exe'), createAcpClient: createAcpClientDep },
  });
  t.after(() => host.close());
  return { root, host, real, store, writes, record };
}

test('a flood of tool, reasoning and text events does not flood the disk or the window', async t => {
  const big = 'x'.repeat(15000);
  const f = fixture(t, () => ({
    close() {},
    run: async options => {
      for (let i = 0; i < 3000; i += 1) {
        options.onEvent({ type: 'activity', toolCall: { toolCallId: `call-${i % 40}`, title: `step ${i}`, status: i % 7 === 0 ? 'completed' : 'in_progress', rawInput: { variant: 'Bash', command: big } } });
        options.onEvent({ type: 'reasoning', delta: 'think ' });
        options.onEvent({ type: 'text', delta: 'word ' });
      }
      return { status: 'completed', text: 'word '.repeat(3000), sessionId: 's' };
    },
  }));
  const messages = [];
  const result = await f.host.run({ runId: 'run-1', requestId: 'req-flood', prompt: 'go' }, message => messages.push(message));
  assert.equal(result.status, 'completed');
  // Before the fix every one of the 3000 activity events wrote a synchronous,
  // fsynced multi-hundred-KB record on the main process.
  assert.ok(f.writes.sync <= 3, `main-thread record writes: ${f.writes.sync}`);
  assert.ok(f.writes.async <= 10, `checkpoint writes: ${f.writes.async}`);
  assert.ok(messages.length < 200, `renderer messages: ${messages.length}`);
  // Nothing is lost by merging: all text and reasoning still arrives, in order.
  assert.equal(messages.filter(m => m.type === 'delta').map(m => m.text).join(''), 'word '.repeat(3000));
  assert.equal(messages.filter(m => m.type === 'reasoning').map(m => m.text).join(''), 'think '.repeat(3000));
  // The latest state of each tool call survives.
  const finalActivity = new Map();
  for (const m of messages.filter(x => x.type === 'activity')) finalActivity.set(m.event.toolCall.toolCallId, m.event.toolCall);
  assert.equal(finalActivity.size, 40);
  assert.equal(finalActivity.get('call-39').title, 'step 2999');
});

test('a late checkpoint never overwrites the terminal record', async t => {
  const f = fixture(t, () => ({
    close() {},
    run: async options => {
      for (let i = 0; i < 50; i += 1) options.onEvent({ type: 'text', delta: `part ${i} ` });
      return { status: 'completed', text: 'final answer', sessionId: 's' };
    },
  }));
  for (let round = 0; round < 20; round += 1) {
    const requestId = `req-order-${round}`;
    const result = await f.host.run({ runId: 'run-1', requestId, prompt: 'go' }, () => {});
    assert.equal(result.status, 'completed');
    await new Promise(resolve => setTimeout(resolve, 5));
    const saved = f.real.job('run-1', `native-${requestId}`);
    assert.equal(saved.status, 'completed', `round ${round}: ${saved.status}`);
    assert.equal(saved.result.text, 'final answer');
  }
});

test('a failing turn keeps the progress that was streamed before it failed', async t => {
  const f = fixture(t, () => ({
    close() {},
    run: async options => { options.onEvent({ type: 'text', delta: 'kept output' }); throw Error('boom'); },
  }));
  const result = await f.host.run({ runId: 'run-1', requestId: 'req-fail', prompt: 'go' }, () => {});
  assert.equal(result.status, 'unknown');
  assert.equal(result.text, 'kept output');
});

test('Grok turns get an idle timeout so a stuck turn cannot run forever', async t => {
  let seen;
  const f = fixture(t, options => { seen = options; return { close() {}, run: async () => ({ status: 'completed', text: 'ok' }) }; });
  await f.host.run({ runId: 'run-1', requestId: 'req-idle', prompt: 'go' }, () => {});
  assert.equal(seen.idleTimeoutMs, 15 * 60000);
});

test('an idle-timeout stop explains what was kept and what to do next', async t => {
  const f = fixture(t, () => ({ close() {}, run: async () => ({ status: 'unknown', text: 'half', error: 'Grok ACP turn timed out.' }) }));
  const result = await f.host.run({ runId: 'run-1', requestId: 'req-timeout', prompt: 'go' }, () => {});
  assert.match(result.error, /15 分钟没有任何动态/);
  assert.match(result.error, /继续或重试/);
});

test('killProcessTree ends the whole tree and never a dead or unknown process', () => {
  const calls = [];
  const spawn = (binary, args, options) => { calls.push({ binary, args, options }); const e = new EventEmitter(); e.unref = () => {}; return e; };
  const child = { pid: 4242, exitCode: null, signalCode: null, kill() { calls.push('kill'); } };
  assert.equal(killProcessTree(child, { platform: 'win32', spawn, env: { SystemRoot: 'C:\\Windows' } }), true);
  assert.match(calls[0].binary, /taskkill\.exe$/);
  assert.deepEqual(calls[0].args, ['/pid', '4242', '/t', '/f']);
  assert.equal(calls[0].options.shell, false);

  const groups = [];
  assert.equal(killProcessTree(child, { platform: 'linux', killGroup: (pid, signal) => groups.push([pid, signal]) }), true);
  assert.deepEqual(groups, [[-4242, 'SIGTERM']]);

  // No group to signal: fall back to the child itself.
  calls.length = 0;
  killProcessTree(child, { platform: 'linux', killGroup() { throw Error('ESRCH'); } });
  assert.deepEqual(calls, ['kill']);

  // Already exited: its PID may belong to another program now.
  calls.length = 0;
  assert.equal(killProcessTree({ pid: 1, exitCode: 0, kill() { calls.push('kill'); } }, { platform: 'win32', spawn }), false);
  assert.deepEqual(calls, []);

  // Test doubles without a PID are simply killed.
  calls.length = 0;
  assert.equal(killProcessTree({ kill() { calls.push('kill'); } }, { platform: 'win32', spawn }), true);
  assert.deepEqual(calls, ['kill']);
});

test('the ACP client ends the whole process tree when the connection closes', async () => {
  const killed = [];
  const child = new EventEmitter();
  Object.assign(child, { pid: 77, stdin: Object.assign(new EventEmitter(), { writable: true, write() {} }), stdout: new EventEmitter(), stderr: new EventEmitter(), kill() {} });
  const client = createAcpClient({
    binary: process.platform === 'win32' ? 'C:\\grok\\grok.exe' : '/opt/grok/grok', cwd: os.tmpdir(), label: 'Grok ACP',
    spawn: () => child, killTree: (target, options) => killed.push([target, options.platform]),
  });
  const started = client.start().catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  await client.close();
  await started;
  assert.equal(killed.length, 1);
  assert.equal(killed[0][0], child);
});

test('progress checkpoints are asynchronous, atomic and complete', async t => {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wickrun-progress-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fsyncs = [];
  const io = { ...fs, fsyncSync(fd) { fsyncs.push(fd); return fs.fsyncSync(fd); }, promises: fs.promises };
  const store = createRunStore(root, { io });
  const writes = [];
  for (let i = 0; i < 25; i += 1) writes.push(store.saveJobProgress('r', 'j', { status: 'running', partial: 'p'.repeat(1000 * (i + 1)), i }));
  // Concurrent writers to one record must not corrupt it.
  await Promise.allSettled(writes);
  const saved = store.job('r', 'j');
  assert.equal(saved.status, 'running');
  assert.equal(saved.partial.length, 1000 * (saved.i + 1));
  assert.equal(fsyncs.length, 0, 'progress checkpoints must not fsync on the main thread');
  assert.deepEqual(fs.readdirSync(path.join(root, 'jobs')).filter(name => name.endsWith('.tmp')), []);
});

test('the checkpoint writer keeps one write in flight and saves the last change on close', async () => {
  let state = 0, inflight = 0, maxInflight = 0;
  const written = [];
  const timers = [];
  const writer = createCheckpointWriter({
    snapshot: () => ({ state }), interval: 500, now: () => 0,
    setTimer: fn => { timers.push(fn); return { unref() {} }; }, clearTimer() {},
    write: async value => { inflight += 1; maxInflight = Math.max(maxInflight, inflight); await new Promise(r => setImmediate(r)); written.push(value.state); inflight -= 1; },
  });
  for (let i = 1; i <= 100; i += 1) { state = i; writer.touch(); }
  assert.equal(timers.length, 1, 'one timer no matter how many changes');
  timers.shift()();
  state = 101; writer.touch();
  await writer.close();
  assert.equal(maxInflight, 1);
  assert.equal(written.at(-1), 101, 'the latest state is saved on close');
  writer.touch();
  await writer.close();
  assert.equal(written.at(-1), 101, 'nothing is written after close');
});

test('the event batcher merges bursts but keeps order across other events', () => {
  const out = [];
  const timers = [];
  const batcher = createEventBatcher({ emit: m => out.push(m), setTimer: fn => { timers.push(fn); return { unref() {} }; }, clearTimer() {} });
  batcher.push({ type: 'delta', text: 'a' }); batcher.push({ type: 'delta', text: 'b' });
  batcher.push({ type: 'reasoning', text: 'r1' }); batcher.push({ type: 'reasoning', text: 'r2' });
  batcher.push({ type: 'activity', event: { toolCall: { toolCallId: 't', status: 'in_progress' } } });
  batcher.push({ type: 'activity', event: { toolCall: { toolCallId: 't', status: 'completed' } } });
  batcher.push({ type: 'approval', id: 'x' });
  batcher.push({ type: 'delta', text: 'c' });
  batcher.flush();
  assert.deepEqual(out.map(m => m.type), ['delta', 'reasoning', 'activity', 'approval', 'delta']);
  assert.equal(out[0].text, 'ab');
  assert.equal(out[1].text, 'r1r2');
  assert.equal(out[2].event.toolCall.status, 'completed');
});

test('appendTail bounds a long stream without re-slicing every append', () => {
  let value = '';
  for (let i = 0; i < 5000; i += 1) value = appendTail(value, 'abcdefghij', 10000);
  assert.ok(value.length <= 11000);
  assert.equal(value.slice(-10), 'abcdefghij');
});
