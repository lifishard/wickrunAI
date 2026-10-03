/** Content identity shared with the desktop uploader. This root is not a whole-file SHA-256. */
export const MEDIA_CONTENT_CHUNK_BYTES = 4 * 1024 * 1024;
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
  const root = await mediaAwait(digestHex(encode(['wickrun-media-content-v1', file.size, MEDIA_CONTENT_CHUNK_BYTES, hashes])), signal);
  check();
  const requestKey = 'up2-' + await mediaAwait(digestHex(encode(['library', name, mime, root])), signal);
  check();
  return { root, requestKey };
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
