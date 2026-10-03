'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { mediaInfo } = require('./media-files.cjs');

const CHUNK_SIZE = 4 * 1024 ** 2;
const CONCURRENCY = 3;
const RETRIES = 4;
const CONTENT_SCHEME = 'wickrun-media-content-v1';
const invalidUpload = () => Object.assign(Error('云端续传信息不一致或尚未支持内容校验，已停止上传。请更新后重试。'), { fatal: true });
function integrity(value, size, root, id, allowFailure = false) {
  if (!value || !value.id || typeof value.id !== 'string' || id !== undefined && value.id !== id || value.mode !== 'multipart'
    || value.size !== size || value.contentScheme !== CONTENT_SCHEME || value.contentRoot !== root
    || !['pending', 'verifying', 'verification_failed', 'ready'].includes(value.status)
    || (value.status === 'ready' ? !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt <= 0 : value.verifiedAt !== undefined)) throw invalidUpload();
  if (value.status === 'verification_failed' && !allowFailure) throw Object.assign(Error(value.code === 'integrity_mismatch'
    ? '云端文件内容校验失败，请重新选择文件上传。' : '云端暂时无法验证文件内容，请稍后重新选择文件以恢复。'), { fatal: true, code: value.code === 'integrity_mismatch' ? 'integrity_mismatch' : 'verification_unavailable' });
  if (value.status === 'ready' && value.publicRow) {
    const row = value.publicRow;
    if (row.id !== value.id || row.size !== size || row.status !== 'ready' || row.contentScheme !== CONTENT_SCHEME || row.contentRoot !== root
      || !Number.isSafeInteger(row.verifiedAt) || row.verifiedAt <= 0) throw invalidUpload();
  }
  return value;
}
async function awaiting(pending, signal) {
  let stop;
  try { return await Promise.race([pending, new Promise((_, reject) => {
    stop = () => reject(signal.reason?.name === 'TimeoutError' ? signal.reason : abortError());
    signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
  })]); } finally { signal.removeEventListener('abort', stop); }
}
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
  now = Date.now, retryBudgetMs = 120000, verificationTimeoutMs = 15 * 60 * 1000, abortTimeoutMs = 5000, getAccountId, getAccountSignal,
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
      let handle, uploadId, cooldown = 0, waitBudget = retryBudgetMs, sent = 0, size = 0;
      const check = () => {
        if (signal.aborted) throw abortError();
        if (getAccountId && getAccountId() !== accountId) throw Error('云账号已切换，请重新上传。');
      };
      const progress = phase => { check(); onProgress({ sent: Math.min(sent, size), total: size, phase }); };
      const wait = async (ms, requestSignal = signal) => {
        check();
        try {
          await awaiting(sleep(ms, requestSignal), requestSignal);
        } catch (error) { if (requestSignal.aborted && requestSignal.reason?.name === 'TimeoutError') throw requestSignal.reason; throw error; }
        check();
      };
      const pause = async (requestSignal = signal) => {
        let target;
        do {
          target = cooldown;
          const ms = Math.max(0, target - now());
          if (ms) await wait(ms, requestSignal);
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
      const api = async (operation, input, requestSignal = signal) => {
        for (let attempt = 0; attempt < RETRIES; attempt++) {
          await pause(requestSignal);
          try {
            if (requestSignal.aborted) throw requestSignal.reason;
            const result = await awaiting(call(operation, input, { signal: requestSignal, accountId }), requestSignal);
            check(); return result;
          } catch (error) {
            check(); if (requestSignal.aborted) throw requestSignal.reason;
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
        // Windows file IDs can exceed Number's exact range; keep identity fields as bigint.
        const stat = await handle.stat({ bigint: true }); size = Number(stat.size);
        if (!stat.isFile() || size <= 0) throw Error('文件为空或不存在，无法上传。');
        if (!Number.isSafeInteger(size)) throw Error('文件过大，无法安全上传。');
        progress('hashing');
        const hashes = [];
        for (let start = 0; start < size; start += CHUNK_SIZE) {
          const chunk = await read(start, Math.min(CHUNK_SIZE, size - start));
          hashes.push(sha(chunk)); sent = start + chunk.length; progress('hashing');
        }
        // This root is a chunk manifest identity, not a standard whole-file SHA256.
        const root = sha(JSON.stringify([CONTENT_SCHEME, size, CHUNK_SIZE, hashes]));
        const finalName = name || path.basename(filePath), finalMime = mime || mediaInfo(filePath)?.mime || 'application/octet-stream';
        const input = { name: finalName, mime: finalMime, size, contentScheme: CONTENT_SCHEME, contentRoot: root, requestKey: 'up2-' + sha(JSON.stringify(['library', finalName, finalMime, root])), source };
        const validate = async () => {
          check(); if ((await handle.stat({ bigint: true })).size !== stat.size) throw changed();
          const current = await fs.promises.stat(filePath, { bigint: true });
          if (current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) throw changed();
          for (let start = 0, n = 0; start < size; start += CHUNK_SIZE, n++) {
            if (sha(await read(start, Math.min(CHUNK_SIZE, size - start))) !== hashes[n]) throw changed();
          }
          check(); if ((await handle.stat({ bigint: true })).size !== stat.size) throw changed();
          const final = await fs.promises.stat(filePath, { bigint: true });
          if (final.dev !== stat.dev || final.ino !== stat.ino || final.size !== stat.size) throw changed();
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
        const begun = integrity(await api('begin', input), size, root, undefined, true);
        uploadId = begun.id;
        integrity(begun, size, root);
        const finish = async first => {
          progress('finalizing');
          const verifying = new AbortController(), cancelVerification = () => verifying.abort();
          signal.addEventListener('abort', cancelVerification, { once: true });
          const deadline = now() + verificationTimeoutMs;
          const timeoutError = () => Object.assign(Error('云端内容校验仍在进行，已停止等待。请稍后重新选择同一文件以继续确认。'), { code: 'verification_timeout', fatal: true });
          const timer = setTimeout(() => verifying.abort(new DOMException('verification timeout', 'TimeoutError')), verificationTimeoutMs);
          try {
            let result = integrity(first, size, root, begun.id);
            while (result.status !== 'ready') {
              if (result.status !== 'verifying') throw invalidUpload();
              if (now() >= deadline) throw timeoutError();
              const delay = Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0 ? Math.max(250, Math.min(result.retryAfterMs, 10000)) : 1000;
              await wait(Math.min(delay, deadline - now()), verifying.signal); check();
              if (now() >= deadline) throw timeoutError();
              result = integrity(await api('complete', { id: begun.id }, verifying.signal), size, root, begun.id);
            }
            sent = size; progress('done'); return result.publicRow ?? result;
          } catch (error) { if (error?.name === 'TimeoutError') throw timeoutError(); throw error; }
          finally { clearTimeout(timer); signal.removeEventListener('abort', cancelVerification); }
        };
        if (begun.status === 'ready' || begun.status === 'verifying') { sent = size; progress('finalizing'); await validate(); return await finish(begun); }
        progress('uploading');
        {
          if (begun.partSize !== 16 * 1024 ** 2 || !Number.isSafeInteger(begun.partCount) || begun.partCount > 10000
            || begun.partCount !== Math.ceil(size / begun.partSize) || !Array.isArray(begun.completedParts ?? [])) throw invalidUpload();
          const have = new Set();
          for (const p of begun.completedParts ?? []) {
            if (!Number.isSafeInteger(p.partNumber) || p.partNumber < 1 || p.partNumber > begun.partCount || have.has(p.partNumber)
              || p.size !== Math.min(begun.partSize, size - (p.partNumber - 1) * begun.partSize)) throw invalidUpload();
            have.add(p.partNumber); sent += p.size;
          }
          progress('uploading');
          const todo = []; for (let n = 1; n <= begun.partCount; n++) if (!have.has(n)) todo.push(n);
          let next = 0, failure;
          const urlsFor = async numbers => {
            const result = await api('partUrls', { id: begun.id, partNumbers: numbers });
            if (!result || result.id !== undefined && result.id !== begun.id || !Array.isArray(result.parts) || result.parts.length !== numbers.length) throw invalidUpload();
            const urls = new Map();
            for (const p of result.parts) {
              if (!numbers.includes(p.partNumber) || urls.has(p.partNumber) || typeof p.url !== 'string' || !p.url) throw invalidUpload();
              urls.set(p.partNumber, p);
            }
            return urls;
          };
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
        return await finish(await api('complete', { id: begun.id }));
      } catch (error) {
        if ((callerSignal?.aborted || ['integrity_mismatch', 'verification_unavailable'].includes(error?.code)) && uploadId && (!getAccountId || getAccountId() === accountId)) {
          const cleanup = new AbortController(), timer = setTimeout(() => cleanup.abort(), abortTimeoutMs);
          try {
            const result = await awaiting(call('abort', { id: uploadId }, { signal: cleanup.signal, accountId }), cleanup.signal);
            if (result?.ok !== true) throw invalidUpload();
            if (result.pendingCleanup) throw Object.assign(Error('上传已取消，云端清理仍待确认，占用空间暂时保留。请等待清理后重新选择文件。'), { name: callerSignal?.aborted ? 'AbortError' : 'Error', code: 'cleanup_pending' });
          } catch (cleanupError) { if (cleanupError?.code === 'cleanup_pending') throw cleanupError; throw Object.assign(Error('本地上传已停止，云端取消状态尚未确认。请稍后检查云文件。'), { name: callerSignal?.aborted ? 'AbortError' : 'Error', code: 'abort_unconfirmed' }); }
          finally { clearTimeout(timer); }
        }
        if (/https?:\/\/|(?:token|signature|authorization|credential|secret)\s*[=:]/i.test(error?.message ?? '')) throw Object.assign(Error('文件传输请求失败，请重新选择文件以恢复。'), { status: error.status, code: error.code });
        throw error;
      } finally {
        controller.abort(); callerSignal?.removeEventListener('abort', cancel); accountSignal?.removeEventListener('abort', cancel);
        if (handle) await handle.close();
      }
    },
  };
}
module.exports = { createMediaUploader };
