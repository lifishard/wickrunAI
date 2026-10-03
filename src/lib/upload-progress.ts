import type { UploadProgress } from './cloud-media';
import type { Translate } from './i18n';

export function uploadProgressText(progress: UploadProgress, t: Translate): string {
  if (progress.phase === 'finalizing') return t('正在校验云端内容…');
  if (progress.phase === 'done') return t('已上传到云端');
  const n = progress.total ? Math.max(0, Math.min(100, Math.floor(progress.sent / progress.total * 100))) : 0;
  return progress.phase === 'hashing' ? t('正在检查文件 {n}%', { n }) : t('上传中 {n}%', { n });
}

export function uploadCancellationText(error: unknown, t: Translate): string {
  const text = error instanceof Error ? error.message : '';
  if (/云端清理仍待确认/.test(text)) return t('上传已取消，云端清理仍待确认，占用空间暂时保留。');
  if (/云端取消状态尚未确认/.test(text)) return t('本地上传已停止，云端取消状态尚未确认。请稍后检查云文件。');
  return t('已取消上传；已发送的数据可能仍在确认，可稍后刷新文件列表。');
}
