/** Content identity shared with the desktop uploader. This root is not a whole-file SHA-256. */
export const MEDIA_CONTENT_CHUNK_BYTES = 4 * 1024 * 1024;
export const MEDIA_CONTENT_SCHEME = 'wickrun-media-content-v1';
export const MEDIA_VERIFICATION_TIMEOUT_MS = 15 * 60 * 1000;
export const MEDIA_UPLOAD_ATTEMPTS = 4;
export const MEDIA_RETRY_WAIT_BUDGET_MS = 120000;
/** Allow slow links at 64 KiB/s while keeping each individual PUT finite and cancellable. */
export const mediaPutTimeout = (bytes: number): number => Math.max(120000, Math.ceil(bytes / 65536) * 1000);

export function mediaAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error && reason.name === 'AbortError' ? reason : new DOMException('上传已取消', 'AbortError');
}

export function checkMediaAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw mediaAbortError(signal);
}

/** Also stop waiting when a platform promise does not itself support AbortSignal. */
export async function mediaAwait<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  let stop = () => {};
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      stop = () => reject(mediaAbortError(signal));
      signal.addEventListener('abort', stop, { once: true });
      if (signal.aborted) stop();
    })]);
  } finally { signal.removeEventListener('abort', stop); }
}

/** Link caller cancellation and a per-request timeout without retaining their listeners. */
export async function mediaTimed<T>(signal: AbortSignal | undefined, timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  checkMediaAbort(signal);
  const control = new AbortController();
  const stop = () => control.abort(mediaAbortError(signal));
  signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(() => control.abort(new DOMException('云文件请求超时，请重试。', 'TimeoutError')), timeoutMs);
  try {
    if (signal?.aborted) stop();
    // Keep a timeout distinguishable from the caller's cancellation for retry classification.
    const pending = run(control.signal);
    let timedOut = () => {};
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        timedOut = () => reject(control.signal.reason);
        control.signal.addEventListener('abort', timedOut, { once: true });
        if (control.signal.aborted) timedOut();
      })]);
    } catch (error) {
      // fetch/IPC may wrap a timeout as AbortError; retain the actual reason selected by this boundary.
      if (control.signal.aborted) throw control.signal.reason;
      throw error;
    } finally { control.signal.removeEventListener('abort', timedOut); }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

async function digestHex(bytes: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function mediaContentIdentity(file: Blob, name: string, mime: string, onHashed: (bytes: number) => void,
  signal?: AbortSignal, checkScope: () => void = () => {}): Promise<{ root: string; requestKey: string }> {
  const check = () => { checkMediaAbort(signal); checkScope(); };
  const hashes: string[] = [];
  check(); onHashed(0);
  for (let offset = 0; offset < file.size; offset += MEDIA_CONTENT_CHUNK_BYTES) {
    check();
    const end = Math.min(file.size, offset + MEDIA_CONTENT_CHUNK_BYTES);
    // One bounded buffer is read and hashed at a time, including multi-gigabyte files.
    const bytes = await mediaAwait(file.slice(offset, end).arrayBuffer(), signal);
    check();
    hashes.push(await mediaAwait(digestHex(bytes), signal));
    check(); onHashed(end);
  }
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const root = await mediaAwait(digestHex(encode([MEDIA_CONTENT_SCHEME, file.size, MEDIA_CONTENT_CHUNK_BYTES, hashes])), signal);
  check();
  const requestKey = 'up2-' + await mediaAwait(digestHex(encode(['library', name, mime, root])), signal);
  check();
  return { root, requestKey };
}

export interface MediaIntegrityState {
  id: string; mode: 'multipart'; size: number; status: 'pending' | 'verifying' | 'verification_failed' | 'ready';
  contentScheme: string; contentRoot: string; verifiedAt?: number; retryAfterMs?: number; code?: string;
  partSize?: number; partCount?: number; completedParts?: { partNumber: number; size: number }[];
}
export const invalidMediaUpload = () => Object.assign(new Error('云端续传信息不一致或尚未支持内容校验，已停止上传。请更新后重试。'), { fatal: true });
/** A ready label or a matching size alone is never proof of the stored bytes. */
export function checkMediaIntegrity<T extends MediaIntegrityState>(value: T, size: number, root: string, id?: string, allowFailure = false): T {
  if (!value || typeof value.id !== 'string' || !value.id || id !== undefined && value.id !== id
    || value.mode !== 'multipart' || value.size !== size || value.contentScheme !== MEDIA_CONTENT_SCHEME || value.contentRoot !== root
    || !['pending', 'verifying', 'verification_failed', 'ready'].includes(value.status)
    || (value.status === 'ready' ? !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt! <= 0 : value.verifiedAt !== undefined)) throw invalidMediaUpload();
  if (value.status === 'verification_failed' && !allowFailure) throw Object.assign(new Error(value.code === 'integrity_mismatch'
    ? '云端文件内容校验失败，请重新选择文件上传。' : '云端暂时无法验证文件内容，请稍后重新选择文件以恢复。'), { fatal: true, code: value.code === 'integrity_mismatch' ? 'integrity_mismatch' : 'verification_unavailable' });
  return value;
}
export function checkMediaParts(value: MediaIntegrityState): void {
  if (value.partSize !== 16 * 1024 * 1024 || !Number.isSafeInteger(value.partCount) || value.partCount! > 10000
    || value.partCount !== Math.ceil(value.size / value.partSize!) || !Array.isArray(value.completedParts ?? [])) throw invalidMediaUpload();
  const seen = new Set<number>();
  for (const part of value.completedParts ?? []) {
    if (!Number.isSafeInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > value.partCount! || seen.has(part.partNumber)
      || part.size !== Math.min(value.partSize!, value.size - (part.partNumber - 1) * value.partSize!)) throw invalidMediaUpload();
    seen.add(part.partNumber);
  }
}
export async function waitMediaVerification<T extends MediaIntegrityState>(first: T, read: (signal: AbortSignal) => Promise<T>,
  size: number, root: string, signal?: AbortSignal): Promise<T> {
  try {
    return await mediaTimed(signal, MEDIA_VERIFICATION_TIMEOUT_MS, async requestSignal => {
      let result = checkMediaIntegrity(first, size, root, first.id);
      while (result.status !== 'ready') {
        if (result.status !== 'verifying') throw invalidMediaUpload();
        const delay = result.retryAfterMs;
        await mediaSleep(typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? Math.max(250, Math.min(delay, 10000)) : 1000, requestSignal);
        result = checkMediaIntegrity(await read(requestSignal), size, root, first.id);
      }
      return result;
    });
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError') throw Object.assign(new Error('云端内容校验仍在进行，已停止等待。请稍后重新选择同一文件以继续确认。'), { code: 'verification_timeout', fatal: true });
    throw error;
  }
}

/** Avoid displaying signed links, tokens or arbitrary upstream exception bodies. */
export function safeMediaFailure(error: unknown): Error {
  const source = error as MediaFailure;
  const message = error instanceof Error ? error.message : '';
  if (!/https?:\/\/|(?:token|signature|authorization|credential|secret)["']?\s*[=:]|\bBearer\s+\S+/i.test(message)) return error instanceof Error ? error : new Error('文件传输失败，请重试。');
  return Object.assign(new Error('文件传输请求失败，请重新选择文件以恢复。'), { name: source.name === 'AbortError' ? 'AbortError' : 'Error', status: source.status, code: source.code, retryAfter: source.retryAfter, retryAfterMs: source.retryAfterMs, fatal: source.fatal });
}

export function mediaRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value == null || !value.trim()) return undefined;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const milliseconds = Number(text) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  // Accept HTTP-date forms only; Date.parse alone treats inputs such as "1.5" as old dates.
  const asctime = /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/i.test(text);
  const httpDate = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(text)
    || /^[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT$/i.test(text)
    || asctime;
  if (!httpDate) return undefined;
  const when = Date.parse(asctime ? `${text} GMT` : text);
  return Number.isFinite(when) ? Math.max(0, when - now) : undefined;
}

export function mediaSleep(ms: number, signal?: AbortSignal): Promise<void> {
  checkMediaAbort(signal);
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(mediaAbortError(signal)); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
}

export type MediaFailure = Error & { status?: number; code?: string; retryAfter?: number; retryAfterMs?: number; fatal?: boolean };

/** One cooldown and one waiting budget for all of an upload's concurrent workers and API calls. */
export class MediaUploadRetry {
  private until = 0;
  private spent = 0;
  constructor(private now = Date.now, private sleep = mediaSleep) {}

  async wait(signal?: AbortSignal): Promise<void> {
    checkMediaAbort(signal);
    while (this.until > this.now()) {
      await this.sleep(this.until - this.now(), signal);
      checkMediaAbort(signal);
    }
  }

  failed(error: unknown, attempt: number): void {
    const failure = error as MediaFailure;
    if (failure?.name === 'AbortError' || failure?.fatal || attempt >= MEDIA_UPLOAD_ATTEMPTS - 1
      || (failure?.status != null && failure.status !== 408 && failure.status !== 429 && failure.status < 500)) throw error;
    const requested = failure?.retryAfterMs ?? failure?.retryAfter;
    const delay = typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 ? requested : 500 * 2 ** attempt;
    const now = this.now(), baseline = Math.max(now, this.until), next = Math.max(baseline, now + delay);
    const extra = next - baseline;
    // Never turn a long Retry-After into an early retry. Leave the upload resumable instead.
    if (!Number.isFinite(next) || this.spent + extra > MEDIA_RETRY_WAIT_BUDGET_MS) throw error;
    this.spent += extra; this.until = next;
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const runAttempt = work;
    for (let attempt = 0; ; attempt++) {
      await this.wait(signal);
      try { const value = await runAttempt(); checkMediaAbort(signal); return value; }
      catch (error) { checkMediaAbort(signal); this.failed(error, attempt); }
    }
  }
}
