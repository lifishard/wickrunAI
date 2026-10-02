/**
 * Media inside a model response, whichever API shape it arrives in.
 *
 * Chat gateways return generated pictures and audio in different places:
 * `message.images`, content parts, `message.audio`, Gemini-style `inline_data`,
 * Responses-API `image_generation_call`, or just a link in the text. This reads
 * all of them into one shape that the app saves as a file.
 */
export interface MediaPart {
  kind: 'image' | 'audio' | 'video';
  mime?: string;
  /** Raw base64 without the data: prefix. */
  base64?: string;
  url?: string;
  name?: string;
}

const AUDIO_MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', opus: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', pcm16: 'audio/wav' };

function fromUrlString(value: string, kind: MediaPart['kind'], mime?: string): MediaPart | null {
  const data = /^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$/s.exec(value);
  if (data) return { kind: data[1].startsWith('audio/') ? 'audio' : data[1].startsWith('video/') ? 'video' : kind, mime: data[1] || mime, base64: data[2] };
  if (/^https:\/\//i.test(value)) return { kind, mime, url: value };
  return null;
}

function kindOfMime(mime: string | undefined, fallback: MediaPart['kind']): MediaPart['kind'] {
  if (mime?.startsWith('audio/')) return 'audio';
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('image/')) return 'image';
  return fallback;
}

function fromPart(item: unknown): MediaPart | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const type = typeof o.type === 'string' ? o.type : '';
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

  // OpenAI-style image / video links: { type:'image_url', image_url:{ url } } or image_url:'...'
  for (const [field, kind] of [['image_url', 'image'], ['video_url', 'video'], ['audio_url', 'audio']] as const) {
    const raw = o[field];
    const url = typeof raw === 'string' ? raw : text((raw as Record<string, unknown> | undefined)?.url);
    if (url) return fromUrlString(url, kind);
  }
  // Images API / b64_json
  if (text(o.b64_json)) return { kind: 'image', mime: 'image/png', base64: o.b64_json as string };
  if (type === 'output_image' || type === 'image') {
    const src = o.source as Record<string, unknown> | undefined;
    if (src && text(src.data)) return { kind: 'image', mime: text(src.media_type) ?? 'image/png', base64: src.data as string };
    if (text(o.url)) return fromUrlString(o.url as string, 'image');
  }
  // Responses API
  if (type === 'image_generation_call' && text(o.result)) return { kind: 'image', mime: 'image/png', base64: o.result as string };
  // Audio: { type:'output_audio'|'audio', data, format }
  if ((type === 'output_audio' || type === 'audio' || type === 'input_audio') && text((o.audio as Record<string, unknown> | undefined)?.data ?? o.data)) {
    const holder = (o.audio ?? o) as Record<string, unknown>;
    const format = text(holder.format) ?? 'wav';
    return { kind: 'audio', mime: AUDIO_MIME[format] ?? `audio/${format}`, base64: holder.data as string };
  }
  // Gemini-style inline data
  const inline = (o.inline_data ?? o.inlineData) as Record<string, unknown> | undefined;
  if (inline && text(inline.data)) {
    const mime = text(inline.mime_type) ?? text(inline.mimeType);
    return { kind: kindOfMime(mime, 'image'), mime, base64: inline.data as string };
  }
  const file = (o.file_data ?? o.fileData) as Record<string, unknown> | undefined;
  if (file && text(file.file_uri ?? file.fileUri)) return fromUrlString((file.file_uri ?? file.fileUri) as string, kindOfMime(text(file.mime_type ?? file.mimeType), 'video'));
  return null;
}

/** Everything the model returned besides text, from one message / delta / choice. */
export function extractMediaParts(holder: unknown, root?: unknown): MediaPart[] {
  const out: MediaPart[] = [];
  const push = (p: MediaPart | null) => { if (p && (p.base64 || p.url)) out.push(p); };
  const h = (holder && typeof holder === 'object' ? holder : {}) as Record<string, unknown>;

  for (const key of ['images', 'videos']) if (Array.isArray(h[key])) for (const item of h[key] as unknown[]) push(typeof item === 'string' ? fromUrlString(item, key === 'videos' ? 'video' : 'image') : fromPart(item));
  if (Array.isArray(h.content)) for (const item of h.content) push(fromPart(item));
  if (Array.isArray(h.parts)) for (const item of h.parts) push(fromPart(item));
  const audio = h.audio as Record<string, unknown> | undefined;
  if (audio && typeof audio.data === 'string' && audio.data) push(fromPart({ type: 'audio', audio }));

  const r = (root && typeof root === 'object' ? root : {}) as Record<string, unknown>;
  // /images/generations shaped bodies and Responses API output arrays
  if (Array.isArray(r.data)) for (const item of r.data) push(fromPart(item));
  if (Array.isArray(r.output)) for (const item of r.output) push(fromPart(item));
  return out;
}

const MEDIA_LINK = /https:\/\/[^\s<>"')\]]+?\.(?:mp4|m4v|webm|mov|mp3|wav|m4a|ogg|flac|png|jpe?g|gif|webp)(?:\?[^\s<>"')\]]*)?/gi;

/** Media links a model wrote into its answer text (many gateways reply with just a URL). */
export function mediaLinksInText(text: string): MediaPart[] {
  const seen = new Set<string>();
  const out: MediaPart[] = [];
  for (const match of text.matchAll(MEDIA_LINK)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const ext = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)?.[1].toLowerCase() ?? '';
    const kind: MediaPart['kind'] = ['mp4', 'm4v', 'webm', 'mov'].includes(ext) ? 'video' : ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(ext) ? 'audio' : 'image';
    out.push({ kind, url });
  }
  return out.slice(0, 10);
}
