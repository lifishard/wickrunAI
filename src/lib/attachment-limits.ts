/**
 * Attachment limits shared by renderer/native clients.
 *
 * Electron's file picker mirrors these byte values in
 * `electron/attachments.cjs`. Keeping the policy here gives browser and
 * Android entry points one place to validate pasted or remote files when
 * those clients accept them.
 */
export const MIB = 1024 * 1024;

export const ATTACHMENT_LIMITS = Object.freeze({
  textBytes: 100 * MIB,
  imageBytes: 20 * MIB,
  audioBytes: 12 * MIB,
  videoBytes: 12 * MIB,
  batchBytes: 100 * MIB,
});

export type AttachmentKind = 'text' | 'image' | 'audio' | 'video';

export function attachmentLimit(kind: AttachmentKind): number {
  return ATTACHMENT_LIMITS[`${kind}Bytes`];
}

export function formatAttachmentLimit(bytes: number): string {
  return `${Math.round(bytes / MIB)}MB`;
}

/** Return a user-facing error, or undefined when the file is within bounds. */
export function validateAttachmentSize(kind: AttachmentKind, size: number, name = '附件'): string | undefined {
  const max = attachmentLimit(kind);
  if (!Number.isFinite(size) || size < 0) return `${name} 大小无效。`;
  if (size <= max) return undefined;
  return `${name} 有 ${(size / MIB).toFixed(1)}MB，超过${{ image: '图片', text: '文本', audio: '音频', video: '视频' }[kind]}附件 ${formatAttachmentLimit(max)} 上限。请分批或压缩后重试。`;
}

/** Return a user-facing error, or undefined when the selection is within bounds. */
export function validateAttachmentBatch(totalBytes: number): string | undefined {
  if (!Number.isFinite(totalBytes) || totalBytes < 0) return '附件总大小无效。';
  if (totalBytes <= ATTACHMENT_LIMITS.batchBytes) return undefined;
  return `本次附件合计 ${(totalBytes / MIB).toFixed(1)}MB，超过 ${formatAttachmentLimit(ATTACHMENT_LIMITS.batchBytes)} 总上限。请分批添加。`;
}
