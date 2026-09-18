import React from 'react';
import { useT } from '../lib/i18n';
import type { RunState } from '../types';
import { recoveryInfo } from '../lib/delivery';

export default function RecoveryCard({state,onResume,onCompact,onHandoff,onAddInput,onResolve}:{state:RunState;onResume:()=>void;onCompact?:()=>void;onHandoff?:()=>void;onAddInput?:(text:string)=>void;onResolve?:(choice:'skip'|'retry')=>void}) {
  const t = useT();
  const [text,setText] = React.useState('');
  const info = recoveryInfo(state);
  return <section className="recovery-card" aria-label={t('任务恢复')}>
    <strong>{t('进度已保存 · ')}{t(info.kind === 'uncertain' ? '需要核实操作结果':'可以从这里继续')}</strong>
    <p>{info.reason}</p>
    {info.completed.length ? <p>{t('已完成步骤：')}{info.completed.join('；')}{t('（交付检查见下方）')}</p>:null}
    {info.outputPaths.length ? <details><summary>{t('已保存 {n} 个成果文件', { n: info.outputPaths.length })}</summary>{info.outputPaths.map(p=><p className="delivery-path" key={p}>{p}</p>)}<small>{t('可从本条回答的文件卡片打开。')}</small></details>:null}
    {info.target ? <p className="delivery-path">{t('当前操作：')}{info.target}</p>:null}
    {info.remaining.length ? <p>{t('待处理：')}{info.remaining.join('；')}</p>:null}
    <p><strong>{t('下一步：')}</strong>{info.next}</p>
    {info.kind === 'uncertain' ? <div className="recovery-actions">
      <button className="btn sm" disabled={!onResolve} onClick={()=>onResolve?.('skip')}>{t('我已核实，跳过此步')}</button>
      <button className="btn sm" disabled={!onResolve} onClick={()=>onResolve?.('retry')}>{t('允许重试此步')}</button>
    </div> : <>
      <div className="recovery-actions">
        <button className="btn sm primary" onClick={onResume}>{t('接着跑')}</button>
        {onCompact ? <button className="btn sm" onClick={onCompact}>{t('压缩后继续')}</button> : null}
        {onHandoff ? <button className="btn sm" onClick={onHandoff}>{t('新窗口交接')}</button> : null}
      </div>
      <p className="hint">{t('压缩会整理可归档的历史，保留用户要求与可检索原文，然后从已保存的位置继续。也可在新对话中审阅交接草稿后再发送。')}</p>
      {onAddInput ? <details className="recovery-input"><summary>{t('补充信息后继续')}</summary>
        <textarea aria-label={t('补充恢复信息')} value={text} maxLength={12000} onChange={e=>setText(e.target.value)} placeholder={t('补充缺少的资料、修正要求或说明接下来怎么做')} rows={3}/>
        <button className="btn sm" disabled={!text.trim()} onClick={()=>{onAddInput(text.trim());setText('');}}>{t('补充并接着跑')}</button>
      </details>:null}
    </>}
  </section>;
}
