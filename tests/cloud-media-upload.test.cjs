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
const row = (file, id = 'upload-one') => ({ id, name: file.name, mime: file.type, size: file.size, status: 'ready', createdAt: 1 });
const single = (file, extra = {}) => ({ id: 'upload-one', size: file.size, mode: 'single', status: 'pending', url: 'https://storage.test/first', ...extra });
const multipart = (file, extra = {}) => ({ id: 'upload-one', size: file.size, mode: 'multipart', status: 'pending', partSize: 2, partCount: Math.ceil(file.size / 2), completedParts: [], ...extra });

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

test('same metadata with changed bytes cannot reuse a ready cloud file', async t => {
  const first = fileOf('first-byte'), second = fileOf('other-byte'), uploads = new Map();
  const f = setup(t, call => {
    if (call.operation === 'begin') {
      let saved = uploads.get(call.input.requestKey);
      if (!saved) { saved = { id: `upload-${uploads.size + 1}`, ready: false }; uploads.set(call.input.requestKey, saved); }
      return json(saved.ready ? { ...single(first, { id: saved.id }), status: 'ready', publicRow: row(first, saved.id) }
        : single(first, { id: saved.id, url: `https://storage.test/${saved.id}` }));
    }
    if (call.operation === 'complete') { [...uploads.values()].find(u => u.id === call.input.id).ready = true; return json(row(first, call.input.id)); }
    return new Response('', { status: 200 });
  });
  const a = await f.api.uploadFileFromBrowser(first, () => {}), b = await f.api.uploadFileFromBrowser(second, () => {});
  assert.notEqual(a.id, b.id); assert.equal(uploads.size, 2);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 2);
  assert.ok(f.calls.filter(c => c.operation === 'begin').every(c => c.input.sha256 === undefined));
});

test('same metadata with changed bytes cannot reuse a pending upload', async t => {
  const first = fileOf('first-byte'), second = fileOf('other-byte'), uploads = new Map();
  const f = setup(t, call => {
    if (call.operation === 'begin') {
      if (!uploads.has(call.input.requestKey)) uploads.set(call.input.requestKey, `upload-${uploads.size + 1}`);
      const id = uploads.get(call.input.requestKey); return json(single(first, { id, url: `https://storage.test/${id}` }));
    }
    if (call.operation === 'complete') return json(row(first, call.input.id));
    return new Response('', { status: call.url.endsWith('upload-1') ? 403 : 200 });
  });
  await assert.rejects(f.api.uploadFileFromBrowser(first, () => {}), error => error.status === 403);
  const finished = await f.api.uploadFileFromBrowser(second, () => {});
  assert.equal(finished.id, 'upload-2'); assert.equal(uploads.size, 2);
  assert.deepEqual(f.calls.filter(c => c.operation === 'complete').map(c => c.input.id), ['upload-2']);
});

test('cancellation during hashing stops before begin, including a slice that finishes late', async t => {
  const read = deferred(), entered = deferred(), control = new AbortController();
  const file = { name: 'hash.bin', type: '', size: 3, slice: () => ({ arrayBuffer: () => { entered.resolve(); return read.promise; } }) };
  const f = setup(t, () => { throw Error('no request expected'); });
  const progress = [], pending = f.api.uploadFileFromBrowser(file, p => progress.push(p), control.signal);
  await entered.promise; control.abort(); await assert.rejects(pending, { name: 'AbortError' }); read.resolve(new ArrayBuffer(3)); await tick();
  assert.equal(f.calls.length, 0); assert.deepEqual(progress.map(p => p.phase), ['hashing']);
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

test('a long server Retry-After ends the attempt without retrying early', async t => {
  const file = fileOf(), f = setup(t, call => call.operation === 'begin' ? json(single(file)) : new Response('', { status: 429, headers: { 'Retry-After': '121' } }));
  await assert.rejects(f.api.uploadFileFromBrowser(file, () => {}), error => error.status === 429 && error.retryAfter === 121000);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1); assert.equal(f.calls.filter(c => c.operation === 'complete').length, 0);
});

test('cancelling a 429 cooldown stops the wait and never starts the next PUT', async t => {
  const file = fileOf(), waiting = deferred(), control = new AbortController();
  const f = setup(t, call => {
    if (call.operation === 'begin') return json(single(file));
    waiting.resolve(); return new Response('', { status: 429, headers: { 'Retry-After': '60' } });
  });
  const pending = f.api.uploadFileFromBrowser(file, () => {}, control.signal);
  await waiting.promise; await tick(); control.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(getEventListeners(control.signal, 'abort').length, 0);
});

test('single PUT renews once with the identical declaration and reports each phase', async t => {
  const file = fileOf(), progress = []; let begins = 0;
  const f = setup(t, call => {
    if (call.operation === 'begin') return json(single(file, { url: `https://storage.test/${++begins}` }));
    if (call.operation === 'complete') return json(row(file));
    return new Response('', { status: call.url.endsWith('/1') ? 403 : 200 });
  });
  await f.api.uploadFileFromBrowser(file, p => progress.push(p));
  const declarations = f.calls.filter(c => c.operation === 'begin').map(c => c.input);
  assert.equal(declarations.length, 2); assert.deepEqual(declarations[0], declarations[1]);
  assert.deepEqual([...new Set(progress.map(p => p.phase))], ['hashing', 'uploading', 'finalizing', 'done']);
  assert.ok(progress.every(p => p.sent <= p.total));
});

test('single PUT renewal recovers the same ready file without needing another URL', async t => {
  const file = fileOf(); let begins = 0;
  const f = setup(t, call => {
    if (call.operation === 'begin') return json(++begins === 1 ? single(file) : { id: 'upload-one', size: file.size, status: 'ready', publicRow: row(file) });
    return new Response('', { status: 403 });
  });
  assert.equal((await f.api.uploadFileFromBrowser(file, () => {})).id, 'upload-one');
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1); assert.equal(f.calls.filter(c => c.operation === 'complete').length, 0);
});

test('single PUT renewal refuses a different upload id', async t => {
  const file = fileOf(); let begins = 0;
  const f = setup(t, call => call.operation === 'begin' ? json(single(file, { id: ++begins === 1 ? 'upload-one' : 'replacement' })) : new Response('', { status: 403 }));
  await assert.rejects(f.api.uploadFileFromBrowser(file, () => {}), /续传信息不一致/);
  assert.equal(begins, 2); assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});

test('single PUT cannot renew a second time after another 403', async t => {
  const file = fileOf();
  const f = setup(t, call => call.operation === 'begin' ? json(single(file)) : new Response('', { status: 403 }));
  await assert.rejects(f.api.uploadFileFromBrowser(file, () => {}), error => error.status === 403);
  assert.equal(f.calls.filter(c => c.operation === 'begin').length, 2);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 2);
  assert.equal(f.calls.filter(c => c.operation === 'complete').length, 0);
});

test('each multipart 403 renews only its original upload id and part number', async t => {
  const file = fileOf(), attempts = new Map(), renewals = [];
  const f = setup(t, call => {
    if (call.operation === 'begin') return json(multipart(file));
    if (call.operation === 'partUrls') {
      assert.equal(call.input.id, 'upload-one');
      const renewal = call.input.partNumbers.length === 1 && attempts.has(call.input.partNumbers[0]);
      if (renewal) renewals.push(call.input.partNumbers[0]);
      return json({ parts: call.input.partNumbers.map(partNumber => ({ partNumber, url: `https://storage.test/part/${partNumber}` })) });
    }
    if (call.operation === 'complete') return json(row(file));
    const number = Number(call.url.split('/').at(-1)), count = (attempts.get(number) ?? 0) + 1; attempts.set(number, count);
    return new Response('', { status: count === 1 ? 403 : 200 });
  });
  await f.api.uploadFileFromBrowser(file, () => {});
  assert.deepEqual([...renewals].sort(), [1, 2, 3, 4, 5]); assert.ok([...attempts.values()].every(n => n === 2));
});

test('multipart refuses renewed URLs for an unexpected part before uploading bytes', async t => {
  const file = fileOf(); let urls = 0;
  const f = setup(t, call => {
    if (call.operation === 'begin') return json(multipart(file, { completedParts: [1, 2, 3, 4].map(partNumber => ({ partNumber, size: 2 })) }));
    if (call.operation === 'partUrls') return json({ parts: [{ partNumber: ++urls === 1 ? 5 : 4, url: 'https://storage.test/part' }] });
    return new Response('', { status: 403 });
  });
  await assert.rejects(f.api.uploadFileFromBrowser(file, () => {}), /续传信息不一致/);
  assert.equal(f.calls.filter(c => c.init.method === 'PUT').length, 1);
});

for (const stage of ['begin', 'partUrls', 'complete', 'renewal']) test(`cancellation reaches an in-flight ${stage} request`, async t => {
  const file = fileOf(), ready = deferred(), control = new AbortController(); let begins = 0, seen;
  const f = setup(t, call => {
    const block = call.operation === stage || stage === 'renewal' && call.operation === 'begin' && begins === 1;
    if (block) { seen = call.init.signal; ready.resolve(); return new Promise(() => {}); }
    if (call.operation === 'begin') { begins++; return json(stage === 'partUrls' ? multipart(file) : single(file)); }
    if (call.operation === 'complete') return json(row(file));
    return new Response('', { status: stage === 'renewal' ? 403 : 200 });
  });
  const pending = f.api.uploadFileFromBrowser(file, () => {}, control.signal);
  await ready.promise; control.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(seen.aborted, true); assert.equal(getEventListeners(control.signal, 'abort').length, 0);
});

test('the first multipart failure cancels sibling workers and waits for them to settle', async t => {
  const file = fileOf('abcdefghijklmnopqr'), started = deferred(); let active = 0, cancelled = 0, completed = 0;
  const f = setup(t, async call => {
    if (call.operation === 'begin') return json(multipart(file));
    if (call.operation === 'partUrls') return json({ parts: call.input.partNumbers.map(partNumber => ({ partNumber, url: `https://storage.test/${partNumber}` })) });
    if (call.operation === 'complete') { completed++; return json(row(file)); }
    if (call.url.endsWith('/5')) { await started.promise; return new Response('', { status: 400 }); }
    active++; started.resolve();
    return new Promise((_, reject) => {
      const stop = () => { active--; cancelled++; reject(new DOMException('cancelled', 'AbortError')); };
      call.init.signal.addEventListener('abort', stop, { once: true }); if (call.init.signal.aborted) stop();
    });
  });
  await assert.rejects(f.api.uploadFileFromBrowser(file, () => {}), error => error.status === 400);
  assert.equal(active, 0); assert.ok(cancelled >= 1); assert.equal(completed, 0);
});

test('an account change immediately aborts a hanging PUT and cannot complete under the new account', async t => {
  const file = fileOf(), ready = deferred(); let putSignal;
  const f = setup(t, call => {
    if (call.operation === 'begin') { assert.equal(call.init.headers['X-Wickrun-Account'], 'account-one'); return json(single(file)); }
    putSignal = call.init.signal; ready.resolve(); return new Promise(() => {});
  });
  const pending = f.api.uploadFileFromBrowser(file, () => {}); await ready.promise;
  f.account.configureWebCloudAccount('account-two'); assert.equal(putSignal.aborted, true);
  await assert.rejects(pending, error => error.name === 'AbortError' && /账号已切换/.test(error.message));
  assert.equal(f.calls.filter(c => c.operation === 'complete').length, 0);
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
