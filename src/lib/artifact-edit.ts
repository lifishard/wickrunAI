export interface ArtifactVersion { hash: string; text: string; at: number }
export interface ArtifactSnapshot { path: string; text: string; hash: string; versions: ArtifactVersion[] }
/** Textareas expose LF offsets even when the original file contains CRLF. */
export function artifactSourceOffset(text: string, textareaOffset: number): number {
  let source = 0, shown = 0;
  while (source < text.length && shown < textareaOffset) {
    source += text[source] === '\r' && text[source + 1] === '\n' ? 2 : 1;
    shown++;
  }
  return source;
}
export function applyArtifactTextareaChange(original: string, value: string): string {
  const normalized = original.replace(/\r\n?/g, '\n');
  let start = 0, end = normalized.length, nextEnd = value.length;
  while (start < end && start < nextEnd && normalized[start] === value[start]) start++;
  while (end > start && nextEnd > start && normalized[end - 1] === value[nextEnd - 1]) { end--; nextEnd--; }
  const eol = original.includes('\r\n') ? '\r\n' : original.includes('\r') ? '\r' : '\n';
  return original.slice(0, artifactSourceOffset(original, start)) + value.slice(start, nextEnd).replace(/\n/g, eol) + original.slice(artifactSourceOffset(original, end));
}
export function replaceArtifactSelection(text: string, start: number, end: number, replacement: string): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > text.length) throw Error('请先选中需要修改的文字。');
  return text.slice(0, start) + replacement + text.slice(end);
}
