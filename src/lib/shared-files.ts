import { collaborationCall, SHARED_FILE_MAX_BYTES, type SharedItem } from './shared-resources';
import { cloudAccountIdentity, cloudCall, onWebCloudAccountChange } from './cloud-api';
import { MEDIA_CONTENT_SCHEME, MEDIA_UPLOAD_ATTEMPTS, MediaUploadRetry, mediaAbortError, mediaAwait, mediaContentIdentity,
  mediaPutTimeout, mediaRetryAfter, mediaTimed, checkMediaIntegrity, checkMediaParts, invalidMediaUpload, waitMediaVerification,
  safeMediaFailure, type MediaFailure, type MediaIntegrityState } from './cloud-media-upload';

export const SHARED_FILE_CHUNK_BYTES = 512 * 1024;
type Data = Record<string, unknown>;
type Call = <T>(operation:string,input?:Data,options?:{signal?:AbortSignal;accountId?:string;timeoutMs?:number})=>Promise<T>;
export type FileTransferProgress = {done:number;total:number;direction:'upload'|'download';phase?:'hashing'|'uploading'|'finalizing'|'done'};
type TransferOptions = {token?:string;signal?:AbortSignal;onProgress?:(value:FileTransferProgress)=>void;call?:Call;account?:()=>Promise<string|null>;historyId?:string;
  /** Use object storage when the server offers it. Defaults on, except when a custom `call` is injected. */
  objectStorage?:boolean;
  /** Sends bytes to a signed storage URL. Replaced in tests. */
  put?:(url:string,body:Blob,signal?:AbortSignal)=>Promise<Response>;
  get?:(url:string,signal?:AbortSignal)=>Promise<Response>; initialAccount?:string|null; retry?:MediaUploadRetry; canCleanup?:()=>boolean};
type UploadStatus = {uploadId:string;chunkSize:number;chunkCount:number;missing:number[]};
export type SharedFilePayload = {name:string;mime:string;size:number;blobId:string;sha256?:string;chunkSize?:number;storage?:'r2';fileEncryption?:{keyId:string;plainSize:number}};
/** Largest shared file kept in object storage; a sealed (end-to-end encrypted) file must fit in memory, so it stays at 100 MB. */
export const SHARED_OBJECT_MAX_BYTES=5*1024*1024*1024;
/** A file larger than this is saved straight from its signed link instead of being assembled in memory. */
export const SHARED_MEMORY_DOWNLOAD_BYTES=256*1024*1024;

function notCancelled(signal?:AbortSignal) {
  if(signal?.aborted)throw mediaAbortError(signal);
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
async function session(options:TransferOptions) {
  const account=options.account??cloudAccountIdentity,initial=options.initialAccount!==undefined?options.initialAccount:await account(),retry=options.retry??new MediaUploadRetry();
  const check=async(signal=options.signal)=>{notCancelled(signal);if(await mediaAwait(account(),signal)!==initial)throw new DOMException('账号已切换，已停止传输文件。','AbortError');notCancelled(signal);};
  const raw:Call=options.call??((operation,input,request)=>/^file/.test(operation)
    ?cloudCall('collaboration',{operation,input},request):collaborationCall(operation,input));
  const guarded=async<T>(operation:string,input:Data,request?:{signal?:AbortSignal}):Promise<T>=>{
    const signal=request?.signal??options.signal;
    return retry.run(async()=>{
      await check(signal);
      const result=await mediaTimed(signal,30000,requestSignal=>raw<T>(operation,input,{signal:requestSignal,accountId:initial??undefined}));
      await check(signal);return result;
    },signal);
  };
  return {initial,call:guarded,check,retry,raw,account};
}


interface ObjectUpload extends MediaIntegrityState {payload?:Data}
async function sendWithRetry(url:string,body:Blob,options:TransferOptions,io:Awaited<ReturnType<typeof session>>,renew:()=>Promise<string>):Promise<void> {
  const send=options.put??((target:string,data:Blob,signal?:AbortSignal)=>fetch(target,{method:'PUT',body:data,signal}));
  let renewed=false;
  for(let attempt=0;;attempt++) {
    await io.retry.wait(options.signal);await io.check();
    try {
      const response=await mediaTimed(options.signal,mediaPutTimeout(body.size),signal=>send(url,body,signal));await io.check();
      if(response.ok)return;
      throw Object.assign(Error(`网络不稳定或云存储拒绝上传（HTTP ${response.status}）。再次选择同一个文件会从断点继续。`),{status:response.status,retryAfterMs:mediaRetryAfter(response.headers?.get('Retry-After')??null)});
    } catch(error) {
      await io.check();
      if((error as MediaFailure).status===403&&!renewed&&attempt<MEDIA_UPLOAD_ATTEMPTS-1){renewed=true;url=await renew();continue;}
      io.retry.failed(error,attempt);
    }
  }
}
async function resumeKey(itemId:string,file:File,root:string):Promise<string> {
  const bytes=new TextEncoder().encode(JSON.stringify(['shared',itemId,file.name,file.type||'application/octet-stream',root]));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return 'sh2-'+Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}

/**
 * Send the file straight to object storage. The server only issues signed URLs and
 * checks permissions and quota, so file size no longer depends on it.
 * Strict uploads never silently downgrade to the legacy storage protocol.
 */
async function uploadToObjectStorage(io:Awaited<ReturnType<typeof session>>,scope:Data,file:File,encrypted:{keyId:string}|null,options:TransferOptions):Promise<SharedFilePayload> {
  const total=file.size;let sent=0;
  const report=(phase:FileTransferProgress['phase'],done=sent)=>{notCancelled(options.signal);options.onProgress?.({done:Math.min(done,total),total,direction:'upload',phase});};
  const {root}=await mediaContentIdentity(file,file.name,file.type||'application/octet-stream',done=>report('hashing',done),options.signal);
  const requestKey=await resumeKey(String(scope.itemId),file,root);
  const begun=checkMediaIntegrity(await io.call<ObjectUpload>('fileR2Begin',{...scope,name:file.name,mime:file.type||'application/octet-stream',size:file.size,requestKey,
    contentScheme:MEDIA_CONTENT_SCHEME,contentRoot:root,...(encrypted?{keyId:encrypted.keyId}:{})}),total,root,undefined,true);
  try {
    checkMediaIntegrity(begun,total,root);
    if(begun.status==='pending') {
        checkMediaParts(begun);
        const partSize=begun.partSize!,count=begun.partCount!;
        const have=new Set((begun.completedParts??[]).map(p=>p.partNumber));
        for(const part of begun.completedParts??[])sent+=part.size;
        report('uploading');
        const todo:number[]=[];for(let n=1;n<=count;n++)if(!have.has(n))todo.push(n);
        let next=0,failure:unknown=null;
        const peers=new AbortController(),stop=()=>peers.abort(mediaAbortError(options.signal));
        options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
        const peerOptions={...options,signal:peers.signal},peerIo=await session(peerOptions);
        const urlsFor=async(numbers:number[])=>{
          const result=await peerIo.call<{id?:string;parts:{partNumber:number;url:string}[]}>('fileR2Parts',{...scope,uploadId:begun.id,partNumbers:numbers});
          if(!result||result.id!==undefined&&result.id!==begun.id||!Array.isArray(result.parts)||result.parts.length!==numbers.length)throw invalidMediaUpload();
          const urls=new Map<number,string>();
          for(const part of result.parts){if(!numbers.includes(part.partNumber)||urls.has(part.partNumber)||typeof part.url!=='string'||!part.url)throw invalidMediaUpload();urls.set(part.partNumber,part.url);}
          return urls;
        };
        const worker=async()=>{
            try {
            while(next<todo.length) {
              await peerIo.check();const batch=todo.slice(next,next+4);next+=batch.length;
              const urls=await urlsFor(batch);
              for(const n of batch) {
                await peerIo.check();
                const start=(n-1)*partSize,end=Math.min(total,start+partSize),url=urls.get(n);
                await sendWithRetry(url!,file.slice(start,end),peerOptions,peerIo,async()=>(await urlsFor([n])).get(n)!);
                sent+=end-start;report('uploading');
              }
            }
            } catch(error) { if(failure===null){failure=error;peers.abort();}throw error; }
        };
        try {await Promise.allSettled(Array.from({length:Math.min(3,todo.length)},worker));}
        finally {options.signal?.removeEventListener('abort',stop);}
        if(failure)throw failure;
    }
    report('finalizing',total);
    const first=begun.status==='verifying'?begun:checkMediaIntegrity(await io.call<ObjectUpload>('fileR2Finish',{...scope,uploadId:begun.id}),total,root,begun.id);
    const result=await waitMediaVerification(first,signal=>io.call<ObjectUpload>('fileR2Finish',{...scope,uploadId:begun.id},{signal}),total,root,options.signal);
    if(!result.payload)throw invalidMediaUpload();
    const manifest=checkManifest(result.payload);
    if(manifest.storage!=='r2'||manifest.blobId!==begun.id||manifest.size!==total||manifest.name!==file.name||manifest.mime!==(file.type||'application/octet-stream'))throw invalidMediaUpload();
    await io.check();report('done',total);
    return manifest;
  } catch(error) {
    if(options.canCleanup?.()!==false&&(encrypted||options.signal?.aborted||['integrity_mismatch','verification_unavailable'].includes((error as MediaFailure)?.code??''))){
      try {
        const result=await mediaTimed(undefined,5000,async signal=>{
          if(await mediaAwait(io.account(),signal)!==io.initial||options.canCleanup?.()===false)return null;
          return io.raw<{ok?:boolean;pendingCleanup?:boolean}>('fileR2Abort',{...scope,uploadId:begun.id},{signal,accountId:io.initial??undefined,timeoutMs:5000});
        });
        if(result!==null&&result?.ok!==true)throw invalidMediaUpload();
        if(result?.pendingCleanup)throw Object.assign(new Error('上传已取消，云端清理仍待确认，占用空间暂时保留。请等待清理后重新选择文件。'),{name:options.signal?.aborted?'AbortError':'Error',code:'cleanup_pending'});
      }catch(cleanupError){if((cleanupError as MediaFailure)?.code==='cleanup_pending')throw cleanupError;throw Object.assign(new Error('本地文件传输已停止，云端取消状态尚未确认。请稍后检查共享文件。'),{name:options.signal?.aborted?'AbortError':'Error',code:'abort_unconfirmed'});}
    }
    throw error;
  }
}

/** Each request is bounded; a finished upload stays unpublished until the item is saved. */
export async function uploadSharedFile(itemId:string,file:File,options:TransferOptions={}):Promise<SharedFilePayload> {
  const control=new AbortController(),cancel=()=>control.abort(mediaAbortError(options.signal));
  options.signal?.addEventListener('abort',cancel,{once:true});if(options.signal?.aborted)cancel();
  let accountOff=()=>{},timer:ReturnType<typeof setInterval>|undefined;
  try{
    const account=options.account??cloudAccountIdentity,initial=await mediaAwait(account(),control.signal);
    let accountCurrent=true;
    const changed=()=>{accountCurrent=false;control.abort(new DOMException('账号已切换，已停止传输文件。','AbortError'));};
    accountOff=onWebCloudAccountChange?.(id=>{if(id!==initial)changed();})??(()=>{});
    let checking=false;
    timer=setInterval(()=>{if(checking||control.signal.aborted)return;checking=true;void account().then(id=>{if(id!==initial)changed();},changed).finally(()=>{checking=false;});},250);
    return await uploadSharedFileScoped(itemId,file,{...options,initialAccount:initial,signal:control.signal,retry:new MediaUploadRetry(),canCleanup:()=>accountCurrent});
  }catch(error){throw safeMediaFailure(error);}
  finally{if(timer)clearInterval(timer);accountOff();options.signal?.removeEventListener('abort',cancel);control.abort();}
}
async function uploadSharedFileScoped(itemId:string,file:File,options:TransferOptions):Promise<SharedFilePayload> {
  const objectStorage=(options.objectStorage??!options.call)&&file.size>0;
  const ceiling=objectStorage?SHARED_OBJECT_MAX_BYTES:SHARED_FILE_MAX_BYTES;
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>ceiling)throw Error(objectStorage?'文件不能超过 5 GB。':'文件不能超过 100 MB。');
  const io=await session(options);if(!io.initial)throw Error('请先登录。');
  const original=file;
  const cryptoClient=options.call?null:await (await import('./shared-encryption-bridge')).sharedEncryptionClient();
  const sealed=cryptoClient?await cryptoClient.isEncrypted(itemId,options.token):false;
  // A sealed file is encrypted in memory, so it keeps the 100 MB limit; check before reading it.
  if(sealed&&file.size>SHARED_FILE_MAX_BYTES)throw Error('加密共享文件不能超过 100 MB。');
  const encrypted=cryptoClient&&sealed?await mediaAwait(cryptoClient.encryptFile(itemId,new Uint8Array(await mediaAwait(file.arrayBuffer(),options.signal)),options.token),options.signal):null;
  if(encrypted){
    if(encrypted.bytes.length>SHARED_FILE_MAX_BYTES)throw Error('加密后的文件不能超过 100 MB。');
    file=new File([new Uint8Array(encrypted.bytes)],'encrypted',{type:'application/octet-stream'});
  }
  // The existing encrypted manifest schema also authenticates a whole-ciphertext SHA-256 (encrypted files remain capped at 100 MB).
  const compatibleSha256=objectStorage&&(encrypted||file.size<=64*1024*1024)?await mediaAwait(digest(file),options.signal):undefined;
  await io.check();
  options.onProgress?.({done:0,total:file.size,direction:'upload'});
  const scope={itemId,...(options.token?{token:options.token}:{})};
  if(objectStorage) {
    const stored=await uploadToObjectStorage(io,scope,file,encrypted,options);
    if(stored) {
      const manifest=compatibleSha256?{...stored,sha256:compatibleSha256}:stored;
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
    if(options.canCleanup?.()!==false&&await io.account()===io.initial)await mediaTimed(undefined,5000,signal=>io.raw('fileAbort',{...scope,uploadId:started.uploadId},{signal,accountId:io.initial??undefined})).catch(()=>{});
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
