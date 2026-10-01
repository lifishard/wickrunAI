import { agreementKey, decode64, randomKey, sealBytes, sealJSON, signValue, unsealBytes, unsealJSON, verifyValue, type PublicIdentity, type VaultKeys } from './e2ee-crypto';
import type { DeviceVault, VaultStorage } from './e2ee-vault';
import { assertPublicCollaboration } from './shared-resources';

type Data=Record<string,any>;
type Call=<T=Data>(operation:string,input?:Data)=>Promise<T>;
export type SharedKeyManifest={version:1;keyId:string;audienceHash:string;writerId:string;writerIdentity:PublicIdentity;envelopes:{accountId:string;identity:PublicIdentity;envelope:string;signature:string}[]};
type Bundle={version:1;keys:Record<string,string>};
type Audience={hash:string;participants:{accountId:string;identity:PublicIdentity|null}[];encryption:SharedKeyManifest|null;revision:number|null};
const keyContext=(itemId:string,keyId:string,accountId:string,audience:string)=>`shared-key:${itemId}:${keyId}:${accountId}:${audience}`;
const keyProof=(itemId:string,manifest:Data,recipient:Data)=>['shared-key',itemId,manifest.keyId,manifest.audienceHash,manifest.writerId,recipient.accountId,recipient.identity.sign,recipient.identity.agree,recipient.envelope];
const privateEpoch='00000000-0000-0000-0000-000000000000';
const epoch=(value:string)=>/^WRC1\.([a-f0-9-]{36})\./.exec(value)?.[1];
const msgMetadata=(m:Data)=>[m.id,m.role,m.authorId??null,m.model??null,m.replyTo??null,m.groupId??null];
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const sameIdentity=(a:PublicIdentity|null,b:PublicIdentity)=>a?.sign===b.sign&&a?.agree===b.agree;
const locked=()=>Error('此共享内容已端到端加密。请在账号与同步中解锁本设备；新成员需要已有成员的已解锁设备分发密钥。');

/** Keys live only in approved local vaults. The service receives signed recipient envelopes. */
export class SharedEncryptionClient {
  private bundles=new Map<string,Bundle>();
  private cipherCache=new Map<string,string>();
  private loading:Promise<VaultKeys>|null=null;
  constructor(private raw:Call,private vault:DeviceVault,private storage:VaultStorage){}
  private async keys():Promise<VaultKeys>{
    if(this.vault.keys)return this.vault.keys;
    if(!this.loading)this.loading=(async()=>{await this.vault.status();if(!this.vault.keys)throw locked();return this.vault.keys;})().finally(()=>{this.loading=null;});
    return this.loading;
  }
  private async pin(accountId:string,identity:PublicIdentity){
    const key=`wickrun:e2ee:peer:${this.vault.accountId}:${accountId}`,saved=await this.storage.kvGet(key);
    if(saved&&!sameIdentity(JSON.parse(saved),identity))throw Error('成员的加密身份已改变，已停止发送。请先核实该成员的身份。');
    if(!saved)await this.storage.kvSet(key,JSON.stringify(identity));
  }
  private async guardItem(item:Data){
    const key=`wickrun:e2ee:shared-mode:${this.vault.accountId}:${item.id}`;
    if(item.encryption){if(await this.storage.kvGet(key)!=='encrypted')await this.storage.kvSet(key,'encrypted');}
    else if(await this.storage.kvGet(key)==='encrypted')throw Error('此共享内容的加密标记已丢失，已停止读取和发送。');
  }
  private async openBundle(itemId:string,manifest:SharedKeyManifest):Promise<Bundle>{
    const mine=await this.keys(),recipient=manifest.envelopes.find(e=>e.accountId===mine.accountId);
    if(!recipient||!sameIdentity(recipient.identity,mine.publicIdentity))throw locked();
    await this.pin(manifest.writerId,manifest.writerIdentity);
    if(!await verifyValue(manifest.writerIdentity.sign,keyProof(itemId,manifest,recipient),recipient.signature))throw Error('共享密钥签名校验失败。');
    const cacheId=JSON.stringify([itemId,manifest.keyId,recipient.envelope,recipient.signature]);
    const cached=this.bundles.get(cacheId);if(cached)return cached;
    const context=keyContext(itemId,manifest.keyId,mine.accountId,manifest.audienceHash);
    const wrapping=await agreementKey(mine.privateIdentity.agree,manifest.writerIdentity.agree,context);
    const bundle=await unsealJSON<Bundle>(wrapping,recipient.envelope,context);
    if(bundle.version!==1||!bundle.keys?.[manifest.keyId]||Object.keys(bundle.keys).length>512||Object.values(bundle.keys).some(k=>typeof k!=='string'||decode64(k).length!==32))throw Error('共享密钥格式无效。');
    if(this.bundles.size>200)this.bundles.clear();this.bundles.set(cacheId,bundle);return bundle;
  }
  private async distribute(itemId:string,audience:Audience,old?:Bundle){
    const mine=await this.keys(),keyId=crypto.randomUUID(),bundle:Bundle={version:1,keys:{...old?.keys,[keyId]:randomKey()}};
    if(Object.keys(bundle.keys).length>512)throw Error('此共享内容的密钥版本过多，请建立新的共享副本。');
    if(!audience.participants.some(p=>p.accountId===mine.accountId&&sameIdentity(p.identity,mine.publicIdentity)))throw Error('当前账号不在共享内容的加密成员中。');
    const manifest:SharedKeyManifest={version:1,keyId,audienceHash:audience.hash,writerId:mine.accountId,writerIdentity:mine.publicIdentity,envelopes:[]};
    for(const participant of audience.participants){
      if(!participant.identity)continue;
      await this.pin(participant.accountId,participant.identity);
      const context=keyContext(itemId,keyId,participant.accountId,audience.hash),key=await agreementKey(mine.privateIdentity.agree,participant.identity.agree,context);
      const envelope={accountId:participant.accountId,identity:participant.identity,envelope:await sealJSON(key,bundle,context),signature:''};
      envelope.signature=await signValue(mine.privateIdentity.sign,keyProof(itemId,manifest,envelope));manifest.envelopes.push(envelope);
    }
    return {manifest,bundle};
  }
  private async seal(itemId:string,path:string,value:unknown,manifest:SharedKeyManifest,bundle:Bundle,metadata?:unknown){
    const plain=JSON.stringify([itemId,path,value,metadata,manifest.keyId]),cached=this.cipherCache.get(plain);if(cached)return cached;
    const sealed=`WRC1.${manifest.keyId}.${await sealJSON(bundle.keys[manifest.keyId],{value,...(metadata?{metadata}:{})},`shared:${itemId}:${path}:${manifest.keyId}`)}`;
    if(this.cipherCache.size>2000)this.cipherCache.clear();this.cipherCache.set(plain,sealed);return sealed;
  }
  private async unseal(itemId:string,path:string,value:string,bundle:Bundle,metadata?:unknown):Promise<any>{
    const keyId=epoch(value);if(!keyId||!bundle.keys[keyId])throw locked();
    const data=await unsealJSON<Data>(bundle.keys[keyId],value.split('.')[2],`shared:${itemId}:${path}:${keyId}`);
    if(metadata&&!same(metadata,data.metadata))throw Error('加密消息的作者或引用信息不匹配。');return data.value;
  }
  private async encodePayload(item:Data,payload:Data,bundle:Bundle){
    assertPublicCollaboration(payload);
    if(item.kind==='conversation'){
      const mine=await this.keys();
      return {...payload,...(payload.instructions!==undefined?{instructions:await this.seal(item.id,'instructions',payload.instructions,item.encryption,bundle)}:{}),messages:await Promise.all((payload.messages??[]).map(async(m:Data)=>{
        const stamped={...m,authorId:m.authorId??mine.accountId};return {...stamped,content:await this.seal(item.id,`message:${m.id}`,m.content,item.encryption,bundle,msgMetadata(stamped))};
      }))};
    }
    return {ciphertext:await this.seal(item.id,'payload',payload,item.encryption,bundle),...(item.kind==='file'&&payload.blobId?{blobId:payload.blobId,sha256:payload.sha256,size:payload.size,chunkSize:payload.chunkSize,name:'encrypted',mime:'application/octet-stream'}:{}),...(item.kind==='workflow'?{agentIds:(payload.agents??[]).map((a:Data)=>a.id)}:{})};
  }
  private async decodePayload(item:Data,payload:Data,bundle:Bundle){
    if(item.kind==='conversation')return {...payload,...(payload.instructions!==undefined?{instructions:await this.unseal(item.id,'instructions',payload.instructions,bundle)}:{}),messages:await Promise.all((payload.messages??[]).map(async(m:Data)=>({...m,content:await this.unseal(item.id,`message:${m.id}`,m.content,bundle,msgMetadata(m))})))};
    const decoded=await this.unseal(item.id,'payload',payload.ciphertext,bundle);
    if(item.kind==='file'&&decoded.blobId&&['blobId','sha256','size','chunkSize'].some(k=>decoded[k]!==payload[k]))throw Error('加密文件信息不匹配。');
    if(item.kind==='workflow'&&!same((decoded.agents??[]).map((a:Data)=>a.id),payload.agentIds))throw Error('加密工作流的成员信息不匹配。');
    return decoded;
  }
  private async decodeItem(item:Data):Promise<Data>{
    if(!item)return item;await this.guardItem(item);if(!item.encryption)return item;
    const bundle=await this.openBundle(item.id,item.encryption);
    return {...item,title:await this.unseal(item.id,'title',item.title,bundle),payload:await this.decodePayload(item,item.payload,bundle)};
  }
  private async privateBundle(){const mine=await this.keys();return {version:1 as const,keys:{[privateEpoch]:mine.dataKey}};}
  private async decodeComment(item:Data,comment:Data,bundle:Bundle){
    const keys=comment.visibility==='private'?await this.privateBundle():bundle;
    const metadata=[comment.actorId??comment.authorId,comment.visibility];
    return {...comment,body:await this.unseal(item.id,`comment:${comment.id}`,comment.body,keys,metadata),anchor:{...comment.anchor,...(comment.anchor?.quote!==undefined?{quote:await this.unseal(item.id,`quote:${comment.id}`,comment.anchor.quote,keys,metadata)}:{})}};
  }
  private async decodeView(result:Data){
    if(!result.item)return result;
    const item=result.item,bundle=item.encryption?await this.openBundle(item.id,item.encryption):null;
    return {...result,item:await this.decodeItem(item),...(bundle&&result.comments?{comments:await Promise.all(result.comments.map((c:Data)=>this.decodeComment(item,c,bundle)))}:{}),...(result.children?{children:await Promise.all(result.children.map(async(child:Data)=>{try{return await this.decodeItem(child);}catch(error){return {...child,title:'已加密的共享内容',payload:{},encryptionLocked:true,encryptionError:error instanceof Error?error.message:String(error)};}}))}:{})};
  }
  private async fresh(itemId:string,token?:string,rotate=true){
    let view=await this.raw<Data>('get',{itemId,...(token?{token}:{})});
    await this.guardItem(view.item);
    if(rotate&&view.permissions?.edit&&view.item.encryption){
      const audience=await this.raw<Audience>('keyAudience',{itemId,...(token?{token}:{})});
      if(audience.hash!==view.item.encryption.audienceHash){
        const old=await this.openBundle(itemId,view.item.encryption),next=await this.distribute(itemId,audience,old);
        view=await this.raw<Data>('rotateKey',{itemId,...(token?{token}:{}),expectedRevision:view.item.revision,encryption:next.manifest});
      }
    }
    // Children inherit ACL membership but have independent content keys.
    if(rotate&&view.permissions?.edit&&view.children?.length)view.children=await Promise.all(view.children.map(async(child:Data)=>child.encryption?(await this.fresh(child.id,token)).item:child));
    return view;
  }
  async call<T>(operation:string,input:Data={}):Promise<T>{
    if(operation==='create'&&input.encrypt!==false){
      await this.keys();
      const audience=await this.raw<Audience>('keyAudience',{spaceId:input.spaceId,parentId:input.parentId,parentToken:input.parentToken});
      const id=crypto.randomUUID(),{manifest,bundle}=await this.distribute(id,audience),item:Data={...input,id,encryption:manifest};
      const {encrypt:_,...wire}=item;
      const result=await this.raw<Data>(operation,{...wire,title:await this.seal(id,'title',input.title,manifest,bundle),payload:await this.encodePayload(item,input.payload,bundle)});
      return await this.decodeView(result) as T;
    }
    if(operation==='state'){
      const result=await this.raw<Data>(operation,input);
      result.connections=await Promise.all((result.connections??[]).map(async(c:Data)=>{
        if(!epoch(c.purpose))return c;const target=result.items.find((i:Data)=>i.id===c.targetItemId);
        try{const bundle=await this.openBundle(target.id,target.encryption);return {...c,purpose:await this.unseal(target.id,`connection:${c.sourceItemId}:${c.targetItemId}`,c.purpose,bundle)};}
        catch{return {...c,purpose:'已加密的工作交接'};}
      }));
      result.items=await Promise.all(result.items.map(async(item:Data)=>{try{return await this.decodeItem(item);}catch(error){return {...item,title:'已加密的共享内容',payload:{},encryptionLocked:true,encryptionError:error instanceof Error?error.message:String(error)};}}));
      return result as T;
    }
    if(operation==='get')return await this.decodeView(await this.fresh(input.itemId,input.token)) as T;
    if(operation==='openLink')return await this.decodeView(await this.raw<Data>(operation,input)) as T;
    if(operation==='offerConnection'){
      const source=(await this.fresh(input.sourceItemId,input.sourceToken)).item,target=(await this.fresh(input.targetItemId,input.targetToken)).item;
      if(Boolean(source.encryption)!==Boolean(target.encryption))throw Error('交接两端需要使用相同的加密方式。');
      if(!target.encryption)return this.raw<T>(operation,input);
      const bundle=await this.openBundle(target.id,target.encryption);
      const result=await this.raw<Data>(operation,{...input,purpose:await this.seal(target.id,`connection:${source.id}:${target.id}`,input.purpose,target.encryption,bundle)});
      result.connection.purpose=input.purpose;return result as T;
    }
    if(operation==='sendHandoff'){
      const state=await this.raw<Data>('state'),connection=state.connections.find((c:Data)=>c.id===input.connectionId),target=state.items.find((i:Data)=>i.id===connection?.targetItemId);
      if(!target)throw Error('接收工作区已不可访问。');await this.guardItem(target);
      const source=state.items.find((i:Data)=>i.id===connection?.sourceItemId);if(source)await this.guardItem(source);
      if(Boolean(source?.encryption)!==Boolean(target.encryption))throw Error('交接两端需要使用相同的加密方式。');
      if(!target.encryption)return this.raw<T>(operation,input);
      assertPublicCollaboration(input.payload);
      const bundle=await this.openBundle(target.id,target.encryption),mine=await this.keys(),resourceIds=(input.payload.artifacts??[]).filter((a:Data)=>a.resourceId).map((a:Data)=>a.resourceId);
      const ciphertext=await this.seal(target.id,`handoff:${connection.id}:${input.requestKey}`,input.payload,target.encryption,bundle,[mine.accountId]);
      const result=await this.raw<Data>(operation,{...input,payload:{ciphertext,resourceIds}});result.receipt.payload=input.payload;return result as T;
    }
    if(operation==='listHandoffs'){
      const result=await this.raw<Data>(operation,input),target=result.target;if(target)await this.guardItem(target);if(!target?.encryption)return result as T;
      const bundle=await this.openBundle(target.id,target.encryption);
      result.receipts=await Promise.all(result.receipts.map(async(r:Data)=>{
        const payload=await this.unseal(target.id,`handoff:${r.connectionId}:${r.requestKey}`,r.payload.ciphertext,bundle,[r.actorId]);
        if(!same((payload.artifacts??[]).filter((a:Data)=>a.resourceId).map((a:Data)=>a.resourceId),r.payload.resourceIds))throw Error('加密交接文件引用不匹配。');return {...r,payload};
      }));result.target=await this.decodeItem(target);return result as T;
    }
    if(operation==='getHistory'){
      const view=await this.fresh(input.itemId,input.token,false),result=await this.raw<Data>(operation,input),item=view.item;if(!item.encryption)return result as T;
      const bundle=await this.openBundle(item.id,item.encryption);
      result.history=await Promise.all(result.history.map(async(h:Data)=>{
        const next:Data={...h,title:await this.unseal(item.id,'title',h.title,bundle),payload:await this.decodePayload(item,h.payload,bundle)};
        for(const key of ['before','after'])if(h[key]?.payload)next[key]={...h[key],title:await this.unseal(item.id,'title',h[key].title,bundle),payload:await this.decodePayload(item,h[key].payload,bundle)};
        else if(typeof h[key]==='string'&&epoch(h[key])&&h.messageId){const data=await this.unseal(item.id,`message:${h.messageId}`,h[key],bundle);next[key]=data;}
        if(h.comment)next.comment=await this.decodeComment(item,{...h.comment,id:h.commentId,actorId:h.actorId},bundle);
        return next;
      }));return result as T;
    }
    if(['update','postMessage','comment','editComment','setGroups','setPolicy','revoke'].includes(operation)){
      const view=await this.fresh(input.itemId,input.token),item=view.item;
      if(!item.encryption){const result=await this.raw<Data>(operation,input);if(['setGroups','setPolicy','revoke'].includes(operation))return await this.decodeView({...result,...await this.fresh(item.id,input.token)}) as T;return result as T;}
      const bundle=await this.openBundle(item.id,item.encryption),mine=await this.keys();let wire={...input};
      // Rotation is our own metadata-only write. Preserve conflict detection for actual user edits.
      if(wire.expectedRevision!==undefined){const prior=await this.raw<Audience>('keyAudience',{itemId:item.id,token:input.token});if(prior.revision!==item.revision)throw Error('共享内容已改变，请重新载入后保存。');if(input.expectedRevision>item.revision)throw Error('共享版本无效。');}
      if(operation==='update'){
        // Never overwrite another participant's update merely because we fetched newer keys.
        if(input.expectedRevision!==item.revision)throw Error('共享内容已改变，请重新载入后保存。');
        wire={...wire,title:await this.seal(item.id,'title',input.title??(await this.decodeItem(item)).title,item.encryption,bundle),payload:await this.encodePayload(item,input.payload,bundle)};
      }
      if(operation==='postMessage'){
        const existing=item.payload.messages.find((m:Data)=>m.id===input.message.id);
        if(existing&&existing.authorId===mine.accountId){
          const plain=await this.unseal(item.id,`message:${existing.id}`,existing.content,bundle,msgMetadata(existing));
          if(plain===input.message.content&&same(msgMetadata(existing),msgMetadata({...input.message,authorId:mine.accountId})))return await this.decodeView(view) as T;
        }
        const m={...input.message,authorId:mine.accountId};wire.message={...input.message,content:await this.seal(item.id,`message:${m.id}`,m.content,item.encryption,bundle,msgMetadata(m))};
      }
      if(operation==='comment'||operation==='editComment'){
        const old=operation==='editComment'?view.comments.find((c:Data)=>c.id===input.commentId):null;
        if(operation==='editComment'&&!old)throw Error('批注已不存在。');
        const id=old?.id??crypto.randomUUID(),visibility=input.visibility??old?.visibility??'shared',keys=visibility==='private'?await this.privateBundle():bundle;
        const manifest=visibility==='private'?{...item.encryption,keyId:privateEpoch}:item.encryption,metadata=[mine.accountId,visibility];
        const plainOld=old?await this.decodeComment(item,old,bundle):null,body=input.body??plainOld?.body,anchor=input.anchor??plainOld?.anchor;
        wire={...wire,id,visibility,body:await this.seal(item.id,`comment:${id}`,body,manifest,keys,metadata),anchor:{...anchor,...(anchor?.quote!==undefined?{quote:await this.seal(item.id,`quote:${id}`,anchor.quote,manifest,keys,metadata)}:{})}};
      }
      let result=await this.raw<Data>(operation,wire);
      if(['setGroups','setPolicy','revoke'].includes(operation)){
        const refreshed=await this.fresh(item.id,input.token);result={...result,...refreshed};
      }
      if(result.comment)result.comment=await this.decodeComment(item,result.comment,bundle);
      return await this.decodeView(result) as T;
    }
    return await this.raw<T>(operation,input);
  }
  async encryptFile(itemId:string,bytes:Uint8Array,token?:string){
    const view=await this.fresh(itemId,token);if(!view.item.encryption)return null;
    const manifest=view.item.encryption,bundle=await this.openBundle(itemId,manifest);
    return {keyId:manifest.keyId,bytes:await sealBytes(bundle.keys[manifest.keyId],bytes,`shared-file:${itemId}:${manifest.keyId}`)};
  }
  async decryptFile(item:Data,bytes:Uint8Array){
    const keyId=item.payload.fileEncryption?.keyId;if(!keyId)return bytes;
    if(!item.encryption)throw locked();const bundle=await this.openBundle(item.id,item.encryption),key=bundle.keys[keyId];if(!key)throw locked();
    return unsealBytes(key,bytes,`shared-file:${item.id}:${keyId}`);
  }
}
