import type { WireMessage } from './paramSchema';

/** Keep image bytes out of the text transcript while retaining their role/order. */
export function clientContent(messages: WireMessage[]) {
  const images: string[] = [];
  const transcript = messages.map(message => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.map(part => {
      if (part.type !== 'image_url') return part;
      images.push(part.image_url.url);
      return { type: 'text' as const, text: `[Image ${images.length} attached separately]` };
    }) : message.content,
  }));
  return { transcript, images };
}
