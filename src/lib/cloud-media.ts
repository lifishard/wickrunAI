import { desktop } from './transport';
import { onWebCloudAccountChange, webCloudAccount } from './cloud-api';
import { checkMediaAbort, mediaAbortError, mediaAwait, mediaContentIdentity, mediaPutTimeout, mediaRetryAfter, mediaTimed,
  MEDIA_UPLOAD_ATTEMPTS, MEDIA_CONTENT_SCHEME, MediaUploadRetry, checkMediaIntegrity, checkMediaParts, invalidMediaUpload,
  waitMediaVerification, safeMediaFailure, type MediaIntegrityState, type MediaFailure } from './cloud-media-upload';

/** 云文件库的错误来自服务端（英文），这里翻成人能照着做的中文。 */
export function cloudMediaError(error: unknown): string {
  const text = safeMediaFailure(error).message;
  if (/over its limit/i.test(text)) return '云存储已超出套餐容量，暂时不能上传新文件（已有文件都保留着）。请删除一些文件或升级套餐后再试。';
  if (/Not enough cloud storage/i.test(text)) return `云存储空间不够放这个文件。请删除一些云端文件或升级套餐。（${text.replace(/^.*?:\s*/, '')}）`;
  if (/single file can be at most/i.test(text)) return `文件太大：${text}`;
  if (/not set up on this server|R2_BUCKET/i.test(text)) return '服务器还没有开通云文件存储，请联系管理员配置后再试。';
  if (/Sign in|登录/i.test(text)) return '请先登录云账号，再上传到云端。';
  return text;
}

export interface UploadProgress { sent: number; total: number; phase?: 'hashing' | 'uploading' | 'finalizing' | 'done' }

function translatedMediaError(error: unknown): Error {
  if (error instanceof Error && error.name === 'AbortError') return safeMediaFailure(error);
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
  } catch (error) {
    if (signal?.aborted && /云端清理仍待确认|云端取消状态尚未确认/.test((error as Error)?.message ?? ''))
      throw new DOMException(/云端清理仍待确认/.test((error as Error).message) ? '上传已取消，云端清理仍待确认，占用空间暂时保留。' : '本地上传已停止，云端取消状态尚未确认。请稍后检查云文件。', 'AbortError');
    checkMediaAbort(signal); throw translatedMediaError(error);
  }
  finally { signal?.removeEventListener('abort', cancel); off(); }
}

/* ------------------------------------------------------------------ *
 * 云文件库：桌面端走主进程（带本机登录令牌），网页走同源接口
 * ------------------------------------------------------------------ */
export interface CloudFile { id: string; name: string; mime: string; size: number; status: string; createdAt: number; contentScheme?: string; contentRoot?: string; verifiedAt?: number }
export interface CloudUsage { available: boolean; usedBytes: number; limitBytes: number; availableBytes: number; maxFileBytes?: number; plan: 'free' | 'paid'; overLimit: boolean }

export async function mediaCall<T = any>(operation: string, input: Record<string, unknown> = {}, signal?: AbortSignal, expectedAccount?: string): Promise<T> {
  const bridge = desktop();
  try {
    return await mediaTimed(signal, 30000, async requestSignal => {
      if (bridge?.cloudMedia) return await mediaAwait(bridge.cloudMedia(operation as never, input), requestSignal) as T;
      const account = expectedAccount ?? webCloudAccount();
      if (expectedAccount !== undefined && webCloudAccount() !== expectedAccount) throw new DOMException('云账号已切换，上传已停止。', 'AbortError');
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

const invalidUpload = invalidMediaUpload;
interface BegunUpload extends MediaIntegrityState { publicRow?: CloudFile; name?: string; mime?: string; createdAt?: number }
function validCompleted(value: CloudFile | undefined, id: string, size: number, root: string): CloudFile {
  if (!value || value.id !== id || value.size !== size || value.status !== 'ready' || value.contentScheme !== MEDIA_CONTENT_SCHEME
    || value.contentRoot !== root || !Number.isSafeInteger(value.verifiedAt) || value.verifiedAt! <= 0) throw invalidUpload();
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
  const call = <T,>(operation: string, input: Record<string, unknown>, requestSignal = control.signal): Promise<T> => retry.run(async () => {
    check(); const result = await mediaCall<T>(operation, input, requestSignal, account); check(); return result;
  }, requestSignal);
  let sent = 0, uploadId: string | undefined;
  const report = (phase: UploadProgress['phase'], bytes = sent) => { check(); onProgress({ sent: Math.min(bytes, file.size), total: file.size, phase }); };
  const done = (row: CloudFile) => { report('done', file.size); return row; };
  try {
    if (signal?.aborted) cancel();
    check();
    const name = file.name, mime = file.type || 'application/octet-stream';
    const { root, requestKey } = await mediaContentIdentity(file, name, mime, bytes => report('hashing', bytes), control.signal, check);
    const declaration = { name, mime, size: file.size, requestKey, contentScheme: MEDIA_CONTENT_SCHEME, contentRoot: root, source: 'web' };
    const begun = checkMediaIntegrity(await call<BegunUpload>('begin', declaration), file.size, root, undefined, true);
    uploadId = begun.id;
    checkMediaIntegrity(begun, file.size, root);
    const finish = async (first: BegunUpload) => {
      report('finalizing', file.size);
      const verified = await waitMediaVerification(first, requestSignal => call<BegunUpload>('complete', { id: begun.id }, requestSignal), file.size, root, control.signal);
      return done(validCompleted(verified.publicRow ?? verified as CloudFile, begun.id, file.size, root));
    };
    if (begun.status === 'ready' || begun.status === 'verifying') return await finish(begun);
    checkMediaParts(begun);
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
    {
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
    return await finish(checkMediaIntegrity(await call<BegunUpload>('complete', { id: begun.id }), file.size, root, begun.id));
  } catch (error) {
    const failedVerification = ['integrity_mismatch', 'verification_unavailable'].includes((error as MediaFailure)?.code ?? '');
    if ((signal?.aborted || failedVerification) && uploadId && webCloudAccount() === account) {
      try {
        const result = await mediaTimed(undefined, 5000, requestSignal => mediaCall<{ ok?: boolean; pendingCleanup?: boolean }>('abort', { id: uploadId }, requestSignal, account));
        if (result?.ok !== true) throw invalidUpload();
        if (result.pendingCleanup) throw Object.assign(new Error('上传已取消，云端清理仍待确认，占用空间暂时保留。请等待清理后重新选择文件。'), { name: signal?.aborted ? 'AbortError' : 'Error', code: 'cleanup_pending' });
      } catch (cleanupError) {
        if ((cleanupError as MediaFailure)?.code === 'cleanup_pending') throw cleanupError;
        throw Object.assign(new Error('本地上传已停止，云端取消状态尚未确认。请稍后检查云文件。'), { name: signal?.aborted ? 'AbortError' : 'Error', code: 'abort_unconfirmed' });
      }
    }
    throw translatedMediaError(error);
  }
  finally { accountOff(); signal?.removeEventListener('abort', cancel); }
}
