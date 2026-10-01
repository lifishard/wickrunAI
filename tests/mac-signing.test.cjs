const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { signingSettings, signedMacConfig } = require('../scripts/mac-signing.cjs');

const credentials = {
  MACOS_SIGNING_ENABLED: 'true', MACOS_SIGNING_IDENTITY: 'Example Name (ABCDE12345)',
  APPLE_TEAM_ID: 'ABCDE12345', CSC_LINK: 'private-certificate-value', CSC_KEY_PASSWORD: 'private-password-value',
  APPLE_API_KEY: '/private/AuthKey.p8', APPLE_API_KEY_ID: 'ABC1234567',
  APPLE_API_ISSUER: '00000000-1111-2222-3333-444444444444',
};

test('signed macOS configuration fails closed and never leaks secret values', () => {
  for (const name of Object.keys(credentials)) {
    const env = { ...credentials, [name]: '' };
    assert.throws(() => signingSettings(env, { checkKeyFile: false }), error => {
      assert.match(error.message, new RegExp(name));
      assert.ok(!error.message.includes(credentials.CSC_LINK));
      assert.ok(!error.message.includes(credentials.CSC_KEY_PASSWORD));
      return true;
    });
  }
  assert.throws(() => signingSettings({ ...credentials, APPLE_TEAM_ID: 'XXXXXXXXXX' }, { checkKeyFile: false }), /certificate name/);
  assert.throws(() => signingSettings({ ...credentials, MACOS_SIGNING_IDENTITY: 'Developer ID Application: Example Name (ABCDE12345)' }, { checkKeyFile: false }), /prefix/);
  assert.throws(() => signingSettings({ ...credentials, APPLE_ID: 'other@example.invalid' }, { checkKeyFile: false }), /alternate/);
  assert.throws(() => signingSettings({ ...credentials, APPLE_API_ISSUER: 'individual-key' }, { checkKeyFile: false }), /issuer UUID/);
});

test('private key must exist and signed overlay preserves the unsigned baseline', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-signing-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...credentials, APPLE_API_KEY: path.join(dir, 'AuthKey.p8') };
  assert.throws(() => signingSettings(env), /readable private key/);
  fs.writeFileSync(env.APPLE_API_KEY, 'test-only');
  const baseline = require('../package.json').build;
  const config = signedMacConfig(baseline, env);
  assert.equal(baseline.mac.identity, null);
  assert.equal(baseline.mac.notarize, false);
  assert.equal(config.forceCodeSigning, true);
  assert.equal(config.mac.notarize, true);
  assert.equal(config.mac.hardenedRuntime, true);
  assert.equal(config.mac.type, 'distribution');
  assert.deepEqual(config.mac.target, baseline.mac.target);
  assert.deepEqual(config.win, baseline.win);
  assert.deepEqual(config.linux, baseline.linux);
});

test('release verifier rejects ad hoc, wrong-team, non-hardened and untimestamped apps', async () => {
  const { verifySignatureDetails, expectedMacPackages } = await import('../scripts/verify-mac-release.mjs');
  const settings = { teamId: 'ABCDE12345', appId: 'dev.anyai.desktop' };
  const good = 'Identifier=dev.anyai.desktop\nCodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=12+7\nAuthority=Developer ID Application: Example (ABCDE12345)\nTimestamp=Sep 27, 2026 at 12:00:00\nTeamIdentifier=ABCDE12345\n';
  verifySignatureDetails(good, settings);
  for (const line of ['Identifier=dev.anyai.desktop', 'TeamIdentifier=ABCDE12345', 'Authority=Developer ID Application: Example (ABCDE12345)', 'Timestamp=Sep 27, 2026 at 12:00:00', 'flags=0x10000(runtime)']) {
    assert.throws(() => verifySignatureDetails(good.replace(line, ''), settings));
  }
  assert.deepEqual(expectedMacPackages('2.20.9').map(item => item.name), [
    'wickrunAI-2.20.9-mac-arm64.dmg', 'wickrunAI-2.20.9-mac-arm64.zip',
    'wickrunAI-2.20.9-mac-x64.dmg', 'wickrunAI-2.20.9-mac-x64.zip',
  ]);
});
