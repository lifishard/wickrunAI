'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parentPort, workerData } = require('node:worker_threads');
const { renameWithRetry } = require('./fs-retry.cjs');

const file = workerData.file;
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
let state;
let loadedHash;
let failed;
// Size and modification time of the file as this worker last read or wrote it.
// Re-reading and hashing a 100 MB store before every save only to learn that
// nothing else touched it was most of the cost of a save.
let loadedStat;
const statOf = () => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}`; } catch { return undefined; } };

function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.kv || !value.secrets || Array.isArray(value.kv) || Array.isArray(value.secrets) ||
      typeof value.kv !== 'object' || typeof value.secrets !== 'object') {
    throw new Error('存储结构不兼容');
  }
}

function load() {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if(workerData.expectedHash)throw Error('已读取的数据文件被其他程序移除，已停止写入。');
    if (fs.existsSync(file + '.prev')) throw new Error('主数据文件缺失，已有备份；请恢复备份后重试。');
    state = { kv: {}, secrets: {} };
    loadedHash = undefined;
    return;
  }
  try {
    state = JSON.parse(raw);
    validate(state);
  } catch (error) {
    throw new Error(`数据读取失败，原文件已保留：${file} (${error.message})`);
  }
  loadedHash = hash(raw);
  loadedStat = statOf();
  const expected = workerData.expectedHash;
  if (expected!==undefined && loadedHash!==expected) {
    const error = new Error('数据文件在写入线程启动前被其他程序改动，已停止覆盖；请重新读取后合并修改。');
    error.code = 'EXTERNAL_CHANGE';
    throw error;
  }
}

function checkExternalChange() {
  if (loadedHash === undefined) {
    try {
      fs.readFileSync(file, 'utf8');
      const error = new Error('数据文件被其他程序创建，已停止覆盖；请重新读取后合并修改。');
      error.code = 'EXTERNAL_CHANGE';
      throw error;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (fs.existsSync(file + '.prev')) {
      const error = new Error('主数据文件缺失，已有备份；请恢复备份后重试。');
      error.code = 'EXTERNAL_CHANGE';
      throw error;
    }
    return;
  }
  if (loadedStat !== undefined && statOf() === loadedStat) return;
  const current = hash(fs.readFileSync(file, 'utf8'));
  if (current === loadedHash) { loadedStat = statOf(); return; }
  {
    const error = new Error('数据文件被其他程序改动，已停止覆盖；请重新读取后合并修改。');
    error.code = 'EXTERNAL_CHANGE';
    throw error;
  }
}

function atomicWrite(text) {
  checkExternalChange();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, text, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    // The committed file becomes the backup by rename instead of a full copy:
    // copying and syncing a 100 MB file on every save made each save take
    // seconds. If the process stops between the two renames, startup restores
    // the main file from .prev (see store.cjs).
    let rotated = false;
    if (fs.existsSync(file)) { renameWithRetry(file, file + '.prev'); rotated = true; }
    try { renameWithRetry(tmp, file); }
    catch (error) {
      if (rotated && !fs.existsSync(file)) { try { renameWithRetry(file + '.prev', file); } catch { /* .prev is restored at startup */ } }
      throw error;
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch { /* no unfinished temporary file */ }
  }
  loadedHash = hash(text);
  loadedStat = statOf();
}

function mutate(message) {
  if (failed) throw failed;
  const bucket = message.scope === 'secrets' ? state.secrets : message.scope === 'kv' ? state.kv : null;
  if (!bucket || typeof message.key !== 'string' || !message.key) throw new Error('存储键无效');
  const had = Object.prototype.hasOwnProperty.call(bucket, message.key);
  const previous = bucket[message.key];
  // Saving the same value again (autosave, then save-before-quit) needs no write.
  if (message.delete ? !had : had && (typeof message.value === 'string' ? previous === message.value : JSON.stringify(previous) === JSON.stringify(message.value))) return;
  try {
    if (message.delete) delete bucket[message.key];
    else bucket[message.key] = message.value;
    validate(state);
    atomicWrite(JSON.stringify(state));
  } catch (error) {
    if (had) bucket[message.key] = previous;
    else delete bucket[message.key];
    throw error;
  }
}

function wireError(error) {
  return { message: error instanceof Error ? error.message : String(error), code: error?.code };
}

try {
  load();
  parentPort.postMessage({ type: 'ready' });
} catch (error) {
  failed = error;
  parentPort.postMessage({ type: 'ready-error', error: wireError(error) });
}

parentPort.on('message', (message) => {
  if (message?.type !== 'mutate') return;
  if (failed) {
    parentPort.postMessage({ type: 'error', id: message.id, error: wireError(failed) });
    return;
  }
  try {
    mutate(message);
    parentPort.postMessage({ type: 'ok', id: message.id });
  } catch (error) {
    // Only a change made by another program stops all further writes: writing
    // would overwrite it. A failed write (disk full, file held by a scanner)
    // rejects this mutation, leaves memory equal to the file, and the next
    // mutation tries again; it must not keep the app unable to save until restart.
    if (error?.code === 'EXTERNAL_CHANGE') failed = error;
    parentPort.postMessage({ type: 'error', id: message.id, error: wireError(error) });
  }
});
