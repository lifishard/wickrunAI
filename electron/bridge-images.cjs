'use strict';
const {createHash}=require('node:crypto');
// Inline MCP images are deliberately bounded independently of API attachments.
function cleanImages(input=[]){
  if(!Array.isArray(input)||input.length>16)throw Error('MCP 图片最多 16 张');
  let total=0;
  return input.map((image,index)=>{
    const match=typeof image?.dataUrl==='string'&&/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if(!match||match[2].length>7*1024*1024)throw Error('MCP 图片需为 PNG、JPEG、GIF 或 WebP，单张最多 5MB');
    const bytes=Buffer.from(match[2],'base64');
    if(!bytes.length||bytes.length>5*1024*1024||bytes.toString('base64')!==match[2])throw Error('MCP 图片内容或大小无效');
    const mime=match[1];
    const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:mime==='image/gif'?/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid)throw Error('图片格式与内容不符');
    total+=bytes.length;if(total>12*1024*1024)throw Error('MCP 每个任务的图片合计最多 12MB');
    return {id:`image-${index+1}`,name:String(image.name||`图片 ${index+1}`).slice(0,200),mimeType:mime,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),data:match[2]};
  });
}
const imageManifest=images=>(images||[]).map(({data,...meta})=>meta);
function imageResult(value){
  const {data,...meta}=value.image;
  return {content:[{type:'text',text:JSON.stringify(meta)},{type:'image',data,mimeType:meta.mimeType}],structuredContent:meta};
}
module.exports={cleanImages,imageManifest,imageResult};
