const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const attachments = require('../electron/attachments.cjs');
const remote = require('../electron/remote-server.cjs');
const { loader } = require('./load-ts.cjs');
const shared = loader()(path.join(__dirname, '..', 'src', 'lib', 'attachment-limits.ts'));

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wickrun-attachments-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('attachment limits replace the old 1MB text cap and keep shared policy explicit', () => {
  assert.deepEqual(shared.ATTACHMENT_LIMITS, {
    textBytes: attachments.MAX_TEXT,
    imageBytes: attachments.MAX_IMAGE,
    audioBytes: 12 * attachments.MIB,
    videoBytes: 12 * attachments.MIB,
    batchBytes: attachments.MAX_BATCH,
  });
  assert.equal(shared.validateAttachmentSize('text', 2 * attachments.MIB), undefined);
  assert.match(shared.validateAttachmentBatch(shared.ATTACHMENT_LIMITS.batchBytes + 1), /100MB/);
  assert.equal(attachments.MAX_TEXT, 25 * attachments.MIB);
  assert.equal(attachments.MAX_IMAGE, 20 * attachments.MIB);
  assert.equal(attachments.MAX_BATCH, 100 * attachments.MIB);
  assert.equal(remote.MAX_REMOTE_BODY, attachments.MAX_BATCH);
  assert.equal(attachments.validateAttachmentSize('text', 2 * attachments.MIB), undefined);
  assert.match(attachments.validateAttachmentSize('text', attachments.MAX_TEXT + 1, 'large.txt'), /25MB/);
  assert.match(attachments.validateAttachmentSize('image', attachments.MAX_IMAGE + 1, 'large.png'), /20MB/);
  assert.equal(attachments.validateAttachmentBatch(attachments.MAX_BATCH), undefined);
  assert.match(attachments.validateAttachmentBatch(attachments.MAX_BATCH + 1), /100MB/);
});

test('file picker accepts text above the former 1MB limit and rejects over-bound files clearly', async (t) => {
  const dir = tempDir(t);
  const accepted = path.join(dir, 'two-megabytes.txt');
  const tooLarge = path.join(dir, 'too-large.txt');
  fs.writeFileSync(accepted, Buffer.alloc(2 * attachments.MIB, 0x78));
  fs.writeFileSync(tooLarge, Buffer.alloc(attachments.MAX_TEXT + 1, 0x78));

  const [ok, bad] = await attachments.readFiles([accepted, tooLarge]);
  assert.equal(ok.kind, 'text');
  assert.equal(ok.size, 2 * attachments.MIB);
  assert.equal(ok.text.length, 2 * attachments.MIB);
  assert.match(bad.error, /25MB/);
  assert.doesNotMatch(bad.error, /1MB/);
});

test('a batch over 100MB reports the offending item before reading it', async (t) => {
  const dir = tempDir(t);
  const files = Array.from({ length: 4 }, (_, i) => path.join(dir, `part-${i}.txt`));
  const rejectedPath = path.join(dir, 'rejected.txt');
  // Four valid 25MB files fill the 100MB batch budget. The fifth file is then
  // rejected during the size preflight, before its contents are read.
  for (const file of files) fs.writeFileSync(file, Buffer.alloc(attachments.MAX_TEXT, 0x78));
  fs.writeFileSync(rejectedPath, Buffer.alloc(2 * attachments.MIB, 0x78));
  const results = await attachments.readFiles([...files, rejectedPath]);
  assert.equal(results[0].kind, 'text');
  const rejected = results.at(-1);
  assert.match(rejected.error, /100MB/);
  assert.match(rejected.error, /分批/);
  assert.equal(rejected.text, undefined);
});

test('PDF, spreadsheets and PPTX become actual text attachments; corrupt and legacy PPT stay rejected', async (t) => {
  const dir = tempDir(t);
  const { PDFDocument } = require('pdf-lib');
  const { Document, Paragraph, Packer } = require('docx');
  const XLSX = require('xlsx');
  const JSZip = require('jszip');
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText('Kandel neurons lecture');
  const pdfPath = path.join(dir, 'lecture.pdf');
  fs.writeFileSync(pdfPath, await pdf.save());
  const blankPdf = await PDFDocument.create();blankPdf.addPage();
  const blankPdfPath = path.join(dir, 'scan.pdf');fs.writeFileSync(blankPdfPath, await blankPdf.save());
  const docxPath = path.join(dir, 'notes.docx');
  fs.writeFileSync(docxPath, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Word neurons')] }] })));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Topic', 'Count'], ['Neuron', 7]]), 'Notes');
  const xlsxPath = path.join(dir, 'notes.xlsx');
  const xlsPath = path.join(dir, 'legacy.xls');
  XLSX.writeFile(workbook, xlsxPath);
  XLSX.writeFile(workbook, xlsPath, { bookType: 'biff8' });
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>Neuron slide</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>');
  const pptxPath = path.join(dir, 'slides.pptx');
  fs.writeFileSync(pptxPath, await zip.generateAsync({ type: 'nodebuffer' }));
  const corruptPath = path.join(dir, 'broken.pdf');
  fs.writeFileSync(corruptPath, Buffer.from('not a PDF'));
  const pptPath = path.join(dir, 'old.ppt');
  fs.writeFileSync(pptPath, Buffer.from('old presentation'));

  const results = await attachments.readFiles([pdfPath, xlsxPath, xlsPath, pptxPath, docxPath, corruptPath, pptPath, blankPdfPath]);
  for (const [index, value] of ['Kandel neurons lecture', 'Neuron', 'Neuron', 'Neuron slide', 'Word neurons'].entries()) {
    assert.equal(results[index].kind, 'text', results[index].error);
    assert.match(results[index].text, new RegExp(value));
    assert.equal(results[index].path, [pdfPath, xlsxPath, xlsPath, pptxPath, docxPath][index]);
  }
  assert.match(results[5].error, /有效的 PDF/);
  assert.match(results[6].error, /另存为 \.pptx/);
  assert.match(results[7].error, /OCR/);
});
