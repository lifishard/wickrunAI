const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/mirror-release.mjs');

function world({ mirror = null, latest = 'v4.1.1', draft = false } = {}) {
  const files = { 'wickrunAI-4.1.1-win-x64-setup.exe': 'setup', 'latest.yml': 'version: 4.1.1', 'wickrunAI-4.1.1-android-preview.apk': 'apk' };
  const source = { isDraft: draft, isPrerelease: false, name: 'wickrunAI 4.1.1', body: '# notes', assets: Object.entries(files).map(([name, data]) => ({ name, size: data.length })) };
  const calls = [];
  const run = (who, args) => {
    calls.push([who, ...args]);
    if (who === 'source' && args[0] === 'release' && args[1] === 'view') return JSON.stringify(source);
    if (who === 'source' && args[0] === 'api') return latest + '\n';
    if (who === 'mirror' && args[1] === 'view') { if (!mirror) throw new Error('release not found'); return JSON.stringify(mirror); }
    if (who === 'mirror' && args[1] === 'create') { mirror = { isDraft: true, assets: [] }; return ''; }
    if (who === 'mirror' && args[1] === 'upload') { for (const file of args.slice(3)) mirror.assets.push({ name: path.basename(file), size: fs.statSync(file).size }); return ''; }
    if (who === 'mirror' && args[1] === 'edit') { mirror.isDraft = false; return ''; }
    throw new Error('unexpected ' + args.join(' '));
  };
  const download = (_tag, dir) => { for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data); };
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-test-'));
  return { run, download, tmp, calls, get mirror() { return mirror; } };
}

test('a published release is copied to the mirror, published and marked latest', async () => {
  const { mirrorRelease } = await load();
  const w = world();
  const result = mirrorRelease({ tag: 'v4.1.1', run: w.run, download: w.download, tmp: w.tmp, log: () => {} });
  assert.equal(result.copied.length, 3);
  assert.equal(result.latest, true);
  assert.equal(w.mirror.isDraft, false);
  assert.ok(w.calls.some(c => c[0] === 'mirror' && c[2] === 'edit' && c.includes('--latest')));
  // Each account only talks to its own repository: uploads go to the mirror, reads come from the source.
  assert.ok(w.calls.filter(c => c[2] === 'upload').every(c => c[0] === 'mirror'));
});

test('the mirror is append-only: a differing published asset is never replaced', async () => {
  const { mirrorRelease } = await load();
  const w = world({ mirror: { isDraft: false, assets: [{ name: 'latest.yml', size: 999 }] } });
  assert.throws(() => mirrorRelease({ tag: 'v4.1.1', run: w.run, download: w.download, tmp: w.tmp, log: () => {} }), /refusing to replace/);
  assert.ok(!w.calls.some(c => c[2] === 'upload'));
});

test('a later Android preview is appended without touching the desktop files', async () => {
  const { mirrorRelease } = await load();
  const w = world({ mirror: { isDraft: false, assets: [{ name: 'wickrunAI-4.1.1-win-x64-setup.exe', size: 5 }, { name: 'latest.yml', size: 14 }] }, latest: 'v4.1.2' });
  const result = mirrorRelease({ tag: 'v4.1.1', run: w.run, download: w.download, tmp: w.tmp, log: () => {} });
  assert.deepEqual(result.copied, ['wickrunAI-4.1.1-android-preview.apk']);
  assert.equal(result.latest, false, 'an older tag does not take the latest mark');
});

test('drafts and malformed tags are not mirrored', async () => {
  const { mirrorRelease } = await load();
  assert.throws(() => mirrorRelease({ tag: 'latest', run: () => '', download: () => {} }), /Not a release tag/);
  const w = world({ draft: true });
  assert.throws(() => mirrorRelease({ tag: 'v4.1.1', run: w.run, download: w.download, tmp: w.tmp, log: () => {} }), /not a published release/);
});
