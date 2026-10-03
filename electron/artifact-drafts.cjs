'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const v8 = require('node:v8');

// UI-only local recovery journal. Never writes to the edited source file.
function createArtifactDrafts(directory, io = fs) {
  function location(kind, file) {
    if (!['text', 'office'].includes(kind) || typeof file !== 'string' || !path.isAbsolute(file) || file.length > 32768) throw Error('草稿位置无效。');
    const normalized = path.normalize(file);
    const key = kind + ':' + (process.platform === 'win32' ? normalized.toLowerCase() : normalized);
    return path.join(directory, crypto.createHash('sha256').update(key).digest('hex') + '.draft');
  }
  function read({ kind, path: file }) {
    const target = location(kind, file);
    let bytes;
    try { bytes = io.readFileSync(target); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try {
      if (bytes.length > 80 * 1024 * 1024) throw Error('过大');
      const record = v8.deserialize(bytes);
      if (record.version !== 1 || record.kind !== kind || !record.value || typeof record.value !== 'object') throw Error('格式不兼容');
      return record.value;
    } catch { throw Error('本地草稿无法读取，原记录已保留。请勿关闭仍有未保存编辑的窗口。'); }
  }
  function write({ kind, path: file, value }) {
    const target = location(kind, file);
    if (!value || typeof value !== 'object') throw Error('草稿内容无效。');
    const bytes = v8.serialize({ version: 1, kind, value });
    if (bytes.length > (kind === 'text' ? 2 : 80) * 1024 * 1024) throw Error('草稿过大，请先保存文件。');
    io.mkdirSync(directory, { recursive: true });
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
      fd = io.openSync(temporary, 'wx', 0o600);
      io.writeFileSync(fd, bytes); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      io.renameSync(temporary, target);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      try { io.unlinkSync(temporary); } catch { /* preserve the previous committed draft */ }
    }
    return { ok: true };
  }
  function remove({ kind, path: file }) {
    try { io.unlinkSync(location(kind, file)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return { ok: true };
  }
  return { read, write, remove };
}
module.exports = { createArtifactDrafts };
