import React from 'react';
import { useT } from '../lib/i18n';
import { feedbackSnapshot, setTaskFeedback, type TaskFeedback as Feedback, type UserOutcome, type FeedbackReason, type CorrectionKind } from '../lib/observations';

export default function TaskFeedback({taskId,onOutcome,onCorrection,onReplay}:{
  taskId?:string;
  /** 这次任务的结论定了，记到当时用过的技能头上 */
  onOutcome?:(recordId:string,done:boolean)=>void;
  /** 把纠错写到该去的地方；返回写进了哪儿，用来回执给用户 */
  onCorrection?:(recordId:string,kind:CorrectionKind,note:string)=>Promise<string>;
  onReplay?:(recordId:string)=>void;
}) {
  const t = useT();
  const [feedback,setFeedback]=React.useState<Feedback|undefined>();const [current,setCurrent]=React.useState(false);const [available,setAvailable]=React.useState(false);const [busy,setBusy]=React.useState(false);
  const [note,setNote]=React.useState('');const [kind,setKind]=React.useState<CorrectionKind>('process');const [saved,setSaved]=React.useState('');
  React.useEffect(()=>{let live=true;const update=()=>{void feedbackSnapshot(taskId??'').then(s=>{if(live){setAvailable(s.available);setFeedback(s.feedback);setCurrent(s.current);}});};update();window.addEventListener('anyai:observations',update);return()=>{live=false;window.removeEventListener('anyai:observations',update);};},[taskId]);
  if(!taskId||!available)return null;
  const save=async(outcome?:UserOutcome,reason?:FeedbackReason)=>{
    setBusy(true);
    try{
      await setTaskFeedback(taskId,outcome?{outcome,reason,at:Date.now(),note:feedback?.note,correction:feedback?.correction}:undefined);
      // 只有「可用」和「未解决」是明确的结论；「部分可用」说不清，不拿去记技能的账
      if(outcome==='usable')onOutcome?.(taskId,true);
      else if(outcome==='unresolved')onOutcome?.(taskId,false);
    }finally{setBusy(false);}
  };
  const submitCorrection=async()=>{
    const text=note.trim();
    if(!text||!onCorrection)return;
    setBusy(true);
    try{
      const where=await onCorrection(taskId,kind,text);
      await setTaskFeedback(taskId,{...feedback!,note:text,correction:kind,at:Date.now()});
      setSaved(where);setNote('');
    }finally{setBusy(false);}
  };
  return <div className="task-feedback" aria-label={t('任务结果反馈')}><span>{t('这次结果可用吗？')}<small>{t('可选，仅保存到本机')}</small></span>
    {feedback&&!current?<p>{t('此前反馈属于较早阶段；这次续跑后的结果尚未评价。')}</p>:null}
    <div className="recovery-actions">{([['usable',t('可用')],['partial',t('部分可用')],['unresolved',t('未解决')]] as const).map(([value,label])=><button className={`btn sm ${current&&feedback?.outcome===value?'primary':'ghost'}`} aria-pressed={current&&feedback?.outcome===value} disabled={busy} key={value} onClick={()=>void save(value,current?feedback?.reason:undefined)}>{label}</button>)}
    {feedback?<button className="btn sm ghost" disabled={busy} onClick={()=>void save()}>{t('撤回反馈')}</button>:null}</div>
    {feedback&&current&&feedback.outcome!=='usable'?<>
      <label>{t('主要原因（可选）')}<select aria-label={t('反馈原因')} value={feedback.reason??''} disabled={busy} onChange={e=>void save(feedback.outcome,(e.target.value||undefined) as FeedbackReason|undefined)}><option value="">{t('暂不选择')}</option><option value="omission">{t('有遗漏')}</option><option value="incorrect">{t('内容错误')}</option><option value="artifact">{t('产物问题')}</option><option value="interrupted">{t('执行中断')}</option><option value="other">{t('其他')}</option></select></label>
      {onCorrection?<details className="task-correction"><summary>{t('把这次纠错留下来')}</summary>
        <p className="hint">{t('先分清错在哪一层：改错地方的纠错不会起作用。知识缺口写进项目记忆，流程问题写进项目规范。')}</p>
        <label>{t('这次错在哪一层')}<select aria-label={t('纠错类型')} value={kind} disabled={busy} onChange={e=>setKind(e.target.value as CorrectionKind)}>
          <option value="process">{t('流程问题：步骤、顺序、该核验没核验')}</option>
          <option value="knowledge">{t('知识缺口：它不知道某个事实或约定')}</option>
        </select></label>
        <textarea aria-label={t('哪里不对')} rows={3} maxLength={2000} value={note} disabled={busy}
          onChange={e=>setNote(e.target.value)} placeholder={t('用一句话说清哪里不对、正确的应该是什么')}/>
        <div className="recovery-actions">
          <button className="btn sm primary" disabled={busy||!note.trim()} onClick={()=>void submitCorrection()}>{t('保存这条纠错')}</button>
          {onReplay?<button className="btn sm" disabled={busy} onClick={()=>onReplay(taskId)}>{t('用同样的要求重做一次')}</button>:null}
        </div>
        {saved?<p className="hint">{t('已写入{where}。重做一次同样的任务，才知道这条纠错管不管用 —— 存下来本身不等于改进。',{where:saved})}</p>:null}
      </details>:null}
    </>:null}
  </div>;
}
