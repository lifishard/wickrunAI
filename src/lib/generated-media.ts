import type { Transport, ToolStep } from '../types';
import type { MediaPart } from './media-parts';
import { desktop } from './transport';

/**
 * Save media a model returned as files, and describe the result as a step so
 * the conversation's file list shows it. Returns null when there is nothing to
 * save. Only the desktop app can keep files on disk; elsewhere the person is
 * told, instead of the media silently vanishing.
 */
export async function saveGeneratedMedia(_transport: Transport, parts: MediaPart[], id: string): Promise<ToolStep | null> {
  if (!parts.length) return null;
  const bridge = desktop();
  const startedAt = Date.now();
  if (!bridge?.saveGeneratedMedia) {
    return { id, callId: id, name: 'generated_media', args: {}, status: 'error', startedAt,
      summary: `模型返回了 ${parts.length} 个图片/音频/视频，但这个入口不能保存到本地。请在桌面端使用，或在网页版的云端存储开通后查看。` };
  }
  try {
    const result = await bridge.saveGeneratedMedia(parts);
    const files = result.files.map((f) => ({ path: f.path, name: f.name, size: f.size, direction: 'output' as const, verifiedAt: startedAt, modifiedAt: f.modifiedAt }));
    const failed = result.errors.map((e) => `${e.name}：${e.error}`).join('；');
    if (!files.length) return { id, callId: id, name: 'generated_media', args: {}, status: 'error', startedAt, summary: `生成的媒体没有保存成功。${failed}` };
    return { id, callId: id, name: 'generated_media', args: {}, status: 'ok', startedAt, files,
      summary: failed ? `已保存 ${files.length} 个生成文件；另有未保存：${failed}` : `已保存 ${files.length} 个生成文件` };
  } catch (error) {
    return { id, callId: id, name: 'generated_media', args: {}, status: 'error', startedAt,
      summary: `生成的媒体没有保存成功：${error instanceof Error ? error.message : String(error)}` };
  }
}
