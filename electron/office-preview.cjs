'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { readDocument } = require('./artifact-workspace.cjs');
let pending = Promise.resolve();

async function convert(p) {
  if (path.extname(p).toLowerCase() !== '.docx') throw Error('精确分页目前支持 DOCX。');
  const input = readDocument(p);
  const root = path.resolve(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(root, 'wickrun-word-preview-'));
  const source = path.join(dir, 'document.docx'), output = path.join(dir, 'document.pdf');
  fs.writeFileSync(source, input);
  try {
    const candidates = process.platform === 'win32' ? [path.join(process.env.ProgramFiles || 'C:/Program Files', 'LibreOffice/program/soffice.exe')]
      : process.platform === 'darwin' ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice'] : ['/usr/bin/libreoffice', '/usr/bin/soffice'];
    const libre = candidates.find(p => fs.existsSync(p));
    if (libre) {
      const { pathToFileURL } = require('node:url');
      await execFile(libre, [`-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, source], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    } else if (process.platform === 'win32') {
      // Copy the bundled helper out of asar so PowerShell can read it when packaged.
      const script = path.join(dir, 'preview.ps1');
      fs.copyFileSync(path.join(__dirname, 'word-preview.ps1'), script);
      await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', script, '-SourcePath', source, '-DestinationPath', output], { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 });
    } else throw Error('精确分页需要本机安装 LibreOffice；仍可使用内容预览。');
    if (!fs.existsSync(output)) throw Error('排版程序没有生成预览。请检查本机 Word 或 LibreOffice。');
    return readDocument(output);
  } catch (error) {
    throw Error(`无法生成精确分页：${error.message}。可继续使用内容预览。`);
  } finally {
    if (path.dirname(dir) === root && path.basename(dir).startsWith('wickrun-word-preview-')) fs.rmSync(dir, { recursive: true, force: true });
  }
}
function previewWord(p) {
  const result = pending.then(() => convert(p));
  pending = result.catch(() => {});
  return result;
}
module.exports = { previewWord };
