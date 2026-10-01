'use strict';
const path = require('node:path');

const MAX_CHARS = 200000;
const MAX_ZIP_ENTRIES = 10000;
const MAX_UNPACKED = 100 * 1024 * 1024;
const clip = text => text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[只显示前 ${MAX_CHARS} 字]` : text;

async function pdf(name, bytes) {
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Error('文件内容不是有效的 PDF。');
  const { pdfToMarkdown } = require('./tools/pdf-layout.cjs');
  const result = await pdfToMarkdown(bytes, { pages: '1-50', includePageMarks: true });
  if (!result.markdown.trim()) throw Error('PDF 没有可提取的文字层；扫描件请先做 OCR。');
  return clip(`# ${name}\n\n> PDF：已提取 ${result.readPages}/${result.totalPages} 页；图片中的文字未识别。\n\n${result.markdown}`);
}

function sheet(name, bytes) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(bytes, { type: 'buffer', cellDates: true });
  let nonempty = 0;
  const parts = [`# ${name}`];
  for (const title of workbook.SheetNames.slice(0, 20)) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[title], { header: 1, blankrows: false, defval: '' });
    if (!rows.length) continue;
    parts.push(`## ${title}`);
    for (const row of rows.slice(0, 500)) {
      const cells = row.slice(0, 80).map(value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim());
      if (cells.some(Boolean)) { nonempty++; parts.push(cells.join('\t')); }
    }
    if (rows.length > 500) parts.push(`[该表还有 ${rows.length - 500} 行未显示]`);
  }
  if (!nonempty) throw Error('表格没有可提取的单元格内容。');
  return clip(parts.join('\n'));
}

async function word(name, bytes) {
  const mammoth = require('mammoth');
  const { htmlToMarkdown } = require('./tools/web.cjs');
  const result = await mammoth.convertToHtml({ buffer: bytes });
  const text = htmlToMarkdown(result.value || '', '').markdown.trim();
  if (!text) throw Error('Word 文档没有可提取的正文。');
  return clip(`# ${name}\n\n${text}`);
}

async function presentation(name, bytes) {
  const JSZip = require('jszip');
  const { DOMParser } = require('@xmldom/xmldom');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files);
  if (files.length > MAX_ZIP_ENTRIES || files.reduce((total, file) => total + (file._data?.uncompressedSize || 0), 0) > MAX_UNPACKED)
    throw Error('演示文稿内部内容过大。');
  if (!zip.file('ppt/presentation.xml')) throw Error('文件内容不是有效的 PPTX。');
  const parse = xml => new DOMParser().parseFromString(xml, 'text/xml');
  const relsFile = zip.file('ppt/_rels/presentation.xml.rels');
  const relations = new Map();
  if (relsFile) {
    const document = parse(await relsFile.async('string'));
    for (const item of Array.from(document.getElementsByTagName('Relationship')))
      relations.set(item.getAttribute('Id'), item.getAttribute('Target'));
  }
  const presentation = parse(await zip.file('ppt/presentation.xml').async('string'));
  const slideIds = Array.from(presentation.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main', 'sldId'));
  const ordered = slideIds.map(item => {
    const target = relations.get(item.getAttribute('r:id'));
    return target ? path.posix.normalize(target.startsWith('/') ? target.slice(1) : `ppt/${target}`) : null;
  }).filter(Boolean);
  if (!ordered.length) throw Error('PPTX 没有可读取的幻灯片。');
  const parts = [`# ${name}`, '> 已提取幻灯片文字；图片或图表里的文字未识别。'];
  let content = 0;
  for (const [index, slidePath] of ordered.entries()) {
    const slide = zip.file(slidePath);
    if (!slide) throw Error(`第 ${index + 1} 页幻灯片结构缺失。`);
    const document = parse(await slide.async('string'));
    const lines = Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't'))
      .map(node => node.textContent?.trim()).filter(Boolean);
    if (lines.length) { content++; parts.push(`## 第 ${index + 1} 页\n\n${lines.join('\n')}`); }
  }
  if (!content) throw Error('PPTX 没有可提取的文字；只有图片的幻灯片请先做 OCR。');
  return clip(parts.join('\n\n'));
}

async function extractDocument(name, bytes) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.pdf') return pdf(name, bytes);
  if (['.xlsx', '.xlsm', '.xls'].includes(ext)) return sheet(name, bytes);
  if (ext === '.docx') return word(name, bytes);
  if (['.pptx', '.potx'].includes(ext)) return presentation(name, bytes);
  if (ext === '.ppt') throw Error('旧版 .ppt 暂不支持读取；请在演示软件中另存为 .pptx 后重试。');
  return null;
}

module.exports = { extractDocument, MAX_CHARS };
