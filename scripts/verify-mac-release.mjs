import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} verification failed: ${result.error?.message || result.stderr || result.stdout}`);
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function verifySignatureDetails(details, { teamId, appId }) {
  const lines = details.split(/\r?\n/);
  if (!lines.includes(`TeamIdentifier=${teamId}`)) throw new Error('Signed application TeamIdentifier does not match APPLE_TEAM_ID');
  if (!lines.includes(`Identifier=${appId}`)) throw new Error('Signed application identifier does not match build.appId');
  if (!lines.some(line => line.startsWith('Authority=Developer ID Application:'))) throw new Error('Application is not signed with a Developer ID Application certificate');
  if (!/flags=.*\bruntime\b/.test(details)) throw new Error('Hardened runtime is absent');
  if (!/^Timestamp=.+$/m.test(details)) throw new Error('Secure signing timestamp is absent');
}

export function expectedMacPackages(version, productName = 'wickrunAI') {
  return ['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(extension => ({
    arch, extension, name: `${productName}-${version}-mac-${arch}.${extension}`,
  })));
}

function onlyApplication(directory) {
  const apps = fs.readdirSync(directory).filter(name => name.endsWith('.app'));
  if (apps.length !== 1) throw new Error('Package must contain exactly one top-level application bundle');
  const app = path.join(directory, apps[0]);
  if (!fs.lstatSync(app).isDirectory()) throw new Error('Packaged application must be a directory, not a symlink');
  return app;
}

function verifyApplication(app, item, settings) {
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  verifySignatureDetails(run('codesign', ['--display', '--verbose=4', app]), settings);
  const executableName = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(app, 'Contents', 'Info.plist')]).trim();
  if (path.basename(executableName) !== executableName) throw new Error('Invalid CFBundleExecutable');
  const architectures = run('lipo', ['-archs', path.join(app, 'Contents', 'MacOS', executableName)]).trim().split(/\s+/);
  const expectedArch = item.arch === 'x64' ? 'x86_64' : 'arm64';
  if (architectures.length !== 1 || architectures[0] !== expectedArch) throw new Error(`Unexpected application architecture in ${item.name}`);
  run('xcrun', ['stapler', 'validate', app]);
  const assessment = run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  if (!assessment.includes('source=Notarized Developer ID')) throw new Error('Gatekeeper did not recognize a notarized Developer ID application');
}

export function verifyMacRelease(directory, metadata, teamId) {
  if (process.platform !== 'darwin') throw new Error('Release signature verification requires macOS');
  if (!/^[A-Z0-9]{10}$/.test(teamId || '')) throw new Error('APPLE_TEAM_ID is required');
  const reportPath = path.join(directory, 'mac-signing-verification.json');
  fs.rmSync(reportPath, { force: true });
  const assets = [];
  for (const item of expectedMacPackages(metadata.version, metadata.build.productName)) {
    const assetPath = path.join(directory, item.name);
    if (!fs.statSync(assetPath).isFile()) throw new Error(`Missing ${item.name}`);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-mac-verify-'));
    let mounted = false;
    try {
      if (item.extension === 'zip') {
        run('ditto', ['-x', '-k', assetPath, temp]);
      } else {
        run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', temp, assetPath]);
        mounted = true;
      }
      verifyApplication(onlyApplication(temp), item, { teamId, appId: metadata.build.appId });
      assets.push({ name: item.name, arch: item.arch, sha256: crypto.createHash('sha256').update(fs.readFileSync(assetPath)).digest('hex') });
      console.log(`Verified signed and notarized application in ${item.name}`);
    } finally {
      // Never recursively remove a mounted disk image if detach fails.
      if (mounted) run('hdiutil', ['detach', temp]);
      if (item.extension === 'dmg') fs.rmdirSync(temp);
      else fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  const report = { version: metadata.version, teamId, appId: metadata.build.appId, verifiedAt: new Date().toISOString(), checks: ['codesign-deep-strict', 'developer-id-team', 'hardened-runtime', 'secure-timestamp', 'architecture', 'stapled-ticket', 'gatekeeper'], assets };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  verifyMacRelease(path.resolve(process.argv[2] || path.join(root, 'release')), metadata, process.env.APPLE_TEAM_ID);
}
