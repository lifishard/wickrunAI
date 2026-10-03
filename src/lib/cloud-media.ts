import { desktop } from './transport';
import { onWebCloudAccountChange, webCloudAccount } from './cloud-api';
import { checkMediaAbort, mediaAbortError, mediaAwait, mediaContentIdentity, mediaPutTimeout, mediaRetryAfter, mediaTimed,
  MEDIA_UPLOAD_ATTEMPTS, MediaUploadRetry, type MediaFailure } from './cloud-media-upload';

/** 云文件库的错误来自服务端（英文），这里翻成人能照着做的中文。 */
export function cloudMediaError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/over its limit/i.test(text)) return '云存储已超出套餐容量，暂时不能上传新文件（已有文件都保留着）。请删除一些文件或升级套餐后再试。';
  if (/Not enough cloud storage/i.test(text)) return `云存储空间不够放这个文件。请删除一些云端文件或升级套餐。（${text.replace(/^.*?:\s*/, '')}）`;
  if (/single file can be at most/i.test(text)) return `文件太大：${text}`;
  if (/not set up on this server|R2_BUCKET/i.test(text)) return '服务器还没有开通云文件存储，请联系管理员配置后再试。';
  if (/Sign in|登录/i.test(text)) return '请先登录云账号，再上传到云端。';
  return text;
}

export interface UploadProgress { sent: number; total: number; phase?: 'hashing' | 'uploading' | 'finalizing' | 'done' }

function translatedMediaError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') return error;
  const result = new Error(cloudMediaError(error)) as MediaFailure;
  if (error instanceof Error) result.name = error.name;
  if (error && typeof error === 'object') {
    const original = error as MediaFailure;
    for (const key of ['status', 'code', 'retryAfter', 'retryAfterMs', 'fatal'] as const) {
      if (original[key] !== undefined) Object.assign(result, { [key]: original[key] });
    }
  }
  return result;
}

/** 把本机文件传到账号的云文件库（桌面端）。传完后网页端可以直接播放和下载。 */
export async function uploadToCloud(path: string, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
  checkMediaAbort(signal);
  const bridge = desktop();
  if (!bridge?.cloudMedia) throw new Error('这个版本不能上传到云端，请更新桌面端。');
  const requestId = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const off = bridge.onEvent((event) => { if (!signal?.aborted && event.requestId === requestId && event.type === 'media-progress') onProgress(event.data as UploadProgress); });
  const cancel = () => { void bridge.cloudMedia('cancel', { requestId }).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    checkMediaAbort(signal);
    // Cancellation stops native workers; keep the UI busy until their upload IPC has actually settled.
    await bridge.cloudMedia('upload', { path, requestId });
    checkMediaAbort(signal);
  } catch (error) { checkMediaAbort(signal); throw translatedMediaError(error); }
  finally { signal?.removeEventListener('abort', cancel); off(); }
}

/* ------------------------------------------------------------------ *
 * 云文件库：桌面端走主进程（带本机登录令牌），网页走同源接口
 * ------------------------------------------------------------------ */
export interface CloudFile { id: string; name: string; mime: string; size: number; status: string; createdAt: number }
export interface CloudUsage { available: boolean; usedBytes: number; limitBytes: number; availableBytes: number; maxFileBytes?: number; plan: 'free' | 'paid'; overLimit: boolean }

export async function mediaCall<T = any>(operation: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const bridge = desktop();
  try {
    return await mediaTimed(signal, 30000, async requestSignal => {
      if (bridge?.cloudMedia) return await mediaAwait(bridge.cloudMedia(operation as never, input), requestSignal) as T;
      const account = webCloudAccount();
      const response = await fetch('/api/media', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: requestSignal,
        headers: { 'Content-Type': 'application/json', ...(account ? { 'X-Wickrun-Account': account } : {}) },
        body: JSON.stringify({ operation, input }),
      });
      const data = await response.json().catch(error => { if (requestSignal.aborted) throw error; return {}; });
      if (!response.ok) {
        const retryAfter = mediaRetryAfter(response.headers.get('Retry-After'));
        throw Object.assign(new Error(typeof data.error === 'string' ? data.error : `云文件请求失败（${response.status}）`),
          { status: response.status, code: typeof data.code === 'string' ? data.code : undefined, retryAfter, retryAfterMs: retryAfter });
      }
      return data as T;
    });
  } catch (error) { throw translatedMediaError(error); }
}

const invalidUpload = () => Object.assign(new Error('云端续传信息不一致，已停止上传。请刷新后重试。'), { fatal: true });
interface BegunUpload { id: string; mode: 'single' | 'multipart'; status: string; size: number; url?: string; publicRow?: CloudFile;
  partSize?: number; partCount?: number; completedParts?: { partNumber: number; size: number }[] }
function validBegun(value: BegunUpload, size: number, expectedId?: string): BegunUpload {
  if (!value || typeof value.id !== 'string' || !value.id || value.size !== size || expectedId != null && value.id !== expectedId) throw invalidUpload();
  if (value.status === 'ready') { validCompleted(value.publicRow, value.id, size); return value; }
  if (value.status !== 'pending' || value.mode !== 'single' && value.mode !== 'multipart') throw invalidUpload();
  if (value.mode === 'single' && (typeof value.url !== 'string' || !value.url)) throw invalidUpload();
  if (value.mode === 'multipart' && (!Number.isSafeInteger(value.partSize) || value.partSize! <= 0
    || !Number.isSafeInteger(value.partCount) || value.partCount !== Math.ceil(size / value.partSize!))) throw invalidUpload();
  return value;
}
function validCompleted(value: CloudFile | undefined, id: string, size: number): CloudFile {
  if (!value || value.id !== id || value.size !== size || value.status !== 'ready') throw invalidUpload();
  return value;
}

/** 浏览器里把文件直传到云存储：大文件分片、可续传，不经过应用服务器。 */
export async function uploadFileFromBrowser(file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<CloudFile> {
  checkMediaAbort(signal);
  const account = webCloudAccount();
  if (!account) throw new Error('请先登录云账号，再上传到云端。');
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('文件为空或大小无效，请重新选择。');
  const control = new AbortController(), retry = new MediaUploadRetry();
  const cancel = () => control.abort(mediaAbortError(signal));
  signal?.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (webCloudAccount() !== account) control.abort(new DOMException('云账号已切换，上传已停止。请在当前账号重新选择文件。', 'AbortError'));
    checkMediaAbort(control.signal);
  };
  const accountOff = onWebCloudAccountChange(id => {
    if (id !== account) control.abort(new DOMException('云账号已切换，上传已停止。请在当前账号重新选择文件。', 'AbortError'));
  });
  const call = <T,>(operation: string, input: Record<string, unknown>): Promise<T> => retry.run(async () => {
    check(); const result = await mediaCall<T>(operation, input, control.signal); check(); return result;
  }, control.signal);
  let sent = 0;
  const report = (phase: UploadProgress['phase'], bytes = sent) => { check(); onProgress({ sent: Math.min(bytes, file.size), total: file.size, phase }); };
  const done = (row: CloudFile) => { report('done', file.size); return row; };
  try {
    if (signal?.aborted) cancel();
    check();
    const name = file.name, mime = file.type || 'application/octet-stream';
    const { requestKey } = await mediaContentIdentity(file, name, mime, bytes => report('hashing', bytes), control.signal, check);
    const declaration = { name, mime, size: file.size, requestKey, source: 'web' };
    const begun = validBegun(await call<BegunUpload>('begin', declaration), file.size);
    if (begun.status === 'ready') return done(begun.publicRow!);
    report('uploading');
    const partUrls = async (numbers: number[]) => {
      const result = await call<{ id?: string; parts: { partNumber: number; url: string }[] }>('partUrls', { id: begun.id, partNumbers: numbers });
      if (!result || result.id != null && result.id !== begun.id || !Array.isArray(result.parts) || result.parts.length !== numbers.length) throw invalidUpload();
      const urls = new Map<number, string>();
      for (const part of result.parts) {
        if (!numbers.includes(part.partNumber) || urls.has(part.partNumber) || typeof part.url !== 'string' || !part.url) throw invalidUpload();
        urls.set(part.partNumber, part.url);
      }
      return urls;
    };
    const put = async (firstUrl: string, body: Blob, renew: () => Promise<{ url: string } | { ready: CloudFile }>, contentType?: string): Promise<CloudFile | undefined> => {
      let url = firstUrl, renewed = false;
      for (let attempt = 0; ; attempt++) {
        await retry.wait(control.signal); check();
        try {
          const response = await mediaTimed(control.signal, mediaPutTimeout(body.size), requestSignal => fetch(url, { method: 'PUT', body, signal: requestSignal,
            ...(contentType ? { headers: { 'Content-Type': contentType } } : {}) }));
          check();
          if (response.ok) return;
          const retryAfter = mediaRetryAfter(response.headers.get('Retry-After'));
          throw Object.assign(new Error(`云存储拒绝了上传（HTTP ${response.status}）。请重新选择文件以续传。`), { status: response.status, retryAfter, retryAfterMs: retryAfter });
        } catch (error) {
          check();
          if ((error as MediaFailure)?.status === 403 && !renewed && attempt < MEDIA_UPLOAD_ATTEMPTS - 1) {
            renewed = true;
            const next = await renew(); check();
            if ('ready' in next) return next.ready;
            url = next.url; continue;
          }
          retry.failed(error, attempt);
        }
      }
    };
    if (begun.mode === 'single') {
      const recovered = await put(begun.url!, file, async () => {
        const renewed = validBegun(await call<BegunUpload>('begin', declaration), file.size, begun.id);
        if (renewed.status === 'ready') return { ready: renewed.publicRow! };
        if (renewed.mode !== 'single') throw invalidUpload();
        return { url: renewed.url! };
      }, mime);
      if (recovered) return done(recovered);
      sent = file.size; report('uploading');
    } else {
      const partSize = begun.partSize!, partCount = begun.partCount!, have = new Set<number>();
      for (const part of begun.completedParts ?? []) {
        if (!Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > partCount || have.has(part.partNumber)) throw invalidUpload();
        const bytes = Math.min(partSize, file.size - (part.partNumber - 1) * partSize);
        if (part.size === bytes) { have.add(part.partNumber); sent += bytes; }
      }
      report('uploading');
      const todo = Array.from({ length: partCount }, (_, index) => index + 1).filter(number => !have.has(number));
      let next = 0, failure: unknown;
      const worker = async () => {
        try {
          while (next < todo.length) {
            check(); const batch = todo.slice(next, next + 4); next += batch.length;
            const urls = await partUrls(batch);
            for (const number of batch) {
              check(); const start = (number - 1) * partSize, end = Math.min(file.size, start + partSize);
              await put(urls.get(number)!, file.slice(start, end), async () => ({ url: (await partUrls([number])).get(number)! }));
              check(); sent += end - start; report('uploading');
            }
          }
        } catch (error) {
          if (failure === undefined) { failure = error; control.abort(new DOMException('一个分片未能完成，已停止其余上传。', 'AbortError')); }
          throw error;
        }
      };
      await Promise.allSettled(Array.from({ length: Math.min(3, todo.length) }, worker));
      if (failure !== undefined) throw failure;
    }
    check(); report('finalizing', file.size);
    return done(validCompleted(await call<CloudFile>('complete', { id: begun.id }), begun.id, file.size));
  } catch (error) { throw translatedMediaError(error); }
  finally { accountOff(); signal?.removeEventListener('abort', cancel); }
}
