'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { guardPath } = require('./tools/common.cjs');
const { archive, runtimeVersions } = require('./code-versions.cjs');
const MAX_BYTES = 512 * 1024;
const proposals = new Map();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const lines = value => value === null || value === '' ? [] : value.endsWith('\n') ? value.slice(0,-1).split('\n') : value.split('\n');

// Bounded line LCS; large replacements remain an exact delete/add block.
function difference(before, after, fullContext = false) {
  const a = lines(before), b = lines(after); let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length-start && end < b.length-start && a[a.length-1-end] === b[b.length-1-end]) end++;
  const x = a.slice(start,a.length-end), y = b.slice(start,b.length-end), rows = [];
  let oldLine = 1, newLine = 1;
  const push = (kind,text) => rows.push({kind,text,oldLine:kind==='add'?null:oldLine++,newLine:kind==='delete'?null:newLine++});
  for (let i=0;i<start;i++) push('context',a[i]);
  if (x.length*y.length <= 1000000) {
    const table = Array.from({length:x.length+1},()=>new Uint32Array(y.length+1));
    for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)table[i][j]=x[i]===y[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
    let i=0,j=0;
    while(i<x.length||j<y.length){
      if(i<x.length&&j<y.length&&x[i]===y[j]){push('context',x[i++]);j++;}
      else if(i<x.length&&(j===y.length||table[i+1][j]>=table[i][j+1]))push('delete',x[i++]);
      else push('add',y[j++]);
    }
  } else {for(const line of x)push('delete',line);for(const line of y)push('add',line);}
  for(let i=a.length-end;i<a.length;i++)push('context',a[i]);
  const additions=rows.filter(r=>r.kind==='add').length, deletions=rows.filter(r=>r.kind==='delete').length;
  // Collapse unchanged regions, retaining three lines around every change.
  const keep=new Set(); rows.forEach((r,i)=>{if(r.kind!=='context')for(let j=Math.max(0,i-3);j<=Math.min(rows.length-1,i+3);j++)keep.add(j);});
  const visible=fullContext?[...rows]:[];let previous=-2;
  if(!fullContext)for(const i of [...keep].sort((a,b)=>a-b)){if(i!==previous+1)visible.push({kind:'hunk',text:`@@ ${rows[i].oldLine??'-'}, ${rows[i].newLine??'-'} @@`,oldLine:null,newLine:null});visible.push(rows[i]);previous=i;}
  if(before!==null && after!==null && before.endsWith('\n')!==after.endsWith('\n'))visible.push({kind:'hunk',text:after.endsWith('\n')?'文件末尾新增换行':'文件末尾移除换行',oldLine:null,newLine:null});
  return {additions,deletions,lines:visible};
}
function read(p) {
  try {
    const stat=fs.lstatSync(p);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw Error('仅支持普通文件，不能审核链接或目录');
    if(stat.size>MAX_BYTES)throw Error('文件超过 512 KB，无法提供完整的逐行审核');
    const bytes=fs.readFileSync(p);
    const text=bytes.toString('utf8');
    if(bytes.includes(0)||!Buffer.from(text,'utf8').equals(bytes))throw Error('二进制或非 UTF-8 文件无法逐行审核');
    return text;
  }catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function change(p,before,after,status='applied') {
  return {id:crypto.randomUUID(),path:p,kind:before===null?'added':after===null?'deleted':'modified',status,at:Date.now(),beforeHash:before===null?null:hash(before),afterHash:after===null?null:hash(after),...difference(before,after)};
}
function proposal(name,args,ctx) {
  if(!['write_file','edit_file','delete_file'].includes(name))throw Error('此工具不能生成可审核的文件差异');
  const p=guardPath(args.path,ctx.workspaceRoots), before=read(p);
  let after;
  if(name==='write_file')after=typeof args.content==='string'?args.content:'';
  else if(name==='delete_file'){if(before===null)throw Error('文件不存在');after=null;}
  else {
    const old=String(args.old_str??''), next=String(args.new_str??'');
    if(before===null||!old||!before.includes(old)||before.indexOf(old,before.indexOf(old)+1)!==-1)throw Error('old_str 必须在文件中唯一匹配，请重新读取文件');
    after=before.replace(old,()=>next);
  }
  if(after!==null&&Buffer.byteLength(after)>MAX_BYTES)throw Error('修改结果超过 512 KB，请拆分修改');
  if(lines(before).length+lines(after).length>20000)throw Error('文件行数超过逐行审核上限，请拆分文件');
  const identity=resolvedTarget(p);
  return {p,before,after,beforeMode:before===null?undefined:fs.statSync(p).mode,identity,name,args:JSON.stringify(args),roots:JSON.stringify(ctx.workspaceRoots),change:change(p,before,after,'pending')};
}
function resolvedTarget(p){let parent=p;while(!fs.existsSync(parent))parent=path.dirname(parent);return path.join(fs.realpathSync(parent),path.relative(parent,p));}
function prepare(name,args,ctx) {
  const item=proposal(name,args,ctx), token=crypto.randomUUID();
  for(const [key,value] of proposals)if(Date.now()-value.created>30*60*1000)proposals.delete(key);
  if(proposals.size>=1000)throw Error('待审核修改过多，请完成已有审核');
  proposals.set(token,{...item,created:Date.now()});
  return {ok:true,content:'修改尚未生效，等待用户审核。',reviewToken:token,codeChanges:[item.change]};
}
function apply(name,args,ctx) {
  runtimeVersions()?.assertReady();
  let item;
  if(ctx.reviewCodeChanges){
    item=proposals.get(ctx.codeReviewToken);proposals.delete(ctx.codeReviewToken);
    if(!item||Date.now()-item.created>30*60*1000||item.name!==name||item.args!==JSON.stringify(args)||item.roots!==JSON.stringify(ctx.workspaceRoots))throw Error('审核已过期或参数变化，请重新生成差异并审核');
    guardPath(item.p,ctx.workspaceRoots);
    if(resolvedTarget(item.p)!==item.identity||read(item.p)!==item.before)throw Error('审核期间文件已发生变化，已阻止覆盖；请重新读取并审核');
  }else item=proposal(name,args,ctx);
  if(ctx.signal?.aborted)throw Error('操作已取消，未写入文件');
  if(item.after===null)fs.unlinkSync(item.p);
  else {
    fs.mkdirSync(path.dirname(item.p),{recursive:true});
    const temporary=path.join(path.dirname(item.p),`.wickrun-${crypto.randomUUID()}.tmp`);
    try{
      fs.writeFileSync(temporary,item.after,{encoding:'utf8',flag:'wx',mode:item.before===null?0o666:fs.statSync(item.p).mode});
      if(resolvedTarget(item.p)!==item.identity||read(item.p)!==item.before)throw Error('写入前文件已发生变化，已阻止覆盖；请重新审核');
      fs.renameSync(temporary,item.p);
    }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  return {ok:true,content:`已${item.after===null?'删除':'保存'} ${item.p}`,summary:`${item.after===null?'删除':'修改'} ${path.basename(item.p)}`,filePath:item.after===null?undefined:item.p,codeChanges:item.before===item.after?[]:[archive({...item.change,status:'applied'},item.before,item.after,{beforeMode:item.beforeMode,afterMode:item.after===null?undefined:fs.statSync(item.p).mode})]};
}
const SKIP=new Set(['.git','node_modules','dist','build','.next','.venv','venv']);
function snapshot(roots) {
  const files=new Map(), modes=new Map(), warnings=[], skipped=new Set();let size=0, count=0, truncated=false;
  const walk=dir=>{
    if(count>=4000||size>=16*1024*1024){truncated=true;warnings.push('扫描达到 4000 文件或 16 MB 上限，记录可能不完整');return;}
    let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{truncated=true;warnings.push(`无法读取：${dir}`);return;}
    for(const entry of entries){
      const p=path.join(dir,entry.name);
      if(entry.isSymbolicLink()){skipped.add(p);continue;}
      if(entry.isDirectory()){if(!SKIP.has(entry.name))walk(p);continue;}
      if(count++>=4000||size>=16*1024*1024){truncated=true;warnings.push('扫描达到上限，记录可能不完整');break;}
      try{const content=read(p);if(content!==null){if(lines(content).length>10000)throw Error('行数过多');size+=Buffer.byteLength(content);files.set(p,content);modes.set(p,fs.statSync(p).mode);}}catch{skipped.add(p);warnings.push(`未逐行记录：${p}`);}
    }
  };
  for(const root of new Set(roots||[]))walk(root);
  return {files,modes,skipped,truncated,warnings:[...new Set(warnings)].slice(0,20)};
}
function compare(before,after){
  const codeChanges=[];
  for(const p of new Set([...before.files.keys(),...after.files.keys()])){
    // Do not mislabel a skipped/oversized file as a deletion or creation.
    if(before.skipped.has(p)||after.skipped.has(p)||(!before.files.has(p)&&before.truncated)||(!after.files.has(p)&&after.truncated))continue;
    const a=before.files.get(p)??null,b=after.files.get(p)??null;
    if(a!==b)codeChanges.push(archive(change(p,a,b),a,b,{beforeMode:before.modes?.get(p),afterMode:after.modes?.get(p)}));
  }
  return {codeChanges,codeAuditWarnings:[...new Set([...before.warnings,...after.warnings])]};
}
/**
 * 本机客户端（Grok）请求改文件时的预览：按它给出的完整输入算出改后内容，给用户看差异。
 * 写入仍由客户端自己做；预览只负责「批准前看得到改什么」，事后再核对实际结果。
 */
function previewNative(rawInput){
  const p=rawInput?.file_path;
  if(typeof p!=='string'||!p)throw Error('修改请求没有目标文件');
  const before=read(p);
  let after;
  if(rawInput.variant==='Write'){if(typeof rawInput.content!=='string')throw Error('修改请求缺少写入内容');after=rawInput.content;}
  else if(rawInput.variant==='SearchReplace'){
    const old=rawInput.old_string,next=rawInput.new_string;
    if(typeof old!=='string'||!old||typeof next!=='string')throw Error('修改请求缺少替换内容');
    if(before===null)throw Error('要替换的文件不存在');
    const count=before.split(old).length-1;
    if(!count)throw Error('要替换的原文在文件里找不到');
    if(count>1&&rawInput.replace_all!==true)throw Error('要替换的原文在文件里出现了不止一次，无法确定改哪一处');
    after=rawInput.replace_all===true?before.split(old).join(next):before.replace(old,()=>next);
  }else throw Error('无法识别的修改方式');
  if(Buffer.byteLength(after)>MAX_BYTES)throw Error('修改结果超过 512 KB，无法逐行审核');
  if(lines(before).length+lines(after).length>20000)throw Error('文件行数超过逐行审核上限');
  return {path:p,afterHash:hash(after),change:change(p,before,after,'pending')};
}
/** 当前文件内容的哈希；不存在为 null，读不了（二进制、过大）为 undefined */
function currentHash(p){try{const text=read(p);return text===null?null:hash(text);}catch{return undefined;}}
module.exports={difference,prepare,apply,snapshot,compare,previewNative,currentHash};
