'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Readable } = require('node:stream');
const { mediaInfo, detectOutputFiles, parseRange, fileResponse, createMediaTokens } = require('../electron/media-files.cjs');

function tmp(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wickrun-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function read(response) {
  if (!response.body) return Buffer.alloc(0);
  const chunks = [];
  for await (const chunk of Readable.from(response.body)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('video, audio, image and archive outputs are recognised whatever made them', () => {
  assert.deepEqual(mediaInfo('promo.MP4'), { kind: 'video', mime: 'video/mp4' });
  assert.equal(mediaInfo('clip.webm').kind, 'video');
  assert.equal(mediaInfo('voice.mp3').kind, 'audio');
  assert.equal(mediaInfo('art.png').kind, 'image');
  assert.equal(mediaInfo('bundle.zip').kind, 'file');
  assert.equal(mediaInfo('notes.txt'), null);
  assert.equal(mediaInfo(''), null);
});

test('output detection reads only metadata, so a large video costs the same as a note', t => {
  const root = tmp(t);
  const before = Date.now() - 60000;
  fs.mkdirSync(path.join(root, 'out'));
  const big = path.join(root, 'out', 'promo.mp4');
  // A sparse 3 GB file: reading it would be impossible in a test.
  const fd = fs.openSync(big, 'w'); fs.ftruncateSync(fd, 3 * 1024 ** 3); fs.closeSync(fd);
  fs.writeFileSync(path.join(root, 'voice.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'readme.txt'), 'not media');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'skip.mp4'), 'x');
  const old = path.join(root, 'old.mp4'); fs.writeFileSync(old, 'x'); const longAgo = new Date(before - 86400000); fs.utimesSync(old, longAgo, longAgo);

  const reads = [];
  const real = fs.readFileSync;
  fs.readFileSync = (...args) => { reads.push(args[0]); return real(...args); };
  let result;
  try { result = detectOutputFiles([root], before); } finally { fs.readFileSync = real; }

  assert.deepEqual(result.files.map(f => f.name).sort(), ['promo.mp4', 'voice.mp3']);
  assert.equal(result.files.find(f => f.name === 'promo.mp4').size, 3 * 1024 ** 3);
  assert.deepEqual(reads, [], 'no file content may be read');
});

test('output detection is bounded and ignores symbolic links', t => {
  const root = tmp(t);
  for (let i = 0; i < 80; i += 1) fs.writeFileSync(path.join(root, `f${i}.png`), 'x');
  assert.equal(detectOutputFiles([root], 0, { maxFiles: 10 }).files.length, 10);
  assert.equal(detectOutputFiles([root], 0, { maxFiles: 10 }).truncated, true);
  const outside = tmp(t);
  fs.writeFileSync(path.join(outside, 'secret.mp4'), 'x');
  try { fs.symlinkSync(outside, path.join(root, 'link'), 'dir'); } catch { return; }
  assert.ok(!detectOutputFiles([root], 0, { maxFiles: 500 }).files.some(f => f.name === 'secret.mp4'));
});

test('Range headers are parsed like a media player sends them', () => {
  assert.deepEqual(parseRange(undefined, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(parseRange('bytes=0-', 100), { start: 0, end: 99, partial: true });
  assert.deepEqual(parseRange('bytes=10-19', 100), { start: 10, end: 19, partial: true });
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99, partial: true });
  for (const bad of ['bytes=100-', 'bytes=20-10', 'bytes=-', 'bytes=abc', 'items=0-1', 'bytes=0-1,5-6', 'bytes=-0']) assert.equal(parseRange(bad, 100), null, bad);
});

test('a local file is streamed with byte ranges so long videos can be scrubbed', async t => {
  const root = tmp(t), file = path.join(root, 'clip.mp4');
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
  fs.writeFileSync(file, bytes);

  const whole = fileResponse(file);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers['Content-Type'], 'video/mp4');
  assert.equal(whole.headers['Accept-Ranges'], 'bytes');
  assert.equal(whole.headers['Content-Length'], '1000');
  assert.ok((await read(whole)).equals(bytes));

  const part = fileResponse(file, 'bytes=100-199');
  assert.equal(part.status, 206);
  assert.equal(part.headers['Content-Range'], 'bytes 100-199/1000');
  assert.equal(part.headers['Content-Length'], '100');
  assert.ok((await read(part)).equals(bytes.subarray(100, 200)));

  const tail = fileResponse(file, 'bytes=-50');
  assert.ok((await read(tail)).equals(bytes.subarray(950)));

  const bad = fileResponse(file, 'bytes=5000-');
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['Content-Range'], 'bytes */1000');
  assert.equal(fileResponse(path.join(root, 'missing.mp4')).status, 404);
  assert.equal(fileResponse(root).status, 404);
});

test('serving a multi-gigabyte file never loads it into memory', () => {
  const opened = [];
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wickrun-big-'));
  const file = path.join(root, 'huge.mp4');
  try {
    const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, 5 * 1024 ** 3); fs.closeSync(fd);
    const response = fileResponse(file, 'bytes=4000000000-4000000999', { openStream: (p, o) => { opened.push(o); return Readable.from([]); } });
    assert.equal(response.status, 206);
    assert.deepEqual(opened, [{ start: 4000000000, end: 4000000999 }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the renderer can only reach files the main process issued a handle for', t => {
  const root = tmp(t), outside = tmp(t);
  fs.writeFileSync(path.join(root, 'ok.mp4'), 'video bytes');
  fs.writeFileSync(path.join(outside, 'secret.mp4'), 'secret');
  let clock = 1000;
  const tokens = createMediaTokens({ roots: () => [root], now: () => clock, ttlMs: 5000 });

  const issued = tokens.issue(path.join(root, 'ok.mp4'));
  assert.equal(issued.kind, 'video');
  assert.equal(issued.mime, 'video/mp4');
  assert.equal(issued.size, 11);
  assert.match(issued.token, /^[0-9a-f]{32}$/);
  assert.equal(tokens.resolve(issued.token), fs.realpathSync.native(path.join(root, 'ok.mp4')));

  assert.throws(() => tokens.issue(path.join(outside, 'secret.mp4')), /不在允许的工作目录/);
  assert.throws(() => tokens.issue(path.join(root, 'missing.mp4')), /路径不存在/);
  assert.equal(tokens.resolve('guess'), null);
  assert.equal(tokens.resolve(undefined), null);

  clock += 6000;
  assert.equal(tokens.resolve(issued.token), null, 'handles expire');
});

test('the handle table is bounded', t => {
  const root = tmp(t);
  fs.writeFileSync(path.join(root, 'a.mp4'), 'x');
  const tokens = createMediaTokens({ roots: () => [root], limit: 5 });
  for (let i = 0; i < 50; i += 1) tokens.issue(path.join(root, 'a.mp4'));
  assert.ok(tokens.size <= 6);
});

test('a native client run reports the videos it wrote, even when the turn ends in an error', async t => {
  const { createConversationClients } = require('../electron/conversation-clients.cjs');
  const { createRunStore } = require('../electron/run-store.cjs');
  const root = tmp(t);
  const work = path.join(root, 'project'); fs.mkdirSync(work);
  const store = createRunStore(path.join(root, 'runtime'));
  store.save({ id: 'run-m', conversationId: 'c', answerId: 'a', config: { toolsEnabled: true, client: { kind: 'kimi', model: 'k' } }, state: { working: [], status: 'running' } });
  let fail = false;
  const host = createConversationClients({
    userData: root, store, getSettings: () => ({ tools: { workspaceRoots: [work] } }), openExternal: async () => {},
    deps: { discoverClient: () => path.join(root, 'kimi.exe'), createAcpClient: () => ({ close() {}, run: async () => {
      fs.writeFileSync(path.join(work, 'promo.mp4'), 'video');
      fs.writeFileSync(path.join(work, 'notes.txt'), 'text');
      if (fail) throw Error('stuck');
      return { status: 'completed', text: 'done' };
    } }) },
  });
  t.after(() => host.close());
  const ok = await host.run({ runId: 'run-m', requestId: 'r1', prompt: 'go', cwd: work }, () => {});
  assert.deepEqual(ok.outputFiles.map(f => f.name), ['promo.mp4']);
  fail = true;
  fs.rmSync(path.join(work, 'promo.mp4'));
  const bad = await host.run({ runId: 'run-m', requestId: 'r2', prompt: 'go', cwd: work }, () => {});
  assert.equal(bad.status, 'unknown');
  assert.deepEqual(bad.outputFiles.map(f => f.name), ['promo.mp4']);
});

