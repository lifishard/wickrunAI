import JSZip from 'jszip';
export interface BinarySnapshot { path: string; hash: string; bytes: Uint8Array; versions: { hash: string; at: number }[] }
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const children = (root: Document | Element, ns: string, tag: string) => Array.from(root.getElementsByTagNameNS(ns, tag));
async function xml(zip: JSZip, name: string): Promise<Document> {
  const file = zip.file(name); if (!file) throw Error('文档缺少必要内容：' + name);
  const text = await file.async('string');
  if (text.length > 8 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text)) throw Error('文档结构不适合直接编辑，请使用默认程序。');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('文档结构损坏。');
  return doc;
}
export interface OfficeText { id: string; label: string; text: string; editable: boolean }
export interface OfficeSheet { name: string; path: string; cells: OfficeText[] }
export interface OfficeDraft { kind: 'docx' | 'xlsx'; paragraphs: OfficeText[]; sheets: OfficeSheet[]; bytes: Uint8Array }
function ownText(p: Element): Element[] {
  return children(p, W, 't').filter(t => { let parent = t.parentElement ?? t.parentNode as Element; while (parent && parent !== p) { if (parent.namespaceURI === W && parent.localName === 'p') return false; parent = parent.parentElement ?? parent.parentNode as Element; } return true; });
}
export async function readOfficeDraft(bytes: Uint8Array, kind: 'docx' | 'xlsx'): Promise<OfficeDraft> {
  const zip = await JSZip.loadAsync(bytes);
  if (Object.keys(zip.files).length > 5000) throw Error('文档结构过大，请使用默认程序。');
  if (kind === 'docx') {
    const doc = await xml(zip, 'word/document.xml');
    const paragraphs = children(doc, W, 'p').map((p, i) => ({ id: String(i), label: `第 ${i + 1} 段`, text: ownText(p).map(t => t.textContent || '').join(''), editable: !children(p, W, 'fldChar').length && !children(p, W, 'instrText').length && !children(p, W, 'drawing').length && !children(p, W, 'tab').length && !children(p, W, 'br').length })).filter(p => p.text);
    return { kind, paragraphs, sheets: [], bytes };
  }
  const book = await xml(zip, 'xl/workbook.xml'), rels = await xml(zip, 'xl/_rels/workbook.xml.rels');
  const strings = zip.file('xl/sharedStrings.xml') ? children(await xml(zip, 'xl/sharedStrings.xml'), S, 'si').map(si => children(si, S, 't').map(t => t.textContent || '').join('')) : [];
  const sheets: OfficeSheet[] = [];
  for (const sheet of children(book, S, 'sheet')) {
    const id = sheet.getAttributeNS(R, 'id');
    const relationship = Array.from(rels.documentElement.childNodes).find(node => node.nodeType === 1 && (node as Element).getAttribute('Id') === id) as Element | undefined;
    const target = relationship?.getAttribute('Target');
    if (!target || relationship?.getAttribute('TargetMode') === 'External') continue;
    const path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    if (path.includes('..')) throw Error('不支持此工作表路径。');
    const doc = await xml(zip, path), protectedSheet = children(doc, S, 'sheetProtection').length > 0;
    const cells = children(doc, S, 'c').slice(0, 10000).map(c => {
      const raw = children(c, S, 'v')[0]?.textContent || '', formula = children(c, S, 'f')[0]?.textContent;
      const text = formula !== undefined ? '=' + formula : c.getAttribute('t') === 's' ? strings[Number(raw)] ?? '' : c.getAttribute('t') === 'inlineStr' ? children(c, S, 't').map(t => t.textContent || '').join('') : raw;
      return { id: c.getAttribute('r') || '', label: c.getAttribute('r') || '', text, editable: !protectedSheet && formula === undefined };
    });
    sheets.push({ name: sheet.getAttribute('name') || '', path, cells });
  }
  return { kind, paragraphs: [], sheets, bytes };
}
export async function patchOfficeDraft(draft: OfficeDraft, target: { id: string; sheet?: string; before: string; after: string }): Promise<Uint8Array> {
  if (target.after.length > 100000) throw Error('修改内容过长。');
  const zip = await JSZip.loadAsync(draft.bytes);
  const path = draft.kind === 'docx' ? 'word/document.xml' : draft.sheets.find(s => s.path === target.sheet)?.path;
  if (!path) throw Error('找不到工作表。');
  const doc = await xml(zip, path);
  if (draft.kind === 'docx') {
    const entry = draft.paragraphs.find(p => p.id === target.id);
    if (!entry?.editable || entry.text !== target.before) throw Error('段落已变化，或包含不支持编辑的域、图形。');
    const p = children(doc, W, 'p')[Number(target.id)], runs = ownText(p);
    // Keep untouched run styling. Only the changed span inherits the first affected run's style.
    let start = 0, end = target.before.length, nextEnd = target.after.length;
    while (start < end && start < nextEnd && target.before[start] === target.after[start]) start++;
    while (end > start && nextEnd > start && target.before[end - 1] === target.after[nextEnd - 1]) { end--; nextEnd--; }
    const replacement = target.after.slice(start, nextEnd);
    if (/[\r\n\t]/.test(replacement)) throw Error('段落编辑暂不支持插入换行或制表符，请分段修改。');
    let offset = 0, inserted = false;
    for (const run of runs) {
      const text = run.textContent || '', runEnd = offset + text.length;
      if ((runEnd > start && offset < end) || (start === end && offset <= start && (runEnd > start || run === runs.at(-1)))) {
        run.textContent = text.slice(0, Math.max(0, start - offset)) + (inserted ? '' : replacement) + text.slice(Math.max(0, end - offset));
        run.setAttribute('xml:space', 'preserve'); inserted = true;
      }
      offset = runEnd;
    }
  } else {
    const sheet = draft.sheets.find(s => s.path === path), entry = sheet?.cells.find(c => c.id === target.id);
    if (!entry?.editable || entry.text !== target.before) throw Error('单元格已变化，或为公式／受保护单元格。');
    const cell = children(doc, S, 'c').find(c => c.getAttribute('r') === target.id)!;
    for (const child of Array.from(cell.childNodes)) if (child.nodeType === 1 && ['v', 'is', 'f'].includes((child as Element).localName)) cell.removeChild(child);
    const numeric = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(target.after) && Number.isFinite(Number(target.after));
    cell.setAttribute('t', numeric ? 'n' : 'inlineStr');
    if (numeric) { const v = doc.createElementNS(S, 'v'); v.textContent = target.after; cell.appendChild(v); }
    else { const inline = doc.createElementNS(S, 'is'), text = doc.createElementNS(S, 't'); text.setAttribute('xml:space', 'preserve'); text.textContent = target.after; inline.appendChild(text); cell.appendChild(inline); }
    // Existing formulas are retained; ask spreadsheet applications to recalculate dependencies.
    const book = await xml(zip, 'xl/workbook.xml');
    let calc = children(book, S, 'calcPr')[0]; if (!calc) { calc = book.createElementNS(S, 'calcPr'); book.documentElement.appendChild(calc); }
    calc.setAttribute('fullCalcOnLoad', '1'); calc.setAttribute('forceFullCalc', '1'); zip.file('xl/workbook.xml', new XMLSerializer().serializeToString(book));
  }
  zip.file(path, new XMLSerializer().serializeToString(doc));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
