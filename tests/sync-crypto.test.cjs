'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { seal, open, FORMAT, VERSION, MIN_PASSPHRASE } = require('../electron/sync-crypto.cjs');

const PASS = 'correct horse battery staple';

test('封了能拆，内容一字不差', () => {
  const payload = { conversations: [{ id: 'a', title: '你好' }], n: 42, nested: { deep: [1, 2, 3] } };
  assert.deepEqual(open(seal(payload, PASS), PASS), payload);
});

test('落点上躺的是密文，原文不能在包里搜到', () => {
  const s = seal({ secretish: 'MY-CONVERSATION-TEXT' }, PASS);
  assert.ok(!s.includes('MY-CONVERSATION-TEXT'));
  assert.ok(!s.includes('secretish'));
});

test('同样的内容封两次结果不同 —— salt 和 nonce 每次都新', () => {
  const a = seal({ x: 1 }, PASS);
  const b = seal({ x: 1 }, PASS);
  assert.notEqual(a, b);
  assert.notEqual(JSON.parse(a).salt, JSON.parse(b).salt);
  assert.notEqual(JSON.parse(a).nonce, JSON.parse(b).nonce);
});

test('口令不对打不开', () => {
  assert.throws(() => open(seal({ x: 1 }, PASS), PASS + 'x'), /口令不对/);
});

test('口令错和包被改过给同一句话 —— 不给试口令的人任何区分信号', () => {
  const s = seal({ x: 1 }, PASS);
  const tampered = JSON.parse(s);
  tampered.body = Buffer.from('garbage-body-here').toString('base64');
  let a = '', b = '';
  try { open(s, PASS + 'x'); } catch (e) { a = e.message; }
  try { open(JSON.stringify(tampered), PASS); } catch (e) { b = e.message; }
  assert.equal(a, b);
});

test('改密文会被 GCM 的 tag 抓住', () => {
  const env = JSON.parse(seal({ x: 1 }, PASS));
  const body = Buffer.from(env.body, 'base64');
  body[0] ^= 0xff;
  env.body = body.toString('base64');
  assert.throws(() => open(JSON.stringify(env), PASS), /打不开/);
});

test('改包头也会被抓住 —— salt/nonce/版本都绑进了 AAD', () => {
  for (const field of ['salt', 'nonce']) {
    const env = JSON.parse(seal({ x: 1 }, PASS));
    const buf = Buffer.from(env[field], 'base64');
    buf[0] ^= 0xff;
    env[field] = buf.toString('base64');
    assert.throws(() => open(JSON.stringify(env), PASS), /打不开|长度/, field);
  }
});

test('版本号被改小不会走进旧解析路径', () => {
  const env = JSON.parse(seal({ x: 1 }, PASS));
  env.version = 0;
  assert.throws(() => open(JSON.stringify(env), PASS), /版本/);
});

test('scrypt 参数被写成内存炸弹会被拦下，而不是照单全收', () => {
  const env = JSON.parse(seal({ x: 1 }, PASS));
  env.kdf = { name: 'scrypt', N: 1 << 30, r: 8, p: 1, keyLen: 32 };
  assert.throws(() => open(JSON.stringify(env), PASS), /参数超出允许范围/);
  env.kdf = { name: 'argon2id', N: 1024, r: 8, p: 1, keyLen: 32 };
  assert.throws(() => open(JSON.stringify(env), PASS), /不认识的口令派生/);
});

test('太短的口令在入口就被拦掉', () => {
  assert.throws(() => seal({ x: 1 }, 'short'), new RegExp(String(MIN_PASSPHRASE)));
  assert.throws(() => seal({ x: 1 }, ''), /口令/);
  assert.throws(() => open('{}', 'short'), /口令/);
});

test('别人的包、空包、乱七八糟的输入都不会被当成同步包', () => {
  assert.throws(() => open('not json at all', PASS), /有效的 JSON/);
  assert.throws(() => open(JSON.stringify({ format: 'something-else' }), PASS), /不是 wickrunAI/);
  assert.throws(() => open(JSON.stringify({ format: FORMAT, version: VERSION, kdf: { name: 'scrypt', N: 1024, r: 8, p: 1, keyLen: 32 }, salt: 'AA==', nonce: 'AA==', tag: 'AA==', body: '' }), PASS), /长度不对/);
});

test('封拆一趟要花上一点时间 —— 这个代价会原样加到爆破的每一次尝试上', () => {
  const t = Date.now();
  seal({ x: 1 }, PASS);
  assert.ok(Date.now() - t >= 20, '口令派生太快，说明 scrypt 参数被调松了');
});
