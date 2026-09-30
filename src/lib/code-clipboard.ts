const MARKER = 'data-wickrun-code="1"';

export function isAppCodeClipboard(html: string): boolean {
  return /<pre\b[^>]*\bdata-wickrun-code\s*=\s*["']?1(?:["'\s>])/i.test(html);
}

/** Supply exact plain text plus a small marker so our composer knows this paste is code. */
export async function writeCodeClipboard(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard.write && typeof ClipboardItem !== 'undefined') {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    try {
      await clipboard.write([new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([`<pre ${MARKER}><code>${escaped}</code></pre>`], { type: 'text/html' }),
      })]);
      return;
    } catch {
      // Older clipboard implementations may reject HTML; plain text still works.
    }
  }
  await clipboard.writeText(text);
}
