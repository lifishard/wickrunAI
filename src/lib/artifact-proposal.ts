export interface ArtifactProposal { start: number; end: number; before: string; after: string }
export function parseArtifactProposal(raw: string, selected: string): ArtifactProposal[] {
  const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(value.edits) || !value.edits.length || value.edits.length > 20) throw Error('模型没有返回有效修改，请重试或缩小选区。');
  const edits: ArtifactProposal[] = value.edits.map((e: unknown) => {
    if (!e || typeof e !== 'object' || !('before' in e) || !('after' in e) || typeof e.before !== 'string' || typeof e.after !== 'string' || !e.before || e.after.length > 1024 * 1024) throw Error('模型返回的修改格式无效。');
    const start = selected.indexOf(e.before);
    if (start < 0 || selected.indexOf(e.before, start + 1) >= 0) throw Error('无法唯一定位模型提出的修改，文件未改动。请缩小选区重试。');
    return { start, end: start + e.before.length, before: e.before, after: e.after };
  }).sort((a: ArtifactProposal, b: ArtifactProposal) => a.start - b.start);
  if (edits.some((e, i) => i > 0 && e.start < edits[i - 1].end)) throw Error('模型的修改范围重叠，文件未改动。');
  return edits;
}
export function applyArtifactProposals(source: string, edits: ArtifactProposal[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  if (sorted.some((e, i) => e.start < 0 || e.end > source.length || source.slice(e.start, e.end) !== e.before || (i > 0 && e.start < sorted[i - 1].end))) throw Error('选中内容已变化，请重新生成建议。');
  let result = source;
  for (const e of sorted.reverse()) result = result.slice(0, e.start) + e.after + result.slice(e.end);
  return result;
}
export function findArtifactSelection(raw: string, visibleSelection: string): { start: number; end: number } | null {
  if (!visibleSelection) return null;
  const start = raw.indexOf(visibleSelection);
  if (start < 0 || raw.indexOf(visibleSelection, start + 1) >= 0) return null;
  return { start, end: start + visibleSelection.length };
}
