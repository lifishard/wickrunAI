'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');

// The override allows review of a sibling worktree without copying its edits.
const source = process.env.WICKRUN_NATIVE_SECRETS_SOURCE || path.resolve(__dirname, '../src/lib/native-secrets.ts');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const turn = () => new Promise(resolve => setImmediate(resolve));

function fixture({ secure = {}, legacy = {}, before = {} } = {}) {
  const secureStore = new Map(Object.entries(secure));
  const legacyStore = new Map(Object.entries(legacy));
  const calls = [];
  const keyOf = id => `secret:${id}`;
  const wrap = (name, action) => async options => {
    calls.push({ name, key: options.key });
    await before[name]?.(options);
    return action(options);
  };
  const plugin = {
    get: wrap('secure.get', ({ key }) => ({ value: secureStore.get(key) ?? null })),
    set: wrap('secure.set', ({ key, value }) => { secureStore.set(key, value); }),
    remove: wrap('secure.remove', ({ key }) => { secureStore.delete(key); }),
  };
  const preferences = {
    get: wrap('legacy.get', ({ key }) => ({ value: legacyStore.get(key) ?? null })),
    set: wrap('legacy.set', ({ key, value }) => { legacyStore.set(key, value); }),
    remove: wrap('legacy.remove', ({ key }) => { legacyStore.delete(key); }),
  };
  const api = loader({
    '@capacitor/core': { registerPlugin(name) { assert.equal(name, 'WickrunSecrets'); return plugin; } },
    '@capacitor/preferences': { Preferences: preferences },
  })(source);
  return { api, secureStore, legacyStore, calls, plugin, preferences, keyOf };
}

test('native credential migration keeps the secure value and erases the stale plaintext copy', async () => {
  const f = fixture({ secure: { 'secret:p': 'secure-current' }, legacy: { 'secret:p': 'legacy-stale' } });
  assert.equal(await f.api.nativeSecretGet('p'), 'secure-current');
  assert.equal(f.secureStore.get('secret:p'), 'secure-current');
  assert.equal(f.legacyStore.has('secret:p'), false);
  assert.equal(f.calls.some(call => call.name === 'secure.set'), false);
});

test('legacy credentials migrate before plaintext is deleted; missing credentials stay missing', async () => {
  const f = fixture({ legacy: { 'secret:p': 'legacy-value' } });
  assert.equal(await f.api.nativeSecretGet('p'), 'legacy-value');
  assert.equal(f.secureStore.get('secret:p'), 'legacy-value');
  assert.equal(f.legacyStore.has('secret:p'), false);
  assert(f.calls.findIndex(call => call.name === 'secure.set') < f.calls.findIndex(call => call.name === 'legacy.remove'));
  assert.equal(await f.api.nativeSecretGet('missing'), null);
  assert.equal(f.secureStore.has('secret:missing'), false);
});

test('secure read/write failures never fall back to plaintext or delete the migration source', async () => {
  for (const failingOperation of ['secure.get', 'secure.set']) {
    const f = fixture({ legacy: { 'secret:p': 'recoverable-value' }, before: {
      [failingOperation]: () => { throw Error('secure store unavailable'); },
    } });
    await assert.rejects(f.api.nativeSecretGet('p'), /unavailable/);
    assert.equal(f.legacyStore.get('secret:p'), 'recoverable-value');
    assert.equal(f.calls.some(call => call.name === 'legacy.remove'), false);
  }
});

test('failed plaintext cleanup preserves the durable secure value and can be retried', async () => {
  let fail = true;
  const f = fixture({ legacy: { 'secret:p': 'legacy-value' }, before: {
    'legacy.remove': () => { if (fail) throw Error('cleanup failed'); },
  } });
  await assert.rejects(f.api.nativeSecretGet('p'), /cleanup failed/);
  assert.equal(f.secureStore.get('secret:p'), 'legacy-value');
  assert.equal(f.legacyStore.get('secret:p'), 'legacy-value');
  fail = false;
  assert.equal(await f.api.nativeSecretGet('p'), 'legacy-value');
  assert.equal(f.legacyStore.has('secret:p'), false);
});

test('setting a new key never writes plaintext and failed secure writes preserve both existing copies', async () => {
  let fail = true;
  const f = fixture({ secure: { 'secret:p': 'current-value' }, legacy: { 'secret:p': 'legacy-value' }, before: {
    'secure.set': () => { if (fail) throw Error('write failed'); },
  } });
  await assert.rejects(f.api.nativeSecretSet('p', 'replacement-value'), /write failed/);
  assert.equal(f.secureStore.get('secret:p'), 'current-value');
  assert.equal(f.legacyStore.get('secret:p'), 'legacy-value');
  fail = false;
  await f.api.nativeSecretSet('p', 'replacement-value');
  assert.equal(f.secureStore.get('secret:p'), 'replacement-value');
  assert.equal(f.legacyStore.has('secret:p'), false);
  assert.equal(f.calls.some(call => call.name === 'legacy.set'), false);
});

test('a deletion does not remove the secure copy if plaintext cleanup fails', async () => {
  let fail = true;
  const f = fixture({ secure: { 'secret:p': 'current-value' }, legacy: { 'secret:p': 'stale-value' }, before: {
    'legacy.remove': () => { if (fail) throw Error('cleanup failed'); },
  } });
  await assert.rejects(f.api.nativeSecretDelete('p'), /cleanup failed/);
  assert.equal(f.secureStore.get('secret:p'), 'current-value', 'failed cleanup must not expose the stale key to remigration');
  fail = false;
  await f.api.nativeSecretDelete('p');
  assert.equal(await f.api.nativeSecretGet('p'), null);
  assert.equal(f.secureStore.has('secret:p'), false);
  assert.equal(f.legacyStore.has('secret:p'), false);
});

function pausedMigration() {
  const entered = deferred(), release = deferred();
  const f = fixture({ legacy: { 'secret:p': 'legacy-value' } });
  f.preferences.get = async ({ key }) => {
    const value = f.legacyStore.get(key) ?? null;
    entered.resolve();
    await release.promise;
    return { value };
  };
  return { ...f, entered, release };
}

test('a concurrent explicit save wins over an already-started legacy migration', async () => {
  const f = pausedMigration();
  const get = f.api.nativeSecretGet('p');
  await f.entered.promise;
  const set = f.api.nativeSecretSet('p', 'replacement-value');
  await turn();
  f.release.resolve();
  await Promise.all([get, set]);
  assert.equal(f.secureStore.get('secret:p'), 'replacement-value');
  assert.equal(f.legacyStore.has('secret:p'), false);
});

test('a concurrent explicit deletion cannot be undone by an already-started legacy migration', async () => {
  const f = pausedMigration();
  const get = f.api.nativeSecretGet('p');
  await f.entered.promise;
  const remove = f.api.nativeSecretDelete('p');
  await turn();
  f.release.resolve();
  await Promise.all([get, remove]);
  assert.equal(f.secureStore.has('secret:p'), false, 'migration resurrected a deleted credential');
  assert.equal(f.legacyStore.has('secret:p'), false);
});

test('a failed operation does not poison later writes to the same key', async () => {
  let attempts = 0;
  const f = fixture({ before: { 'secure.set': () => { if (++attempts === 1) throw Error('temporary failure'); } } });
  const results = await Promise.allSettled([
    f.api.nativeSecretSet('p', 'first-value'),
    f.api.nativeSecretSet('p', 'second-value'),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'fulfilled');
  assert.equal(f.secureStore.get('secret:p'), 'second-value');
});

test('a stalled key does not block saving an unrelated key', async () => {
  const f = pausedMigration();
  const get = f.api.nativeSecretGet('p');
  await f.entered.promise;
  let otherFinished = false;
  const set = f.api.nativeSecretSet('other', 'other-value').then(() => { otherFinished = true; });
  await turn();
  const completedIndependently = otherFinished;
  f.release.resolve();
  await Promise.all([get, set]);
  assert.equal(completedIndependently, true);
  assert.equal(f.secureStore.get('secret:other'), 'other-value');
});
