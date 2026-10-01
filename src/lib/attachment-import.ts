import type { Attachment } from '../types';
import { validateAttachmentSize } from './attachment-limits';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type Imported = Omit<Attachment, 'id'>;
const TEXT_EXT = new Set(['txt','md','markdown','rst','log','csv','tsv','json','jsonl','yaml','yml','toml','ini','cfg','conf','env',
  'js','mjs','cjs','ts','tsx','jsx','py','rb','go','rs','java','kt','c','h','cpp','hpp','cs','swift','php','lua','sh','bash','zsh','ps1','bat','sql','r','m','jl','html','htm','css','scss','less','vue','svelte','xml','svg','ics','ical']);
const MAX_CHARS = 200000;
const clip = (text:string) => text.length > MAX_CHARS ? `${text.slice(0,MAX_CHARS)}\n\n[只显示前 ${MAX_CHARS} 字]` : text;
const extension = (name:string) => name.toLowerCase().split('.').at(-1) ?? '';

async function imageData(file:File):Promise<string> {
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('图片读取失败。'));reader.readAsDataURL(file);});
}

async function pdf(name:string,bytes:Uint8Array):Promise<string> {
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
  return clip(parts.join('\n\n'));
}

async function sheet(name:string,bytes:Uint8Array):Promise<string> {
  const imported=await import('xlsx');
  const XLSX=imported.default??imported;
  const book=XLSX.read(bytes,{type:'array',cellDates:true});
  const parts=[`# ${name}`];let nonempty=0;
  for(const title of book.SheetNames.slice(0,20)) {
    const rows= XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[title],{header:1,blankrows:false,defval:''});
    if(!rows.length)continue;
    parts.push(`## ${title}`);
    for(const row of rows.slice(0,500)) {
      const cells=row.slice(0,80).map(value=>value instanceof Date?value.toISOString().slice(0,10):String(value??'').replace(/[\r\n\t]+/g,' ').trim());
      if(cells.some(Boolean)){nonempty++;parts.push(cells.join('\t'));}
    }
    if(rows.length>500)parts.push(`[该表还有 ${rows.length-500} 行未显示]`);
  }
  if(!nonempty)throw Error('表格没有可提取的单元格内容。');
  return clip(parts.join('\n'));
}

async function zippedText(name:string,bytes:Uint8Array,kind:'pptx'|'docx'):Promise<string> {
  const {default:JSZip}=await import('jszip');
  const zip=await JSZip.loadAsync(bytes);
  const files=Object.values(zip.files);
  if(files.length>10000||files.reduce((sum,file)=>sum+((file as typeof file & {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??0),0)>100*1024*1024)
    throw Error('文档内部内容过大。');
  const parser=new DOMParser();
  if(kind==='docx') {
    const main=zip.file('word/document.xml');if(!main)throw Error('文件内容不是有效的 DOCX。');
    const document=parser.parseFromString(await main.async('string'),'text/xml');
    const lines=Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p'))
      .map(node=>Array.from(node.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')).map(text=>text.textContent).join('').trim()).filter(Boolean);
    if(!lines.length)throw Error('Word 文档没有可提取的正文。');
    return clip(`# ${name}\n\n${lines.join('\n')}`);
  }
  const presentation=zip.file('ppt/presentation.xml'),rels=zip.file('ppt/_rels/presentation.xml.rels');
  if(!presentation||!rels)throw Error('文件内容不是有效的 PPTX。');
  const relationships=parser.parseFromString(await rels.async('string'),'text/xml');
  const targets=new Map(Array.from(relationships.getElementsByTagName('Relationship')).map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]));
  const document=parser.parseFromString(await presentation.async('string'),'text/xml');
  const slideIds=Array.from(document.getElementsByTagNameNS('http://schemas.openxmlformats.org/presentationml/2006/main','sldId'));
  const parts=[`# ${name}`,'> 已提取幻灯片文字；图片或图表里的文字未识别。'];let nonempty=0;
  for(const [index,id] of slideIds.entries()) {
    const target=targets.get(id.getAttribute('r:id'));
    const normalized=target?.startsWith('/')?target.slice(1):`ppt/${target??''}`;
    const slide=zip.file(normalized);
    if(!slide)throw Error(`第 ${index+1} 页幻灯片结构缺失。`);
    const xml=parser.parseFromString(await slide.async('string'),'text/xml');
    const lines=Array.from(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main','t')).map(node=>node.textContent?.trim()).filter(Boolean);
    if(lines.length){nonempty++;parts.push(`## 第 ${index+1} 页\n\n${lines.join('\n')}`);}
  }
  if(!nonempty)throw Error('PPTX 没有可提取的文字；只有图片的幻灯片请先做 OCR。');
  return clip(parts.join('\n\n'));
}

/** Browser/Android file picker, drop and paste use this same parser. */
export async function importBrowserFile(file:File):Promise<Imported> {
  const name=file.name||'未命名';
  const inferred=({
    'application/pdf':'pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
    'application/vnd.ms-excel':'xls',
    'application/vnd.ms-excel.sheet.macroenabled.12':'xlsm',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
    'application/vnd.ms-powerpoint':'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
    'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','image/bmp':'bmp',
  } as Record<string,string>)[file.type.toLowerCase()];
  const ext=name.includes('.')?extension(name):(inferred??'');
  const mime=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'} as Record<string,string>)[ext];
  const kind=mime?'image':'text';
  const error=validateAttachmentSize(kind,file.size,name);if(error)throw Error(error);
  if(mime)return {kind:'image',name,mime,size:file.size,dataUrl:await imageData(file)};
  const bytes=new Uint8Array(await file.arrayBuffer());
  let text:string;
  if(ext==='pdf')text=await pdf(name,bytes);
  else if(['xlsx','xlsm','xls'].includes(ext))text=await sheet(name,bytes);
  else if(ext==='pptx'||ext==='potx')text=await zippedText(name,bytes,'pptx');
  else if(ext==='docx')text=await zippedText(name,bytes,'docx');
  else if(ext==='ppt')throw Error('旧版 .ppt 暂不支持读取；请另存为 .pptx 后重试。');
  else if(TEXT_EXT.has(ext)||!ext) {
    if(bytes.includes(0))throw Error('文件包含二进制内容，无法作为文本导入。');
    text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  } else throw Error('不是支持的文本、文档或图片格式。');
  if(!text.trim())throw Error('文件没有可提取的文字。');
  return {kind:'text',name,mime:'text/plain',size:file.size,text:clip(text)};
}
