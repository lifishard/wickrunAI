import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { nativeSecretGet } from './native-secrets';
import type { CloudBridge, DesktopCloudState } from './cloud-api';

interface AccountPlugin {
  state(): Promise<DesktopCloudState>;
  login(): Promise<{code:string;expires:number}>;
  poll(): Promise<{pending?:boolean;ready?:boolean}>;
  cancel(): Promise<void>;
  activate(): Promise<void>;
  logout(): Promise<void>;
  call(options:{action:string;input:unknown}): Promise<unknown>;
  addListener(event:'loginReturn', callback:()=>void): Promise<PluginListenerHandle>;
}
let plugin:AccountPlugin|undefined;
const account=()=>plugin??=registerPlugin<AccountPlugin>('WickrunAccount');
export const isAndroidAccount=()=>Capacitor.getPlatform()==='android';
let initialized=false, userId:string|null=null;
export async function initializeAndroidAccount() {
  if(!isAndroidAccount())return;
  const state=await account().state();
  userId=state.user?.id??null;
  initialized=true;
  await account().addListener('loginReturn',()=>window.dispatchEvent(new Event('wickrun:account-return')));
}
// Old unprefixed storage remains the guest workspace. Resolve before rendering App.
export function accountStorageKey(key:string) {
  if(!isAndroidAccount())return key;
  if(!initialized)throw new Error('Account storage is not ready');
  return userId?`wickrun:account:${encodeURIComponent(userId)}:${key}`:key;
}
const guestKeys=['snc:settings:v1','snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','anyai:observations:v1','wickrun:cloud:archives:v1'];
export async function cancelAndroidLogin(){await account().cancel();}
async function call(action:string,input:unknown={}) {
  try{return await account().call({action,input});}
  catch(error){
    const e=error as Error & {code?:string;status?:number};
    if(e.code)e.status=Number(e.code);
    throw e;
  }
}
export const androidCloudBridge:CloudBridge={
  cloudState:()=>account().state(), cloudLogin:()=>account().login(), cloudPoll:()=>account().poll(),
  async cloudCall(action,input={}) {
    if(action!=='importGuestKeys')return call(action,input);
    const raw=await Preferences.get({key:'snc:settings:v1'});
    const profiles=JSON.parse(raw.value||'null')?.keyProfiles??[];
    const result=await call('keys') as {ids:string[]};
    for(const profile of profiles) {
      if(typeof profile.id!=='string'||result.ids.includes(profile.id))continue;
      const value=await nativeSecretGet(profile.id);
      if(value){await call('keySet',{id:profile.id,value});result.ids.push(profile.id);}
    }
    return result;
  },
  async cloudGuestData(){
    const result:Record<string,string>={};
    for(const key of guestKeys){const {value}=await Preferences.get({key});if(value!==null)result[key]=value;}
    return result;
  },
  async cloudSwitch(logout){
    await (logout?account().logout():account().activate());
    // Never switch a live transport's namespace beneath in-flight persistence.
    window.location.reload();
  },
};
