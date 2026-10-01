import { collaborationCall, SHARED_FILE_MAX_BYTES, type SharedItem } from './shared-resources';
import { cloudAccountIdentity } from './cloud-api';

export const SHARED_FILE_CHUNK_BYTES = 512 * 1024;
type Data = Record<string, unknown>;
type Call = <T>(operation:string,input?:Data)=>Promise<T>;
export type FileTransferProgress = {done:number;total:number;direction:'upload'|'download'};
type TransferOptions = {token?:string;signal?:AbortSignal;onProgress?:(value:FileTransferProgress)=>void;call?:Call;account?:()=>Promise<string|null>;historyId?:string};
type UploadStatus = {uploadId:string;chunkSize:number;chunkCount:number;missing:number[]};
export type SharedFilePayload = {name:string;mime:string;size:number;blobId:string;sha256:string;chunkSize:number;fileEncryption?:{keyId:string;plainSize:number}};

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

/** Each request is bounded; a finished upload stays unpublished until the item is saved. */
export async function uploadSharedFile(itemId:string,file:File,options:TransferOptions={}):Promise<SharedFilePayload> {
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>SHARED_FILE_MAX_BYTES)throw Error('文件不能超过 100 MB。');
  const io=await session(options);if(!io.initial)throw Error('请先登录。');
  const original=file;
  const cryptoClient=options.call?null:await (await import('./shared-encryption-bridge')).sharedEncryptionClient();
  const encrypted=cryptoClient?await cryptoClient.encryptFile(itemId,new Uint8Array(await file.arrayBuffer()),options.token):null;
  if(encrypted){
    if(encrypted.bytes.length>SHARED_FILE_MAX_BYTES)throw Error('加密后的文件不能超过 100 MB。');
    file=new File([new Uint8Array(encrypted.bytes)],'encrypted',{type:'application/octet-stream'});
  }
  options.onProgress?.({done:0,total:file.size,direction:'upload'});
  const sha256=await digest(file);notCancelled(options.signal);
  const scope={itemId,...(options.token?{token:options.token}:{})};
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
