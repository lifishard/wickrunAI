'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const mainPath = path.join(__dirname, '../electron/main.cjs');
const source = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
const { createMediaUploader } = require(path.join(path.dirname(mainPath), 'media-upload.cjs'));
function handler(name) {
  const marker = `ipcMain.handle('${name}', `;
  const start = source.indexOf(marker);
  assert(start >= 0, `Missing production IPC handler: ${name}`);
  const end = source.indexOf('\n  });', start);
  assert(end > start, `Missing production IPC handler terminator: ${name}`);
  return source.slice(start + marker.length, end) + '}';
}
const declaration = source.match(/^  let mediaSwitching = false;$/m)?.[0];
assert(declaration, 'Missing production account-switch guard state');

// Execute the actual handler bodies and their shared production guard state.
// Only Electron, persistence and the network boundary are supplied by fixtures.
const makeHandlers = new Function('deps', `with (deps) {
  ${declaration}
  return { switchAccount: ${handler('snc:cloudSwitch')}, media: ${handler('snc:cloudMedia')} };
}`);
function gate() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function fixture(t, { flush = async () => {}, logout = async () => {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-switch-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.bin'); fs.writeFileSync(file, 'fixture bytes');
  const state = { flushes: 0, logouts: 0, relaunches: 0, quits: 0, operations: [], puts: 0 };
  const mediaUploads = new Map(), lifetime = new AbortController();
  let declaration;
  const cloudAccount = {
    mediaAccountId: () => 'fixture-account', mediaSignal: () => lifetime.signal,
    async media(operation, input) {
      state.operations.push(operation);
      if (operation === 'begin') {
        declaration = { id: 'fixture-upload', mode: 'multipart', size: input.size, contentScheme: input.contentScheme, contentRoot: input.contentRoot, status: 'pending', partSize: 16 * 1024 * 1024, partCount: 1, completedParts: [] };
        return declaration;
      }
      if (operation === 'partUrls') return { parts: input.partNumbers.map(partNumber => ({ partNumber, url: 'https://r2.test/part' })) };
      if (operation === 'complete') return { ...declaration, status: 'ready', verifiedAt: Date.now() };
      throw Error('Unexpected media operation: ' + operation);
    },
    async logout() { state.logouts++; await logout(); },
    activate() { assert.fail('This fixture exercises logout switching'); },
  };
  const deps = {
    dataAvailable() {}, inflight: new Map(), activeToolControllers: new Map(), cloudRelay: null,
    mediaUploads, cloudAccount, store: { async flush() { state.flushes++; await flush(); } },
    app: { relaunch() { state.relaunches++; }, quit() { state.quits++; } },
    artifactSender() {}, mediaRoots: () => [dir],
    require(name) {
      if (name === './file-records.cjs') return { inspectFile: target => ({ path: target, name: path.basename(target) }) };
      return require(name);
    },
    mediaUploader: createMediaUploader({
      call: (op, input, options) => cloudAccount.media(op, input, options),
      getAccountId: () => cloudAccount.mediaAccountId(), getAccountSignal: () => cloudAccount.mediaSignal(),
      fetchImpl: async () => { state.puts++; return new Response('', { status: 200 }); },
    }),
  };
  const handlers = makeHandlers(deps);
  const upload = () => handlers.media({ sender: { isDestroyed: () => false, send() {} } },
    { action: 'upload', input: { path: file, requestId: 'fixture-request' } });
  return { state, handlers, upload, mediaUploads };
}

test('switch blocks new uploads throughout suspended flush and until restart', async t => {
  const entered = gate(), release = gate();
  const f = fixture(t, { flush: async () => { entered.resolve(); await release.promise; } });
  const existing = new AbortController(); f.mediaUploads.set('existing', existing);
  const pending = f.handlers.switchAccount({}, true);
  await entered.promise; assert(existing.signal.aborted);
  await assert.rejects(f.upload(), /正在切换云账号/);
  assert.deepEqual(f.state.operations, []); assert.equal(f.state.puts, 0);
  release.resolve(); await pending;
  assert.equal(f.state.logouts, 1); assert.equal(f.state.relaunches, 1); assert.equal(f.state.quits, 1);
  await assert.rejects(f.upload(), /正在切换云账号/);
  assert(!f.state.operations.includes('complete'));
});

for (const failureAt of ['flush', 'logout']) {
  test(`${failureAt} failure clears the guard for uploading and retrying the switch`, async t => {
    const failure = Error('fixture ' + failureAt + ' failure'); let failed = false;
    const once = async () => { if (!failed) { failed = true; throw failure; } };
    const f = fixture(t, { [failureAt]: once });
    await assert.rejects(f.handlers.switchAccount({}, true), error => error === failure);
    assert.equal(f.state.quits, 0); assert.equal(f.state.relaunches, 0);
    const result = await f.upload(); assert.equal(result.status, 'ready');
    assert.deepEqual(f.state.operations, ['begin', 'partUrls', 'complete']); assert.equal(f.state.puts, 1);
    await f.handlers.switchAccount({}, true);
    assert.equal(f.state.flushes, 2); assert.equal(f.state.logouts, failureAt === 'flush' ? 1 : 2);
    assert.equal(f.state.quits, 1); assert.equal(f.state.relaunches, 1);
  });
}

test('second switch is refused while the first is waiting without duplicate logout', async t => {
  const entered = gate(), release = gate();
  const f = fixture(t, { flush: async () => { entered.resolve(); await release.promise; } });
  const first = f.handlers.switchAccount({}, true); await entered.promise;
  await assert.rejects(f.handlers.switchAccount({}, true), /switching is already in progress/i);
  assert.equal(f.state.flushes, 1); assert.equal(f.state.logouts, 0);
  release.resolve(); await first;
  assert.equal(f.state.logouts, 1); assert.equal(f.state.quits, 1); assert.equal(f.state.relaunches, 1);
});
