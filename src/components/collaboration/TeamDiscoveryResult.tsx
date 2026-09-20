import React from 'react';
import type { TeamTask, TeamRun } from '../../lib/collaboration';
import { discoveryResult } from '../../lib/team-discovery';
import { readDiscoveryPlan } from '../../lib/team-discovery-plan';
import { useT } from '../../lib/i18n';
import Markdown from '../Markdown';

export default function TeamDiscoveryResult({task,run,onAdopt,onRefine}:{task:TeamTask;run:TeamRun;onAdopt:()=>Promise<void>;onRefine:(text:string)=>Promise<void>}){
 const tr=useT(),result=discoveryResult(task,run);
 const [reply,setReply]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 if(!result)return null;
 const plan=readDiscoveryPlan(result.text);
 return <section className="team-discovery-result" aria-label={tr('方向与下一步建议')}>
  <h3>{tr('方向与下一步建议')}</h3><p className="team-note">{tr('这是供你选择的建议，实际任务尚未开始。可以补充想法再讨论，也可以修改建议后建立下一项任务。')}</p>
  <Markdown text={plan?.body||result.proposal?.body||result.text}/>
  {plan&&plan.items.length>1&&<ol>{plan.items.map(item=><li key={item.id}><strong>{item.title}</strong><p>{item.goal}</p><p className="team-note">{item.dependsOn.length?tr('先完成并验收：{tasks}',{tasks:item.dependsOn.map(id=>plan.items.find(item=>item.id===id)?.title??id).join('、')}):tr('没有前置任务，可单独准备。')}</p></li>)}</ol>}
  {result.proposal&&<dl className="team-proposed-brief"><dt>{tr('建议目标')}</dt><dd>{result.proposal.goal}</dd><dt>{tr('建议的完成标准')}</dt><dd>{result.proposal.acceptance}</dd></dl>}
  {!plan&&!result.proposal&&<p className="team-note">{tr('模型未提供可直接带入的任务建议，你仍可阅读上方结果并手动填写下一步。')}</p>}
  <p className="team-note">{tr('选择下一步会结束本轮梳理，不表示同意执行方案。')}</p>
  {error&&<p role="alert">{error}</p>}
  <button className="btn primary" disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);setError('');try{await onAdopt();}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}}>{tr(plan?'选择并编辑下一步任务':'修改建议，建立下一项任务')}</button>
  <form onSubmit={async e=>{e.preventDefault();if(busy||!reply.trim())return;setBusy(true);setError('');try{await onRefine(reply.trim());setReply('');}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}}>
   <label className="team-field"><span>{tr('还有想补充的？')}</span><textarea rows={2} value={reply} onChange={e=>setReply(e.target.value)} placeholder={tr('回答上面的问题，或说说你更喜欢哪个方向。')}/></label>
   <button className="btn" disabled={busy||!reply.trim()}>{tr('带着补充继续梳理')}</button><span className="team-note">{tr('下一步确认后才开始调用模型。')}</span>
  </form>
 </section>;
}
