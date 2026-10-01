'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loader } = require('./load-ts.cjs');

const file = path.resolve(__dirname, '../src/native/files.ts');
function harness(native = true, afterChunk) {
  const calls = [], chunks = [];
  const plugin = {
    async downloadBegin(input) { calls.push(['begin', input]); return { id: 'fixture-id' }; },
    async downloadChunk(input) {
      calls.push(['chunk', input.index]); chunks.push(Buffer.from(input.data, 'base64'));
      afterChunk?.(input.index);
    },
    async downloadFinish(input) { calls.push(['finish', input.id]); return { saved: true }; },
    async downloadAbort(input) { calls.push(['abort', input.id]); },
  };
  const { saveSharedBlob } = loader({
    '@capacitor/core': {
      Capacitor: { isNativePlatform: () => native, getPlatform: () => native ? 'android' : 'web' },
      registerPlugin: () => plugin,
    },
  })(file);
  return { saveSharedBlob, calls, chunks };
}

test('Android save sends sequential bounded chunks and waits for the verified native save', async () => {
  const input = Buffer.alloc(512 * 1024 + 17, 0x5a);
  const sha256 = createHash('sha256').update(input).digest('hex');
  const h = harness();
  assert.equal(await h.saveSharedBlob(new Blob([input]), { name: 'report.pdf', mime: 'application/pdf', sha256 }), true);
  assert.deepEqual(h.calls.map(call => call[0]), ['begin', 'chunk', 'chunk', 'finish']);
  assert.equal(h.calls[0][1].sha256, sha256);
  assert.deepEqual(h.calls.filter(call => call[0] === 'chunk').map(call => call[1]), [0, 1]);
  assert.equal(h.chunks[0].length, 512 * 1024);
  assert.equal(h.chunks[1].length, 17);
  assert.deepEqual(Buffer.concat(h.chunks), input);
});

test('abort stops later chunks and discards the native temporary download', async () => {
  const controller = new AbortController();
  const h = harness(true, () => controller.abort());
  const input = Buffer.alloc(512 * 1024 + 1, 0x20);
  const sha256 = createHash('sha256').update(input).digest('hex');
  await assert.rejects(h.saveSharedBlob(new Blob([input]), { name: 'data.bin', sha256, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(h.calls.map(call => call[0]), ['begin', 'chunk', 'abort']);
});

test('non-Android caller retains its existing browser download path', async () => {
  const h = harness(false);
  assert.equal(await h.saveSharedBlob(new Blob(['ok']), { name: 'note.txt' }), false);
  assert.deepEqual(h.calls, []);
});
