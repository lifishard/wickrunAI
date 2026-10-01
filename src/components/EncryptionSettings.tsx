import React from 'react';
import { useT } from '../lib/i18n';
import { DeviceVault,deviceCode,type DeviceRequest,type VaultStatus } from '../lib/e2ee-vault';
type Props={vault:DeviceVault;disabled:boolean;beforeSetup:()=>Promise<void>;setup:(prepared:Awaited<ReturnType<DeviceVault['prepare']>>)=>Promise<void>;onChanged:()=>void};
export default function EncryptionSettings({vault,disabled,beforeSetup,setup,onChanged}:Props){
 const t=useT(),[state,setState]=React.useState<VaultStatus|null>(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const [prepared,setPrepared]=React.useState<Awaited<ReturnType<DeviceVault['prepare']>>|null>(null),[saved,setSaved]=React.useState(false),[recovery,setRecovery]=React.useState(''),[request,setRequest]=React.useState<DeviceRequest|null>(null),[codes,setCodes]=React.useState<Record<string,string>>({}),[approved,setApproved]=React.useState<string[]>([]);
 React.useEffect(()=>{setPrepared(null);setSaved(false);setRecovery('');setRequest(null);setApproved([]);setState(null);setError('');},[vault.accountId]);
 const refresh=React.useCallback(async()=>{const next=await vault.status();if(await vault.receive(next)){onChanged();setRequest(null);}setState(next);setCodes(Object.fromEntries(await Promise.all(next.requests.map(async row=>[row.id,await deviceCode(vault.accountId,row)]))));},[vault,onChanged]);
 React.useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>{void refresh().catch(e=>setError(e.message));},5000);return()=>clearInterval(timer);},[refresh]);
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const unavailable=disabled||busy;
 return <details className="encryption-settings"><summary>{t('端到端加密')} · {t(!state?'读取中…':!state.enabled?'未启用':vault.keys?'本设备已解锁':'等待解锁')}</summary>
  <p>{t('对话、管家需求和同步附件在设备上加密。新设备需核对校验码并由已解锁设备批准，或使用恢复密钥。')}</p>
  <p className="muted">{t('调用 AI 时，选中的内容会在本机解密后发送给该模型服务。账号、成员关系和传输大小等元数据仍可被服务端看到。')}</p>
  {error&&<p role="alert">{error}</p>}
  {state&&!state.enabled&&!prepared&&<button className="btn" disabled={unavailable} onClick={()=>void run(async()=>{await beforeSetup();setPrepared(await vault.prepare());})}>{t('设置端到端加密')}</button>}
  {prepared&&<div><p>{t('保存这份恢复密钥。如果所有已解锁设备和恢复密钥都丢失，服务端无法恢复内容。')}</p><textarea readOnly aria-label={t('恢复密钥')} rows={2} value={prepared.recoveryKey}/><label><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)}/>{t('我已另存恢复密钥')}</label><div className="share-actions"><button className="btn primary" disabled={unavailable||!saved} onClick={()=>void run(async()=>{await setup(prepared);setPrepared(null);onChanged();})}>{t('启用并加密同步内容')}</button><button className="btn ghost" disabled={busy} onClick={()=>{setPrepared(null);setSaved(false);}}>{t('取消')}</button></div></div>}
  {state?.enabled&&!vault.keys&&<div><button className="btn" disabled={unavailable} onClick={()=>void run(async()=>setRequest(await vault.request(navigator.userAgent.includes('Android')?'Android':navigator.userAgent.includes('Electron')?'Desktop':'Browser')))}>{t('请求其他设备批准')}</button>{request&&<p>{t('请在两台设备核对相同校验码：')} <strong>{codes[request.id]}</strong><br/>{t('请求有效期为 15 分钟。')}</p>}<label>{t('或输入恢复密钥')}<input type="password" autoComplete="off" value={recovery} onChange={e=>setRecovery(e.target.value)}/></label><button className="btn" disabled={unavailable||!recovery.trim()} onClick={()=>void run(async()=>{await vault.recover(recovery,state);setRecovery('');onChanged();})}>{t('使用恢复密钥解锁')}</button></div>}
  {vault.keys&&state?.requests.filter(row=>!row.envelope).map(row=><div className="encryption-device" key={row.id}><p>{row.label} · <strong>{codes[row.id]}</strong></p><label><input type="checkbox" checked={approved.includes(row.id)} onChange={e=>setApproved(ids=>e.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/>{t('我正在连接这台设备，并已核对校验码')}</label><div className="share-actions"><button className="btn" disabled={unavailable||!approved.includes(row.id)} onClick={()=>void run(async()=>{await vault.approve(row);setApproved(ids=>ids.filter(id=>id!==row.id));})}>{t('批准设备')}</button><button className="btn ghost" disabled={unavailable} onClick={()=>void run(()=>vault.dismiss(row.id))}>{t('拒绝')}</button></div></div>)}
 </details>;
}
