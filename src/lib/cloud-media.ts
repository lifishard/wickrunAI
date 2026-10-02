import { desktop } from './transport';

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

export interface UploadProgress { sent: number; total: number }

/** 把本机文件传到账号的云文件库（桌面端）。传完后网页端可以直接播放和下载。 */
export async function uploadToCloud(path: string, onProgress: (p: UploadProgress) => void): Promise<void> {
  const bridge = desktop();
  if (!bridge?.cloudMedia) throw new Error('这个版本不能上传到云端，请更新桌面端。');
  const requestId = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const off = bridge.onEvent((event) => { if (event.requestId === requestId && event.type === 'media-progress') onProgress(event.data as UploadProgress); });
  try { await bridge.cloudMedia('upload', { path, requestId }); }
  catch (error) { throw new Error(cloudMediaError(error)); }
  finally { off(); }
}

/* ------------------------------------------------------------------ *
 * 云文件库：桌面端走主进程（带本机登录令牌），网页走同源接口
 * ------------------------------------------------------------------ */
import { webCloudAccount } from './cloud-api';

export interface CloudFile { id: string; name: string; mime: string; size: number; status: string; createdAt: number }
export interface CloudUsage { available: boolean; usedBytes: number; limitBytes: number; availableBytes: number; plan: 'free' | 'paid'; overLimit: boolean }

export async function mediaCall<T = any>(operation: string, input: Record<string, unknown> = {}): Promise<T> {
  const bridge = desktop();
  try {
    if (bridge?.cloudMedia) return await bridge.cloudMedia(operation as never, input) as T;
    const account = webCloudAccount();
    const response = await fetch('/api/media', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(account ? { 'X-Wickrun-Account': account } : {}) },
      body: JSON.stringify({ operation, input }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `云文件请求失败（${response.status}）`);
    return data as T;
  } catch (error) { throw new Error(cloudMediaError(error)); }
}

const PART_RETRIES = 4;
async function putWithRetry(url: string, body: Blob, signal?: AbortSignal): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < PART_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new Error('上传已取消');
    try {
      const response = await fetch(url, { method: 'PUT', body, signal });
      if (response.ok) return;
      if (response.status < 500 && response.status !== 429 && response.status !== 408) throw Object.assign(new Error(`云存储拒绝了上传（HTTP ${response.status}）。请刷新页面重试。`), { fatal: true });
      last = `HTTP ${response.status}`;
    } catch (error) {
      if ((error as { fatal?: boolean }).fatal || signal?.aborted) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
  }
  throw new Error(`网络不稳定，上传中断（${last}）。再次选择同一个文件会从断点继续。`);
}

/** 浏览器里把文件直传到云存储：大文件分片、可续传，不经过应用服务器。 */
export async function uploadFileFromBrowser(file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<CloudFile> {
  const requestKey = 'up-' + await sha256Hex(`${file.name}|${file.size}|${file.lastModified}`);
  const begun = await mediaCall('begin', { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, requestKey, source: 'web' });
  if (begun.status === 'ready') { onProgress({ sent: file.size, total: file.size }); return begun.publicRow; }
  let sent = 0;
  const report = () => onProgress({ sent: Math.min(sent, file.size), total: file.size });
  if (begun.mode === 'single') { await putWithRetry(begun.url, file, signal); sent = file.size; report(); }
  else {
    const have = new Set<number>((begun.completedParts ?? []).map((p: { partNumber: number }) => p.partNumber));
    for (const p of begun.completedParts ?? []) sent += p.size;
    report();
    const todo: number[] = []; for (let n = 1; n <= begun.partCount; n += 1) if (!have.has(n)) todo.push(n);
    let next = 0, failure: unknown = null;
    const worker = async () => {
      while (!failure && next < todo.length) {
        const batch = todo.slice(next, next + 4); next += batch.length;
        const urls = new Map<number, string>(((await mediaCall('partUrls', { id: begun.id, partNumbers: batch })).parts as { partNumber: number; url: string }[]).map(p => [p.partNumber, p.url]));
        for (const n of batch) {
          if (failure) return;
          const start = (n - 1) * begun.partSize, end = Math.min(file.size, start + begun.partSize);
          try { await putWithRetry(urls.get(n)!, file.slice(start, end), signal); sent += end - start; report(); } catch (error) { failure = error; return; }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
    if (failure) throw failure;
  }
  return mediaCall('complete', { id: begun.id });
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
