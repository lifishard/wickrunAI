import { collaborationCall, SHARED_FILE_MAX_BYTES, type SharedItem } from './shared-resources';
import { cloudAccountIdentity } from './cloud-api';

export const SHARED_FILE_CHUNK_BYTES = 512 * 1024;
type Data = Record<string, unknown>;
type Call = <T>(operation:string,input?:Data)=>Promise<T>;
export type FileTransferProgress = {done:number;total:number;direction:'upload'|'download'};
type TransferOptions = {token?:string;signal?:AbortSignal;onProgress?:(value:FileTransferProgress)=>void;call?:Call;account?:()=>Promise<string|null>;historyId?:string;
  /** Use object storage when the server offers it. Defaults on, except when a custom `call` is injected. */
  objectStorage?:boolean;
  /** Sends bytes to a signed storage URL. Replaced in tests. */
  put?:(url:string,body:Blob,signal?:AbortSignal)=>Promise<Response>;
  get?:(url:string,signal?:AbortSignal)=>Promise<Response>};
type UploadStatus = {uploadId:string;chunkSize:number;chunkCount:number;missing:number[]};
export type SharedFilePayload = {name:string;mime:string;size:number;blobId:string;sha256?:string;chunkSize?:number;storage?:'r2';fileEncryption?:{keyId:string;plainSize:number}};
/** Largest shared file kept in object storage; a sealed (end-to-end encrypted) file must fit in memory, so it stays at 100 MB. */
export const SHARED_OBJECT_MAX_BYTES=5*1024*1024*1024;
/** A file larger than this is saved straight from its signed link instead of being assembled in memory. */
export const SHARED_MEMORY_DOWNLOAD_BYTES=256*1024*1024;

function notCancelled(signal?:AbortSignal) {
  if(signal?.aborted)throw new DOMException('文件传输已取消。','AbortError');
}
async function digest(blob:Blob):Promise<string> {
  const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
function encoded(bytes:Uint8Array):string {
  let value='';for(let start=0;start<bytes.length;start+=32768)value+=String.fromCharCode(...bytes.subarray(start,start+32768));
  return btoa(value);
}
function decoded(value:unknown):Uint8Array {
  if(typeof value!=='string'||value.length>Math.ceil(SHARED_FILE_CHUNK_BYTES/3)*4||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error('文件分块编码无效。');
  const bytes=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
  if(encoded(bytes)!==value)throw Error('文件分块编码无效。');
  return bytes;
}
const text=(data:Data,key:string)=>typeof data[key]==='string'?data[key] as string:'';
function checkManifest(data:Data):SharedFilePayload {
  if(data.storage==='r2'){
    if(!Number.isSafeInteger(data.size)||Number(data.size)<1||Number(data.size)>SHARED_OBJECT_MAX_BYTES||!text(data,'blobId')||(data.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(text(data,'sha256'))))throw Error('文件传输信息无效。');
    return data as SharedFilePayload;
  }
  if(!Number.isSafeInteger(data.size)||Number(data.size)<0||Number(data.size)>SHARED_FILE_MAX_BYTES||data.chunkSize!==SHARED_FILE_CHUNK_BYTES||!text(data,'blobId')||!/^[a-f0-9]{64}$/.test(text(data,'sha256')))throw Error('文件传输信息无效。');
  return data as SharedFilePayload;
}
async function pause(ms:number,signal?:AbortSignal) {
  notCancelled(signal);
  await new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(new DOMException('文件传输已取消。','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',cancel);resolve();},ms);
    signal?.addEventListener('abort',cancel,{once:true});
  });
}
async function session(options:TransferOptions) {
  const account=options.account??cloudAccountIdentity,initial=await account(),call=options.call??collaborationCall;
  const guarded=async<T>(operation:string,input:Data):Promise<T>=>{
    for(let attempt=0;attempt<3;attempt++) {
      notCancelled(options.signal);if(await account()!==initial)throw Error('账号已切换，已停止传输文件。');
      try {
        const result=await call<T>(operation,input);
        notCancelled(options.signal);if(await account()!==initial)throw Error('账号已切换，已停止传输文件。');
        return result;
      } catch(error) {
        const status=(error as {status?:number}).status;
        if(options.signal?.aborted||attempt===2||status!==undefined&&![429,502,503,504].includes(status)||error instanceof Error&&/账号已切换/.test(error.message))throw error;
        await pause(status===429?2000:500*(attempt+1),options.signal);
      }
    }
    throw Error('文件传输失败。');
  };
  return {initial,call:guarded};
}


type ObjectUpload={id:string;mode:'single'|'multipart';status:string;size:number;url?:string;partSize?:number;partCount?:number;completedParts?:{partNumber:number;size:number}[]};
async function sendWithRetry(url:string,body:Blob,options:TransferOptions):Promise<void> {
  const send=options.put??((target:string,data:Blob,signal?:AbortSignal)=>fetch(target,{method:'PUT',body:data,signal}));
  let last='';
  for(let attempt=0;attempt<4;attempt++) {
    notCancelled(options.signal);
    try {
      const response=await send(url,body,options.signal);
      if(response.ok)return;
      if(response.status<500&&response.status!==429&&response.status!==408)throw Object.assign(Error(`云存储拒绝了上传（HTTP ${response.status}）。请刷新页面后重试。`),{fatal:true});
      last=`HTTP ${response.status}`;
    } catch(error) {
      if((error as {fatal?:boolean}).fatal||options.signal?.aborted)throw error;
      last=error instanceof Error?error.message:String(error);
    }
    await pause(500*2**attempt,options.signal);
  }
  throw Error(`网络不稳定，上传中断（${last}）。再次选择同一个文件会从断点继续。`);
}
async function resumeKey(itemId:string,file:File):Promise<string> {
  const bytes=new TextEncoder().encode(`${itemId}|${file.name}|${file.size}|${file.lastModified}`);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return 'sh-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('').slice(0,40);
}

/**
 * Send the file straight to object storage. The server only issues signed URLs and
 * checks permissions and quota, so file size no longer depends on it.
 * Returns null when this server has no object storage, so the caller can use the old path.
 */
async function uploadToObjectStorage(io:Awaited<ReturnType<typeof session>>,scope:Data,file:File,encrypted:{keyId:string}|null,options:TransferOptions):Promise<SharedFilePayload|null> {
  let begun:ObjectUpload;
  // A plain file can resume where it stopped; a sealed one is re-encrypted each time, so its bytes differ and it must start over.
  const requestKey=encrypted?crypto.randomUUID():await resumeKey(String(scope.itemId),file);
  try {
    begun=await io.call<ObjectUpload>('fileR2Begin',{...scope,name:file.name,mime:file.type||'application/octet-stream',size:file.size,requestKey,...(encrypted?{keyId:encrypted.keyId}:{})});
  } catch(error) {
    if((error as {status?:number}).status===501)return null;
    throw error;
  }
  const total=file.size;let sent=0;
  const report=()=>options.onProgress?.({done:Math.min(sent,total),total,direction:'upload'});
  try {
    if(begun.status!=='ready') {
      if(begun.mode==='single') {
        if(!begun.url)throw Error('文件传输信息无效。');
        await sendWithRetry(begun.url,file,options);sent=total;report();
      } else {
        const partSize=begun.partSize,count=begun.partCount;
        if(!partSize||!count||count!==Math.ceil(total/partSize))throw Error('文件传输信息无效。');
        const have=new Set((begun.completedParts??[]).map(p=>p.partNumber));
        for(const part of begun.completedParts??[])sent+=part.size;
        report();
        const todo:number[]=[];for(let n=1;n<=count;n++)if(!have.has(n))todo.push(n);
        let next=0,failure:unknown=null;
        const worker=async()=>{
          while(!failure&&next<todo.length) {
            const batch=todo.slice(next,next+4);next+=batch.length;
            try {
              const {parts}=await io.call<{parts:{partNumber:number;url:string}[]}>('fileR2Parts',{...scope,uploadId:begun.id,partNumbers:batch});
              const urls=new Map(parts.map(p=>[p.partNumber,p.url]));
              for(const n of batch) {
                if(failure)return;
                const start=(n-1)*partSize,end=Math.min(total,start+partSize),url=urls.get(n);
                if(!url)throw Error('文件传输信息无效。');
                await sendWithRetry(url,file.slice(start,end),options);sent+=end-start;report();
              }
            } catch(error) { failure=error;return; }
          }
        };
        await Promise.all(Array.from({length:Math.min(3,todo.length)},worker));
        if(failure)throw failure;
      }
    }
    const result=await io.call<{payload:Data}>('fileR2Finish',{...scope,uploadId:begun.id});
    const manifest=checkManifest(result.payload);
    if(manifest.size!==total)throw Error('文件校验不一致，请重新上传。');
    return manifest;
  } catch(error) {
    // A cancelled or sealed upload cannot be resumed, so release its reserved space; other failures keep their progress.
    if((encrypted||(error as {name?:string}).name==='AbortError')&&await (options.account??cloudAccountIdentity)()===io.initial)await (options.call??collaborationCall)('fileR2Abort',{...scope,uploadId:begun.id}).catch(()=>{});
    throw error;
  }
}

/** Each request is bounded; a finished upload stays unpublished until the item is saved. */
export async function uploadSharedFile(itemId:string,file:File,options:TransferOptions={}):Promise<SharedFilePayload> {
  const objectStorage=(options.objectStorage??!options.call)&&file.size>0;
  const ceiling=objectStorage?SHARED_OBJECT_MAX_BYTES:SHARED_FILE_MAX_BYTES;
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>ceiling)throw Error(objectStorage?'文件不能超过 5 GB。':'文件不能超过 100 MB。');
  const io=await session(options);if(!io.initial)throw Error('请先登录。');
  const original=file;
  const cryptoClient=options.call?null:await (await import('./shared-encryption-bridge')).sharedEncryptionClient();
  const sealed=cryptoClient?await cryptoClient.isEncrypted(itemId,options.token):false;
  // A sealed file is encrypted in memory, so it keeps the 100 MB limit; check before reading it.
  if(sealed&&file.size>SHARED_FILE_MAX_BYTES)throw Error('加密共享文件不能超过 100 MB。');
  const encrypted=cryptoClient&&sealed?await cryptoClient.encryptFile(itemId,new Uint8Array(await file.arrayBuffer()),options.token):null;
  if(encrypted){
    if(encrypted.bytes.length>SHARED_FILE_MAX_BYTES)throw Error('加密后的文件不能超过 100 MB。');
    file=new File([new Uint8Array(encrypted.bytes)],'encrypted',{type:'application/octet-stream'});
  }
  options.onProgress?.({done:0,total:file.size,direction:'upload'});
  const scope={itemId,...(options.token?{token:options.token}:{})};
  if(objectStorage) {
    const stored=await uploadToObjectStorage(io,scope,file,encrypted,options);
    if(stored) {
      // A hash is only affordable for files that fit comfortably in memory; the server verifies the byte count either way.
      const sha256=encrypted||file.size<=64*1024*1024?await digest(file):undefined;
      const manifest:SharedFilePayload=sha256?{...stored,sha256}:stored;
      options.onProgress?.({done:file.size,total:file.size,direction:'upload'});
      return encrypted?{...manifest,name:original.name,mime:original.type||'application/octet-stream',fileEncryption:{keyId:encrypted.keyId,plainSize:original.size}}:manifest;
    }
  }
  if(file.size>SHARED_FILE_MAX_BYTES)throw Error('文件不能超过 100 MB。');
  const sha256=await digest(file);notCancelled(options.signal);
  const started=await io.call<UploadStatus>('fileBegin',{...scope,name:file.name,mime:file.type||'application/octet-stream',size:file.size,sha256,requestKey:crypto.randomUUID(),...(encrypted?{keyId:encrypted.keyId}:{})});
  const count=Math.ceil(file.size/SHARED_FILE_CHUNK_BYTES);
  if(!started.uploadId||started.chunkSize!==SHARED_FILE_CHUNK_BYTES||started.chunkCount!==count||!Array.isArray(started.missing)||started.missing.some(i=>!Number.isSafeInteger(i)||i<0||i>=count)||new Set(started.missing).size!==started.missing.length)throw Error('文件传输信息无效。');
  let done=file.size-started.missing.reduce((bytes,index)=>bytes+Math.min(SHARED_FILE_CHUNK_BYTES,file.size-index*SHARED_FILE_CHUNK_BYTES),0);
  try {
    for(const index of started.missing.sort((a,b)=>a-b)) {
      notCancelled(options.signal);
      const bytes=new Uint8Array(await file.slice(index*SHARED_FILE_CHUNK_BYTES,(index+1)*SHARED_FILE_CHUNK_BYTES).arrayBuffer());
      await io.call('fileChunk',{...scope,uploadId:started.uploadId,index,data:encoded(bytes)});
      done+=bytes.length;options.onProgress?.({done,total:file.size,direction:'upload'});
    }
    const result=await io.call<{payload:Data}>('fileFinish',{...scope,uploadId:started.uploadId});
    const manifest=checkManifest(result.payload);
    if(manifest.size!==file.size||manifest.sha256!==sha256||manifest.name!==file.name||manifest.mime!==(file.type||'application/octet-stream'))throw Error('文件校验不一致，请重新上传。');
    options.onProgress?.({done:file.size,total:file.size,direction:'upload'});
    return encrypted?{...manifest,name:original.name,mime:original.type||'application/octet-stream',fileEncryption:{keyId:encrypted.keyId,plainSize:original.size}}:manifest;
  } catch(error) {
    // A switched account must not issue cleanup as a different principal.
    if(await (options.account??cloudAccountIdentity)()===io.initial)await (options.call??collaborationCall)('fileAbort',{...scope,uploadId:started.uploadId}).catch(()=>{});
    throw error;
  }
}

/** Current and historical files are read under the item's current server ACL. */
export async function downloadSharedFile(item:SharedItem,options:TransferOptions={}):Promise<Blob> {
  const payload=item.payload;
  if(!payload.blobId) {
    const data=text(payload,'data');
    const bytes=data?Uint8Array.from(atob(data),c=>c.charCodeAt(0)):new TextEncoder().encode(text(payload,'text'));
    if(bytes.length>SHARED_FILE_MAX_BYTES)throw Error('文件不能超过 100 MB。');
    return new Blob([bytes],{type:text(payload,'mime')||'text/plain'});
  }
  if(payload.storage==='r2')return downloadFromObjectStorage(item,options);
  const manifest=checkManifest(payload),io=await session(options),parts:Uint8Array<ArrayBuffer>[]=[];
  options.onProgress?.({done:0,total:manifest.size,direction:'download'});
  for(let index=0;index<Math.ceil(manifest.size/SHARED_FILE_CHUNK_BYTES);index++) {
    const result=await io.call<{index:number;data:string}>('fileReadChunk',{itemId:item.id,blobId:manifest.blobId,index,...(options.token?{token:options.token}:{}),...(options.historyId?{historyId:options.historyId}:{})});
    const bytes=decoded(result.data);
    if(result.index!==index||bytes.length!==Math.min(SHARED_FILE_CHUNK_BYTES,manifest.size-index*SHARED_FILE_CHUNK_BYTES))throw Error('文件分块长度不一致，未保存损坏文件。');
    parts.push(bytes as Uint8Array<ArrayBuffer>);options.onProgress?.({done:Math.min(manifest.size,(index+1)*SHARED_FILE_CHUNK_BYTES),total:manifest.size,direction:'download'});
  }
  const blob=new Blob(parts,{type:manifest.mime||'application/octet-stream'});
  if(blob.size!==manifest.size||await digest(blob)!==manifest.sha256)throw Error('文件校验失败，未保存损坏文件。');
  notCancelled(options.signal);
  if(manifest.fileEncryption){
    const cryptoClient=await (await import('./shared-encryption-bridge')).sharedEncryptionClient();if(!cryptoClient)throw Error('请先登录并解锁此设备。');
    const bytes=await cryptoClient.decryptFile(item,new Uint8Array(await blob.arrayBuffer()));
    if(bytes.length!==manifest.fileEncryption.plainSize)throw Error('加密文件长度校验失败。');
    return new Blob([new Uint8Array(bytes)],{type:manifest.mime||'application/octet-stream'});
  }
  return blob;
}

/** A short-lived link for saving or playing a file kept in object storage. The server issues it only after the item's own access check. */
export async function sharedFileLink(item:SharedItem,options:TransferOptions&{mode?:'inline'|'attachment'}={}):Promise<{url:string;name:string;size:number;mime:string}> {
  const manifest=checkManifest(item.payload);
  if(manifest.storage!=='r2')throw Error('这个文件不在对象存储里。');
  const io=await session(options);
  return io.call('fileR2Url',{itemId:item.id,blobId:manifest.blobId,mode:options.mode??'attachment',...(options.token?{token:options.token}:{}),...(options.historyId?{historyId:options.historyId}:{})});
}

async function downloadFromObjectStorage(item:SharedItem,options:TransferOptions):Promise<Blob> {
  const manifest=checkManifest(item.payload);
  // Only a file that must be decrypted, or that is small, is assembled in memory; the rest is saved from its link.
  if(!manifest.fileEncryption&&manifest.size>SHARED_MEMORY_DOWNLOAD_BYTES)throw Error('文件较大，请直接下载保存，不要在应用内预览。');
  const link=await sharedFileLink(item,options);
  options.onProgress?.({done:0,total:manifest.size,direction:'download'});
  const fetcher=options.get??((url:string,signal?:AbortSignal)=>fetch(url,{signal}));
  const response=await fetcher(link.url,options.signal);
  if(!response.ok)throw Error(`下载失败（HTTP ${response.status}）。链接可能已过期，请重试。`);
  const blob=await response.blob();
  notCancelled(options.signal);
  if(blob.size!==manifest.size)throw Error('文件长度不一致，未保存损坏文件。');
  if(manifest.sha256&&await digest(blob)!==manifest.sha256)throw Error('文件校验失败，未保存损坏文件。');
  options.onProgress?.({done:manifest.size,total:manifest.size,direction:'download'});
  if(manifest.fileEncryption){
    const cryptoClient=await (await import('./shared-encryption-bridge')).sharedEncryptionClient();if(!cryptoClient)throw Error('请先登录并解锁此设备。');
    const bytes=await cryptoClient.decryptFile(item,new Uint8Array(await blob.arrayBuffer()));
    if(bytes.length!==manifest.fileEncryption.plainSize)throw Error('加密文件长度校验失败。');
    return new Blob([new Uint8Array(bytes)],{type:manifest.mime||'application/octet-stream'});
  }
  return new Blob([blob],{type:manifest.mime||'application/octet-stream'});
}
