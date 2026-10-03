'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createMediaUploader } = require('../electron/media-upload.cjs');

const MiB = 1024 ** 2;
function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-up-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }

// A tiny fake of the server's media API and the bucket.
function fakeCloud({ partSize = 16 * MiB, failPuts = [] } = {}) {
  const state = { calls: [], put: [], uploads: new Map(), failures: [...failPuts] };
  const call = async (operation, input) => {
    state.calls.push(operation);
    if (operation === 'begin') {
      let row = state.uploads.get(input.requestKey);
      if (!row) {
        row = { id: 'id-' + state.uploads.size, mode: 'multipart', size: input.size, contentScheme: input.contentScheme, contentRoot: input.contentRoot, parts: new Map(), status: 'pending' };
        state.uploads.set(input.requestKey, row);
      }
      return { ...row, partSize, partCount: Math.ceil(row.size / partSize), completedParts: [...row.parts].map(([partNumber, size]) => ({ partNumber, size })) };
    }
    if (operation === 'partUrls') return { parts: input.partNumbers.map(n => ({ partNumber: n, url: `https://r2.test/part/${input.id}/${n}` })) };
    if (operation === 'complete') return { ...[...state.uploads.values()].find(row => row.id === input.id), status: 'ready', verifiedAt: 1 };
    if (operation === 'abort') return { ok: true };
    throw Error('unexpected ' + operation);
  };
  const fetchImpl = async (url, { body }) => {
    if (state.failures.length) { const f = state.failures.shift(); if (f) return new Response('', { status: f }); }
    state.put.push({ url, size: body.length });
    const m = /part\/(.+)\/(\d+)$/.exec(url);
    if (m) for (const row of state.uploads.values()) if (row.id === m[1]) row.parts.set(Number(m[2]), body.length);
    return new Response('', { status: 200 });
  };
  return { state, call, fetchImpl };
}

test('a small file goes up with one PUT', async t => {
  const dir = tmp(t), file = path.join(dir, 'a.mp4'); fs.writeFileSync(file, Buffer.alloc(3 * MiB, 1));
  const cloud = fakeCloud();
  const result = await createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file });
  assert.equal(result.status, 'ready');
  assert.deepEqual(cloud.state.put.map(p => p.size), [3 * MiB]);
});

test('a large file goes up in parts, never holding more than a few parts', async t => {
  const dir = tmp(t), file = path.join(dir, 'long.mp4'); fs.writeFileSync(file, Buffer.alloc(40 * MiB + 123, 2));
  const cloud = fakeCloud();
  const progress = [];
  await createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, onProgress: p => progress.push(p.sent) });
  assert.deepEqual(cloud.state.put.map(p => p.size).sort((a, b) => a - b), [8 * MiB + 123, 16 * MiB, 16 * MiB]);
  assert.equal(progress.at(-1), 40 * MiB + 123);
});

test('after an interruption the same file resumes and sends only the missing parts', async t => {
  const dir = tmp(t), file = path.join(dir, 'long.mp4'); fs.writeFileSync(file, Buffer.alloc(48 * MiB, 3));
  const cloud = fakeCloud({ failPuts: [0, 400] }); // first part ok, second part refused for good
  const uploader = createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl, sleep: async () => {} });
  await assert.rejects(uploader.upload({ filePath: file }), /拒绝了上传/);
  const sentBefore = cloud.state.put.length;
  cloud.state.failures.length = 0;
  const result = await uploader.upload({ filePath: file });
  assert.equal(result.status, 'ready');
  const parts = new Set(cloud.state.put.map(p => p.url));
  assert.equal(parts.size, cloud.state.put.length, 'no part is sent twice');
  assert.equal(cloud.state.put.length, 3, `3 parts of 16 MiB in total, sent ${sentBefore} before the stop`);
});

test('temporary network errors are retried, then reported with what to do', async t => {
  const dir = tmp(t), file = path.join(dir, 'a.mp3'); fs.writeFileSync(file, Buffer.alloc(MiB));
  const flaky = fakeCloud({ failPuts: [503, 503] });
  assert.equal((await createMediaUploader({ call: flaky.call, fetchImpl: flaky.fetchImpl, sleep: async () => {} }).upload({ filePath: file })).status, 'ready');
  const dead = fakeCloud({ failPuts: [503, 503, 503, 503] });
  await assert.rejects(createMediaUploader({ call: dead.call, fetchImpl: dead.fetchImpl, sleep: async () => {} }).upload({ filePath: file }), /再次上传将从断点继续/);
});

test('an empty or missing file is refused before anything is sent', async t => {
  const dir = tmp(t); fs.writeFileSync(path.join(dir, 'e.mp4'), '');
  const cloud = fakeCloud();
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: path.join(dir, 'e.mp4') }), /为空/);
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: path.join(dir, 'none.mp4') }));
  assert.deepEqual(cloud.state.calls, []);
});

const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
function contentKey(bytes, name, mime) {
  const chunks = []; for (let i = 0; i < bytes.length; i += 4 * MiB) chunks.push(digest(bytes.subarray(i, i + 4 * MiB)));
  const root = digest(JSON.stringify(['wickrun-media-content-v1', bytes.length, 4 * MiB, chunks]));
  return 'up2-' + digest(JSON.stringify(['library', name, mime, root]));
}
function small(t) { const file = path.join(tmp(t), 'sample.bin'); fs.writeFileSync(file, Buffer.from('original-content')); return file; }

test('idempotent control calls recover from network failures and timeouts', async t => {
  const file = small(t), cloud = fakeCloud(), seen = new Map(); let clock = 0;
  const call = async (operation, input, options) => {
    const attempts = (seen.get(operation) ?? 0) + 1; seen.set(operation, attempts);
    if (attempts === 1 && operation === 'begin') throw new TypeError('fetch failed');
    if (attempts === 1 && operation === 'complete') throw new DOMException('timeout', 'TimeoutError');
    return cloud.call(operation, input, options);
  };
  const result = await createMediaUploader({ call, fetchImpl: cloud.fetchImpl, now: () => clock, sleep: async ms => { clock += ms; } }).upload({ filePath: file });
  assert.equal(result.status, 'ready'); assert.equal(seen.get('begin'), 2); assert.equal(seen.get('complete'), 2);
  assert.equal(cloud.state.put.length, 1, 'control retries must not repeat the file PUT');
});

test('obsolete HTTP asctime Retry-After is GMT even in a non-UTC local timezone', async t => {
  const previousZone = process.env.TZ; process.env.TZ = 'America/Los_Angeles';
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone; });
  const file = small(t), cloud = fakeCloud(), waits = []; let clock = Date.UTC(2026, 9, 3, 9, 0, 0), attempts = 0;
  const result = await createMediaUploader({ call: cloud.call, now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
    fetchImpl: async (...args) => ++attempts === 1 ? new Response('', { status: 429, headers: { 'Retry-After': 'Sat Oct  3 09:00:02 2026' } }) : cloud.fetchImpl(...args),
  }).upload({ filePath: file });
  assert.equal(result.status, 'ready'); assert.deepEqual(waits, [2000]);
});
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function abortable(signal, onCancel = () => {}) {
  return new Promise((_, reject) => {
    const stop = () => { onCancel(); reject(Object.assign(Error('cancelled'), { name: 'AbortError' })); };
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  });
}

test('byte identity follows the shared chunk protocol and ignores path and mtime', async t => {
  const dir = tmp(t), file = path.join(dir, 'source.bin'), other = path.join(dir, 'copy.bin');
  const bytes = Buffer.alloc(4 * MiB + 17, 7); fs.writeFileSync(file, bytes); fs.writeFileSync(other, bytes);
  const seen = [], cloud = fakeCloud();
  const uploader = createMediaUploader({ call: (op, input) => { if (op === 'begin') seen.push(input); return cloud.call(op, input); }, fetchImpl: cloud.fetchImpl });
  await uploader.upload({ filePath: file, name: 'same.bin', mime: 'application/octet-stream' });
  await uploader.upload({ filePath: other, name: 'same.bin', mime: 'application/octet-stream' });
  assert.equal(seen[0].requestKey, contentKey(bytes, 'same.bin', 'application/octet-stream'));
  assert.equal(seen[0].requestKey, seen[1].requestKey); assert.match(seen[0].requestKey, /^up2-[a-f0-9]{64}$/);
  assert.equal(seen[0].sha256, undefined, 'chunk root is not a whole-file sha256 declaration');
  const stamp = fs.statSync(file).mtime; bytes[2 * MiB] = 8; fs.writeFileSync(file, bytes); fs.utimesSync(file, stamp, stamp);
  await uploader.upload({ filePath: file, name: 'same.bin', mime: 'application/octet-stream' });
  assert.notEqual(seen[2].requestKey, seen[0].requestKey, 'same metadata cannot resume different bytes');
  await uploader.upload({ filePath: file, name: 'other.bin', mime: 'application/octet-stream' });
  await uploader.upload({ filePath: file, name: 'same.bin', mime: 'audio/mpeg' });
  assert.notEqual(seen[3].requestKey, seen[2].requestKey); assert.notEqual(seen[4].requestKey, seen[2].requestKey);
});

test('changed bytes cannot reuse a ready upload with the same filename, size and mtime', async t => {
  const file = small(t), stamp = fs.statSync(file).mtime, uploads = new Map(); let puts = 0;
  const call = async (op, input) => {
    if (op === 'begin') {
      const existing = uploads.get(input.requestKey);
      if (existing) return { ...existing, status: 'ready', verifiedAt: 1 };
      const row = { id: 'id-' + uploads.size, mode: 'multipart', size: input.size, contentScheme: input.contentScheme, contentRoot: input.contentRoot }; uploads.set(input.requestKey, row);
      return { ...row, status: 'pending', partSize: 16 * MiB, partCount: 1, completedParts: [] };
    }
    if (op === 'partUrls') return { parts: input.partNumbers.map(partNumber => ({ partNumber, url: 'https://r2.test/put' })) };
    return { ...[...uploads.values()].find(row => row.id === input.id), status: 'ready', verifiedAt: 1 };
  };
  const uploader = createMediaUploader({ call, fetchImpl: async () => { puts++; return new Response(); } });
  const first = await uploader.upload({ filePath: file }); await uploader.upload({ filePath: file });
  fs.writeFileSync(file, 'different-bytes!'); fs.utimesSync(file, stamp, stamp);
  const changed = await uploader.upload({ filePath: file });
  assert.notEqual(changed.id, first.id); assert.equal(puts, 2);
});

test('a source edited after begin is refused before PUT and complete', async t => {
  const file = small(t), cloud = fakeCloud(), stamp = fs.statSync(file).mtime;
  const call = async (op, input) => {
    const result = await cloud.call(op, input);
    if (op === 'begin') { fs.writeFileSync(file, 'different-bytes!'); fs.utimesSync(file, stamp, stamp); }
    return result;
  };
  await assert.rejects(createMediaUploader({ call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file }), /被修改/);
  assert.equal(cloud.state.put.length, 0); assert(!cloud.state.calls.includes('complete'));
});

test('final byte validation catches changes to an already sent or resumed part', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(40 * MiB, 1));
  const cloud = fakeCloud(); let changed = false;
  const call = async (op, input) => {
    const result = await cloud.call(op, input);
    if (op === 'begin') result.completedParts = [{ partNumber: 1, size: 16 * MiB }];
    return result;
  };
  const fetchImpl = async (...args) => {
    const response = await cloud.fetchImpl(...args);
    if (!changed) { changed = true; const fd = fs.openSync(file, 'r+'); fs.writeSync(fd, Buffer.from([2]), 0, 1, 0); fs.closeSync(fd); }
    return response;
  };
  await assert.rejects(createMediaUploader({ call, fetchImpl }).upload({ filePath: file }), /被修改/);
  assert(!cloud.state.calls.includes('complete'));
});

test('path replacement and truncation cannot finish an upload', async t => {
  for (const replace of [true, false]) {
    const file = small(t), cloud = fakeCloud();
    const fetchImpl = async (...args) => {
      const response = await cloud.fetchImpl(...args);
      if (replace) { fs.renameSync(file, file + '.old'); fs.writeFileSync(file, 'different-bytes!'); }
      else fs.truncateSync(file, 3);
      return response;
    };
    await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl }).upload({ filePath: file }), /被修改/);
    assert(!cloud.state.calls.includes('complete'));
  }
});

test('distinct large file IDs cannot collide before or during final byte validation', async t => {
  const originalId = 9007199254740992n, replacementId = 9007199254740993n;
  assert.notEqual(originalId, replacementId);
  assert.equal(Number(originalId), Number(replacementId), 'the Number representation loses the distinguishing bit');
  for (const replaceDuringScan of [false, true]) await t.test(replaceDuringScan ? 'replacement during byte scan' : 'replacement before byte scan', async sub => {
    const file = small(sub), original = fs.readFileSync(file), cloud = fakeCloud();
    const open = fs.promises.open.bind(fs.promises), stat = fs.promises.stat.bind(fs.promises);
    let replaced = false, reads = 0;
    const replace = () => {
      fs.renameSync(file, file + '.old'); fs.writeFileSync(file, Buffer.alloc(original.length, 9)); replaced = true;
    };
    // Preserve real file reads and replacement; only expose deterministic 64-bit identities.
    sub.mock.method(fs.promises, 'open', async (...args) => {
      const handle = await open(...args);
      if (args[0] === file) {
        const handleStat = handle.stat.bind(handle), read = handle.read.bind(handle);
        sub.mock.method(handle, 'stat', async options => {
          const result = await handleStat(options); result.ino = options?.bigint ? originalId : Number(originalId); return result;
        });
        sub.mock.method(handle, 'read', async (...input) => {
          const result = await read(...input);
          if (++reads === 3 && replaceDuringScan) replace(); // hash, PUT body, validation scan
          return result;
        });
      }
      return handle;
    });
    sub.mock.method(fs.promises, 'stat', async (target, options) => {
      const result = await stat(target, options);
      if (target === file) {
        const id = replaced ? replacementId : originalId;
        result.ino = options?.bigint ? id : Number(id);
      }
      return result;
    });
    await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: async (...args) => {
      assert.deepEqual(args[1].body, original, 'the upload remains pinned to the original handle');
      const response = await cloud.fetchImpl(...args); if (!replaceDuringScan) replace(); return response;
    } }).upload({ filePath: file }), /被修改/);
    assert.equal(replaced, true); assert(!fs.readFileSync(file).equals(original));
    assert(!cloud.state.calls.includes('complete'));
  });
});

test('429 waits honor seconds and HTTP date; invalid headers back off with no final sleep', async t => {
  for (const [header, expected] of [['2', 2000], ['Thu, 01 Jan 1970 00:00:04 GMT', 3000], ['invalid', 500], ['1.5', 500], ['-1', 500], ['0', 0]]) {
    const file = small(t), cloud = fakeCloud(); let clock = 1000, attempts = 0; const waits = [];
    const uploader = createMediaUploader({ call: cloud.call, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
      fetchImpl: async (...args) => ++attempts === 1 ? new Response('', { status: 429, headers: { 'Retry-After': header } }) : cloud.fetchImpl(...args) });
    await uploader.upload({ filePath: file }); assert.deepEqual(waits, expected ? [expected] : []);
  }
  const file = small(t), cloud = fakeCloud(); let clock = 0, attempts = 0; const waits = [];
  await assert.rejects(createMediaUploader({ call: cloud.call, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; },
    fetchImpl: async () => { attempts++; return new Response('', { status: 429, headers: { 'Retry-After': '1' } }); } }).upload({ filePath: file }), /断点继续/);
  assert.equal(attempts, 4); assert.deepEqual(waits, [1000, 1000, 1000]);
});

test('long Retry-After is never shortened and does not consume normal transfer time', async t => {
  const file = small(t), cloud = fakeCloud(); let attempts = 0;
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: async () => { attempts++; return new Response('', { status: 429, headers: { 'Retry-After': '121' } }); },
    sleep: async () => assert.fail('must not sleep for an unaffordable delay') }).upload({ filePath: file }), error => error.status === 429);
  assert.equal(attempts, 1);
  let clock = 0; const waits = [];
  await createMediaUploader({ call: cloud.call, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; }, fetchImpl: async () => {
    clock += 600000; return attempts++ === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : new Response();
  } }).upload({ filePath: file });
  assert.deepEqual(waits, [1000]);
});

test('API 429 preserves one session and uses Retry-After for begin, partUrls and complete', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(40 * MiB));
  const cloud = fakeCloud(), failed = new Set(), waits = []; let clock = 0;
  const call = async (op, input) => {
    if (!failed.has(op)) { failed.add(op); throw Object.assign(Error('limited'), { status: 429, retryAfter: '1' }); }
    return cloud.call(op, input);
  };
  await createMediaUploader({ call, fetchImpl: cloud.fetchImpl, now: () => clock, sleep: async ms => { waits.push(ms); clock += ms; } }).upload({ filePath: file });
  assert.equal(cloud.state.uploads.size, 1); assert.equal(waits.length, 3); assert(waits.every(ms => ms === 1000));
});

test('a one-part upload renews its part URL once and persistent 403 stops', async t => {
  const file = small(t), cloud = fakeCloud(); let urls = 0, attempts = 0;
  const call = async (op, input) => {
    const result = await cloud.call(op, input);
    if (op === 'partUrls') { urls++; for (const part of result.parts) part.url += '?generation=' + urls; }
    return result;
  };
  const seen = [];
  await createMediaUploader({ call, fetchImpl: async (url) => { seen.push(url); return new Response('', { status: ++attempts === 1 ? 403 : 200 }); } }).upload({ filePath: file });
  assert.equal(urls, 2); assert.notEqual(seen[0], seen[1]);
  urls = 0; attempts = 0;
  await assert.rejects(createMediaUploader({ call, fetchImpl: async () => { attempts++; return new Response('', { status: 403 }); } }).upload({ filePath: file }), /拒绝了上传/);
  assert.equal(urls, 2); assert.equal(attempts, 2);
});

test('a renewed part URL refuses another reservation id', async t => {
  const file = small(t), cloud = fakeCloud(); let urls = 0, attempts = 0;
  const call = async (op, input) => { const result = await cloud.call(op, input); if (op === 'partUrls' && ++urls > 1) result.id = 'other-id'; return result; };
  await assert.rejects(createMediaUploader({ call, fetchImpl: async () => { attempts++; return new Response('', { status: 403 }); } }).upload({ filePath: file }), /续传信息不一致/);
  assert.equal(attempts, 1); assert(!cloud.state.calls.includes('complete'));
});

test('multipart 403 renews only the refused part within the same upload', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(40 * MiB));
  const cloud = fakeCloud(), requested = []; let refused = false;
  const call = async (op, input) => { if (op === 'partUrls') requested.push(input); return cloud.call(op, input); };
  await createMediaUploader({ call, fetchImpl: async (...args) => { if (!refused) { refused = true; return new Response('', { status: 403 }); } return cloud.fetchImpl(...args); } }).upload({ filePath: file });
  assert.deepEqual(requested.map(r => r.partNumbers), [[1, 2, 3], [1]]); assert.equal(new Set(requested.map(r => r.id)).size, 1);
});

test('cancel before start or during hashing does not begin a reservation', async t => {
  for (const before of [true, false]) {
    const file = small(t), cloud = fakeCloud(), controller = new AbortController(); if (before) controller.abort();
    await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, signal: controller.signal,
      onProgress: p => { if (p.phase === 'hashing') controller.abort(); } }), error => error.name === 'AbortError');
    assert.deepEqual(cloud.state.calls, []);
  }
});

test('cancel interrupts retry waiting and keeps AbortError', async t => {
  const file = small(t), cloud = fakeCloud(), controller = new AbortController(), waiting = gate(); let attempts = 0;
  const pending = createMediaUploader({ call: cloud.call, fetchImpl: async () => { attempts++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); },
    sleep: () => { waiting.resolve(); return new Promise(() => {}); } }).upload({ filePath: file, signal: controller.signal });
  await waiting.promise; controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(attempts, 1); assert(!cloud.state.calls.includes('complete'));
});

test('API cancellation reaches begin, partUrls, renewal and complete', async t => {
  for (const target of ['begin', 'partUrls', 'renew', 'complete']) {
    const file = target === 'partUrls' ? path.join(tmp(t), 'large.bin') : small(t); if (target === 'partUrls') fs.writeFileSync(file, Buffer.alloc(40 * MiB));
    const cloud = fakeCloud(), entered = gate(), controller = new AbortController(); let urls = 0, cancelled = false;
    const call = async (op, input, { signal }) => {
      if (op === 'partUrls') urls++;
      if (op === target || target === 'renew' && op === 'partUrls' && urls === 2) { entered.resolve(); return abortable(signal, () => { cancelled = true; }); }
      return cloud.call(op, input);
    };
    const pending = createMediaUploader({ call, fetchImpl: target === 'renew' ? async () => new Response('', { status: 403 }) : cloud.fetchImpl }).upload({ filePath: file, signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError'); assert(cancelled);
  }
});

test('first partUrls failure aborts and joins the other workers', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(144 * MiB));
  const cloud = fakeCloud(), peerEntered = gate(); let joined = false, puts = 0;
  const failure = Error('partUrls failed');
  const call = async (op, input, { signal }) => {
    if (op !== 'partUrls') return cloud.call(op, input);
    if (input.partNumbers[0] === 1) { await peerEntered.promise; throw failure; }
    peerEntered.resolve(); return abortable(signal, () => { joined = true; });
  };
  await assert.rejects(createMediaUploader({ call, fetchImpl: async () => { puts++; return new Response(); } }).upload({ filePath: file }), error => error === failure);
  assert(joined); assert.equal(puts, 0); assert(!cloud.state.calls.includes('complete'));
});

test('failed PUT aborts in-flight peer PUTs before returning', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(144 * MiB));
  const cloud = fakeCloud(), peerEntered = gate(); let joined = false;
  const fetchImpl = async (url, { signal }) => {
    if (url.endsWith('/1')) { await peerEntered.promise; return new Response('', { status: 400 }); }
    peerEntered.resolve(); return abortable(signal, () => { joined = true; });
  };
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl }).upload({ filePath: file }), /拒绝了上传/);
  assert(joined); assert(!cloud.state.calls.includes('complete'));
});

test('account snapshot prevents continuation and 100 percent is not done before confirmation', async t => {
  const file = small(t), cloud = fakeCloud(); let account = 'alice'; const phases = [];
  const call = async (op, input, options) => { assert.equal(options.accountId, 'alice'); const result = await cloud.call(op, input); if (op === 'begin') account = 'bob'; return result; };
  await assert.rejects(createMediaUploader({ call, fetchImpl: cloud.fetchImpl, getAccountId: () => account }).upload({ filePath: file }), /账号已切换/);
  assert.equal(cloud.state.put.length, 0);
  const complete = gate(), entered = gate();
  const pending = createMediaUploader({ call: async (op, input) => { if (op === 'complete') { entered.resolve(); await complete.promise; } return cloud.call(op, input); }, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, onProgress: p => phases.push(p) });
  await entered.promise; assert(phases.some(p => p.sent === p.total && p.phase === 'uploading')); assert(!phases.some(p => p.phase === 'done'));
  assert.equal(phases.at(-1).phase, 'finalizing'); complete.resolve(); await pending; assert.equal(phases.at(-1).phase, 'done');
});

test('429 cooldown is shared by all workers before further PUTs', async t => {
  const file = path.join(tmp(t), 'large.bin'); fs.writeFileSync(file, Buffer.alloc(144 * MiB));
  const cloud = fakeCloud(), cooling = gate(), allWaiting = gate(), release = gate();
  let clock = 0, sleeps = 0, attempts = 0, refused = false;
  const call = async (op, input) => {
    if (op === 'partUrls' && input.partNumbers[0] !== 1) await cooling.promise;
    return cloud.call(op, input);
  };
  const pending = createMediaUploader({ call, now: () => clock,
    sleep: async ms => { assert.equal(ms, 5000); cooling.resolve(); if (++sleeps === 3) allWaiting.resolve(); await release.promise; },
    fetchImpl: async (...args) => {
      attempts++;
      if (!refused) { refused = true; return new Response('', { status: 429, headers: { 'Retry-After': '5' } }); }
      assert(clock >= 5000, 'no peer starts a new PUT during cooldown'); return cloud.fetchImpl(...args);
    } }).upload({ filePath: file });
  await allWaiting.promise; assert.equal(attempts, 1); clock = 5000; release.resolve(); await pending;
  assert.equal(cloud.state.put.length, 9);
});

test('cumulative Retry-After budget stops without truncating the requested delay', async t => {
  const file = small(t), cloud = fakeCloud(), delays = ['60', '60', '1']; let clock = 0, attempts = 0; const waits = [];
  await assert.rejects(createMediaUploader({ call: cloud.call, now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; }, fetchImpl: async () => new Response('', { status: 429, headers: { 'Retry-After': delays[attempts++] } })
  }).upload({ filePath: file }), error => error.status === 429);
  assert.equal(attempts, 3); assert.deepEqual(waits, [60000, 60000]);
});

test('caller abort listeners are removed on success and cancellation', async t => {
  const file = small(t), cloud = fakeCloud(), controller = new AbortController();
  await createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, signal: controller.signal });
  assert.equal(require('node:events').getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(require('node:events').getEventListeners(controller.signal, 'abort').length, 0);
});

test('account lifetime immediately aborts suspended PUT and removes its listener', async t => {
  const file = small(t), cloud = fakeCloud(), lifetime = new AbortController(), entered = gate(); let cancelled = false;
  const pending = createMediaUploader({ call: cloud.call, getAccountId: () => 'alice', getAccountSignal: () => lifetime.signal,
    fetchImpl: async (_url, { signal }) => { entered.resolve(); return abortable(signal, () => { cancelled = true; }); }
  }).upload({ filePath: file });
  await entered.promise; lifetime.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
  assert(cancelled); assert(!cloud.state.calls.includes('complete'));
  assert.equal(require('node:events').getEventListeners(lifetime.signal, 'abort').length, 0);
});

test('same-session ready reuse checks the verified descriptor before reporting done', async t => {
  const file = small(t), cloud = fakeCloud(), phases = []; let puts = 0;
  const call = async (op, input) => {
    const row = await cloud.call(op, input);
    if (op === 'begin') return { ...row, status: 'ready', verifiedAt: 1 };
    return row;
  };
  await createMediaUploader({ call, fetchImpl: async () => { puts++; return new Response(); } }).upload({ filePath: file, onProgress: p => phases.push(p) });
  assert.equal(puts, 0); assert(!cloud.state.calls.includes('complete'));
  assert.equal(phases.at(-2).phase, 'finalizing'); assert.equal(phases.at(-1).phase, 'done');
});

test('upload timeout is finite and retryable while caller cancellation stays AbortError', async t => {
  const file = small(t), cloud = fakeCloud(); let attempts = 0;
  // The default timer is unref'd; keep this short fake request alive until it fires.
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await assert.rejects(createMediaUploader({ call: cloud.call, putTimeoutMs: () => 5, sleep: async () => {},
    fetchImpl: async (_url, { signal }) => { attempts++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); }
  }).upload({ filePath: file }), /上传超时/);
  assert.equal(attempts, 4); assert(!cloud.state.calls.includes('complete'));
});

test('a replaced path cannot substitute different bytes into the pinned file handle', async t => {
  const file = small(t), original = fs.readFileSync(file), cloud = fakeCloud(); let puts = 0;
  const call = async (op, input) => {
    const result = await cloud.call(op, input);
    if (op === 'begin') { fs.renameSync(file, file + '.old'); fs.writeFileSync(file, 'different-bytes!'); }
    return result;
  };
  await assert.rejects(createMediaUploader({ call, fetchImpl: async (_url, { body }) => {
    puts++; assert.deepEqual(body, original); return new Response();
  } }).upload({ filePath: file }), /被修改/);
  assert.equal(puts, 1); assert(!cloud.state.calls.includes('complete'));
});

test('strict multipart rejects non-protocol part sizes before allocating or sending', async t => {
  const file = small(t), cloud = fakeCloud({ partSize: 3 * MiB });
  await assert.rejects(createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file }), /续传信息不一致/);
  assert.equal(cloud.state.put.length, 0); assert(!cloud.state.calls.includes('complete'));
});

for (const stage of ['begin', 'complete']) for (const defect of ['scheme', 'root', 'single', 'missingTime', 'zeroTime', 'nanTime']) test(`native ${stage} rejects ${defect} without done`, async t => {
  const file = small(t), cloud = fakeCloud(), phases = [];
  const call = async (op, input) => {
    const result = await cloud.call(op, input); if (op !== stage) return result;
    result.status = 'ready'; result.verifiedAt = 1;
    if (defect === 'scheme') delete result.contentScheme;
    if (defect === 'root') result.contentRoot = '0'.repeat(64);
    if (defect === 'single') result.mode = 'single';
    if (defect === 'missingTime') delete result.verifiedAt;
    if (defect === 'zeroTime') result.verifiedAt = 0;
    if (defect === 'nanTime') result.verifiedAt = NaN;
    return result;
  };
  await assert.rejects(createMediaUploader({ call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, onProgress: p => phases.push(p.phase) }), /续传信息不一致/);
  assert(!phases.includes('done')); assert(!cloud.state.calls.includes('abort'));
});

test('native verification polls separately and never reports done before verified ready', async t => {
  const file = small(t), cloud = fakeCloud(), phases = []; let complete = 0, clock = 0;
  const call = async (op, input) => { const result = await cloud.call(op, input); if (op === 'complete' && ++complete === 1) { result.status = 'verifying'; delete result.verifiedAt; result.retryAfterMs = 1000; } return result; };
  await createMediaUploader({ call, fetchImpl: cloud.fetchImpl, now: () => clock, sleep: async ms => { clock += ms; } }).upload({ filePath: file, onProgress: p => phases.push(p.phase) });
  assert.equal(complete, 2); assert.equal(phases.at(-2), 'finalizing'); assert.equal(phases.at(-1), 'done');
});

test('native verified failure clears only a trusted reservation and permits identical reselect', async t => {
  const file = small(t), cloud = fakeCloud(); let failed = true, aborts = 0;
  const call = async (op, input) => {
    const result = await cloud.call(op, input);
    if (op === 'begin' && failed) { failed = false; return { ...result, status: 'verification_failed', code: 'integrity_mismatch', error: 'https://signed.invalid/?secret=x' }; }
    if (op === 'abort') { aborts++; cloud.state.uploads.clear(); }
    return result;
  };
  const uploader = createMediaUploader({ call, fetchImpl: cloud.fetchImpl });
  await assert.rejects(uploader.upload({ filePath: file }), error => error.code === 'integrity_mismatch' && !error.message.includes('signed.invalid'));
  assert.equal(aborts, 1); assert.equal((await uploader.upload({ filePath: file })).status, 'ready');
});

test('native verification deadline interrupts a Retry-After wait', async t => {
  const file = small(t), cloud = fakeCloud(); let polls = 0;
  const call = async (op, input) => {
    if (op === 'complete') {
      if (++polls === 1) { const result = await cloud.call(op, input); delete result.verifiedAt; return { ...result, status: 'verifying', retryAfterMs: 0 }; }
      throw Object.assign(Error('limited'), { status: 429, retryAfter: '60' });
    }
    return cloud.call(op, input);
  };
  const started = Date.now();
  await assert.rejects(createMediaUploader({ call, fetchImpl: cloud.fetchImpl, verificationTimeoutMs: 300 }).upload({ filePath: file }), error => error.code === 'verification_timeout');
  assert(Date.now() - started < 1500); assert.equal(polls, 2);
});

for (const pendingCleanup of [false, true]) test(`native cancel verification truthfully reports pending cleanup=${pendingCleanup}`, async t => {
  const file = small(t), cloud = fakeCloud(), entered = gate(), controller = new AbortController(), phases = []; let late;
  const call = async (op, input, options) => {
    if (op === 'complete') { entered.resolve(); return new Promise(resolve => { late = resolve; }); }
    if (op === 'abort') { assert.equal(options.accountId, 'alice'); return pendingCleanup ? { ok: true, pendingCleanup: true } : new Promise(() => {}); }
    return cloud.call(op, input);
  };
  const pending = createMediaUploader({ call, fetchImpl: cloud.fetchImpl, getAccountId: () => 'alice', abortTimeoutMs: 20 }).upload({ filePath: file, signal: controller.signal, onProgress: p => phases.push(p.phase) });
  await entered.promise; controller.abort(); await assert.rejects(pending, error => error.name === 'AbortError' && error.code === (pendingCleanup ? 'cleanup_pending' : 'abort_unconfirmed'));
  late({ status: 'ready' }); await new Promise(r => setImmediate(r)); assert(!phases.includes('done'));
});
