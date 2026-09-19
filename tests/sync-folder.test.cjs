'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const F = require('../electron/sync-folder.cjs');

const PASS = 'correct horse battery staple';
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsync-'));
const dev = () => crypto.randomUUID();

test('两台设备各写各的文件，互不覆盖', () => {
  const d = dir(), A = dev(), B = dev();
  F.push(d, A, { from: 'A' }, PASS);
  F.push(d, B, { from: 'B' }, PASS);
  assert.equal(F.peek(d).length, 2);
  assert.deepEqual(F.pull(d, A, PASS).bundles.map((x) => x.payload), [{ from: 'B' }]);
  assert.deepEqual(F.pull(d, B, PASS).bundles.map((x) => x.payload), [{ from: 'A' }]);
});

test('自己写的自己不会再读回来', () => {
  const d = dir(), A = dev();
  F.push(d, A, { from: 'A' }, PASS);
  assert.deepEqual(F.pull(d, A, PASS).bundles, []);
});

test('重复推送是覆盖不是堆积 —— 落点不该无限长大', () => {
  const d = dir(), A = dev();
  for (let i = 0; i < 5; i++) F.push(d, A, { i }, PASS);
  assert.equal(F.peek(d).length, 1);
});

test('落点上躺的是密文，会话原文搜不到', () => {
  const d = dir(), A = dev();
  F.push(d, A, { conversations: [{ title: 'MY-PRIVATE-TITLE' }] }, PASS);
  const raw = fs.readFileSync(path.join(d, A + '.wsync'), 'utf8');
  assert.ok(!raw.includes('MY-PRIVATE-TITLE'));
  assert.ok(!raw.includes('conversations'));
});

test('一个坏包不会让整次同步失败 —— 其余照常合', () => {
  const d = dir(), A = dev(), B = dev();
  F.push(d, B, { from: 'B' }, PASS);
  fs.writeFileSync(path.join(d, dev() + '.wsync'), 'not a bundle');
  const r = F.pull(d, A, PASS);
  assert.equal(r.bundles.length, 1);
  assert.equal(r.failures.length, 1);
});

test('换过口令的老包被记为失败，不会污染合并结果', () => {
  const d = dir(), A = dev(), B = dev();
  F.push(d, B, { from: 'B' }, 'an older passphrase here');
  const r = F.pull(d, A, PASS);
  assert.deepEqual(r.bundles, []);
  assert.equal(r.failures.length, 1);
});

test('文件名声称的设备号和包里签的对不上就拒收', () => {
  const d = dir(), A = dev(), B = dev(), C = dev();
  F.push(d, B, { from: 'B' }, PASS);
  // 把 B 的包改名成 C 的
  fs.renameSync(path.join(d, B + '.wsync'), path.join(d, C + '.wsync'));
  const r = F.pull(d, A, PASS);
  assert.deepEqual(r.bundles, []);
  assert.match(r.failures[0].error, /对不上/);
});

test('不是 UUID 名字的文件一律不看 —— 落点目录是共用的，里面可能有别人的东西', () => {
  const d = dir(), A = dev();
  fs.writeFileSync(path.join(d, 'readme.wsync'), 'x');
  fs.writeFileSync(path.join(d, 'notes.txt'), 'x');
  fs.writeFileSync(path.join(d, '../outside.wsync'), 'x');
  const r = F.pull(d, A, PASS);
  assert.deepEqual(r.bundles, []);
  assert.deepEqual(r.failures, []);
  assert.deepEqual(F.peek(d), []);
});

test('临时文件不会被当成同步包读走 —— 读的一方看不到半份', () => {
  const d = dir(), A = dev(), B = dev();
  fs.writeFileSync(path.join(d, B + '.wsync.1234.tmp'), 'half written');
  assert.deepEqual(F.pull(d, A, PASS).failures, []);
  assert.deepEqual(F.peek(d), []);
});

test('设备号必须是 UUID —— 它会变成落点上的文件名', () => {
  const d = dir();
  for (const bad of ['', '../escape', 'a/b', 'A'.repeat(40), null]) {
    assert.throws(() => F.push(d, bad, {}, PASS), /设备编号/, String(bad));
  }
});

test('落点必须是绝对路径的真目录，不跟符号链接', () => {
  const d = dir(), A = dev();
  assert.throws(() => F.push('relative/path', A, {}, PASS), /绝对路径/);
  assert.throws(() => F.push(path.join(d, 'nope'), A, {}, PASS), /不存在/);
  const f = path.join(d, 'afile');
  fs.writeFileSync(f, 'x');
  assert.throws(() => F.push(f, A, {}, PASS), /不是文件夹/);
});

test('落点上设备太多就停下来让人先清理，而不是闷头读几百个包', () => {
  const d = dir(), A = dev();
  for (let i = 0; i <= F.MAX_FILES; i++) fs.writeFileSync(path.join(d, dev() + '.wsync'), 'x');
  assert.throws(() => F.pull(d, A, PASS), new RegExp(String(F.MAX_FILES)));
});

test('口令太短在落点这一层也进不去', () => {
  const d = dir(), A = dev();
  assert.throws(() => F.push(d, A, {}, 'short'), /口令/);
});
