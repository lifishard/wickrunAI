import { agreementKey,agreementPair,checkVaultKeys,createVaultKeys,fingerprint,randomKey,sealJSON,signValue,unsealJSON,verifyValue,type PublicIdentity,type VaultKeys } from './e2ee-crypto';
export type VaultStorage={kvGet:(key:string)=>Promise<string|null>;kvSet:(key:string,value:string)=>Promise<void>};
type Call=<T>(input:Record<string,unknown>)=>Promise<T>;
export type DeviceRequest={id:string;label:string;publicKey:string;expires:number;envelope?:string;signature?:string};
export type VaultStatus={enabled:boolean;identity:PublicIdentity|null;recovery:string|null;requests:DeviceRequest[]};
const LOCAL='wickrun:e2ee:keys:v1:',PENDING='wickrun:e2ee:request:v1:';
export async function deviceCode(account:string,request:DeviceRequest){return (await fingerprint([account,request.id,request.publicKey,request.expires])).slice(0,12).match(/.{1,4}/g)!.join(' ');}
export class DeviceVault {
 keys:VaultKeys|null=null;
 constructor(readonly accountId:string,private storage:VaultStorage,private call:Call){}
 async status(){const state=await this.call<VaultStatus>({op:'status'});const saved=await this.storage.kvGet(LOCAL+this.accountId);this.keys=null;
  if(saved&&state.identity)this.keys=await checkVaultKeys(JSON.parse(saved),this.accountId,state.identity);return state;}
 async prepare(){const keys=await createVaultKeys(this.accountId),recoveryKey=randomKey(),recovery=await sealJSON(recoveryKey,keys,`recovery:${this.accountId}`);return {keys,recoveryKey:'WR1-'+recoveryKey,recovery};}
 async initialize(prepared:Awaited<ReturnType<DeviceVault['prepare']>>){const {keys,recovery}=prepared;
  // Save locally before publishing. A network retry uses the same prepared key.
  await this.storage.kvSet(LOCAL+this.accountId,JSON.stringify(keys));
  const state=await this.call<VaultStatus>({op:'initialize',identity:keys.publicIdentity,recovery,signature:await signValue(keys.privateIdentity.sign,['initialize',this.accountId,keys.publicIdentity.sign,keys.publicIdentity.agree,recovery])});
  if(!state.identity)throw Error('加密设置未完成。');this.keys=await checkVaultKeys(keys,this.accountId,state.identity);return state;
 }
 async request(label:string){const saved=await this.storage.kvGet(PENDING+this.accountId);let pending=saved?JSON.parse(saved):null;
  if(!pending||pending.expires<=Date.now()){const pair=await agreementPair();pending={id:crypto.randomUUID(),...pair,expires:Date.now()+15*60_000};await this.storage.kvSet(PENDING+this.accountId,JSON.stringify(pending));}
  return this.call<DeviceRequest>({op:'request',id:pending.id,label,publicKey:pending.publicKey});
 }
 async approve(request:DeviceRequest){if(!this.keys)throw Error('请先解锁本设备。');
  const context=`approve:${this.accountId}:${request.id}:${request.expires}`,key=await agreementKey(this.keys.privateIdentity.agree,request.publicKey,context),envelope=await sealJSON(key,this.keys,context);
  return this.call<DeviceRequest>({op:'approve',id:request.id,envelope,signature:await signValue(this.keys.privateIdentity.sign,['approve',this.accountId,request.id,request.publicKey,request.expires,envelope])});
 }
 async receive(state:VaultStatus){const saved=await this.storage.kvGet(PENDING+this.accountId);if(!saved||!state.identity)return false;
  const pending=JSON.parse(saved),request=state.requests.find(r=>r.id===pending.id);if(!request?.envelope||!request.signature)return false;
  if(request.expires<=Date.now()||request.publicKey!==pending.publicKey||!await verifyValue(state.identity.sign,['approve',this.accountId,request.id,request.publicKey,request.expires,request.envelope],request.signature))throw Error('设备批准校验失败。');
  const context=`approve:${this.accountId}:${request.id}:${request.expires}`,key=await agreementKey(pending.privateKey,state.identity.agree,context);
  const keys=await checkVaultKeys(await unsealJSON<VaultKeys>(key,request.envelope,context),this.accountId,state.identity);await this.save(keys);await this.dismiss(request.id);return true;
 }
 async recover(recoveryKey:string,state:VaultStatus){if(!state.identity||!state.recovery||!/^WR1-[A-Za-z0-9_-]{43}$/.test(recoveryKey.trim()))throw Error('恢复密钥格式无效。');
  await this.save(await checkVaultKeys(await unsealJSON<VaultKeys>(recoveryKey.trim().slice(4),state.recovery,`recovery:${this.accountId}`),this.accountId,state.identity));
 }
 private async save(keys:VaultKeys){await this.storage.kvSet(LOCAL+this.accountId,JSON.stringify(keys));this.keys=keys;}
 async dismiss(id:string){if(!this.keys)throw Error('请先解锁本设备。');await this.call({op:'dismiss',id,signature:await signValue(this.keys.privateIdentity.sign,['dismiss',this.accountId,id])});}
}
