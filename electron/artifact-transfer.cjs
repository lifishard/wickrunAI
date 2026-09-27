"use strict";
const crypto=require('node:crypto');
const {nameInfo,checkHeader,TOTAL}=require('./bridge-artifacts.cjs');
const FILE_LIMIT=100*1024*1024, CHUNK_SIZE=512*1024, TTL=24*60*60*1000, MAX_FILES=50;
const error=(message,status=400)=>Object.assign(Error(message),{status});
function begin(input,now=Date.now()){
 const {name,requestKey,size,sha256}=input||{},info=nameInfo(name);
 if(typeof requestKey!=='string'||!/^[\w-]{1,80}$/.test(requestKey))throw error('A stable requestKey is required.');
 if(!Number.isSafeInteger(size)||size<1||size>FILE_LIMIT)throw error('File must be 1 byte to 100 MB.');
 if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))throw error('Supply the SHA-256 of the original file.');
 return {id:crypto.randomUUID(),name,requestKey,size,sha256,mimeType:info.mimeType,createdAt:now,expiresAt:now+TTL,token:crypto.randomBytes(32).toString('base64url'),chunkSize:CHUNK_SIZE,chunkCount:Math.ceil(size/CHUNK_SIZE)};
}
function same(a,b){if(a.name!==b.name||a.size!==b.size||a.sha256!==b.sha256)throw error('requestKey already belongs to different file content.',409);}
function quota(artifacts,uploads,next){const records=new Map([...artifacts,...uploads].map(a=>[a.requestKey||a.id,a]));if(records.size>=MAX_FILES||[...records.values()].reduce((n,a)=>n+a.size,0)+next.size>TOTAL)throw error('At most 50 files and 500 MB per task, including unfinished uploads.',413);}
function chunk(meta,index,input){
 if(!Number.isSafeInteger(index)||index<0||index>=meta.chunkCount)throw error('Invalid chunk index.');
 let bytes=input;if(!Buffer.isBuffer(bytes)){
  if(typeof input!=='string'||input.length>Math.ceil(CHUNK_SIZE/3)*4||input.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(input))throw error('Invalid chunk base64.');
  bytes=Buffer.from(input,'base64');if(bytes.toString('base64')!==input)throw error('Noncanonical chunk base64.');
 }
 const expected=Math.min(CHUNK_SIZE,meta.size-index*CHUNK_SIZE);if(bytes.length!==expected)throw error(`Chunk ${index} must contain exactly ${expected} bytes.`);
 return bytes;
}
function verifier(meta){
 const hash=crypto.createHash('sha256'),ext=nameInfo(meta.name).ext,decoder=['md','txt','csv','json','html','svg'].includes(ext)?new TextDecoder('utf-8',{fatal:true}):null;let size=0;
 return {add(bytes){if(!size)checkHeader(ext,bytes);hash.update(bytes);size+=bytes.length;if(decoder&&decoder.decode(bytes,{stream:true}).includes('\0'))throw error('Invalid text file.');},finish(){if(decoder)decoder.decode();if(size!==meta.size||hash.digest('hex')!==meta.sha256)throw error('File checksum mismatch; abort this upload and retry the original file.',409);}};
}
function manifest(m){return {id:m.id,name:m.name,mimeType:m.mimeType,size:m.size,sha256:m.sha256,createdAt:m.createdAt,chunked:true,chunkSize:CHUNK_SIZE};}
function status(m,indices){const have=new Set(indices);return {uploadId:m.id,chunkSize:CHUNK_SIZE,chunkCount:m.chunkCount,expiresAt:m.expiresAt,received:have.size,missing:Array.from({length:m.chunkCount},(_,i)=>i).filter(i=>!have.has(i))};}
function ticket(m,base){return {urlTemplate:`${base}/api/relay-uploads/${m.id}/{index}`,headers:{Authorization:'Bearer '+m.token},method:'PUT'};}
function authorized(m,token,now=Date.now()){return m&&m.expiresAt>now&&typeof token==='string'&&token.length===m.token.length&&crypto.timingSafeEqual(Buffer.from(token),Buffer.from(m.token));}
module.exports={FILE_LIMIT,CHUNK_SIZE,TTL,MAX_FILES,error,begin,same,quota,chunk,verifier,manifest,status,ticket,authorized};
