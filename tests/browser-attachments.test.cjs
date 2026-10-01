const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loader } = require('./load-ts.cjs');
const load = loader({ '../lib/i18n': { tr: text => text } });
const { readBrowserAttachments } = load(path.join(__dirname, '../src/web/attachments.ts'));
const { ATTACHMENT_LIMITS } = load(path.join(__dirname, '../src/lib/attachment-limits.ts'));

test('browser text attachments retain content and share the desktop limits', async () => {
  const files = [new File(['hello\nworld'], 'note.md', { type: 'text/markdown' }), new File(['const answer = 42;'], 'answer.ts')];
  const result = await readBrowserAttachments(files, 'file');
  assert.equal(result.length, 2);
  assert.equal(result[0].text, 'hello\nworld');
  assert.equal(result[0].kind, 'text');
  assert.equal(result[1].mime, 'text/plain');
  assert.notEqual(result[0].id, result[1].id);
  assert.equal(result[0].path, undefined);
});

test('selection size and unsupported formats fail before reading any content', async () => {
  let reads = 0;
  const file = (name, size) => ({ name, size, type: '', text: async () => { reads++; return 'unexpected'; } });
  await assert.rejects(readBrowserAttachments([file('large.txt', ATTACHMENT_LIMITS.textBytes + 1)], 'file'), /25MB/);
  await assert.rejects(readBrowserAttachments(Array.from({ length: 5 }, () => file('part.txt', ATTACHMENT_LIMITS.textBytes)), 'file'), /100MB/);
  await assert.rejects(readBrowserAttachments([file('ok.txt', 1), file('program.exe', 1)], 'file'), /支持的文本/);
  assert.equal(reads, 0);
});

test('supported mobile image without MIME metadata uses its extension, but mismatched MIME is rejected', async t => {
  const previous = global.FileReader;
  t.after(() => { global.FileReader = previous; });
  let reads = 0;
  global.FileReader = class {
    readAsDataURL() { reads++; this.result = 'data:image/png;base64,aGVsbG8='; this.onload(); }
  };
  const [image] = await readBrowserAttachments([new File(['hello'], 'photo.PNG')], 'image');
  assert.equal(image.mime, 'image/png');
  assert.equal(image.kind, 'image');
  assert.equal(image.dataUrl, 'data:image/png;base64,aGVsbG8=');
  await assert.rejects(readBrowserAttachments([new File(['hello'], 'photo.png', { type: 'image/svg+xml' })], 'image'), /PNG/);
  assert.equal(reads, 1);
});
