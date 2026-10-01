/** Client-only cryptography. No plaintext key material is sent to the service. */
export const SEAL_MAGIC=new TextEncoder().encode('WRSEAL1\n');
const utf8=new TextEncoder();
export const encode64=(bytes:Uint8Array):string=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
export const decode64=(text:string):Uint8Array=>{if(!/^[A-Za-z0-9_-]+$/.test(text))throw Error('Invalid encrypted encoding.');const raw=atob(text.replace(/-/g,'+').replace(/_/g,'/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(encode64(bytes)!==text)throw Error('Invalid encrypted encoding.');return bytes;};
const buffer=(bytes:Uint8Array)=>new Uint8Array(bytes).buffer;
export const randomKey=()=>encode64(crypto.getRandomValues(new Uint8Array(32)));
export async function fingerprint(value:unknown){const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(JSON.stringify(value))));return encode64(hash);}
export function isSealed(bytes:Uint8Array){return bytes.length>=36&&SEAL_MAGIC.every((byte,i)=>bytes[i]===byte);}
async function aes(raw:string){const bytes=decode64(raw);if(bytes.length!==32)throw Error('Invalid encryption key.');return crypto.subtle.importKey('raw',buffer(bytes),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealBytes(raw:string,bytes:Uint8Array,context:string):Promise<Uint8Array>{
 const nonce=crypto.getRandomValues(new Uint8Array(12)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:utf8.encode(context),tagLength:128},await aes(raw),buffer(bytes)));
 const out=new Uint8Array(SEAL_MAGIC.length+12+cipher.length);out.set(SEAL_MAGIC);out.set(nonce,SEAL_MAGIC.length);out.set(cipher,SEAL_MAGIC.length+12);return out;
}
export async function unsealBytes(raw:string,bytes:Uint8Array,context:string):Promise<Uint8Array>{
 if(!isSealed(bytes))throw Error('Expected end-to-end encrypted content.');
 try{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:buffer(bytes.subarray(8,20)),additionalData:utf8.encode(context),tagLength:128},await aes(raw),buffer(bytes.subarray(20))));}
 catch{throw Error('加密内容校验失败：密钥或内容不匹配，已停止读取。');}
}
export async function sealJSON(raw:string,value:unknown,context:string){return encode64(await sealBytes(raw,utf8.encode(JSON.stringify(value)),context));}
export async function unsealJSON<T>(raw:string,value:string,context:string):Promise<T>{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await unsealBytes(raw,decode64(value),context))) as T;}
export type PublicIdentity={sign:string;agree:string};
export type PrivateIdentity={sign:string;agree:string};
export type VaultKeys={version:1;accountId:string;dataKey:string;publicIdentity:PublicIdentity;privateIdentity:PrivateIdentity};
const curve={name:'ECDH',namedCurve:'P-256'};
export async function agreementPair(){const pair=await crypto.subtle.generateKey(curve,true,['deriveBits']);return {publicKey:encode64(new Uint8Array(await crypto.subtle.exportKey('spki',pair.publicKey))),privateKey:encode64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',pair.privateKey)))};}
export async function createVaultKeys(accountId:string):Promise<VaultKeys>{
 const agree=await agreementPair(),sign=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {version:1,accountId,dataKey:randomKey(),publicIdentity:{agree:agree.publicKey,sign:encode64(new Uint8Array(await crypto.subtle.exportKey('spki',sign.publicKey)))},privateIdentity:{agree:agree.privateKey,sign:encode64(new Uint8Array(await crypto.subtle.exportKey('pkcs8',sign.privateKey)))}};
}
export async function signValue(privateKey:string,value:unknown){const key=await crypto.subtle.importKey('pkcs8',buffer(decode64(privateKey)),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);return encode64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,utf8.encode(JSON.stringify(value)))));}
export async function verifyValue(publicKey:string,value:unknown,signature:string){try{const key=await crypto.subtle.importKey('spki',buffer(decode64(publicKey)),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,buffer(decode64(signature)),utf8.encode(JSON.stringify(value)));}catch{return false;}}
export async function agreementKey(privateKey:string,publicKey:string,context:string){
 const mine=await crypto.subtle.importKey('pkcs8',buffer(decode64(privateKey)),curve,false,['deriveBits']),theirs=await crypto.subtle.importKey('spki',buffer(decode64(publicKey)),curve,false,[]);
 const shared=await crypto.subtle.deriveBits({name:'ECDH',public:theirs},mine,256),hkdf=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveBits']);
 return encode64(new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:utf8.encode('wickrun-e2ee-v1'),info:utf8.encode(context)},hkdf,256)));
}
export async function checkVaultKeys(value:VaultKeys,accountId:string,identity:PublicIdentity){
 if(value?.version!==1||value.accountId!==accountId||value.publicIdentity?.sign!==identity.sign||value.publicIdentity?.agree!==identity.agree||decode64(value.dataKey).length!==32)throw Error('加密身份不匹配。');
 const challenge=randomKey();if(!await verifyValue(identity.sign,challenge,await signValue(value.privateIdentity.sign,challenge)))throw Error('加密身份不匹配。');
 const peer=await agreementPair(),context='wickrun-identity-check';if(await agreementKey(peer.privateKey,identity.agree,context)!==await agreementKey(value.privateIdentity.agree,peer.publicKey,context))throw Error('加密身份不匹配。');
 return value;
}
