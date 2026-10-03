'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { mediaInfo } = require('./media-files.cjs');

const CHUNK_SIZE = 4 * 1024 ** 2;
const CONCURRENCY = 3;
const RETRIES = 4;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const abortError = () => Object.assign(new Error('上传已取消'), { name: 'AbortError' });
function retryAfterMs(value, now) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  if (/^\d+$/.test(text)) { const ms = Number(text) * 1000; return Number.isFinite(ms) ? ms : null; }
  const weekday = '(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)', month = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
  const httpDate = new RegExp(`^(?:${weekday}, \\d{2} ${month} \\d{4} \\d{2}:\\d{2}:\\d{2} GMT|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \\d{2}-${month}-\\d{2} \\d{2}:\\d{2}:\\d{2} GMT|${weekday} ${month} [ \\d]\\d \\d{2}:\\d{2}:\\d{2} \\d{4})$`, 'i');
  if (!httpDate.test(text)) return null;
  // HTTP's obsolete asctime form also denotes GMT, despite lacking a zone suffix.
  const date = Date.parse(/ GMT$/i.test(text) ? text : `${text} GMT`);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(abortError()); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

/** A full byte scan defines the resumable identity; metadata is never its proof. */
function createMediaUploader({ call, fetchImpl = (...args) => fetch(...args), sleep = defaultSleep,
  now = Date.now, retryBudgetMs = 120000, getAccountId, getAccountSignal,
  putTimeoutMs = bytes => Math.max(120000, Math.ceil(bytes / 65536) * 1000) } = {}) {
  return {
    async upload({ filePath, name, mime, source, onProgress = () => {}, signal: callerSignal } = {}) {
      const controller = new AbortController(), signal = controller.signal;
      const cancel = () => controller.abort();
      callerSignal?.addEventListener('abort', cancel, { once: true });
      if (callerSignal?.aborted) cancel();
      const accountId = getAccountId?.();
      const accountSignal = getAccountSignal?.();
      accountSignal?.addEventListener('abort', cancel, { once: true });
      if (accountSignal?.aborted) cancel();
      let handle, cooldown = 0, waitBudget = retryBudgetMs, sent = 0, size = 0;
      const check = () => {
        if (signal.aborted) throw abortError();
        if (getAccountId && getAccountId() !== accountId) throw Error('云账号已切换，请重新上传。');
      };
      const progress = phase => { check(); onProgress({ sent: Math.min(sent, size), total: size, phase }); };
      const wait = async ms => {
        check(); let onAbort;
        try {
          await Promise.race([sleep(ms, signal), new Promise((_, reject) => {
            onAbort = () => reject(abortError()); signal.addEventListener('abort', onAbort, { once: true });
            if (signal.aborted) onAbort();
          })]);
        } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
        check();
      };
      const pause = async () => {
        let target;
        do {
          target = cooldown;
          const ms = Math.max(0, target - now());
          if (ms) await wait(ms);
          check();
        } while (cooldown > target);
      };
      const schedule = (error, attempt) => {
        const current = now(), delay = error.status === 429 ? retryAfterMs(error.retryAfter, current) : null;
        const target = Math.max(cooldown, current + (delay ?? 500 * 2 ** attempt));
        const extra = target - Math.max(current, cooldown);
        if (extra > waitBudget) throw Object.assign(Error('云存储要求等待较久，上传已暂停。再次上传将从断点继续。'), { status: error.status, retryAfter: error.retryAfter });
        waitBudget -= extra; cooldown = target;
      };
      const transient = error => error?.status === 429 || error?.status === 408 || error?.status >= 500
        || error?.name === 'TypeError' || error?.name === 'TimeoutError';
      const send = async (signed, body) => {
        check();
        const attempt = new AbortController(), cancelAttempt = () => attempt.abort();
        signal.addEventListener('abort', cancelAttempt, { once: true });
        const timer = setTimeout(() => attempt.abort(new DOMException('云存储上传超时', 'TimeoutError')), putTimeoutMs(body.length));
        timer.unref?.();
        try {
          return await fetchImpl(signed.url, { method: 'PUT', body, signal: attempt.signal, headers: signed.headers });
        } finally { clearTimeout(timer); signal.removeEventListener('abort', cancelAttempt); }
      };
      const api = async (operation, input) => {
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          await pause();
          try {
            const result = await call(operation, input, { signal, accountId });
            check(); return result;
          } catch (error) {
            check();
            if (error?.name === 'AbortError' || !transient(error) || attempt === RETRIES - 1) throw error;
            schedule(error, attempt);
          }
        }
      };
      const put = async (signed, body, renew) => {
        let renewed = false, lastError;
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          await pause();
          try {
            const response = await send(signed, body);
            check();
            if (response.ok) return;
            if (response.status === 403 && !renewed && attempt < RETRIES - 1) {
              renewed = true;
              try { signed = await renew(); } catch (error) { error.fatal = true; throw error; }
              check(); if (signed.status === 'ready') return;
              continue;
            }
            throw Object.assign(Error(`云存储拒绝了上传（HTTP ${response.status}）。`), {
              status: response.status, retryAfter: response.headers?.get('Retry-After'), fatal: !transient({ status: response.status }),
            });
          } catch (error) {
            check();
            if (error?.name === 'AbortError' || error.fatal) throw error;
            lastError = error;
            if (attempt < RETRIES - 1) schedule(error, attempt);
          }
        }
        throw Object.assign(Error(`网络不稳定，上传中断：${lastError?.message || '未知错误'}。已上传的部分会保留，再次上传将从断点继续。`), { status: lastError?.status, retryAfter: lastError?.retryAfter });
      };
      const read = async (start, length) => {
        check(); const buffer = Buffer.allocUnsafe(length); let offset = 0;
        while (offset < length) {
          check();
          const { bytesRead } = await handle.read(buffer, offset, Math.min(CHUNK_SIZE, length - offset), start + offset);
          check();
          if (!bytesRead) throw Error('文件在上传过程中被修改或缩短，请重新上传。');
          offset += bytesRead;
        }
        return buffer;
      };
      const changed = () => Error('文件在上传过程中被修改，请重新上传。');
      try {
        check(); handle = await fs.promises.open(filePath, 'r'); check();
        const stat = await handle.stat(); size = stat.size;
        if (!stat.isFile() || size <= 0) throw Error('文件为空或不存在，无法上传。');
        progress('hashing');
        const hashes = [];
        for (let start = 0; start < size; start += CHUNK_SIZE) {
          const chunk = await read(start, Math.min(CHUNK_SIZE, size - start));
          hashes.push(sha(chunk)); sent = start + chunk.length; progress('hashing');
        }
        // This root is a chunk manifest identity, not a standard whole-file SHA256.
        const root = sha(JSON.stringify(['wickrun-media-content-v1', size, CHUNK_SIZE, hashes]));
        const finalName = name || path.basename(filePath), finalMime = mime || mediaInfo(filePath)?.mime || 'application/octet-stream';
        const input = { name: finalName, mime: finalMime, size, requestKey: 'up2-' + sha(JSON.stringify(['library', finalName, finalMime, root])), source };
        const validate = async () => {
          check(); if ((await handle.stat()).size !== size) throw changed();
          const current = await fs.promises.stat(filePath);
          if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== size) throw changed();
          for (let start = 0, n = 0; start < size; start += CHUNK_SIZE, n++) {
            if (sha(await read(start, Math.min(CHUNK_SIZE, size - start))) !== hashes[n]) throw changed();
          }
          check(); if ((await handle.stat()).size !== size) throw changed();
          const final = await fs.promises.stat(filePath);
          if (final.dev !== stat.dev || final.ino !== stat.ino || final.size !== size) throw changed();
        };
        const bodyFor = async (start, length) => {
          // Independently verify fixed chunks, including unaligned part boundaries.
          const body = Buffer.allocUnsafe(length);
          for (let at = Math.floor(start / CHUNK_SIZE) * CHUNK_SIZE; at < start + length; at += CHUNK_SIZE) {
            const chunk = await read(at, Math.min(CHUNK_SIZE, size - at));
            if (sha(chunk) !== hashes[at / CHUNK_SIZE]) throw changed();
            const from = Math.max(start, at), to = Math.min(start + length, at + chunk.length);
            chunk.copy(body, from - start, from - at, to - at);
          }
          return body;
        };
        sent = 0;
        const begun = await api('begin', input);
        if (begun.status === 'ready') { sent = size; progress('finalizing'); await validate(); progress('done'); return begun.publicRow; }
        progress('uploading');
        const renewSingle = async () => {
          const refreshed = await api('begin', input);
          if (refreshed.id !== begun.id || refreshed.status !== 'ready' && (refreshed.mode !== 'single' || !refreshed.url)) throw Object.assign(Error('上传会话已变化，请重新上传。'), { fatal: true });
          return refreshed;
        };
        if (begun.mode === 'single') {
          await put(begun, await bodyFor(0, size), renewSingle); sent = size; progress('uploading');
        } else {
          const have = new Set((begun.completedParts ?? []).map(p => p.partNumber));
          for (const p of begun.completedParts ?? []) sent += p.size;
          progress('uploading');
          const todo = []; for (let n = 1; n <= begun.partCount; n++) if (!have.has(n)) todo.push(n);
          let next = 0, failure;
          const urlsFor = async numbers => new Map((await api('partUrls', { id: begun.id, partNumbers: numbers })).parts.map(p => [p.partNumber, p]));
          const worker = async () => {
            try {
              while (next < todo.length) {
                check(); const batch = todo.slice(next, next + 4); next += batch.length;
                const urls = await urlsFor(batch);
                for (const n of batch) {
                  check(); const start = (n - 1) * begun.partSize, length = Math.min(begun.partSize, size - start);
                  await put(urls.get(n), await bodyFor(start, length), async () => (await urlsFor([n])).get(n));
                  sent += length; progress('uploading');
                }
              }
            } catch (error) { if (!failure) failure = error; controller.abort(); }
          };
          await Promise.allSettled(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
          if (failure) throw failure;
        }
        progress('finalizing'); await validate();
        const result = await api('complete', { id: begun.id });
        if (result.status !== 'ready') throw Error('云端尚未确认上传完成，请重新上传以恢复。');
        sent = size; progress('done'); return result;
      } finally {
        controller.abort(); callerSignal?.removeEventListener('abort', cancel); accountSignal?.removeEventListener('abort', cancel);
        if (handle) await handle.close();
      }
    },
  };
}
module.exports = { createMediaUploader };
