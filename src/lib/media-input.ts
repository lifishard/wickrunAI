import type { Attachment, KeyProfile, ModelInfo, ChatMessage } from '../types';
import type { ContentPart } from './paramSchema';
import { routeKey } from './adaptive';
export type MediaModality = 'text' | 'image' | 'audio' | 'video';
export function mediaCapabilities(profile: KeyProfile, model: string, info?: ModelInfo): MediaModality[] | undefined {
  return profile.routeProfiles?.[routeKey(profile, model)]?.inputModalities ?? info?.inputModalities;
}
export function mediaParts(attachments: Attachment[]): ContentPart[] {
  return attachments.filter(a => a.kind !== 'text' && !a.contextOmitted).flatMap(a => {
    if (!a.dataUrl) throw Error(`附件《${a.name}》的媒体内容不可用，请重新添加。`);
    if (a.kind === 'image') return [{ type: 'image_url', image_url: { url: a.dataUrl } } as ContentPart];
    if (a.kind === 'video') return [{ type: 'video_url', video_url: { url: a.dataUrl } } as ContentPart];
    const match = /^data:audio\/(wav|x-wav|mpeg|mp3);base64,([A-Za-z0-9+/=]+)$/.exec(a.dataUrl);
    if (!match) throw Error(`音频《${a.name}》需要先转换为 WAV 或 MP3。`);
    return [{ type: 'input_audio', input_audio: { data: match[2], format: /wav/.test(match[1]) ? 'wav' : 'mp3' } } as ContentPart];
  });
}
export function validateMediaRoute(messages: ChatMessage[], profile: KeyProfile, model: string, info?: ModelInfo, nativeClient = false): void {
  const capabilities = mediaCapabilities(profile, model, info), route = routeKey(profile, model);
  for (const m of messages) for (const a of m.attachments ?? []) {
    if (a.kind === 'text') continue;
    if (nativeClient && (a.kind === 'audio' || a.kind === 'video')) throw Error('当前本地 AI 连接不能直接接收音视频。请先转为文字，或把视频抽帧后添加。');
    if (capabilities && !capabilities.includes(a.kind)) throw Error(`当前模型不支持${{ image: '图片', audio: '音频', video: '视频' }[a.kind]}。请在「添加媒体」中先转为文字，或切换模型。`);
    if (!capabilities && a.kind !== 'image' && a.mediaRoute !== route) throw Error(`尚未确认当前模型支持《${a.name}》。请在添加媒体窗口确认能力，或在对话设置中配置此模型的输入类型。`);
  }
}
export function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(Error('文件读取失败。')); reader.readAsDataURL(file); });
}
export async function audioAsWav(file: File): Promise<{ dataUrl: string; duration: number; size: number }> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > 300) throw Error('单次音频最多 5 分钟，请先截取需要分析的片段。');
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const mono = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + mono.length * 2), view = new DataView(buffer);
    const ascii = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    ascii(0, 'RIFF'); view.setUint32(4, 36 + mono.length * 2, true); ascii(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, mono.length * 2, true);
    mono.forEach((n, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, n)) * (n < 0 ? 32768 : 32767), true));
    return { dataUrl: await readDataUrl(new Blob([buffer], { type: 'audio/wav' })), duration: decoded.duration, size: buffer.byteLength };
  } finally { await context.close(); }
}
export async function videoFrames(file: File, count: number, signal: AbortSignal): Promise<Attachment[]> {
  if (!Number.isInteger(count) || count < 1 || count > 16) throw Error('抽帧数量须在 1–16 之间。');
  const url = URL.createObjectURL(file), video = document.createElement('video'); video.preload = 'auto'; video.muted = true;
  const wait = (event: string) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => done(Error('读取视频超时或浏览器不支持此编码。')), 15000);
    const done = (error?: Error) => { clearTimeout(timer); video.removeEventListener(event, ok); video.removeEventListener('error', bad); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(); };
    const ok = () => done(), bad = () => done(Error('浏览器无法解码此视频。请转换为 MP4（H.264）或 WebM。')), cancel = () => done(new DOMException('已取消', 'AbortError'));
    video.addEventListener(event, ok, { once: true }); video.addEventListener('error', bad, { once: true }); signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  });
  try {
    const ready = wait('loadeddata'); video.src = url; await ready;
    if(video.duration===Infinity){const end=wait('seeked');video.currentTime=1e10;await end;}
    if (!Number.isFinite(video.duration) || video.duration <= 0) throw Error('无法读取视频时长。');
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const result: Attachment[] = [{ id: crypto.randomUUID(), kind: 'text', name: `${file.name} · 抽帧说明`, mime: 'text/plain', size: 0, text: `视频《${file.name}》共 ${video.duration.toFixed(1)} 秒，以下是均匀采样的 ${count} 帧。只包含画面，不包含声音，未采样的动作可能遗漏。` }];
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      const seconds = video.duration * (i + 0.5) / count;
      const seek = wait('seeked'); video.currentTime = seconds; await seek;
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      result.push({ id: crypto.randomUUID(), kind: 'image', name: `${file.name} @ ${seconds.toFixed(1)}s`, mime: 'image/jpeg', size: Math.ceil(dataUrl.length * 0.75), dataUrl });
    }
    return result;
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}
