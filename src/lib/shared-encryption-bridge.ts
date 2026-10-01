import { cloudAccountIdentity, cloudCall } from './cloud-api';
import { DeviceVault } from './e2ee-vault';
import { SharedEncryptionClient } from './shared-encryption';
import { getTransport } from './transport';

let current:{accountId:string;client:SharedEncryptionClient}|null=null;
export async function sharedEncryptionClient(){
  const accountId=await cloudAccountIdentity();
  if(!accountId){current=null;return null;}
  if(current?.accountId===accountId)return current.client;
  const storage=getTransport(),vault=new DeviceVault(accountId,storage,input=>cloudCall('sync',{op:'vault',input}));
  const client=new SharedEncryptionClient(async(operation,input)=>{
    if(await cloudAccountIdentity()!==accountId)throw Error('账号已切换，已停止共享操作。');
    const result=await cloudCall('collaboration',{operation,input});
    if(await cloudAccountIdentity()!==accountId)throw Error('账号已切换，已停止读取共享内容。');
    return result as never;
  },vault,storage);
  current={accountId,client};return client;
}
