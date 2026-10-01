import { tr } from '../lib/i18n';
import type { Attachment } from '../types';
import { validateAttachmentBatch, validateAttachmentSize } from '../lib/attachment-limits';
import { canImportBrowserFile, importBrowserFile } from '../lib/attachment-import';

const IMAGE_MIMES = /^image\/(png|jpeg|webp|gif)$/;
const IMAGE_EXTENSIONS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/** Validate the entire selection before reading file contents into memory. */
export async function readBrowserAttachments(files: File[], mode: 'file' | 'image'): Promise<Attachment[]> {
  const kind = mode === 'image' ? 'image' : 'text';
  const batchError = validateAttachmentBatch(files.reduce((sum, file) => sum + file.size, 0));
  if (batchError) throw new Error(batchError);
  const mimes = files.map(file => file.type || (kind === 'image' ? IMAGE_EXTENSIONS[file.name.split('.').pop()?.toLowerCase() || ''] : 'text/plain') || '');
  for (const [index, file] of files.entries()) {
    const error = validateAttachmentSize(kind, file.size, file.name);
    if (error) throw new Error(error);
    if (kind === 'image' && !IMAGE_MIMES.test(mimes[index])) throw new Error(tr('请上传 PNG、JPEG、WebP 或 GIF 图片。'));
    if (kind === 'text' && !canImportBrowserFile(file)) throw new Error(tr('不是支持的文本、文档或图片格式。'));
  }
  const result: Attachment[] = [];
  for (const file of files) {
    const item=await importBrowserFile(file);
    result.push({id:crypto.randomUUID(),...item});
  }
  return result;
}

/** Must be called directly from a user gesture so WebKit can open its picker. */
export function pickBrowserAttachments(mode: 'file' | 'image'): Promise<Attachment[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = mode === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : '.pdf,.docx,.xlsx,.xlsm,.xls,.pptx,.potx,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.html,.css,.yaml,.yml,.xml,.log';
    input.hidden = true;
    const cleanup = () => input.remove();
    input.oncancel = () => { cleanup(); resolve([]); };
    input.onchange = () => {
      const files = Array.from(input.files || []);
      cleanup();
      void readBrowserAttachments(files, mode).then(resolve, reject);
    };
    document.body.append(input);
    try { input.click(); } catch (error) { cleanup(); reject(error); }
  });
}
