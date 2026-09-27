import React from 'react';
import {desktop} from '../lib/transport';
import type {UpdateState} from '../lib/updates';
import {useT} from '../lib/i18n';
export default function UpdatePanel(){
 const t=useT(),[state,setState]=React.useState<UpdateState|null>(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
 React.useEffect(()=>{let alive=true;const refresh=()=>void desktop()?.updateState().then(s=>{if(alive)setState(s);}).catch(e=>{if(alive)setError(String(e));});refresh();const timer=setInterval(refresh,5000);return()=>{alive=false;clearInterval(timer);};},[]);
 const act=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();setState(await desktop()!.updateState());}catch(e){setError(String(e));}finally{setBusy(false);}};
 if(!desktop())return null;
 const labels:Record<string,string>={idle:'等待检查',checking:'正在检查更新',current:'已是最新正式版本',available:'发现新版本',downloading:'正在下载更新',downloaded:'已下载，退出应用时安装',error:'更新检查失败'};
 return <section className="settings-section"><h3>{t('应用更新')}</h3><p>{t('跟随 GitHub 正式发布自动检查更新，每四小时检查一次。下载期间可继续工作，关闭窗口不会中断任务。')}</p>
 {state?<><label className="row"><input type="checkbox" checked={state.enabled} disabled={busy||state.mode==='development'} onChange={e=>void act(()=>desktop()!.updateSetEnabled(e.target.checked))}/>{t('自动检查并下载更新')}</label><p role="status">{state.currentVersion} → {state.version??state.currentVersion} · {t(labels[state.status])}{state.status==='downloading'?` ${Math.round(state.percent)}%`:''}</p>
 {state.mode==='manual'?<p>{t('此安装方式需要手动升级：未签名的 macOS、便携版和 Linux deb 暂不自动安装。可打开发布页下载。')}</p>:null}
 {state.mode==='development'?<p>{t('开发环境不安装更新。')}</p>:<div className="row"><button className="btn sm" disabled={busy} onClick={()=>void act(()=>desktop()!.updateCheck())}>{t('检查更新')}</button>{state.mode==='automatic'&&state.status==='downloaded'?<button className="btn sm" disabled={busy} onClick={()=>void act(()=>desktop()!.updateInstall())}>{t('保存并重启安装')}</button>:null}<button className="btn sm" onClick={()=>void act(()=>desktop()!.updateOpenRelease())}>{t('打开发布页')}</button></div>}{state.error?<p role="alert">{state.error}</p>:null}</>:null}{error?<p role="alert">{error}</p>:null}
 </section>;
}
