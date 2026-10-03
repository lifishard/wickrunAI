'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('the packaged app carries the license, the notice and every third-party license text', () => {
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSES.txt']) {
    assert.ok(pkg.build.files.includes(file), `${file} ships with the app`);
    assert.ok(fs.existsSync(path.join(root, file)), `${file} exists`);
  }
  assert.equal(pkg.license, 'SEE LICENSE IN LICENSE');
  // Also next to the executable, where people can open them without unpacking app.asar.
  const beside = pkg.build.extraFiles.map(f => typeof f === 'string' ? f : f.to);
  for (const name of ['LICENSE.txt', 'NOTICE.txt', 'THIRD_PARTY_LICENSES.txt']) assert.ok(beside.includes(name), `${name} is in the install folder`);
  assert.doesNotMatch(pkg.build.copyright, /Apache/);
  // Regenerate after any dependency change: npm run licenses
  execFileSync(process.execPath, [path.join(root, 'scripts', 'third-party-notices.mjs'), '--check'], { cwd: root, stdio: 'pipe' });
});

test('third-party notices list production dependencies with their texts, not dev tools', async () => {
  const { collectPackages, render } = await import('../scripts/third-party-notices.mjs');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const packages = collectPackages(lock, root);
  const names = new Set(packages.map(p => p.name));
  for (const dep of Object.keys(pkg.dependencies)) assert.ok(names.has(dep), `${dep} is listed`);
  for (const dev of ['electron-builder', 'typescript', 'vite']) assert.ok(!names.has(dev), `${dev} is a build tool, not shipped`);
  const text = render(packages);
  assert.match(text, /pdfjs-dist [\d.]+ — Apache-2\.0/);
  assert.match(text, /DOMPurify: Apache-2\.0; JSZip: MIT/);
  assert.ok(packages.filter(p => !p.platform && p.texts.length).length > packages.length * 0.9, 'nearly every package ships its own license file');
});

test('the Windows installer asks for agreement to the current license, readable in Chinese', () => {
  assert.equal(pkg.build.nsis.oneClick, false, 'the assisted installer shows the license page');
  assert.equal(pkg.build.nsis.license, 'build/license.txt');
  const bytes = fs.readFileSync(path.join(root, pkg.build.nsis.license));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 with BOM, or NSIS shows the Chinese text garbled');
  const text = bytes.toString('utf8');
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').replace(/\r\n?/g, '\n').trimEnd();
  assert.ok(text.replace(/\r\n/g, '\n').includes(license), 'the installer shows LICENSE itself');
  assert.doesNotMatch(text, /\[(Company legal name|公司全称|Registered address|注册地址)\]/, 'no draft placeholders in what users accept');
});

test('the installer closes only the dedicated browser profile before replacing files', () => {
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh');
  const nsh = fs.readFileSync(path.join(root, pkg.build.nsis.include), 'utf8');
  for (const hook of ['customInit', 'customUnInit']) assert.match(nsh, new RegExp(`!macro ${hook}\\b[\\s\\S]*?wickrunCloseDedicatedBrowser[\\s\\S]*?!macroend`));
  const command = nsh.split('\n').find(line => line.includes('nsExec::Exec'));
  assert.ok(command, 'the cleanup runs hidden through nsExec');
  // NSIS expands single $ itself: every PowerShell variable must be written as $$.
  const powershell = command.slice(command.indexOf('-Command'));
  assert.doesNotMatch(powershell.replace(/\$\$/g, ''), /\$/);
  // Only browsers started with wickrunAI's own profile; never the user's own browser.
  assert.match(powershell, /user-data-dir=/);
  assert.match(powershell, /'anyai\\chrome-profile\*'/);
  assert.match(powershell, /\$\$_\.ProcessId -ne \$\$PID/);
  assert.doesNotMatch(powershell, /\\anyai\\chrome-profile/i, 'the pattern is split so the command never matches itself');
  assert.doesNotMatch(powershell, /Name\s*-eq|IM chrome|taskkill/i, 'no closing of browsers by program name');
  try {
    execFileSync('makensis', ['-VERSION'], { stdio: 'ignore' });
  } catch { return; } // the NSIS compiler is optional on developer machines
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'wickrun-nsis-'));
  try {
    fs.writeFileSync(path.join(dir, 't.nsi'), `Unicode true\n!include "${path.join(root, pkg.build.nsis.include)}"\nOutFile "t.exe"\nRequestExecutionLevel user\nFunction .onInit\n!insertmacro customInit\nFunctionEnd\nSection\nSectionEnd\n`);
    execFileSync('makensis', ['-V1', 't.nsi'], { cwd: dir, stdio: 'pipe' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the app never keeps the install folder as its working directory', () => {
  const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');
  assert.match(main.slice(0, 2000), /app\.isPackaged\) try \{ process\.chdir\(app\.getPath\('userData'\)\)/);
});
