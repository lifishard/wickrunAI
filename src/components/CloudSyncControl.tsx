import React from 'react';
import { flushSync } from 'react-dom';
import { Modal } from './ui';
import { useT } from '../lib/i18n';
import { getTransport } from '../lib/transport';
import { cloudBridge, cloudCall, configureCloudKeys, type CloudStatus, type DesktopCloudState } from '../lib/cloud-api';
import { canonicalCloud, CloudMergeConflict, emptyCloudData, hydrateCloudData, mergeCloudData, projectCloudData, firstSyncBase, butlerCloudSlice, firstButlerBase, withButlerCloudSlice, mergeButlerSlices, butlerBrainFromRows, butlerPreferencesFromCloud, type CloudData, type CloudLocal } from '../lib/cloud-data';
import { readCloudObservations, readCloudArchives, readCloudButler } from '../lib/cloud-local';
import { emptyButlerBrain, type ButlerBrainState, type ButlerProactivePreferences } from '../lib/proactive-butler';

import { CloudSyncClient } from '../lib/cloud-sync';
import { DeviceVault } from '../lib/e2ee-vault';
import EncryptionSettings from './EncryptionSettings';
const BASE='wickrun:cloud:base:v1';
type Remote = {revision:number;data:CloudData};
type ConflictReview = {records:string[];revision:number;fingerprint:string;importGuest:boolean};
type Props={local:Omit<CloudLocal,'observations'>;blocked:boolean;isBlocked:()=>boolean;onApply:(next:CloudLocal)=>Promise<void>;onButlerApply:(brain:ButlerBrainState,prefs:ButlerProactivePreferences|undefined)=>Promise<void>;beforeSwitch:()=>Promise<void>};
export default function CloudSyncControl(props:Props){
  const t=useT(), current=React.useRef(props);current.current=props;
  const [open,setOpen]=React.useState(false),[status,setStatus]=React.useState<CloudStatus|null>(null),[native,setNative]=React.useState<DesktopCloudState|null>(null);
  React.useEffect(()=>{const open=()=>setOpen(true);window.addEventListener('wickrun:open-account',open);return()=>window.removeEventListener('wickrun:open-account',open);},[]);
  const [working,setWorking]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
  const [conflicts,setConflicts]=React.useState<ConflictReview|null>(null);
  const [archives,setArchives]=React.useState<CloudData['archives']>([]);
  const [cloudKeyIds,setCloudKeyIds]=React.useState<string[]>([]);
  const lock=React.useRef(false),last=React.useRef(''),didInitial=React.useRef(false);
  const clientRef=React.useRef<{accountId:string;client:CloudSyncClient}|null>(null);
  const statusRef=React.useRef(status);statusRef.current=status;
  const vault=React.useMemo(()=>status?.user&&status.syncProtocol==='layered-v1'?new DeviceVault(status.user.id,getTransport(),input=>cloudCall('sync',{op:'vault',input})):undefined,[status?.user?.id,status?.syncProtocol]);
  const vaultRef=React.useRef(vault);vaultRef.current=vault;
  const encryptionChanged=React.useCallback(()=>{clientRef.current=null;window.dispatchEvent(new Event('wickrun:sync-files'));},[]);
  React.useEffect(()=>{
    let alive=true;
    void cloudBridge()?.cloudState().then(value=>{if(alive)setNative(value);}).catch(()=>{});
    void cloudCall<CloudStatus>('status').then(value=>{if(alive)setStatus(value);}).catch(e=>{if(alive)setError(String(e.message||e));});
    return()=>{alive=false;};
  },[]);
  React.useEffect(()=>{
    configureCloudKeys(status?.available?status.user?.id??null:null,cloudKeyIds);
  },[status,cloudKeyIds]);
  React.useEffect(()=>{
    let alive=true;setCloudKeyIds([]);
    if(status?.available&&status.user)void cloudCall<{ids:string[]}>('keys').then(value=>{if(alive)setCloudKeyIds(value.ids);}).catch(()=>{});
    return()=>{alive=false;};
  },[status?.user?.id,status?.available]);
  React.useEffect(()=>{
    if(!native?.pending)return;
    const timer=setInterval(()=>{void cloudBridge()?.cloudPoll().then(async()=>{const next=await cloudBridge()!.cloudState();setNative(next);}).catch(e=>{setError(String(e.message||e));setNative(value=>value?{...value,pending:null}:value);});},2500);
    return()=>clearInterval(timer);
  },[native?.pending?.code]);

  const collect=async():Promise<CloudLocal>=>{
    // Composer debounces draft persistence. Publish the visible text before a
    // snapshot so a fast Sync click cannot miss the user's latest keystrokes.
    flushSync(()=>window.dispatchEvent(new Event('wickrun:flush-draft')));
    const accountId=statusRef.current?.user?.id;
    return {...current.current.local,observations:await readCloudObservations(),archives:await readCloudArchives(),butler:accountId?(await readCloudButler(accountId)??emptyButlerBrain(accountId)):undefined};
  };
  const layered=()=>{
    const account=statusRef.current;
    if(account?.syncProtocol!=='layered-v1'||!account.user)return undefined;
    if(clientRef.current?.accountId!==account.user.id)clientRef.current={accountId:account.user.id,client:new CloudSyncClient(getTransport(),input=>cloudCall('sync',input),vaultRef.current)};
    return clientRef.current.client;
  };
  async function sync(importGuest=false,choice?:'local'|'remote',alreadyLocked=false){
    if(!alreadyLocked&&lock.current||current.current.isBlocked())return;
    const account=statusRef.current;
    if(!account?.available||!account.user)return;
    lock.current=true;setWorking(true);setError('');setNotice('');
    try{
      const transport=getTransport(),before=await collect(),client=layered();
      const prepare=(data:CloudData)=>client?client.prepare(data):Promise.resolve(data);
      const original=await prepare(projectCloudData(before));
      let local=original;
      let guestRaw:Record<string,string>|null=null;
      if(importGuest){
        guestRaw=cloudBridge()?await cloudBridge()!.cloudGuestData():Object.fromEntries(['snc:settings:v1','snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','anyai:observations:v1','wickrun:cloud:archives:v1'].map(key=>[key,localStorage.getItem('wickrun:web:guest:'+key)||'null']));
        const parse=(key:string,fallback:unknown)=>JSON.parse(guestRaw![key]||'null')??fallback;
        const guest=await prepare(projectCloudData({settings:{...before.settings,...parse('snc:settings:v1',{})},conversations:parse('snc:conversations:v1',[]),projects:parse('snc:projects:v1',[]),skills:parse('snc:skills:v1',[]),tasks:parse('snc:tasks:v1',[]),observations:parse('anyai:observations:v1',{}).tasks??[],archives:parse('wickrun:cloud:archives:v1',[])}));
        guest.preferences=local.preferences;
        local=mergeCloudData(emptyCloudData(),local,guest,'local');
      }
      const raw=await transport.kvGet(BASE);
      const saved=raw?JSON.parse(raw) as {userId:string;data:CloudData}:null;
      if(saved&&saved.userId!==account.user.id)throw new Error(t('账号与本地同步记录不匹配，已停止同步。'));
      if(saved&&client)saved.data=await prepare(saved.data);
      const read=()=>client?client.read(saved?.data):cloudCall<Remote>('read');
      const write=(revision:number,data:CloudData)=>client?client.write(revision,data):cloudCall<Remote>('write',{revision,data});
      let remote=await read();
      if(choice)await transport.kvSet('wickrun:cloud:before-conflict:v1',JSON.stringify(original));
      if(choice&&(!conflicts||conflicts.revision!==remote.revision||conflicts.fingerprint!==canonicalCloud(local)))throw new Error(t('内容已变化，请重新同步并检查冲突。'));
      let base=saved?.data??emptyCloudData();
      if(!saved&&remote.revision>0&&!importGuest){
        // Keep an untouched migration copy; a continued desktop workspace
        // retains its habits while genuine cloud/local differences need review.
        await transport.kvSet('wickrun:cloud:before-first-sync:v1',JSON.stringify(original));
        const bridge=cloudBridge(),state=bridge?await bridge.cloudState():null;
        const continuing=state?.continuesLocalWorkspace===true&&(state.workspaceAccountId??state.user?.id)===account.user.id;
        base=firstSyncBase(local,remote.data,continuing);
      }
      let merged:CloudData=local;
      for(let attempt=0;attempt<3;attempt++){
        try{merged=mergeCloudData(base,local,remote.data,choice);}
        catch(e){if(e instanceof CloudMergeConflict)setConflicts({records:e.records,revision:remote.revision,fingerprint:canonicalCloud(local),importGuest});throw e;}
        if(canonicalCloud(merged)===canonicalCloud(remote.data)&&!client?.needsEncryption)break;
        try{remote=await write(remote.revision,merged);merged=remote.data;break;}
        catch(e){if(choice||attempt===2||!(/409|Cloud data changed/.test(String(e))||(e as {status?:number}).status===409))throw e;remote=await read();}
      }
      if(current.current.isBlocked())throw new Error(t('任务正在运行，云端已保存；空闲后会继续合并本机内容。'));
      // Preserve edits made while the network request was in flight.
      const latest=await collect();
      let combined=mergeCloudData(original,await prepare(projectCloudData(latest)),merged);
      const keyResult=await cloudCall<{ids:string[]}>('keys');
      for(const profile of local.profiles){
        if(keyResult.ids.includes(profile.id))continue;
        if(saved?.data.profiles.some(p=>p.id===profile.id))continue;
        const value=await transport.secretGet(profile.id);
        if(value){await cloudCall('keySet',{id:profile.id,value});keyResult.ids.push(profile.id);}
      }
      if(importGuest&&guestRaw){
        const guestProfiles=(JSON.parse(guestRaw['snc:settings:v1']||'null')?.keyProfiles??[]) as {id:string}[];
        if(cloudBridge()){
          // Import is an explicit user action; native secrets never enter the renderer.
          const result=await cloudBridge()!.cloudCall('importGuestKeys',{}) as {ids:string[]};
          keyResult.ids=[...new Set([...keyResult.ids,...result.ids])];
        }else for(const profile of guestProfiles){
          if(keyResult.ids.includes(profile.id))continue;
          const value=sessionStorage.getItem('wickrun:web:guest:secret:'+profile.id);
          if(value){await cloudCall('keySet',{id:profile.id,value});keyResult.ids.push(profile.id);}
        }
      }
      for(const profile of combined.profiles){
        if(!keyResult.ids.includes(profile.id)){await transport.secretDelete(profile.id);continue;}
        const key=await cloudCall<{value:string|null}>('keyGet',{id:profile.id});
        if(key.value)await transport.secretSet(profile.id,key.value);
      }
      setCloudKeyIds(keyResult.ids);
      if(current.current.isBlocked())throw new Error(t('任务正在运行，云端已保存；空闲后会继续合并本机内容。'));
      const finalLocal=await collect();
      combined=mergeCloudData(await prepare(projectCloudData(latest)),await prepare(projectCloudData(finalLocal)),combined);
      const restored=client?await client.restore(combined):combined;
      if(current.current.isBlocked())throw new Error(t('任务正在运行，云端已保存；空闲后会继续合并本机内容。'));
      // Downloads can take time; merge edits made while files were in flight.
      const afterDownload=await collect();
      const downloadedCombined=mergeCloudData(await prepare(projectCloudData(finalLocal)),await prepare(projectCloudData(afterDownload)),combined);
      const applyData=canonicalCloud(downloadedCombined)===canonicalCloud(combined)?restored:client?await client.restore(downloadedCombined):downloadedCombined;
      combined=downloadedCombined;
      await current.current.onApply(hydrateCloudData(applyData,afterDownload,keyResult.ids,account.user.id));
      setArchives(combined.archives);
      await transport.kvSet(BASE,JSON.stringify({userId:account.user.id,data:merged,revision:remote.revision}));
      if(client)await client.applied(remote.revision);
      last.current=canonicalCloud(combined);setConflicts(null);
      setNotice(client?.pendingFiles?t('文字与目录已同步，{n} 个文件等待来源设备上线。',{n:client.pendingFiles}):t('云端同步完成'));
      if(client?.warning)setError(client.warning);
    }catch(e){setError(e instanceof CloudMergeConflict?t('同一内容在两端都有修改，请选择冲突版本。'):String((e as Error).message||e));}
    finally{lock.current=false;setWorking(false);}
  }
  async function syncButler(){
    if(lock.current)return;
    const account=statusRef.current;
    if(!account?.available||!account.user)return;
    lock.current=true;
    try{
      const transport=getTransport(),accountId=account.user.id,client=layered();
      const localBrain=await readCloudButler(accountId)??emptyButlerBrain(accountId);
      const local=butlerCloudSlice(projectCloudData({...current.current.local,conversations:[],projects:[],skills:[],tasks:[],observations:[],butler:localBrain}));
      const raw=await transport.kvGet(BASE),saved=raw?JSON.parse(raw) as {userId:string;data:CloudData}:null;
      if(saved&&saved.userId!==accountId)return;
      let base=butlerCloudSlice(saved?.data??emptyCloudData());
      const read=()=>client?client.read(saved?.data,true):cloudCall<Remote>('read');
      let remote=await read();
      if(!saved&&remote.revision>0)base=firstButlerBase(local,remote.data);
      let merged=local;
      for(let attempt=0;attempt<3;attempt++){
        const remoteSlice=butlerCloudSlice(remote.data);
        // A local pause is a safety command. Concurrent edits to the same Butler
        // row resolve locally; unrelated collections remain byte-for-byte remote.
        merged=mergeButlerSlices(base,local,remoteSlice);
        const next=withButlerCloudSlice(remote.data,merged);
        if(canonicalCloud(next)===canonicalCloud(remote.data))break;
        try{remote=client?await client.write(remote.revision,next,true):await cloudCall<Remote>('write',{revision:remote.revision,data:next});break;}
        catch(e){if(attempt===2||!(/409|Cloud data changed/.test(String(e))||(e as {status?:number}).status===409))throw e;remote=await read();}
      }
      const latestBrain=await readCloudButler(accountId)??emptyButlerBrain(accountId);
      const latest=butlerCloudSlice(projectCloudData({...current.current.local,conversations:[],projects:[],skills:[],tasks:[],observations:[],butler:latestBrain}));
      const combined=mergeButlerSlices(local,latest,merged);
      const brain=butlerBrainFromRows(combined.butler,accountId,latestBrain);
      const prefs=butlerPreferencesFromCloud(combined.preferences,current.current.local.settings.butler?.proactive);
      if(canonicalCloud(brain)!==canonicalCloud(latestBrain)||canonicalCloud(prefs)!==canonicalCloud(current.current.local.settings.butler?.proactive))
        await current.current.onButlerApply(brain,prefs);
      // Only advance the baseline for records actually applied on this device.
      // Advancing unrelated rows would turn an old local chat into a new edit
      // and overwrite another device's newer chat on the next full sync.
      if(saved)await transport.kvSet(BASE,JSON.stringify({userId:accountId,data:withButlerCloudSlice(saved.data,merged),revision:remote.revision}));
    }catch(e){setError(String((e as Error).message||e));}
    finally{lock.current=false;}
  }
  React.useEffect(()=>{
    const changed=()=>{void syncButler();};
    window.addEventListener('wickrun:butler-change',changed);
    const timer=setInterval(()=>{if(statusRef.current?.user)void syncButler();},5000);
    return()=>{window.removeEventListener('wickrun:butler-change',changed);clearInterval(timer);};
  },[]);
  React.useEffect(()=>{
    if(!status?.user||!status.available||props.blocked)return;
    const timer=setTimeout(()=>{
      if(!didInitial.current){didInitial.current=true;void sync();return;}
      void collect().then(async value=>{const client=layered(),data=projectCloudData(value);if(canonicalCloud(client?await client.prepare(data):data)!==last.current&&!conflicts)void sync();}).catch(e=>setError(String(e.message||e)));
    },didInitial.current?5000:100);
    return()=>clearTimeout(timer);
  },[status,props.local.settings,props.local.conversations,props.local.projects,props.local.skills,props.local.tasks,props.blocked]);
  React.useEffect(()=>{
    const timer=setInterval(()=>{if(statusRef.current?.user&&!current.current.isBlocked()&&!conflicts)void sync();},60000);
    return()=>clearInterval(timer);
  },[conflicts]);

  async function checkEncryptionSetup(){
    const client=layered();if(!client)throw Error('Sync unavailable');
    await client.prepare(projectCloudData(await collect()));
    const remote=await client.read();await client.restore(remote.data);
    if(client.pendingFiles)throw Error(t('请先让来源设备上线，取回所有待同步附件后再启用加密。'));
  }
  async function beforeEncryptionSetup(){
    if(lock.current||current.current.isBlocked())throw Error(t('请先暂停正在运行的任务，再同步或切换账号。'));
    lock.current=true;setWorking(true);
    try{await checkEncryptionSetup();}finally{lock.current=false;setWorking(false);}
  }
  async function setupEncryption(prepared:Awaited<ReturnType<DeviceVault['prepare']>>){
    if(lock.current||current.current.isBlocked()||!vault||prepared.keys.accountId!==statusRef.current?.user?.id)throw Error(t('请先暂停正在运行的任务，再同步或切换账号。'));
    lock.current=true;setWorking(true);
    try{
      await checkEncryptionSetup();if(current.current.isBlocked())throw Error(t('请先暂停正在运行的任务，再同步或切换账号。'));
      await vault.initialize(prepared);clientRef.current=null;
      await sync(false,undefined,true);
      const head=await cloudCall<{encrypted:boolean}>('sync',{op:'manifest'});
      if(!head.encrypted)throw Error(t('加密密钥已启用，但历史内容尚未完成转换。请处理同步提示后重试；原有内容仍保留。'));
    }finally{lock.current=false;setWorking(false);}
  }
  React.useEffect(()=>{
    const request=()=>{if(statusRef.current?.user&&!conflicts)void sync();};
    window.addEventListener('wickrun:sync-files',request);return()=>window.removeEventListener('wickrun:sync-files',request);
  },[conflicts]);

  async function switchAccount(logout:boolean){
    setWorking(true);setError('');
    try{await current.current.beforeSwitch();await cloudBridge()!.cloudSwitch(logout);}catch(e){setError(String((e as Error).message||e));setWorking(false);}
  }
  const unavailable=working||props.blocked;
  return <>
    <button className="btn sm cloud-account-trigger" onClick={()=>setOpen(true)} title={t('账号与云同步')}>{working?t('同步中…'):error?t('同步需要处理'):status?.user?t('云端同步'):t('Google 账号')}</button>
    {open?<Modal title={t('账号与云同步')} onClose={()=>setOpen(false)}><div className="modal-body" style={{display:'grid',gap:14}}>
      <p>{t('同一 Google 账号可在桌面版与网页版查看聊天、项目、技能和任务记录，并使用自己的 API 密钥。')}</p>
      {native?.continuesLocalWorkspace!==undefined&&<p>{t(native.continuesLocalWorkspace?'当前账号继续使用这台机器原有的对话、记忆、模型和工作区。':'首次登录会延续本机工作区；切换到其他账号时，会使用该账号自己的工作区。')}</p>}
      {status?.syncProtocol==='layered-v1'?<p>{t('文字对话、管家需求与同步目录保存在账号中。附件和文件以本机为主，传输缓存最多保留 7 天；目标设备收到后提前清理。新设备可双向同步，过期文件需要来源设备上线。')}</p>:null}
      {status?.user?<p><strong>{status.user.name}</strong><br/>{status.user.email}</p>:native?.user?<p>{native.user.email}</p>:null}
      {error?<p role="alert" style={{color:'var(--danger)'}}>{error}</p>:null}
      {notice?<p role="status">{notice}</p>:null}
      {status&&!status.available?<p>{t('云同步尚未配置。请在 Railway 添加数据库和加密变量。')}</p>:null}
      {props.blocked?<p>{t('请先暂停正在运行的任务，再同步或切换账号。')}</p>:null}
      {cloudBridge()?<>
        {!native?.pending&&!native?.ready?<button className="btn primary" disabled={unavailable} onClick={()=>{setError('');void cloudBridge()!.cloudLogin().then(async()=>setNative(await cloudBridge()!.cloudState())).catch(e=>setError(String(e.message||e)));}}>{t('使用 Google 登录')}</button>:null}
        {native?.pending?<div><p>{t('浏览器会打开 Google 登录。请核对两处校验码一致，再批准此桌面程序。')}</p><strong style={{font:'24px monospace',letterSpacing:4}}>{native.pending.code}</strong></div>:null}
        {native?.ready?<button className="btn primary" disabled={unavailable} onClick={()=>void switchAccount(false)}>{t('登录完成，重启继续使用')}</button>:null}
        {native?.user?<button className="btn" disabled={unavailable} onClick={()=>void switchAccount(true)}>{t('退出并返回未登录工作区')}</button>:null}
      </>:!status?.user?<a className="btn primary" href="/api/auth/google">{t('使用 Google 登录')}</a>:null}
      {status?.user&&status.available?<>
        {vault&&<EncryptionSettings key={vault.accountId} vault={vault} disabled={unavailable} onChanged={encryptionChanged} beforeSetup={beforeEncryptionSetup} setup={setupEncryption}/>}
        <button className="btn primary" disabled={unavailable} onClick={()=>void sync()}>{t('立即同步')}</button>
        {archives.length?<details><summary>{t('查看任务记录（{n}）',{n:archives.length})}</summary><p>{t('这里是跨设备保存的历史记录，不会在此恢复或执行本机进程。')}</p><div style={{maxHeight:300,overflow:'auto'}}>{archives.map(row=><details key={row.id}><summary>{String(row.title||row.id)}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{String(row.text||'')}</pre></details>)}</div></details>:null}
        <details><summary>{t('导入未登录时的本地内容')}</summary><p>{t('将此设备未登录时的内容和 API 密钥复制到当前账号。原本地内容保留；相同编号的账号内容及已有密钥不会被覆盖。')}</p><button className="btn" disabled={unavailable} onClick={()=>void sync(true)}>{t('导入到此账号')}</button></details>
        {conflicts?<section><p>{t('发现 {n} 条冲突；其他内容会正常合并。本机会先保留恢复副本。',{n:conflicts.records.length})}</p><button className="btn" disabled={unavailable} onClick={()=>void sync(conflicts.importGuest,'local')}>{t('冲突使用本机版本')}</button> <button className="btn" disabled={unavailable} onClick={()=>void sync(conflicts.importGuest,'remote')}>{t('冲突使用云端版本')}</button></section>:null}
        <small>{t('空闲时自动同步。API 密钥通过独立加密通道保存；新设备的技能与定时任务需要手动启用，本地工具权限不随账号同步。')}</small>
      </>:null}
    </div></Modal>:null}
  </>;
}
