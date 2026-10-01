import { canonicalCloud, cloudCollections, emptyCloudData, type CloudData, type CloudRow } from './cloud-data';
import { fileReferences, isFileRef, restoreFilePayloads, splitFilePayloads, type SyncFileRef } from '../../server/cloud-file-projection.mjs';
import { decode64,encode64,isSealed,sealBytes,unsealBytes } from './e2ee-crypto';
import type { DeviceVault } from './e2ee-vault';

type RecordRef={collection:string;id:string;sha256:string;size:number};
type Manifest={version:1;records:RecordRef[]};
type Head={revision:number;manifest:RecordRef;chunkSize:number;usedBytes:number;quotaBytes:number;migrationPending?:boolean;encrypted?:boolean};
type Storage={kvGet:(key:string)=>Promise<string|null>;kvSet:(key:string,value:string)=>Promise<void>};
type Call=<T>(input:Record<string,unknown>)=>Promise<T>;
type Snapshot={revision:number;data:CloudData};
const encoder=new TextEncoder(),decoder=()=>new TextDecoder('utf-8',{fatal:true});
const CHUNK=512*1024;
const FILE_PREFIX='wickrun:cloud:file:v1:';
const DEVICE='wickrun:cloud:device:v1';
const key=(row:RecordRef)=>`${row.collection}:${row.sha256}`;
const conflict=(error:unknown)=>(error as {status?:number}).status===409||/409|Cloud data changed/.test(String(error));
export async function cloudDigest(bytes:Uint8Array):Promise<string>{
  const value=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function base64(bytes:Uint8Array):string {
  let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);
}
function fromBase64(text:string):Uint8Array {
  const raw=atob(text),result=Uint8Array.from(raw,char=>char.charCodeAt(0));
  if(base64(result)!==text)throw Error('Invalid sync chunk.');return result;
}
function checkedManifest(value:unknown):Manifest {
  const result=value as Manifest;
  if(result?.version!==1||!Array.isArray(result.records)||result.records.length>38001)throw Error('Invalid sync directory.');
  const ids=new Set<string>();
  for(const row of result.records){
    if(!row||![...cloudCollections,'preferences'].includes(row.collection)||typeof row.id!=='string'||!row.id||!isFileRef(row)||row.size>128*1024*1024)throw Error('Invalid sync record.');
    const id=JSON.stringify([row.collection,row.id]);if(ids.has(id))throw Error('Duplicate sync record.');ids.add(id);
  }
  if(result.records.filter(row=>row.collection==='preferences'&&row.id==='root').length!==1)throw Error('Sync preferences are missing.');
  return result;
}

/** Text records are durable; files use a separate seven-day delivery cache. */
export class CloudSyncClient {
  private head?:Head;
  private manifest?:Manifest;
  private records=new Map<string,unknown>();
  private knownFiles=new Set<string>();
  private receipts=new Map<string,SyncFileRef>();
  private deviceId?:string;
  private lastHeartbeat=0;
  private fileWarning='';
  private missing=0;
  constructor(private storage:Storage,private call:Call,private vault?:DeviceVault){}
  private encryptionKey?:string;
  private async encryption(){
    if(!this.vault)return;
    const state=await this.vault.status();
    if(state.enabled&&!this.vault.keys)throw Error('此设备尚未解锁。请在账号设置中由已解锁设备批准，或输入恢复密钥。');
    this.encryptionKey=this.vault.keys?.dataKey;
  }
  private context(collection:string,id:string){return JSON.stringify(['wickrun-sync-v1',this.vault?.accountId,collection,id]);}
  get needsEncryption(){return !!this.encryptionKey&&!this.head?.encrypted;}
  get pendingFiles(){return this.missing;}
  get warning(){return this.fileWarning;}
  private async device(){
    if(!this.deviceId){const saved=await this.storage.kvGet(DEVICE);this.deviceId=saved&&/^[\w-]{8,100}$/.test(saved)?saved:crypto.randomUUID();if(this.deviceId!==saved)await this.storage.kvSet(DEVICE,this.deviceId);}
    return this.deviceId;
  }
  async prepare(data:CloudData):Promise<CloudData>{
    await this.encryption();
    const projected=await splitFilePayloads(data,cloudDigest);
    for(const [sha,{bytes}]of projected.files)if(!this.knownFiles.has(sha)){
      // A server receipt is sent only after this durable local write succeeds.
      await this.storage.kvSet(FILE_PREFIX+sha,decoder().decode(bytes));this.knownFiles.add(sha);
    }
    if(!this.encryptionKey)return projected.data;
    const replacements=new Map<string,SyncFileRef>();
    for(const ref of fileReferences(projected.data)){
      if(ref.encrypted)continue;
      const bytes=await this.cachedFile(ref);
      if(bytes&&isSealed(bytes))continue;
      if(!bytes)throw Error('启用加密前需要取回旧附件。请让来源设备上线并完成文件同步。');
      const mappingKey='wickrun:e2ee:file-map:'+ref.sha256,saved=await this.storage.kvGet(mappingKey);
      let encryptedRef:SyncFileRef|undefined=saved?JSON.parse(saved):undefined;
      if(!encryptedRef||!isFileRef(encryptedRef)||!await this.cachedFile(encryptedRef)){
        const sealed=await sealBytes(this.encryptionKey,bytes,this.context('file','payload'));
        encryptedRef={sha256:await cloudDigest(sealed),size:sealed.length,encrypted:true};
        await this.storage.kvSet(FILE_PREFIX+encryptedRef.sha256,'WRSEALED:'+encode64(sealed));this.knownFiles.add(encryptedRef.sha256);
        await this.storage.kvSet(mappingKey,JSON.stringify(encryptedRef));
      }
      replacements.set(ref.sha256,encryptedRef);
    }
    const replace=(value:unknown):unknown=>{
      if(Array.isArray(value))return value.map(replace);
      if(!value||typeof value!=='object')return value;
      return Object.fromEntries(Object.entries(value).map(([name,child])=>[name,name==='cloudFile'&&isFileRef(child)?replacements.get((child as SyncFileRef).sha256)??child:replace(child)]));
    };
    return replace(projected.data) as CloudData;
  }
  private async cachedFile(ref:SyncFileRef):Promise<Uint8Array|null>{
    const raw=await this.storage.kvGet(FILE_PREFIX+ref.sha256);if(raw===null)return null;
    const bytes=raw.startsWith('WRSEALED:')?decode64(raw.slice(9)):encoder.encode(raw);if(bytes.length!==ref.size||await cloudDigest(bytes)!==ref.sha256)throw Error('本机附件校验失败；原始文件保留，请重新导入该附件。');
    this.knownFiles.add(ref.sha256);
    return bytes;
  }
  private async uploadFile(ref:SyncFileRef){
    const bytes=await this.cachedFile(ref);if(!bytes)return;
    const deviceId=await this.device(),input={deviceId,ref};
    const result=await this.call<{missing:number[];chunkSize:number}>({op:'file:begin',...input});
    if(result.chunkSize!==CHUNK)throw Error('Unsupported file sync chunk size.');
    for(const index of result.missing)await this.call({op:'file:chunk',...input,index,data:base64(bytes.subarray(index*CHUNK,(index+1)*CHUNK))});
    await this.call({op:'file:finish',...input});
    this.receipts.set(ref.sha256,ref);
  }
  async heartbeat(force=false){
    if(!force&&Date.now()-this.lastHeartbeat<15000)return;
    const deviceId=await this.device();
    const result=await this.call<{requests:SyncFileRef[]}>({op:'file:device',deviceId});this.lastHeartbeat=Date.now();
    const refs=new Map(result.requests.filter(isFileRef).map(ref=>[ref.sha256,ref]));
    for(const ref of refs.values()){
      try{await this.uploadFile(ref);}catch(error){this.fileWarning=String((error as Error).message||error);}
    }
    await this.ackFiles();
  }
  private async seed(data?:CloudData){
    if(!data)return;
    for(const [collection,values]of Object.entries(data)){
      const rows=collection==='preferences'?[{id:'root',value:values}]:Array.isArray(values)?values.map(value=>({id:value.id,value})):[];
      for(const {id,value}of rows){const bytes=encoder.encode(canonicalCloud(value)),sha256=await cloudDigest(bytes);this.records.set(`${collection}:${sha256}`,value);}
    }
  }
  private async download(ref:RecordRef,revision:number){
    const cached=this.records.get(key(ref));if(cached!==undefined)return cached;
    if(!isFileRef(ref)||ref.size>128*1024*1024)throw Error('Invalid sync record size.');
    const bytes=new Uint8Array(ref.size);
    for(let index=0;index<Math.ceil(ref.size/CHUNK);index++){
      const result=await this.call<{data:string}>({op:'read',collection:ref.collection,sha256:ref.sha256,revision,index});
      const part=fromBase64(result.data);if(part.length!==Math.min(CHUNK,ref.size-index*CHUNK))throw Error('Incomplete sync record.');bytes.set(part,index*CHUNK);
    }
    if(await cloudDigest(bytes)!==ref.sha256)throw Error('Sync record checksum did not match.');
    if(isSealed(bytes)&&!this.encryptionKey)throw Error('请先解锁端到端加密。');
    const plain=isSealed(bytes)?await unsealBytes(this.encryptionKey!,bytes,this.context(ref.collection,ref.id)):bytes;
    const value=JSON.parse(decoder().decode(plain));this.records.set(key(ref),value);return value;
  }
  async read(seed?:CloudData,butlerOnly=false):Promise<Snapshot>{
    await this.encryption();
    await this.seed(seed&&butlerOnly?{...emptyCloudData(),butler:seed.butler??[],preferences:seed.preferences}:seed);await this.heartbeat();
    for(let attempt=0;;attempt++)try{
      const head=await this.call<Head>({op:'manifest'});
      if(head.encrypted&&!this.encryptionKey)throw Error('请先解锁端到端加密。');
      if(head.chunkSize!==CHUNK||!Number.isSafeInteger(head.revision))throw Error('Unsupported sync directory.');
      const manifest=checkedManifest(await this.download(head.manifest,head.revision)),data=emptyCloudData();
      for(const ref of manifest.records){
        if(butlerOnly&&!['butler','preferences'].includes(ref.collection))continue;
        const value=await this.download(ref,head.revision);
        if(ref.collection==='preferences')data.preferences=value as Record<string,unknown>;
        else{if((value as CloudRow)?.id!==ref.id)throw Error('Sync record identity did not match.');(data[ref.collection as keyof CloudData] as CloudRow[]).push(value as CloudRow);}
      }
      this.head=head;this.manifest=manifest;
      const used=new Set([key(head.manifest),...manifest.records.map(key)]);for(const id of this.records.keys())if(!used.has(id))this.records.delete(id);
      // Migration can include an old cloud-only attachment. Cache it before a
      // merge can remove its directory entry, and keep the server recovery copy
      // until the subsequent durable workspace apply is confirmed.
      if(head.migrationPending&&!butlerOnly)await this.restore(data);
      return {revision:head.revision,data};
    }catch(error){if(attempt>=2||!conflict(error))throw error;}
  }
  private async upload(collection:string,id:string,value:unknown):Promise<RecordRef>{
    const existing=this.manifest?.records.find(row=>row.collection===collection&&row.id===id);
    if(existing&&!this.needsEncryption&&canonicalCloud(this.records.get(key(existing)))===canonicalCloud(value))return existing;
    const plain=encoder.encode(canonicalCloud(value)),bytes=this.encryptionKey&&collection!=='manifest'?await sealBytes(this.encryptionKey,plain,this.context(collection,id)):plain,ref={collection,id,sha256:await cloudDigest(bytes),size:bytes.length};
    if(this.manifest?.records.some(row=>row.collection===collection&&row.id===id&&row.sha256===ref.sha256))return ref;
    const result=await this.call<{missing:number[];chunkSize:number}>({op:'begin',...ref});
    if(result.chunkSize!==CHUNK)throw Error('Unsupported sync chunk size.');
    for(const index of result.missing)await this.call({op:'chunk',...ref,index,data:base64(bytes.subarray(index*CHUNK,(index+1)*CHUNK))});
    await this.call({op:'finish',...ref});this.records.set(key(ref),value);return ref;
  }
  async write(revision:number,data:CloudData,butlerOnly=false):Promise<Snapshot>{
    if(!this.head||this.head.revision!==revision||!this.manifest)throw Error('Cloud data changed on another device. Sync again before saving.');
    if(butlerOnly&&this.needsEncryption)throw Error('请先完成一次完整同步以加密账号内容。');
    if(this.encryptionKey&&!butlerOnly)data=await this.prepare(await this.restore(data));
    this.fileWarning='';
    const existingFiles=new Set<string>();
    for(const ref of this.manifest.records)for(const file of fileReferences(this.records.get(key(ref))))existingFiles.add(file.sha256);
    if(!butlerOnly)for(const ref of fileReferences(data))if(!existingFiles.has(ref.sha256)){
      try{await this.uploadFile(ref);}catch(error){this.fileWarning=String((error as Error).message||error);}
    }
    const records:RecordRef[]=butlerOnly?this.manifest.records.filter(row=>!['butler','preferences'].includes(row.collection)):[];
    records.push(await this.upload('preferences','root',data.preferences));
    for(const collection of cloudCollections)if(!butlerOnly||collection==='butler')for(const value of data[collection]??[])records.push(await this.upload(collection,value.id,value));
    records.sort((a,b)=>{const left=JSON.stringify([a.collection,a.id]),right=JSON.stringify([b.collection,b.id]);return left<right?-1:left>right?1:0;});
    const manifest:Manifest={version:1,records},ref=await this.upload('manifest','root',manifest);
    const head=await this.call<Head>({op:'commit',revision,manifestSha256:ref.sha256});
    this.head=head;this.manifest=manifest;return {revision:head.revision,data};
  }
  async restore(data:CloudData):Promise<CloudData>{
    const payloads=new Map<string,{text?:string;dataUrl?:string}>();this.missing=0;
    for(const ref of fileReferences(data)){
      let bytes=await this.cachedFile(ref);
      if(!bytes){
        try{
          const deviceId=await this.device(),input={deviceId,ref};
          const status=await this.call<{available:boolean;chunkSize?:number}>({op:'file:need',...input});
          if(!status.available){this.missing++;continue;}
          if(status.chunkSize!==CHUNK||ref.size>110*1024*1024)throw Error('Invalid sync file size.');
          bytes=new Uint8Array(ref.size);
          for(let index=0;index<Math.ceil(ref.size/CHUNK);index++){
            const result=await this.call<{data:string}>({op:'file:read',...input,index}),part=fromBase64(result.data);
            if(part.length!==Math.min(CHUNK,ref.size-index*CHUNK))throw Error('Incomplete file sync.');bytes.set(part,index*CHUNK);
          }
          if(await cloudDigest(bytes)!==ref.sha256)throw Error('Sync file checksum did not match.');
          const plain=isSealed(bytes)?await unsealBytes(this.encryptionKey!,bytes,this.context('file','payload')):bytes;
          const raw=decoder().decode(plain),payload=JSON.parse(raw);
          if(!payload||Array.isArray(payload)||Object.keys(payload).some(key=>!['text','dataUrl'].includes(key)||typeof payload[key]!=='string'))throw Error('Invalid sync file payload.');
          await this.storage.kvSet(FILE_PREFIX+ref.sha256,isSealed(bytes)?'WRSEALED:'+encode64(bytes):raw);this.knownFiles.add(ref.sha256);
        }catch(error){this.fileWarning=String((error as Error).message||error);this.missing++;continue;}
      }
      const plain=isSealed(bytes)?await unsealBytes(this.encryptionKey!,bytes,this.context('file','payload')):bytes;
      if(isSealed(bytes))await this.storage.kvSet('wickrun:e2ee:file-map:'+await cloudDigest(plain),JSON.stringify({...ref,encrypted:true}));
      payloads.set(ref.sha256,JSON.parse(decoder().decode(plain)));this.receipts.set(ref.sha256,ref);
    }
    return restoreFilePayloads(data,payloads);
  }
  private async ackFiles(){
    if(!this.receipts.size)return;const deviceId=await this.device();
    for(const [sha,ref]of this.receipts){try{await this.call({op:'file:ack',deviceId,ref});this.receipts.delete(sha);}catch{/* Durable local copy exists; retry receipt after reconnection. */}}
  }
  async applied(revision:number){
    if(this.head?.migrationPending)try{const result=await this.call<{migrationPending:boolean}>({op:'adopt',revision,receivedFiles:[...this.knownFiles]});this.head.migrationPending=result.migrationPending;}catch{/* Keep the migration recovery copy until a later confirmed apply. */}
    await this.ackFiles();
  }
}
