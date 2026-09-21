import React from 'react';
import { Modal } from './ui';
import { useT } from '../lib/i18n';
import { getTransport } from '../lib/transport';
import { cloudBridge, cloudCall, configureCloudKeys, type CloudStatus, type DesktopCloudState } from '../lib/cloud-api';
import { canonicalCloud, CloudMergeConflict, emptyCloudData, hydrateCloudData, mergeCloudData, projectCloudData, cloudCollections, type CloudData, type CloudLocal } from '../lib/cloud-data';
import { readCloudObservations, readCloudArchives } from '../lib/cloud-local';

const BASE='wickrun:cloud:base:v1';
type Remote = {revision:number;data:CloudData};
type ConflictReview = {records:string[];revision:number;fingerprint:string;importGuest:boolean};
type Props={local:Omit<CloudLocal,'observations'>;blocked:boolean;isBlocked:()=>boolean;onApply:(next:CloudLocal)=>Promise<void>;beforeSwitch:()=>Promise<void>};
export default function CloudSyncControl(props:Props){
  const t=useT(), current=React.useRef(props);current.current=props;
  const [open,setOpen]=React.useState(false),[status,setStatus]=React.useState<CloudStatus|null>(null),[native,setNative]=React.useState<DesktopCloudState|null>(null);
  const [working,setWorking]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
  const [conflicts,setConflicts]=React.useState<ConflictReview|null>(null);
  const [archives,setArchives]=React.useState<CloudData['archives']>([]);
  const lock=React.useRef(false),last=React.useRef(''),didInitial=React.useRef(false);
  const statusRef=React.useRef(status);statusRef.current=status;
  React.useEffect(()=>{
    let alive=true;
    void cloudBridge()?.cloudState().then(value=>{if(alive)setNative(value);}).catch(()=>{});
    void cloudCall<CloudStatus>('status').then(value=>{if(alive)setStatus(value);}).catch(e=>{if(alive)setError(String(e.message||e));});
    return()=>{alive=false;};
  },[]);
  React.useEffect(()=>{
    configureCloudKeys(status?.available?status.user?.id??null:null,props.local.settings.keyProfiles.map(p=>p.id));
  },[status,props.local.settings.keyProfiles]);
  React.useEffect(()=>{
    if(!native?.pending)return;
    const timer=setInterval(()=>{void cloudBridge()?.cloudPoll().then(async()=>{const next=await cloudBridge()!.cloudState();setNative(next);}).catch(e=>{setError(String(e.message||e));setNative(value=>value?{...value,pending:null}:value);});},2500);
    return()=>clearInterval(timer);
  },[native?.pending?.code]);

  const collect=async():Promise<CloudLocal>=>({...current.current.local,observations:await readCloudObservations(),archives:await readCloudArchives()});
  async function sync(importGuest=false,choice?:'local'|'remote'){
    if(lock.current||current.current.isBlocked())return;
    const account=statusRef.current;
    if(!account?.available||!account.user)return;
    lock.current=true;setWorking(true);setError('');setNotice('');
    try{
      const transport=getTransport(),before=await collect();
      const original=projectCloudData(before);
      let local=original;
      let guestRaw:Record<string,string>|null=null;
      if(importGuest){
        guestRaw=cloudBridge()?await cloudBridge()!.cloudGuestData():Object.fromEntries(['snc:settings:v1','snc:conversations:v1','snc:projects:v1','snc:skills:v1','snc:tasks:v1','anyai:observations:v1','wickrun:cloud:archives:v1'].map(key=>[key,localStorage.getItem('wickrun:web:guest:'+key)||'null']));
        const parse=(key:string,fallback:unknown)=>JSON.parse(guestRaw![key]||'null')??fallback;
        const guest=projectCloudData({settings:{...before.settings,...parse('snc:settings:v1',{})},conversations:parse('snc:conversations:v1',[]),projects:parse('snc:projects:v1',[]),skills:parse('snc:skills:v1',[]),tasks:parse('snc:tasks:v1',[]),observations:parse('anyai:observations:v1',{}).tasks??[],archives:parse('wickrun:cloud:archives:v1',[])});
        guest.preferences=local.preferences;
        local=mergeCloudData(emptyCloudData(),local,guest,'local');
      }
      const raw=await transport.kvGet(BASE);
      const saved=raw?JSON.parse(raw) as {userId:string;data:CloudData}:null;
      if(saved&&saved.userId!==account.user.id)throw new Error(t('账号与本地同步记录不匹配，已停止同步。'));
      let remote=await cloudCall<Remote>('read');
      if(choice)await transport.kvSet('wickrun:cloud:before-conflict:v1',JSON.stringify(original));
      if(choice&&(!conflicts||conflicts.revision!==remote.revision||conflicts.fingerprint!==canonicalCloud(local)))throw new Error(t('内容已变化，请重新同步并检查冲突。'));
      let base=saved?.data??emptyCloudData();
      if(!saved&&remote.revision>0&&!importGuest){
        // On first login, account data supersedes seed/default entries with the same id.
        // Keep an untouched migration copy; unique local records are still merged.
        await transport.kvSet('wickrun:cloud:before-first-sync:v1',JSON.stringify(original));
        base={...emptyCloudData(),preferences:local.preferences};
        for(const key of cloudCollections)base[key]=local[key].filter(row=>remote.data[key].some(r=>r.id===row.id));
      }
      let merged:CloudData=local;
      for(let attempt=0;attempt<3;attempt++){
        try{merged=mergeCloudData(base,local,remote.data,choice);}
        catch(e){if(e instanceof CloudMergeConflict)setConflicts({records:e.records,revision:remote.revision,fingerprint:canonicalCloud(local),importGuest});throw e;}
        if(canonicalCloud(merged)===canonicalCloud(remote.data))break;
        try{remote=await cloudCall<Remote>('write',{revision:remote.revision,data:merged});break;}
        catch(e){if(choice||attempt===2||!(/409|Cloud data changed/.test(String(e))||(e as {status?:number}).status===409))throw e;remote=await cloudCall<Remote>('read');}
      }
      if(current.current.isBlocked())throw new Error(t('任务正在运行，云端已保存；空闲后会继续合并本机内容。'));
      // Preserve edits made while the network request was in flight.
      const latest=await collect();
      let combined=mergeCloudData(original,projectCloudData(latest),merged);
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
      if(current.current.isBlocked())throw new Error(t('任务正在运行，云端已保存；空闲后会继续合并本机内容。'));
      const finalLocal=await collect();
      combined=mergeCloudData(projectCloudData(latest),projectCloudData(finalLocal),combined);
      await current.current.onApply(hydrateCloudData(combined,finalLocal,keyResult.ids));
      setArchives(combined.archives);
      await transport.kvSet(BASE,JSON.stringify({userId:account.user.id,data:merged,revision:remote.revision}));
      last.current=canonicalCloud(combined);setConflicts(null);setNotice(t('云端同步完成'));
    }catch(e){setError(e instanceof CloudMergeConflict?t('同一内容在两端都有修改，请选择冲突版本。'):String((e as Error).message||e));}
    finally{lock.current=false;setWorking(false);}
  }
  React.useEffect(()=>{
    if(!status?.user||!status.available||props.blocked)return;
    const timer=setTimeout(()=>{
      if(!didInitial.current){didInitial.current=true;void sync();return;}
      void collect().then(value=>{if(canonicalCloud(projectCloudData(value))!==last.current&&!conflicts)void sync();});
    },didInitial.current?5000:100);
    return()=>clearTimeout(timer);
  },[status,props.local.settings,props.local.conversations,props.local.projects,props.local.skills,props.local.tasks,props.blocked]);
  React.useEffect(()=>{
    const timer=setInterval(()=>{if(statusRef.current?.user&&!current.current.isBlocked()&&!conflicts)void sync();},60000);
    return()=>clearInterval(timer);
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
      {status?.user?<p><strong>{status.user.name}</strong><br/>{status.user.email}</p>:native?.user?<p>{native.user.email}</p>:null}
      {error?<p role="alert" style={{color:'var(--danger)'}}>{error}</p>:null}
      {notice?<p role="status">{notice}</p>:null}
      {status&&!status.available?<p>{t('云同步尚未配置。请在 Railway 添加数据库和加密变量。')}</p>:null}
      {props.blocked?<p>{t('请先暂停正在运行的任务，再同步或切换账号。')}</p>:null}
      {cloudBridge()?<>
        {!native?.pending&&!native?.ready?<button className="btn primary" disabled={unavailable} onClick={()=>{setError('');void cloudBridge()!.cloudLogin().then(async()=>setNative(await cloudBridge()!.cloudState())).catch(e=>setError(String(e.message||e)));}}>{t('使用 Google 登录')}</button>:null}
        {native?.pending?<div><p>{t('浏览器会打开 Google 登录。请核对两处校验码一致，再批准此桌面程序。')}</p><strong style={{font:'24px monospace',letterSpacing:4}}>{native.pending.code}</strong></div>:null}
        {native?.ready?<button className="btn primary" disabled={unavailable} onClick={()=>void switchAccount(false)}>{t('登录完成，重启进入账号工作区')}</button>:null}
        {native?.user?<button className="btn" disabled={unavailable} onClick={()=>void switchAccount(true)}>{t('退出并返回未登录工作区')}</button>:null}
      </>:!status?.user?<a className="btn primary" href="/api/auth/google">{t('使用 Google 登录')}</a>:null}
      {status?.user&&status.available?<>
        <button className="btn primary" disabled={unavailable} onClick={()=>void sync()}>{t('立即同步')}</button>
        {archives.length?<details><summary>{t('查看任务记录（{n}）',{n:archives.length})}</summary><p>{t('这里是跨设备保存的历史记录，不会在此恢复或执行本机进程。')}</p><div style={{maxHeight:300,overflow:'auto'}}>{archives.map(row=><details key={row.id}><summary>{String(row.title||row.id)}</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:12}}>{String(row.text||'')}</pre></details>)}</div></details>:null}
        <details><summary>{t('导入未登录时的本地内容')}</summary><p>{t('将此设备未登录时的内容和 API 密钥复制到当前账号。原本地内容保留；相同编号的账号内容及已有密钥不会被覆盖。')}</p><button className="btn" disabled={unavailable} onClick={()=>void sync(true)}>{t('导入到此账号')}</button></details>
        {conflicts?<section><p>{t('发现 {n} 条冲突；其他内容会正常合并。本机会先保留恢复副本。',{n:conflicts.records.length})}</p><button className="btn" disabled={unavailable} onClick={()=>void sync(conflicts.importGuest,'local')}>{t('冲突使用本机版本')}</button> <button className="btn" disabled={unavailable} onClick={()=>void sync(conflicts.importGuest,'remote')}>{t('冲突使用云端版本')}</button></section>:null}
        <small>{t('空闲时自动同步。API 密钥通过独立加密通道保存；新设备的技能与定时任务需要手动启用，本地工具权限不随账号同步。')}</small>
      </>:null}
    </div></Modal>:null}
  </>;
}
