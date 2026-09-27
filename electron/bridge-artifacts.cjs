"use strict";
const crypto=require('node:crypto');
const LIMIT=2*1024*1024, TOTAL=8*1024*1024;
const types={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',zip:'application/zip',md:'text/markdown',txt:'text/plain',csv:'text/csv',json:'application/json',html:'text/html',svg:'image/svg+xml'};
function cleanArtifact(input){
 const {name,requestKey,text,base64}=input||{};
 if(typeof name!=='string'||name.length>120||/[\\/:*?"<>|\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw Error('Invalid artifact filename.');
 const ext=name.split('.').pop().toLowerCase(),mimeType=types[ext];if(!mimeType)throw Error('Unsupported artifact type.');
 if(typeof requestKey!=='string'||!/^[\w-]{1,80}$/.test(requestKey))throw Error('A stable requestKey is required.');
 if((typeof text==='string')===(typeof base64==='string'))throw Error('Supply exactly one of text or base64.');
 let bytes;
 if(typeof text==='string'){if(text.length>LIMIT)throw Error('Artifact exceeds 2 MB.');bytes=Buffer.from(text);}
 else{if(base64.length>Math.ceil(LIMIT/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Invalid base64 or artifact exceeds 2 MB.');bytes=Buffer.from(base64,'base64');if(bytes.toString('base64')!==base64)throw Error('Noncanonical base64.');}
 if(!bytes.length||bytes.length>LIMIT)throw Error('Artifact must be 1 byte to 2 MB.');
 const hex=bytes.subarray(0,12).toString('hex'),ascii=bytes.subarray(0,12).toString('ascii');
 if(ext==='png'&&!hex.startsWith('89504e470d0a1a0a')||['jpg','jpeg'].includes(ext)&&!hex.startsWith('ffd8ff')||ext==='gif'&&!/^GIF8[79]a/.test(ascii)||ext==='webp'&&!(ascii.startsWith('RIFF')&&ascii.slice(8)==='WEBP')||ext==='pdf'&&!ascii.startsWith('%PDF-')||['docx','xlsx','pptx','zip'].includes(ext)&&!hex.startsWith('504b0304'))throw Error('File content does not match its extension.');
 if(['md','txt','csv','json','html','svg'].includes(ext)){const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(decoded.includes('\0'))throw Error('Invalid text file.');}
 return {id:crypto.randomUUID(),requestKey,name,mimeType,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64'),createdAt:Date.now()};
}
function addArtifact(list,input){
 const next=cleanArtifact(input),previous=list.find(a=>a.requestKey===next.requestKey);
 if(previous){if(previous.sha256!==next.sha256||previous.name!==next.name)throw Error('requestKey already has different content.');return {artifact:previous,duplicate:true};}
 if(list.length>=10||list.reduce((s,a)=>s+a.size,0)+next.size>TOTAL)throw Error('At most 10 artifacts and 8 MB per task.');
 return {artifact:next,duplicate:false};
}
const manifest=list=>(list||[]).map(({base64,requestKey,...a})=>a);
module.exports={cleanArtifact,addArtifact,manifest,LIMIT,TOTAL};
