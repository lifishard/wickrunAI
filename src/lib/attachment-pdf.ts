import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export async function importPdfFile(name:string,bytes:Uint8Array):Promise<string> {
  if (new TextDecoder('latin1').decode(bytes.subarray(0,5)) !== '%PDF-') throw Error('文件内容不是有效的 PDF。');
  const lib=await import('pdfjs-dist');
  lib.GlobalWorkerOptions.workerSrc=workerUrl;
  const document=await lib.getDocument({data:bytes}).promise;
  const parts=[`# ${name}`,`> PDF：已提取 ${Math.min(50,document.numPages)}/${document.numPages} 页；图片中的文字未识别。`];
  for(let n=1;n<=Math.min(50,document.numPages);n++) {
    const page=await document.getPage(n),content=await page.getTextContent();
    const text=content.items.map(item=>'str' in item ? item.str : '').filter(Boolean).join(' ').trim();
    if(text)parts.push(`## 第 ${n} 页\n\n${text}`);
  }
  if(parts.length===2)throw Error('PDF 没有可提取的文字层；扫描件请先做 OCR。');
  const text=parts.join('\n\n');
  return text.length>200000?`${text.slice(0,200000)}\n\n[只显示前 200000 字]`:text;
}
