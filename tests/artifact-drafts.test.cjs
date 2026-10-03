const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createArtifactDrafts } = require('../electron/artifact-drafts.cjs');
const { createArtifactWorkspace } = require('../electron/artifact-workspace.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-draft-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dir: path.join(root, 'drafts'), file: path.join(root, 'note.md') };
}
test('acknowledged text drafts survive a new process reader without changing the source', t => {
  const { dir, file, root } = setup(t); fs.writeFileSync(file, 'original');
  const files = createArtifactWorkspace(path.join(root, 'versions'));
  const initial = files.read(file);
  createArtifactDrafts(dir).write({ kind: 'text', path: file, value: { text: '\uFEFFdraft🙂\r\n', hash: initial.hash } });
  const script = `const api=require(${JSON.stringify(path.resolve(__dirname, '../electron/artifact-drafts.cjs'))}).createArtifactDrafts(${JSON.stringify(dir)});process.stdout.write(JSON.stringify(api.read({kind:'text',path:${JSON.stringify(file)}})));`;
  const recovered = JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
  assert.equal(recovered.text, '\uFEFFdraft🙂\r\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  fs.writeFileSync(file, 'external');
  assert.throws(() => files.save({ path: file, expectedHash: recovered.hash, text: recovered.text }), /其他任务/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'external');
});
test('binary recovery retains typed bytes and is removed durably on discard', t => {
  const { dir, file } = setup(t), api = createArtifactDrafts(dir);
  const value = { snapshot: { bytes: new Uint8Array([1, 2, 255]), hash: 'base' }, changed: new Uint8Array([3, 4]), text: 'edit' };
  api.write({ kind: 'office', path: file, value });
  const recovered = createArtifactDrafts(dir).read({ kind: 'office', path: file });
  assert.ok(recovered.snapshot.bytes instanceof Uint8Array);
  assert.deepEqual([...recovered.changed], [3, 4]);
  assert.equal(api.read({ kind: 'text', path: file }), null);
  api.remove({ kind: 'office', path: file });
  assert.equal(createArtifactDrafts(dir).read({ kind: 'office', path: file }), null);
});
test('disk failure cannot acknowledge or destroy a previously committed draft', t => {
  const { dir, file } = setup(t), input = { kind: 'text', path: file, value: { text: 'first', hash: 'base' } };
  createArtifactDrafts(dir).write(input);
  const failed = createArtifactDrafts(dir, { ...fs, renameSync() { throw Object.assign(Error('disk locked'), { code: 'EPERM' }); } });
  assert.throws(() => failed.write({ ...input, value: { text: 'second' } }), /disk locked/);
  assert.equal(createArtifactDrafts(dir).read(input).text, 'first');
  assert.equal(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')).length, 0);
});
test('corrupt journal is surfaced and relative paths or oversized text are rejected', t => {
  const { dir, file } = setup(t), api = createArtifactDrafts(dir), input = { kind: 'text', path: file };
  api.write({ ...input, value: { text: 'first' } });
  fs.writeFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'corrupt');
  assert.throws(() => api.read(input), /原记录已保留/);
  assert.throws(() => api.write({ ...input, path: '../escape', value: {} }), /无效/);
  assert.throws(() => api.write({ ...input, value: { text: 'x'.repeat(3 * 1024 * 1024) } }), /过大/);
});
test('queued draft deletion follows pending writes, and failures do not block a later retry', async () => {
  const calls = []; let finish;
  const bridge = { artifactDraft(action) { calls.push(action); if (action === 'write' && calls.length === 1) return new Promise(resolve => { finish = resolve; }); return Promise.resolve(null); } };
  const { loader } = require('./load-ts.cjs');
  const api = loader({ './transport': { desktop: () => bridge } })(path.resolve(__dirname, '../src/lib/artifact-drafts.ts'));
  const write = api.writeDraft('text', '/note', { text: 'draft', hash: 'base' });
  const remove = api.removeDraft('text', '/note');
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(calls, ['write']);
  finish({ ok: true }); await Promise.all([write, remove]); assert.deepEqual(calls, ['write', 'remove']);
  bridge.artifactDraft = async action => { if (action === 'write') throw Error('disk full'); return null; };
  await assert.rejects(api.writeDraft('text', '/note', {}), /disk full/);
  assert.equal(await api.readDraft('text', '/note'), null);
});
test('coalescing preserves latest revision order even when paths alias the same native journal', async () => {
  const calls = [];
  const { loader } = require('./load-ts.cjs');
  const api = loader({ './transport': { desktop: () => ({ artifactDraft: async (action, input) => { calls.push([action, input.value?.text]); return null; } }) } })(path.resolve(__dirname, '../src/lib/artifact-drafts.ts'));
  const first = api.writeDraft('text', 'C:/Note.md', { text: 'old', hash: 'base' });
  const alias = api.writeDraft('text', 'c:/note.md', { text: 'middle', hash: 'base' });
  const latest = api.writeDraft('text', 'C:/Note.md', { text: 'latest', hash: 'base' });
  await api.removeDraft('text', 'C:\\Note.md');
  await Promise.all([first, alias, latest]);
  assert.deepEqual(calls, [['write', 'middle'], ['write', 'latest'], ['remove', undefined]]);
});
