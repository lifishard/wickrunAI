import React from 'react';
import { desktop } from '../lib/transport';
import { useT } from '../lib/i18n';
export default function ClaudeHandoff({task}:{task:{taskId?:string;prompt?:string;status?:string}}){
 const t=useT(),[copied,setCopied]=React.useState(false),[error,setError]=React.useState('');
 if(!task.prompt||!task.taskId||task.status==='completed')return null;
 return <section className="recovery-card" aria-label={t('交给 Claude')}>
  <strong>{t(task.status==='working'?'Claude 正在处理':'任务指令已准备好')}</strong>
  <p>{t('复制下面的完整指令，粘贴到 Claude 发送即可。连接在线不代表 Claude 已开始执行；额度和授权由 Claude 管理。')}</p>
  <div className="recovery-actions"><button className="btn sm primary" onClick={()=>void Promise.resolve().then(()=>navigator.clipboard.writeText(task.prompt!)).then(()=>{setCopied(true);setError('');}).catch(()=>setError(t('复制失败，请在下方选中完整指令复制。')))}>{t(copied?'已复制':'复制任务指令')}</button>
  {desktop()?<button className="btn sm" onClick={()=>void desktop()!.nativeAiOpen('claude-desktop',task.taskId).catch(e=>setError(String(e)))}>{t('打开 Claude Desktop')}</button>:null}</div>
  <details open={!!error}><summary>{t('查看完整任务指令')}</summary><textarea aria-label={t('完整任务指令')} readOnly value={task.prompt} rows={6} style={{width:'100%'}} onFocus={e=>e.currentTarget.select()}/></details>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
