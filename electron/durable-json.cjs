'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const WINDOWS_RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 100];
const WINDOWS_RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const defaultSleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** One main-process writer. Never treat an existing unreadable file as new data. */
function createDurableJson(file, {
  initial,
  validate = () => {},
  io = fs,
  platform = process.platform,
  sleep = defaultSleep,
} = {}) {
  let cache;
  let loadedHash;
  const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
  // Load the owned in-memory value without cloning. Public reads still return
  // a clone, while writers can validate the current disk hash without copying
  // a large document before every update.
  function load() {
    if (cache !== undefined) return cache;
    let raw;
    try { raw = io.readFileSync(file, 'utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A missing primary with a backup indicates interrupted recovery, not first use.
      if (io.existsSync(file + '.prev')) throw new Error('主数据文件缺失，已有备份；请恢复备份后重试。');
      const value = initial(); validate(value); return value;
    }
    let value;
    try { value = JSON.parse(raw); validate(value); }
    catch (error) { throw new Error(`数据读取失败，原文件已保留：${file} (${error.message})`); }
    cache = value;
    loadedHash = hash(raw);
    return cache;
  }
  function read() {
    return structuredClone(load());
  }
  function rejectChangedPrimary() {
    let current;
    try { current = hash(io.readFileSync(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && loadedHash === undefined) return;
      cache = undefined; loadedHash = undefined;
      throw error;
    }
    if (current === loadedHash) return;
    cache = undefined; loadedHash = undefined;
    throw new Error('数据文件被其他程序改动，已停止覆盖；请重新读取后合并修改。');
  }
  function renameWithRetry(from, to, retryState) {
    for (;;) {
      try { return io.renameSync(from, to); }
      catch (error) {
        const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[retryState.nextDelay];
        if (platform !== 'win32' || !WINDOWS_RENAME_RETRY_CODES.has(error.code) || delay === undefined) throw error;
        retryState.nextDelay += 1;
        sleep(delay);
        rejectChangedPrimary();
      }
    }
  }
  function write(value) {
    validate(value);
    const text = JSON.stringify(value);
    // Validate the current disk data before replacing it, including on a first write.
    load();
    if (cache !== undefined) {
      let current;
      try { current = hash(io.readFileSync(file, 'utf8')); } catch (error) { cache = undefined; loadedHash = undefined; throw error; }
      if (current !== loadedHash) { cache = undefined; loadedHash = undefined; throw new Error('数据文件被其他程序改动，已停止覆盖；请重新读取后合并修改。'); }
    }
    io.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + crypto.randomUUID() + '.tmp';
    const retryState = { nextDelay: 0 };
    let fd;
    try {
      fd = io.openSync(tmp, 'wx', 0o600);
      io.writeFileSync(fd, text, 'utf8'); io.fsyncSync(fd); io.closeSync(fd); fd = undefined;
      if (io.existsSync(file)) {
        const prevTmp=tmp+'.prev';
        io.copyFileSync(file,prevTmp);
        const backupFd=io.openSync(prevTmp,'r+');
        try{io.fsyncSync(backupFd);}finally{io.closeSync(backupFd);}
        renameWithRetry(prevTmp,file+'.prev',retryState);
      }
      // Backup preparation can itself be retried, so close that window before
      // replacing the primary even when the first primary rename succeeds.
      rejectChangedPrimary();
      renameWithRetry(tmp, file,retryState);
      cache = JSON.parse(text);
      loadedHash = hash(text);
    } finally {
      if (fd !== undefined) io.closeSync(fd);
      try { io.unlinkSync(tmp); } catch { /* no unfinished temp */ }
      try { io.unlinkSync(tmp + '.prev'); } catch { /* no unfinished backup temp */ }
    }
    return structuredClone(cache);
  }
  return { read, write, update(fn) { const value = read(); fn(value); return write(value); },
    currentHash() { return loadedHash; },
    invalidate() { cache = undefined; loadedHash = undefined; }, file };
}
module.exports = { createDurableJson };
