'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const { mediaInfo } = require('./media-files.cjs');

/**
 * Sends a local file (a finished video, a recording, a large deliverable) to
 * the account's cloud file library, straight to object storage.
 *
 * Large files go up in parts. Each part is read from disk when it is sent and
 * is the only part held in memory, so a multi-gigabyte video uses the same
 * memory as a small one. Starting the same upload again resumes: the server
 * says which parts it already has and only the rest are sent.
 */
const CONCURRENCY = 3;
const PART_RETRIES = 4;

function createMediaUploader({ call, fetchImpl = (...args) => fetch(...args), sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  async function put(url, body, signal) {
    let lastError;
    for (let attempt = 0; attempt < PART_RETRIES; attempt += 1) {
      if (signal?.aborted) throw Error('上传已取消');
      try {
        const response = await fetchImpl(url, { method: 'PUT', body, signal });
        if (response.ok) return;
        // A refused signature will not get better by retrying; a busy server may.
        if (response.status < 500 && response.status !== 429 && response.status !== 408) {
          throw Object.assign(Error(`云存储拒绝了上传（HTTP ${response.status}）。请重试；若反复出现，请检查服务端的 R2 配置。`), { fatal: true });
        }
        lastError = Error(`云存储暂时不可用（HTTP ${response.status}）`);
      } catch (error) {
        if (error.fatal || signal?.aborted) throw error;
        lastError = error;
      }
      await sleep(500 * 2 ** attempt);
    }
    throw Error(`网络不稳定，上传中断：${lastError?.message || '未知错误'}。已上传的部分会保留，再次上传将从断点继续。`);
  }

  async function readSlice(file, start, length) {
    const handle = await fs.promises.open(file, 'r');
    try {
      const buffer = Buffer.allocUnsafe(length);
      let offset = 0;
      while (offset < length) {
        const { bytesRead } = await handle.read(buffer, offset, length - offset, start + offset);
        if (!bytesRead) throw Error('文件在上传过程中被修改或缩短，请重新上传。');
        offset += bytesRead;
      }
      return buffer;
    } finally { await handle.close(); }
  }

  return {
    async upload({ filePath, name, mime, source, onProgress = () => {}, signal } = {}) {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) throw Error('文件为空或不存在，无法上传。');
      const info = mediaInfo(filePath);
      // The same file (path, size, modified time) always maps to the same upload, so it can resume.
      const requestKey = 'up-' + crypto.createHash('sha256').update(`${filePath}|${stat.size}|${Math.floor(stat.mtimeMs)}`).digest('hex').slice(0, 40);
      const begun = await call('begin', { name: name || require('node:path').basename(filePath), mime: mime || info?.mime || 'application/octet-stream', size: stat.size, requestKey, source });
      if (begun.status === 'ready') { onProgress({ sent: stat.size, total: stat.size }); return begun.publicRow; }
      let sent = 0;
      const report = () => onProgress({ sent: Math.min(sent, stat.size), total: stat.size });
      if (begun.mode === 'single') {
        await put(begun.url, await readSlice(filePath, 0, stat.size), signal);
        sent = stat.size; report();
      } else {
        const have = new Set((begun.completedParts ?? []).map(p => p.partNumber));
        for (const p of begun.completedParts ?? []) sent += p.size;
        report();
        const todo = []; for (let n = 1; n <= begun.partCount; n += 1) if (!have.has(n)) todo.push(n);
        let next = 0, failure = null;
        const worker = async () => {
          while (!failure && next < todo.length) {
            const batch = todo.slice(next, next + 4); next += batch.length;
            const urls = new Map((await call('partUrls', { id: begun.id, partNumbers: batch })).parts.map(p => [p.partNumber, p.url]));
            for (const n of batch) {
              if (failure) return;
              const start = (n - 1) * begun.partSize, length = Math.min(begun.partSize, stat.size - start);
              try { await put(urls.get(n), await readSlice(filePath, start, length), signal); sent += length; report(); }
              catch (error) { failure = error; return; }
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
        if (failure) throw failure;
      }
      return call('complete', { id: begun.id });
    },
  };
}

module.exports = { createMediaUploader };
