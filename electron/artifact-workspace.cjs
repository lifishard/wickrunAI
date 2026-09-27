'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDurableJson } = require('./durable-json.cjs');
const LIMIT = 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/** UI-owned text edits. Model tools never receive this interface. */
function createArtifactWorkspace(directory) {
  function file(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) throw Error('请选择本地文件。');
    if (fs.lstatSync(p).isSymbolicLink()) throw Error('请打开原文件后再修改。');
    const real = fs.realpathSync(p);
    if (!['.md', '.markdown', '.txt'].includes(path.extname(real).toLowerCase())) throw Error('目前仅支持修改 Markdown 和纯文本文件。');
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size > LIMIT) throw Error('仅支持 1 MB 以内的文本文件。');
    const bytes = fs.readFileSync(real);
    if (bytes.length > LIMIT) throw Error('仅支持 1 MB 以内的文本文件。');
    // Fatal decoding prevents silently corrupting legacy encodings or binary data.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes('\0')) throw Error('文件不是可编辑的纯文本。');
    return { path: real, text, hash: hash(bytes), mode: stat.mode };
  }
  function history(p) {
    const key = process.platform === 'win32' ? p.toLowerCase() : p;
    return createDurableJson(path.join(directory, hash(key) + '.json'), {
      initial: () => [],
      validate: entries => {
        if (!Array.isArray(entries) || entries.length > 19 || entries.some(e => typeof e.text !== 'string' || Buffer.byteLength(e.text) > LIMIT || hash(e.text) !== e.hash || !Number.isFinite(e.at))) throw Error('版本记录损坏，已停止修改。');
      },
    });
  }
  function read(p) {
    const current = file(p);
    const versions = history(current.path).read().filter(v => v.hash !== current.hash).reverse();
    return { path: current.path, text: current.text, hash: current.hash, versions };
  }
  function save({ path: p, expectedHash, text }) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > LIMIT || text.includes('\0')) throw Error('内容必须是 1 MB 以内的文本。');
    const current = file(p);
    if (current.hash !== expectedHash) throw Error('文件已被其他任务或程序修改。你的草稿已保留，请重新读取文件后合并。');
    if (text === current.text) return read(p);
    const store = history(current.path);
    const versions = store.read().filter(v => v.hash !== current.hash);
    versions.push({ hash: current.hash, text: current.text, at: Date.now() });
    // Persist the original before touching the user's file, including on a failed save.
    store.write(versions.slice(-19));
    const tmp = current.path + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
      fd = fs.openSync(tmp, 'wx', current.mode);
      fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      if (file(p).hash !== current.hash) throw Error('文件已变化，已停止覆盖。请重新读取后合并。');
      fs.renameSync(tmp, current.path);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(tmp); } catch { /* no unfinished temporary */ }
    }
    return read(current.path);
  }
  function restore({ path: p, expectedHash, version }) {
    const current = file(p);
    const entry = history(current.path).read().find(v => v.hash === version);
    if (!entry) throw Error('找不到这个版本，请重新读取版本列表。');
    return save({ path: current.path, expectedHash, text: entry.text });
  }
  return { read, save, restore };
}

function readDocument(p) {
  const extensions = ['.pdf', '.docx', '.xlsx', '.xlsm', '.png', '.jpg', '.jpeg', '.gif', '.webp'];
  if (typeof p !== 'string' || !extensions.includes(path.extname(p).toLowerCase())) throw Error('不支持此文件格式。');
  const stat = fs.statSync(p);
  if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw Error('文档预览支持 25 MB 以内的文件。');
  return new Uint8Array(fs.readFileSync(p));
}
module.exports = { createArtifactWorkspace, readDocument };
