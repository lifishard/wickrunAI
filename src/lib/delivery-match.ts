/**
 * Literal acceptance checks compare what the person asked for with what was
 * delivered. Deliverables are now often long Markdown files and artifacts, where
 * the same words appear with different line wrapping, bold markers, smart quotes
 * or full-width characters. Those differences are formatting, not missing
 * content, so both sides are normalized the same way before comparing.
 * Wording, order and numbers still have to match.
 *
 * Keep in sync with electron/tools/verification.cjs (normalizeForMatch).
 */
export function normalizeForMatch(text: string): string {
  return String(text).normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function containsLoosely(haystack: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  return n.length > 0 && normalizeForMatch(haystack).includes(n);
}

/** Output files whose text can be searched; media and binaries are skipped. */
export const TEXT_DELIVERABLE = /\.(?:md|markdown|txt|text|html?|csv|tsv|json|ya?ml|xml|srt|vtt|ass|log|rtf|tex|js|mjs|cjs|ts|tsx|jsx|css|scss|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|sh|ps1|bat|sql|toml|ini|cfg|env|ics)$/i;
