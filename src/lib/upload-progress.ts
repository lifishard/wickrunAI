import type { UploadProgress } from './cloud-media';
import type { Translate } from './i18n';

export function uploadProgressText(progress: UploadProgress, t: Translate): string {
  if (progress.phase === 'finalizing') return t('正在确认云端保存…');
  if (progress.phase === 'done') return t('已上传到云端');
  const n = progress.total ? Math.max(0, Math.min(100, Math.floor(progress.sent / progress.total * 100))) : 0;
  return progress.phase === 'hashing' ? t('正在检查文件 {n}%', { n }) : t('上传中 {n}%', { n });
}
