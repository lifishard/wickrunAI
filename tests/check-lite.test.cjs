const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const checkLite = path.resolve(__dirname, '../scripts/check-lite.mjs');

function runFixture(t, source) {
  const tmpRoot = fs.realpathSync.native(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tmpRoot, 'wickrun check-lite '));
  t.after(() => {
    assert.equal(path.dirname(root), tmpRoot);
    assert.ok(path.basename(root).startsWith('wickrun check-lite '));
    fs.rmSync(root, {recursive: true, force: true});
  });
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.copyFileSync(checkLite, path.join(root, 'scripts/check-lite.mjs'));
  fs.writeFileSync(path.join(root, 'src/fixture.ts'), source);
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-lite.mjs')], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}

test('Record check accepts all top-level keys on one line and ignores nested syntax', t => {
  const result = runFixture(t, `
export type Stage = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta';
const stageMap: Record<Stage, unknown> = {alpha: "text with }, { and commas, inside", "beta" /* key comment */: {nested: [{gamma: 9}]}, 'gamma': [1, {delta: 2}], delta: function () { const pattern = /[},]/; return {epsilon: ',', brace: '}', pattern}; }, epsilon: () => ({zeta: 1}), zeta: 6};
`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /七项低级错误检查通过/);
});

test('Record check reports a genuinely missing top-level key', t => {
  const result = runFixture(t, `
type Stage = 'alpha' | 'beta';
const stageMap: Record<Stage, number | object> = {
  // A nested beta must not satisfy the missing top-level beta.
  alpha: {beta: 1},
};
`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Record<Stage, …> 少了这些键 —— beta/);
});

test('Record check skips objects with top-level spread keys', t => {
  const result = runFixture(t, `
type Stage = 'alpha' | 'beta';
const defaults = {beta: 2};
const stageMap: Record<Stage, number> = {alpha: 1, ...defaults};
`);
  assert.equal(result.status, 0, result.stderr);
});

test('Record check skips objects with computed keys', t => {
  const result = runFixture(t, `
type Stage = 'alpha' | 'beta';
const dynamic = 'beta';
const stageMap: Record<Stage, number> = {alpha: 1, [dynamic]: 2};
`);
  assert.equal(result.status, 0, result.stderr);
});

test('Record check starts at the initializer when the value type contains braces', t => {
  const result = runFixture(t, `
type Stage = 'alpha' | 'beta';
const stageMap: Record<Stage, {nested: number}> = {alpha: {nested: 1}};
`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Record<Stage, …> 少了这些键 —— beta/);
});

test('Record check skips quoted keys that require escape decoding', t => {
  const result = runFixture(t, [
    "type Stage = 'alpha' | 'beta';",
    'const stageMap: Record<Stage, number> = {"\\u0061lpha": 1};',
  ].join('\n'));
  assert.equal(result.status, 0, result.stderr);
});

test('Record check skips template values with interpolation', t => {
  const result = runFixture(t, [
    "type Stage = 'alpha' | 'beta';",
    'const stageMap: Record<Stage, string> = {alpha: `outer ${`nested }, {`}`};',
  ].join('\n'));
  assert.equal(result.status, 0, result.stderr);
});
