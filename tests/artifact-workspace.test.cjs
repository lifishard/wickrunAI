const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createArtifactWorkspace, readDocument } = require('../electron/artifact-workspace.cjs');
const { loader } = require('./load-ts.cjs');
const { replaceArtifactSelection, artifactSourceOffset, applyArtifactTextareaChange } = loader()(path.resolve(__dirname, '../src/lib/artifact-edit.ts'));
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-artifacts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'note.md'), history = path.join(dir, 'history');
  fs.writeFileSync(file, '\uFEFF# 文档\r\n\r\n保留🙂\r\n修改这里\r\n结尾\r\n');
  return { file, history, api: createArtifactWorkspace(history) };
}
test('local selection changes only the requested occurrence and retains Unicode and CRLF', t => {
  const { file, api } = fixture(t), initial = api.read(file);
  const start = initial.text.indexOf('修改这里');
  const next = replaceArtifactSelection(initial.text, start, start + 4, '新的内容');
  const saved = api.save({ path: file, expectedHash: initial.hash, text: next });
  assert.equal(saved.text, initial.text.replace('修改这里', '新的内容'));
  assert.equal(fs.readFileSync(file, 'utf8'), next);
  assert.equal(saved.versions[0].text, initial.text);
  assert.throws(() => replaceArtifactSelection('abc', -1, 2, 'x'));
  assert.throws(() => replaceArtifactSelection('abc', 2, 1, 'x'));
  assert.equal(replaceArtifactSelection('same same', 5, 9, 'new'), 'same new');
});
test('history survives restart and restoring retains the replaced version', t => {
  const { file, history, api } = fixture(t), initial = api.read(file);
  const saved = api.save({ path: file, expectedHash: initial.hash, text: 'new' });
  const restarted = createArtifactWorkspace(history);
  const restored = restarted.restore({ path: file, expectedHash: saved.hash, version: initial.hash });
  assert.equal(restored.text, initial.text);
  assert.equal(restored.versions.find(v => v.hash === saved.hash).text, 'new');
});
test('external edits reject both save and restore without changing the newer file', t => {
  const { file, api } = fixture(t), initial = api.read(file);
  const saved = api.save({ path: file, expectedHash: initial.hash, text: 'new' });
  fs.writeFileSync(file, 'external change');
  assert.throws(() => api.save({ path: file, expectedHash: saved.hash, text: 'draft' }), /其他任务/);
  assert.throws(() => api.restore({ path: file, expectedHash: saved.hash, version: initial.hash }), /其他任务/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'external change');
});
test('history is bounded; unchanged saves create no duplicate versions', t => {
  const { file, api } = fixture(t); let s = api.read(file);
  for (let i = 0; i < 24; i++) s = api.save({ path: file, expectedHash: s.hash, text: String(i) });
  assert.equal(s.versions.length, 19);
  assert.equal(api.save({ path: file, expectedHash: s.hash, text: s.text }).versions.length, 19);
});
test('unreadable history, binary files, legacy text, and oversized text cannot be overwritten', t => {
  const { file, history, api } = fixture(t), initial = api.read(file);
  api.save({ path: file, expectedHash: initial.hash, text: 'saved' });
  fs.writeFileSync(path.join(history, fs.readdirSync(history).find(n => n.endsWith('.json'))), 'broken');
  assert.throws(() => api.save({ path: file, expectedHash: apiHash('saved'), text: 'lost' }), /数据读取失败/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'saved');
  fs.writeFileSync(file, Buffer.from([0xff, 0xfe, 0])); assert.throws(() => api.read(file));
  fs.writeFileSync(file, 'a'.repeat(1024 * 1024 + 1)); assert.throws(() => api.read(file), /1 MB/);
  const binary = file.replace('.md', '.pdf'); fs.writeFileSync(binary, '%PDF-test');
  assert.throws(() => api.read(binary), /Markdown/);
  assert.equal(Buffer.from(readDocument(binary)).toString(), '%PDF-test');
  assert.throws(() => readDocument(file), /不支持/);
});
function apiHash(text) { return require('node:crypto').createHash('sha256').update(text).digest('hex'); }
test('textarea selections and direct edits preserve CRLF and untouched mixed line endings', () => {
  const original = '# 标题\r\n\r\n改这里🙂\r\n保留\n尾段';
  const normalized = original.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('改这里');
  assert.equal(replaceArtifactSelection(original, artifactSourceOffset(original, start), artifactSourceOffset(original, start + 3), '完成'), original.replace('改这里', '完成'));
  assert.equal(applyArtifactTextareaChange(original, normalized.replace('改这里', '新内容\n第二行')), original.replace('改这里', '新内容\r\n第二行'));
  assert.equal(applyArtifactTextareaChange(original, normalized), original);
  assert.equal(applyArtifactTextareaChange(original, ''), '');
  assert.equal(applyArtifactTextareaChange('', '🙂\n开始'), '🙂\n开始');
});
