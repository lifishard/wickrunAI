import { Capacitor, registerPlugin } from '@capacitor/core';

const CHUNK_BYTES = 512 * 1024;
const MAX_BYTES = 100 * 1024 * 1024;

interface NativeFiles {
  downloadBegin(input: { name: string; mime: string; size: number; sha256: string }): Promise<{ id: string }>;
  downloadChunk(input: { id: string; index: number; data: string }): Promise<void>;
  downloadFinish(input: { id: string }): Promise<{ saved: boolean }>;
  downloadAbort(input: { id: string }): Promise<void>;
}

const files = registerPlugin<NativeFiles>('WickrunFiles');

export interface SaveSharedBlobOptions {
  name: string;
  mime?: string;
  sha256?: string;
  signal?: AbortSignal;
}

function ensureActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('保存已取消。', 'AbortError');
}

function base64(bytes: Uint8Array): string {
  let value = '';
  for (let start = 0; start < bytes.length; start += 32768)
    value += String.fromCharCode(...bytes.subarray(start, start + 32768));
  return btoa(value);
}

async function sha256(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Returns false only when this is not Android; the caller may use its browser download path. */
export async function saveSharedBlob(blob: Blob, options: SaveSharedBlobOptions): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  if (!Number.isSafeInteger(blob.size) || blob.size > MAX_BYTES) throw Error('文件不能超过 100 MB。');
  ensureActive(options.signal);
  const hash = options.sha256 || await sha256(blob);
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error('文件校验信息无效。');
  ensureActive(options.signal);
  const { id } = await files.downloadBegin({
    name: options.name,
    mime: options.mime || blob.type || 'application/octet-stream',
    size: blob.size,
    sha256: hash,
  });
  if (!id) throw Error('无法开始保存文件。');
  try {
    for (let index = 0; index < Math.ceil(blob.size / CHUNK_BYTES); index++) {
      ensureActive(options.signal);
      const bytes = new Uint8Array(await blob.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).arrayBuffer());
      await files.downloadChunk({ id, index, data: base64(bytes) });
    }
    ensureActive(options.signal);
    const finish = files.downloadFinish({ id });
    const result = options.signal ? await Promise.race([
      finish,
      new Promise<never>((_, reject) => {
        const abort = () => reject(new DOMException('保存已取消。', 'AbortError'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
        void finish.finally(() => options.signal?.removeEventListener('abort', abort)).catch(() => {});
      }),
    ]) : await finish;
    if (!result.saved) throw Error('文件尚未保存。');
    return true;
  } catch (error) {
    await files.downloadAbort({ id }).catch(() => {});
    if (error instanceof Error && /Save cancelled/.test(error.message))
      throw new DOMException('保存已取消。', 'AbortError');
    throw error;
  }
}
