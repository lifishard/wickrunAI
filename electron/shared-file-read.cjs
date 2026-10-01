const fs=require('node:fs');
const path=require('node:path');
/** Called only by the trusted renderer after an explicit Share action. */
function readSharedFile(file){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))throw Error('文件路径无效。');
  const handle=fs.openSync(file,'r');
  try{
    const before=fs.fstatSync(handle),limit=100*1024*1024;
    if(!before.isFile()||before.size>limit)throw Error('共享文件不能超过 100 MB。');
    const bytes=Buffer.alloc(before.size);let offset=0;
    while(offset<bytes.length){const count=fs.readSync(handle,bytes,offset,Math.min(1024*1024,bytes.length-offset),offset);if(!count)throw Error('读取期间文件已改变，请重试。');offset+=count;}
    const after=fs.fstatSync(handle);if(after.size!==before.size||after.mtimeMs!==before.mtimeMs)throw Error('读取期间文件已改变，请重试。');
    return new Uint8Array(bytes);
  }finally{fs.closeSync(handle);}
}
module.exports={readSharedFile};
