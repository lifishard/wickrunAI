/** The fenced code's clipboard value comes from Markdown source, not highlighted HTML. */
export function codeClipboardText(token: { raw: string; text: string }): string {
  const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r\n|\n|\r)/.exec(token.raw);
  if (!opening) return token.text;
  const body = token.raw.slice(opening[0].length);
  const fence = opening[1][0] === '`' ? '`' : '~';
  const closing = new RegExp(`^[ \\t]{0,3}${fence}{${opening[1].length},}[ \\t]*(?:\\r\\n|\\n|\\r)?$`, 'gm');
  let match: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((match = closing.exec(body))) last = match;
  return last ? body.slice(0, last.index) : body;
}

/** Marked normalizes CRLF before tokenizing; recover matching slices from the original input. */
export function codeClipboardTexts(source: string, tokens: { raw: string; text: string }[]): string[] {
  let normalized = '';
  const sourceOffsets = [0];
  for (let i = 0; i < source.length;) {
    const char = source[i];
    const width = char === '\r' && source[i + 1] === '\n' ? 2 : 1;
    normalized += char === '\r' ? '\n' : char;
    i += width;
    sourceOffsets.push(i);
  }
  let searchFrom = 0;
  return tokens.map((token) => {
    const start = normalized.indexOf(token.raw, searchFrom);
    if (start < 0) return codeClipboardText(token);
    searchFrom = start + token.raw.length;
    return codeClipboardText({ ...token, raw: source.slice(sourceOffsets[start], sourceOffsets[searchFrom]) });
  });
}
