'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createMediaUploader } = require('../electron/media-upload.cjs');

const MiB = 1024 ** 2;
function tmp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-up-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }

// A tiny fake of the server's media API and the bucket.
function fakeCloud({ partSize = 4 * MiB, failPuts = [] } = {}) {
  const state = { calls: [], put: [], uploads: new Map(), failures: [...failPuts] };
  const call = async (operation, input) => {
    state.calls.push(operation);
    if (operation === 'begin') {
      let row = state.uploads.get(input.requestKey);
      if (!row) {
        const multipart = input.size > 8 * MiB;
        row = { id: 'id-' + state.uploads.size, mode: multipart ? 'multipart' : 'single', size: input.size, parts: new Map(), status: 'pending' };
        state.uploads.set(input.requestKey, row);
      }
      return row.mode === 'single' ? { id: row.id, mode: 'single', url: `https://r2.test/put/${row.id}`, status: 'pending' }
        : { id: row.id, mode: 'multipart', partSize, partCount: Math.ceil(row.size / partSize), status: 'pending', completedParts: [...row.parts].map(([partNumber, size]) => ({ partNumber, size })) };
    }
    if (operation === 'partUrls') return { parts: input.partNumbers.map(n => ({ partNumber: n, url: `https://r2.test/part/${input.id}/${n}` })) };
    if (operation === 'complete') return { id: input.id, status: 'ready' };
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
  const dir = tmp(t), file = path.join(dir, 'long.mp4'); fs.writeFileSync(file, Buffer.alloc(10 * MiB + 123, 2));
  const cloud = fakeCloud();
  const progress = [];
  await createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl }).upload({ filePath: file, onProgress: p => progress.push(p.sent) });
  assert.deepEqual(cloud.state.put.map(p => p.size).sort((a, b) => a - b), [2 * MiB + 123, 4 * MiB, 4 * MiB]);
  assert.equal(progress.at(-1), 10 * MiB + 123);
});

test('after an interruption the same file resumes and sends only the missing parts', async t => {
  const dir = tmp(t), file = path.join(dir, 'long.mp4'); fs.writeFileSync(file, Buffer.alloc(12 * MiB, 3));
  const cloud = fakeCloud({ failPuts: [0, 403] }); // first part ok, second part refused for good
  const uploader = createMediaUploader({ call: cloud.call, fetchImpl: cloud.fetchImpl, sleep: async () => {} });
  await assert.rejects(uploader.upload({ filePath: file }), /拒绝了上传/);
  const sentBefore = cloud.state.put.length;
  cloud.state.failures.length = 0;
  const result = await uploader.upload({ filePath: file });
  assert.equal(result.status, 'ready');
  const parts = new Set(cloud.state.put.map(p => p.url));
  assert.equal(parts.size, cloud.state.put.length, 'no part is sent twice');
  assert.equal(cloud.state.put.length, 3, `3 parts of 4 MiB in total, sent ${sentBefore} before the stop`);
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
