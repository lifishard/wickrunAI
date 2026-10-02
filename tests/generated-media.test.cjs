'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createGeneratedMedia, privateAddress } = require('../electron/generated-media.cjs');

function tmp(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'wickrun-gen-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const publicLookup = async () => [{ address: '93.184.216.34' }];
function response(bytes, { status = 200, type = 'video/mp4', headers = {} } = {}) {
  return new Response(bytes, { status, headers: { 'content-type': type, ...headers } });
}

test('an inline base64 image or audio clip from any provider becomes a file', async t => {
  const dir = tmp(t);
  const media = createGeneratedMedia({ dir });
  const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
  const result = await media.save([
    { kind: 'image', mime: 'image/png', base64: png.toString('base64') },
    { kind: 'image', base64: `data:image/jpeg;base64,${png.toString('base64')}` },
    { kind: 'audio', mime: 'audio/mpeg', base64: Buffer.from('ID3 audio').toString('base64') },
  ]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.files.map(f => path.extname(f.name)), ['.png', '.png', '.mp3']);
  assert.ok(fs.readFileSync(result.files[0].path).equals(png));
});

test('a link to a rendered video is downloaded now, because provider links expire', async t => {
  const dir = tmp(t);
  const bytes = Buffer.alloc(300000, 7);
  const media = createGeneratedMedia({ dir, lookup: publicLookup, fetchImpl: async () => response(bytes) });
  const result = await media.save([{ kind: 'video', url: 'https://cdn.example.com/out/clip.mp4?sig=abc', name: 'promo' }]);
  assert.equal(result.errors.length, 0);
  assert.match(result.files[0].name, /^promo-[0-9a-f]{6}\.mp4$/);
  assert.equal(result.files[0].size, 300000);
  assert.deepEqual(fs.readdirSync(path.dirname(result.files[0].path)).filter(n => n.endsWith('.part')), []);
});

test('links to this computer or the local network are refused', async t => {
  assert.equal(privateAddress('127.0.0.1'), true);
  assert.equal(privateAddress('10.1.2.3'), true);
  assert.equal(privateAddress('192.168.0.9'), true);
  assert.equal(privateAddress('169.254.169.254'), true);
  assert.equal(privateAddress('::1'), true);
  assert.equal(privateAddress('::ffff:127.0.0.1'), true);
  assert.equal(privateAddress('93.184.216.34'), false);
  const dir = tmp(t);
  let fetched = 0;
  const media = createGeneratedMedia({ dir, lookup: async () => [{ address: '10.0.0.5' }], fetchImpl: async () => { fetched += 1; return response('x'); } });
  const result = await media.save([{ kind: 'video', url: 'https://internal.example.com/a.mp4' }, { kind: 'video', url: 'http://cdn.example.com/a.mp4' }]);
  assert.equal(fetched, 0);
  assert.match(result.errors[0].error, /本机或内网/);
  assert.match(result.errors[1].error, /https/);
});

test('a redirect to an internal address is refused too', async t => {
  const dir = tmp(t);
  const lookup = async host => [{ address: host === 'evil.example.com' ? '127.0.0.1' : '93.184.216.34' }];
  const media = createGeneratedMedia({ dir, lookup, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x.mp4' } }) });
  const result = await media.save([{ kind: 'video', url: 'https://cdn.example.com/a.mp4' }]);
  assert.match(result.errors[0].error, /本机或内网/);
});

test('an oversized download is stopped and leaves nothing behind', async t => {
  const dir = tmp(t);
  const big = createGeneratedMedia({ dir, lookup: publicLookup, maxBytes: 1000, fetchImpl: async () => response(Buffer.alloc(5000), { headers: { 'content-length': '5000' } }) });
  const declared = await big.save([{ kind: 'video', url: 'https://cdn.example.com/a.mp4' }]);
  assert.match(declared.errors[0].error, /上限/);
  const streamed = createGeneratedMedia({ dir, lookup: publicLookup, maxBytes: 1000, fetchImpl: async () => response(Buffer.alloc(5000)) });
  const result = await streamed.save([{ kind: 'video', url: 'https://cdn.example.com/b.mp4' }]);
  assert.match(result.errors[0].error, /上限/);
  const left = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(n => String(n).endsWith('.mp4') || String(n).endsWith('.part')) : [];
  assert.deepEqual(left, []);
});

test('an expired link explains what to do, and one failure does not hide the other files', async t => {
  const dir = tmp(t);
  let n = 0;
  const media = createGeneratedMedia({ dir, lookup: publicLookup, fetchImpl: async () => (n++ === 0 ? response('', { status: 403 }) : response(Buffer.alloc(100))) });
  const result = await media.save([{ kind: 'video', url: 'https://cdn.example.com/old.mp4' }, { kind: 'video', url: 'https://cdn.example.com/new.mp4' }]);
  assert.match(result.errors[0].error, /已过期，请重新生成/);
  assert.equal(result.files.length, 1);
});
