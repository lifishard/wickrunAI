const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { File } = require('node:buffer');
const { getEventListeners } = require('node:events');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const root = path.resolve(__dirname, '../src/lib');
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const fileOf = (text = 'abcdefghij') => new File([text], 'same.bin', { type: 'application/octet-stream', lastModified: 123 });
function strictFixture(t, hook = () => {}, file = fileOf(), partSize = 16 * 1024 ** 2) {
  const rows = new Map(), puts = [], declarations = [], phases = []; let serial = 0;
  const pending = row => ({ ...row, status: 'pending', partSize, partCount: Math.ceil(row.size / partSize), completedParts: [] });
  const ready = row => ({ ...row, status: 'ready', verifiedAt: 1, createdAt: 1 });
  const f = setup(t, async call => {
    const custom = await hook(call, { rows, puts, declarations, pending, ready }); if (custom !== undefined) return custom;
    if (call.operation === 'begin') {
      declarations.push(call.input); let row = rows.get(call.input.requestKey);
      if (!row) { row = { ...call.input, id: `upload-${++serial}`, mode: 'multipart' }; rows.set(call.input.requestKey, row); }
      return json(row.finished ? ready(row) : pending(row));
    }
    if (call.operation === 'partUrls') return json({ parts: call.input.partNumbers.map(partNumber => ({ partNumber, url: `https://storage.test/${call.input.id}/${partNumber}` })) });
    if (call.operation === 'complete') { const row = [...rows.values()].find(row => row.id === call.input.id); row.finished = true; return json(ready(row)); }
    if (call.operation === 'abort') { for (const [key, row] of rows) if (row.id === call.input.id) rows.delete(key); return json({ ok: true }); }
    puts.push(call); return new Response('', { status: 200 });
  });
  return { ...f, file, rows, puts, declarations, phases, upload: (signal, selected = file) => f.api.uploadFileFromBrowser(selected, p => phases.push(p), signal), ready, pending };
}
function setup(t, handler, bridge = null) {
  const load = loader({ './transport': { desktop: () => bridge } });
  const account = load(path.join(root, 'cloud-api.ts'));
  account.configureWebCloudAccount('account-one');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const input = init.method === 'POST' ? JSON.parse(init.body) : null;
    const call = { url: String(url), init, operation: input?.operation, input: input?.input };
    calls.push(call); return handler(call, calls);
  });
  return { api: load(path.join(root, 'cloud-media.ts')), helpers: load(path.join(root, 'cloud-media-upload.ts')), account, calls };
}

test('the content identity matches the desktop protocol and reads only bounded slices', async () => {
  const { mediaContentIdentity, MEDIA_CONTENT_CHUNK_BYTES: chunk } = loader()(path.join(root, 'cloud-media-upload.ts'));
  const bytes = Buffer.alloc(chunk + 19, 0x61); bytes[chunk] = 0x62;
  const file = new File([bytes], 'Protocol.bin', { type: 'application/custom', lastModified: 123 });
  file.arrayBuffer = () => { throw new Error('whole-file read forbidden'); };
  const progress = [], result = await mediaContentIdentity(file, file.name, file.type, n => progress.push(n));
  const hashes = [hash(bytes.subarray(0, chunk)), hash(bytes.subarray(chunk))];
  const expectedRoot = hash(JSON.stringify(['wickrun-media-content-v1', file.size, chunk, hashes]));
  assert.equal(result.root, expectedRoot);
  assert.equal(result.requestKey, 'up2-' + hash(JSON.stringify(['library', file.name, file.type, expectedRoot])));
  assert.match(result.requestKey, /^up2-[a-f0-9]{64}$/);
  assert.deepEqual(progress, [0, chunk, file.size]);
});

test('a 5 GiB file hashes sequential 4 MiB chunks without a whole-file buffer', async t => {
  const { mediaContentIdentity, MEDIA_CONTENT_CHUNK_BYTES: chunk } = loader()(path.join(root, 'cloud-media-upload.ts'));
  const buffer = new ArrayBuffer(chunk), slices = []; let active = 0, maxActive = 0, largest = 0;
  t.mock.method(crypto.subtle, 'digest', async (_algorithm, bytes) => {
    active++; maxActive = Math.max(maxActive, active); largest = Math.max(largest, bytes.byteLength);
    await tick(); active--; return new ArrayBuffer(32);
  });
  const file = { size: 5 * 1024 ** 3, arrayBuffer() { throw Error('whole-file read forbidden'); },
    slice(start, end) { slices.push([start, end]); return { arrayBuffer: async () => buffer }; } };
  const result = await mediaContentIdentity(file, 'large.bin', 'application/octet-stream', () => {});
  assert.equal(slices.length, 1280); assert.equal(maxActive, 1); assert.equal(largest, chunk);
  assert.ok(slices.every(([start, end]) => end - start === chunk));
  assert.equal(slices.at(-1)[1], file.size); assert.match(result.requestKey, /^up2-[a-f0-9]{64}$/);
});


test('mediaCall retains cancellation and structured server retry information', async t => {
  const f = setup(t, () => json({ error: 'Slow down', code: 'rate_limited' }, 429, { 'Retry-After': '3' }));
  await assert.rejects(f.api.mediaCall('status'), error => error.status === 429 && error.code === 'rate_limited' && error.retryAfter === 3000 && error.retryAfterMs === 3000);
  const control = new AbortController(); control.abort();
  await assert.rejects(f.api.mediaCall('status', {}, control.signal), { name: 'AbortError' });
  assert.equal(f.calls.length, 1);
});

test('request timeouts remain distinct from user cancellation and release parent listeners', async () => {
  const { mediaTimed } = loader()(path.join(root, 'cloud-media-upload.ts'));
  const control = new AbortController();
  await assert.rejects(mediaTimed(control.signal, 1, request => new Promise((_, reject) => {
    request.addEventListener('abort', () => reject(new DOMException('platform wrapped timeout', 'AbortError')), { once: true });
  })), { name: 'TimeoutError' });
  assert.equal(getEventListeners(control.signal, 'abort').length, 0);
});

test('Retry-After accepts finite seconds and HTTP dates, not fractional or invalid date-like numbers', () => {
  const { mediaRetryAfter, mediaPutTimeout } = loader()(path.join(root, 'cloud-media-upload.ts'));
  const now = Date.UTC(2026, 9, 3);
  assert.equal(mediaRetryAfter('12', now), 12000);
  assert.equal(mediaRetryAfter(new Date(now + 17000).toUTCString(), now), 17000);
  assert.equal(mediaRetryAfter('Saturday, 03-Oct-26 00:00:17 GMT', now), 17000);
  assert.equal(mediaRetryAfter('Sat Oct  3 00:00:17 2026', now), 17000);
  for (const value of ['1.5', '-1', '+2', 'Infinity', 'bad', '', 'Oct 3 2026', '2026-10-03', '9'.repeat(400)]) assert.equal(mediaRetryAfter(value, now), undefined, value);
  assert.equal(mediaPutTimeout(16 * 1024 ** 2), 256000);
  assert.equal(mediaPutTimeout(64 * 1024 ** 2), 1024000);
});

test('parallel retry waiters share extensions without dispatching before the newest cooldown', async () => {
  const { MediaUploadRetry } = loader()(path.join(root, 'cloud-media-upload.ts'));
  let now = 1000; const sleepers = [], retry = new MediaUploadRetry(() => now, ms => { const d = deferred(); sleepers.push({ ms, ...d }); return d.promise; });
  retry.failed(Object.assign(Error('429'), { status: 429, retryAfterMs: 1000 }), 0);
  const dispatch = [], one = retry.wait().then(() => dispatch.push(now));
  await tick(); now = 1100; retry.failed(Object.assign(Error('429'), { status: 429, retryAfterMs: 1500 }), 0);
  const two = retry.wait().then(() => dispatch.push(now)); await tick();
  now = 2000; sleepers[0].resolve(); await tick(); assert.deepEqual(dispatch, []); assert.equal(sleepers[2].ms, 600);
  now = 2600; sleepers[1].resolve(); sleepers[2].resolve(); await Promise.all([one, two]);
  assert.deepEqual(dispatch, [2600, 2600]);
});

test('retry attempts and cumulative added cooldown are bounded without shortening Retry-After', async () => {
  const { MediaUploadRetry } = loader()(path.join(root, 'cloud-media-upload.ts'));
  let now = 0, calls = 0; const waits = [], retry = new MediaUploadRetry(() => now, async ms => { waits.push(ms); now += ms; });
  await assert.rejects(retry.run(async () => { calls++; throw Object.assign(Error('temporary'), { status: 503 }); }), error => error.status === 503);
  assert.equal(calls, 4); assert.deepEqual(waits, [500, 1000, 2000]);
  const budget = new MediaUploadRetry(() => 0), first = Object.assign(Error('slow'), { status: 429, retryAfterMs: 100000 });
  budget.failed(first, 0);
  const longer = Object.assign(Error('longer'), { status: 429, retryAfterMs: 125000 });
  assert.throws(() => budget.failed(longer, 1), error => error === longer);
});


test('native cancellation waits for the upload IPC to settle, then clears listeners and preserves AbortError', async t => {
  const ipc = deferred(), calls = [], control = new AbortController(); let event, off = 0;
  const bridge = { onEvent(callback) { event = callback; return () => { off++; }; }, cloudMedia(action, input) { calls.push({ action, input }); return action === 'upload' ? ipc.promise : Promise.resolve(); } };
  const f = setup(t, () => { throw Error('native upload must use IPC'); }, bridge), progress = [];
  let settled = false; const pending = f.api.uploadToCloud('fixture.bin', p => progress.push(p), control.signal).finally(() => { settled = true; });
  control.abort(); await tick();
  assert.equal(settled, false); assert.equal(off, 0);
  assert.deepEqual(calls.map(c => c.action), ['upload', 'cancel']); assert.equal(calls[0].input.requestId, calls[1].input.requestId);
  event({ requestId: calls[0].input.requestId, type: 'media-progress', data: { sent: 1, total: 2 } }); assert.deepEqual(progress, []);
  ipc.reject(new Error('IPC converted cancellation')); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(off, 1); assert.equal(getEventListeners(control.signal, 'abort').length, 0);
});

test('same metadata with changed bytes uses separate ready and pending reservations', async t => {
  const f = strictFixture(t), first = fileOf('first-byte'), second = fileOf('other-byte');
  const a = await f.upload(undefined, first), b = await f.upload(undefined, second);
  assert.notEqual(a.id, b.id); assert.equal(f.rows.size, 2);
  assert.notEqual(f.declarations[0].contentRoot, f.declarations[1].contentRoot);
  assert.equal(f.declarations[0].contentScheme, 'wickrun-media-content-v1');
  assert.deepEqual([...new Set(f.phases.map(p => p.phase))], ['hashing', 'uploading', 'finalizing', 'done']);
});

test('ready reuse requires the complete verified descriptor and does not PUT again', async t => {
  const f = strictFixture(t); await f.upload(); const sent = f.puts.length; await f.upload(); assert.equal(f.puts.length, sent);
});

for (const stage of ['begin', 'complete']) for (const defect of ['scheme', 'root', 'id', 'size', 'single', 'missingTime', 'zeroTime', 'negativeTime', 'stringTime', 'fractionalTime'])
  test(`${stage} rejects ${defect} before done`, async t => {
    const f = strictFixture(t, (call, state) => {
      if (call.operation !== stage) return;
      const base = stage === 'begin' ? { ...call.input, mode: 'multipart', id: 'upload-1' } : [...state.rows.values()][0];
      const value = state.ready(base);
      if (defect === 'scheme') delete value.contentScheme;
      if (defect === 'root') value.contentRoot = '0'.repeat(64);
      if (defect === 'id') value.id = stage === 'begin' ? '' : 'different';
      if (defect === 'size') value.size++;
      if (defect === 'single') value.mode = 'single';
      if (defect === 'missingTime') delete value.verifiedAt;
      if (defect === 'zeroTime') value.verifiedAt = 0;
      if (defect === 'negativeTime') value.verifiedAt = -1;
      if (defect === 'stringTime') value.verifiedAt = '1';
      if (defect === 'fractionalTime') value.verifiedAt = 1.5;
      return json(value);
    });
    await assert.rejects(f.upload(), /续传信息不一致/); assert(!f.phases.some(p => p.phase === 'done')); assert(!f.calls.some(c => c.operation === 'abort'));
  });

test('hash cancellation returns promptly even if a slice finishes late', async t => {
  const read = deferred(), entered = deferred(), control = new AbortController();
  const file = { name: 'hash.bin', type: '', size: 3, slice: () => ({ arrayBuffer: () => { entered.resolve(); return read.promise; } }) };
  const f = strictFixture(t, () => assert.fail('no request expected'), file);
  const pending = f.upload(control.signal); await entered.promise; control.abort(); await assert.rejects(pending, { name: 'AbortError' }); read.resolve(new ArrayBuffer(3));
  await tick(); assert.equal(f.calls.length, 0);
});

test('verification polls until ready while remaining finalizing', async t => {
  let polls = 0; const f = strictFixture(t, (call, state) => {
    if (call.operation === 'complete' && ++polls === 1) return json({ ...state.pending([...state.rows.values()][0]), status: 'verifying', retryAfterMs: 0 });
  });
  await f.upload(); assert.equal(polls, 2); assert.equal(f.phases.at(-1).phase, 'done'); assert.equal(f.phases.at(-2).phase, 'finalizing');
});

test('verification_failed cleans the matching reservation so reselecting identical bytes succeeds', async t => {
  let fail = true; const f = strictFixture(t, (call, state) => {
    if (call.operation === 'complete' && fail) { fail = false; return json({ ...state.pending([...state.rows.values()][0]), status: 'verification_failed', code: 'integrity_mismatch', error: 'secret=https://signed.invalid' }); }
  });
  await assert.rejects(f.upload(), error => error.code === 'integrity_mismatch' && !/signed.invalid/.test(error.message));
  assert.equal(f.rows.size, 0); const row = await f.upload(); assert.equal(row.id, 'upload-2');
});

for (const result of ['pending', 'unresponsive']) test(`cancel while verifying reports ${result} cleanup truthfully and ignores late ready`, async t => {
  const entered = deferred(), late = deferred(), control = new AbortController(); let polls = 0, aborts = 0;
  const f = strictFixture(t, (call, state) => {
    if (call.operation === 'complete') { if (++polls === 1) return json({ ...state.pending([...state.rows.values()][0]), status: 'verifying', retryAfterMs: 0 }); entered.resolve(); return late.promise; }
    if (call.operation === 'abort') { aborts++; assert.equal(call.init.headers['X-Wickrun-Account'], 'account-one'); return result === 'pending' ? json({ ok: true, pendingCleanup: true }) : new Promise(() => {}); }
  });
  const pending = f.upload(control.signal); await entered.promise; control.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && error.code === (result === 'pending' ? 'cleanup_pending' : 'abort_unconfirmed'));
  late.resolve(json(f.ready([...f.rows.values()][0]))); await tick(); assert.equal(aborts, 1); assert(!f.phases.some(p => p.phase === 'done'));
});

test('an A to B to A account transition stops a suspended verification and never cleans under B', async t => {
  const entered = deferred(), late = deferred();
  const f = strictFixture(t, call => { if (call.operation === 'complete') { entered.resolve(); return late.promise; } });
  const pending = f.upload(); await entered.promise; f.account.configureWebCloudAccount('account-two'); f.account.configureWebCloudAccount('account-one');
  await assert.rejects(pending, { name: 'AbortError' }); late.resolve(json({})); await tick(); assert(!f.calls.some(c => c.operation === 'abort')); assert(!f.phases.some(p => p.phase === 'done'));
});

test('one-part 403 renews only the same part and cannot renew twice', async t => {
  let puts = 0; const f = strictFixture(t, call => call.init.method === 'PUT' ? new Response('', { status: ++puts === 1 ? 403 : 200 }) : undefined, fileOf(), 16 * 1024 ** 2);
  await f.upload(); assert.equal(puts, 2); const requests = f.calls.filter(c => c.operation === 'partUrls'); assert.equal(requests.length, 2); assert.deepEqual(requests[0].input, requests[1].input);
});

test('persistent 403 exhausts one renewal and retains resumable progress', async t => {
  const f = strictFixture(t, call => call.init.method === 'PUT' ? new Response('', { status: 403 }) : undefined, fileOf(), 16 * 1024 ** 2);
  await assert.rejects(f.upload(), error => error.status === 403); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 2); assert(!f.calls.some(c => c.operation === 'abort'));
});

test('a long Retry-After does not retry early', async t => {
  const f = strictFixture(t, call => call.init.method === 'PUT' ? new Response('', { status: 429, headers: { 'Retry-After': '121' } }) : undefined, fileOf(), 16 * 1024 ** 2);
  await assert.rejects(f.upload(), error => error.status === 429 && error.retryAfterMs === 121000); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});

test('cancelling a Retry-After wait stops the next PUT', async t => {
  const entered = deferred(), control = new AbortController();
  const f = strictFixture(t, call => { if (call.init.method === 'PUT') { entered.resolve(); return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); } }, fileOf(), 16 * 1024 ** 2);
  const pending = f.upload(control.signal); await entered.promise; await tick(); control.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});

for (const stage of ['begin', 'partUrls', 'complete', 'renewal']) test(`cancellation reaches suspended ${stage}`, async t => {
  const entered = deferred(), control = new AbortController(); let urls = 0, seen;
  const f = strictFixture(t, call => {
    if (call.operation === 'partUrls') urls++;
    if (call.operation === stage || stage === 'renewal' && call.operation === 'partUrls' && urls === 2) { seen = call.init.signal; entered.resolve(); return new Promise(() => {}); }
    if (stage === 'renewal' && call.init.method === 'PUT') return new Response('', { status: 403 });
  });
  const pending = f.upload(control.signal); await entered.promise; control.abort(); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(seen.aborted, true);
});

test('the first failed part cancels and joins its sibling requests', async t => {
  const entered = deferred(); let active = 0, cancelled = 0;
  const buffer = new ArrayBuffer(4 * 1024 ** 2);
  t.mock.method(crypto.subtle, 'digest', async () => new ArrayBuffer(32));
  const large = { name: 'large.bin', type: '', size: 9 * 16 * 1024 ** 2, slice: (start, end) => ({ size: end - start, arrayBuffer: async () => buffer }) };
  const f = strictFixture(t, async call => {
    if (call.init.method !== 'PUT') return;
    if (call.url.endsWith('/5')) { await entered.promise; return new Response('', { status: 400 }); }
    active++; entered.resolve(); return new Promise((_, reject) => { const stop = () => { active--; cancelled++; reject(new DOMException('cancelled', 'AbortError')); }; call.init.signal.addEventListener('abort', stop, { once: true }); if (call.init.signal.aborted) stop(); });
  }, large);
  await assert.rejects(f.upload(), error => error.status === 400); assert.equal(active, 0); assert(cancelled >= 1); assert(!f.calls.some(c => c.operation === 'complete'));
});

test('malformed renewed part maps are refused before another PUT', async t => {
  let urls = 0; const f = strictFixture(t, call => {
    if (call.operation === 'partUrls' && ++urls === 2) return json({ parts: [{ partNumber: 2, url: 'https://storage.test/bad' }] });
    if (call.init.method === 'PUT') return new Response('', { status: 403 });
  }, fileOf(), 16 * 1024 ** 2);
  await assert.rejects(f.upload(), /续传信息不一致/); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});

test('native shared-file IPC reconstructs rate-limit metadata and fixes the expected account', async t => {
  const prior = globalThis.window, seen = [];
  globalThis.window = { snc: { cloudCall: async (action, input) => { seen.push({ action, input }); return { fileTransferError: { message: 'limited', name: 'Error', status: 429, code: 'limited', retryAfter: '7' } }; } } };
  t.after(() => { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  const api = loader()(path.join(root, 'cloud-api.ts'));
  await assert.rejects(api.cloudCall('collaboration', { operation: 'fileR2Begin', input: {} }, { accountId: 'alice' }), error => error.status === 429 && error.retryAfterMs === 7000 && error.code === 'limited');
  assert.equal(seen[0].input.expectedAccountId, 'alice');
});

test('strict multipart bounds reject tiny sizes and excessive counts before allocation', () => {
  const helpers = loader()(path.join(root, 'cloud-media-upload.ts'));
  for (const partSize of [0, 1, 2, 4 * 1024 ** 2, 64 * 1024 ** 2]) assert.throws(() => helpers.checkMediaParts({ size: 5 * 1024 ** 3, partSize, partCount: Math.ceil(5 * 1024 ** 3 / Math.max(1, partSize)) }), /续传信息不一致/);
  assert.throws(() => helpers.checkMediaParts({ size: 16 * 1024 ** 2 * 10001, partSize: 16 * 1024 ** 2, partCount: 10001 }), /续传信息不一致/);
});
