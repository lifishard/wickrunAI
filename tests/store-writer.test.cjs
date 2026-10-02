const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createStoreWriter } = require('../electron/store-writer.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anyai-store-writer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'store.json');
}

test('worker serializes key mutations and keeps the existing store format', async (t) => {
  const file = fixture(t);
  const writer = createStoreWriter(file);
  t.after(() => writer.close());
  await Promise.all([
    writer.mutate({ scope: 'kv', key: 'first', value: 'one' }),
    writer.mutate({ scope: 'kv', key: 'second', value: 'two' }),
  ]);
  await writer.mutate({ scope: 'secrets', key: 'account', value: { enc: true, v: 'ciphertext' } });
  await writer.flush();
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(value.kv, { first: 'one', second: 'two' });
  assert.deepEqual(value.secrets, { account: { enc: true, v: 'ciphertext' } });
  assert.equal(fs.existsSync(file + '.prev'), true);
});

test('external changes reject the failed and pending mutations without overwriting them', async (t) => {
  const file = fixture(t);
  const writer = createStoreWriter(file);
  t.after(() => writer.close());
  await writer.mutate({ scope: 'kv', key: 'original', value: 'kept' });
  fs.writeFileSync(file, JSON.stringify({ kv: { external: 'authoritative' }, secrets: {} }));
  const first = writer.mutate({ scope: 'kv', key: 'lost', value: 'nope' });
  const second = writer.mutate({ scope: 'kv', key: 'alsoLost', value: 'nope' });
  await assert.rejects(first, /其他程序/);
  await assert.rejects(second, /其他程序/);
  await assert.rejects(writer.flush(), /其他程序/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { kv: { external: 'authoritative' }, secrets: {} });
});

test('the first worker write rejects changes made after the main-process snapshot',async t=>{
  const file=fixture(t),crypto=require('node:crypto');
  const old=JSON.stringify({kv:{setting:'old'},secrets:{}});fs.writeFileSync(file,old);
  const expectedHash=crypto.createHash('sha256').update(old).digest('hex');
  fs.writeFileSync(file,JSON.stringify({kv:{setting:'external'},secrets:{}}));
  const writer=createStoreWriter(file,{expectedHash});t.after(()=>writer.close());
  await assert.rejects(writer.mutate({scope:'kv',key:'setting',value:'stale'}),/其他程序/);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).kv.setting,'external');
});

test('store facade returns cached keys while async mutations commit through the writer', async (t) => {
  const file = fixture(t), userData = path.dirname(file), modulePath = require.resolve('../electron/store.cjs');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'electron') return {
      app: { getPath: () => userData },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (value) => Buffer.from(value, 'utf8'),
        decryptString: (value) => value.toString('utf8'),
      },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  const store = require(modulePath);
  t.after(async () => {
    try { await store.flush(); } catch { /* failure is asserted by the writer tests */ }
    store.close();
    Module._load = originalLoad;
    delete require.cache[modulePath];
  });
  assert.equal(store.kvGet('missing'), null);
  await Promise.all([store.kvSet('one', '1'), store.kvSet('two', '2')]);
  await store.secretSet('token', 'secret');
  await store.flush();
  assert.equal(store.kvGet('one'), '1');
  assert.equal(store.kvGet('two'), '2');
  assert.equal(store.secretGet('token'), 'secret');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).kv).sort(), ['one', 'two']);
});

test('a failed write rejects only that mutation; the next save still works',async t=>{
  const file=fixture(t);
  const writer=createStoreWriter(file);t.after(()=>writer.close());
  await writer.mutate({scope:'kv',key:'kept',value:'1'});
  // Block the backup rotation so the next write fails the way a held file does.
  fs.rmSync(file+'.prev',{force:true});fs.mkdirSync(file+'.prev');fs.writeFileSync(path.join(file+'.prev','x'),'x');
  await assert.rejects(writer.mutate({scope:'kv',key:'failed',value:'2'}));
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).kv.failed,undefined);
  fs.rmSync(file+'.prev',{recursive:true,force:true});
  await writer.mutate({scope:'kv',key:'later',value:'3'});
  await writer.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).kv,{kept:'1',later:'3'});
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(n=>n.endsWith('.tmp')),[]);
});

test('renames refused briefly on Windows are retried; other errors fail at once',()=>{
  const {renameWithRetry}=require('../electron/fs-retry.cjs');
  const failing=(codes)=>{let calls=0;return {calls:()=>calls,fs:{renameSync(){const code=codes[calls++];if(code){const e=new Error(code);e.code=code;throw e;}}}};};
  let held=failing(['EPERM','EBUSY','EACCES']);
  assert.equal(renameWithRetry('a','b',{fs:held.fs,platform:'win32',wait:()=>{}}),3);
  held=failing(Array(20).fill('EPERM'));
  assert.throws(()=>renameWithRetry('a','b',{fs:held.fs,platform:'win32',delays:[1,1],wait:()=>{}}),/EPERM/);
  assert.equal(held.calls(),3);
  held=failing(['ENOSPC']);
  assert.throws(()=>renameWithRetry('a','b',{fs:held.fs,platform:'win32',wait:()=>{}}),/ENOSPC/);
  held=failing(['EPERM']);
  assert.throws(()=>renameWithRetry('a','b',{fs:held.fs,platform:'linux',wait:()=>{}}),/EPERM/);
});

test('saving an unchanged value does not rewrite the store; the backup is the previous file',async t=>{
  const file=fixture(t);
  const writer=createStoreWriter(file);t.after(()=>writer.close());
  await writer.mutate({scope:'kv',key:'conversations',value:'v1'});
  await writer.mutate({scope:'kv',key:'conversations',value:'v2'});
  assert.equal(JSON.parse(fs.readFileSync(file+'.prev','utf8')).kv.conversations,'v1');
  const before=fs.statSync(file);
  await new Promise(r=>setTimeout(r,20));
  await writer.mutate({scope:'kv',key:'conversations',value:'v2'});
  await writer.mutate({scope:'kv',key:'missing',delete:true});
  assert.equal(fs.statSync(file).mtimeMs,before.mtimeMs);
  assert.equal(JSON.parse(fs.readFileSync(file+'.prev','utf8')).kv.conversations,'v1');
  // An external edit is still detected after skipped writes.
  fs.writeFileSync(file,JSON.stringify({kv:{conversations:'external!'},secrets:{}}));
  await assert.rejects(writer.mutate({scope:'kv',key:'conversations',value:'v3'}),/其他程序/);
});
