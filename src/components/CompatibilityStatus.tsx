import { useT } from '../lib/i18n';
import React from 'react';
import type { KeyProfile } from '../types';
import { secretGet } from '../lib/store';
import { compatibilityKey, readCompatibility } from '../lib/compatibility-cache';
import { probeCompatibility } from '../lib/compatibility-probe';
export default function CompatibilityStatus({profile,model}:{profile:KeyProfile;model:string}){
  const tx=useT();
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[,refresh]=React.useReducer(x=>x+1,0);
  const id=compatibilityKey(profile,model),report=readCompatibility(profile,model);
  React.useEffect(()=>{const update=()=>refresh();window.addEventListener('wickrun-compatibility',update);return()=>window.removeEventListener('wickrun-compatibility',update);},[]);
  const detect=React.useCallback(async(force=false,signal?:AbortSignal)=>{
    if(!model||!profile.baseUrl||!profile.hasSecret||profile.protocol==='anthropic')return;
    setBusy(true);setError('');
    try{const key=await secretGet(profile.id);if(key&&!signal?.aborted)await probeCompatibility(profile,model,key,{force,signal});}
    catch(e){if(!signal?.aborted)setError(String(e));}finally{if(!signal?.aborted){setBusy(false);refresh();}}
  },[id,profile.hasSecret]);
  React.useEffect(()=>{const control=new AbortController();setBusy(false);setError('');const timer=setTimeout(()=>{void detect(false,control.signal);},1200);return()=>{clearTimeout(timer);control.abort();};},[detect]);
  if(!profile.hasSecret||profile.protocol==='anthropic')return null;
  return <details className="compatibility-status"><summary>{busy?tx("正在检测请求兼容性…"):report?.status==='ready'?tx("请求格式已检测"):tx("请求兼容性")} <small>{report?.mode==='levels'?tx("可调强度"):report?.mode==='toggle'?tx("思考开关"):''}</small></summary>
    <p>{error||(report?.note?tx(report.note):'')||tx("选定模型后自动发送少量短请求，验证此端点接受的格式。最多 16 次，每次输出上限 128 token，可能使用上游额度。")}</p>
    <button className="btn sm" disabled={busy} onClick={()=>void detect(true)}>{tx("重新检测")}</button>
    {report&&<details><summary>{tx("查看验证记录和请求格式")}</summary><p>{tx("检测时间：")}{new Date(report.at).toLocaleString()} {tx("· 仅验证请求兼容性，不保证模型遵从强度。")}</p><pre>{JSON.stringify({model,requests:report.requests,outputField:report.outputField,evidence:report.evidence},null,2)}</pre></details>}
  </details>;
}
