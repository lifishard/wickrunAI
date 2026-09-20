import React from 'react';
import type { TeamRun } from '../../lib/collaboration';
import { teamRunGuidance } from '../../lib/team-run-guidance';
import { useT } from '../../lib/i18n';

export default function TeamRunGuidance({run}:{run:TeamRun}) {
 const tr=useT(),guidance=teamRunGuidance(run);
 const [,tick]=React.useReducer(n=>n+1,0);
 React.useEffect(()=>{if(!guidance.retryAt)return;const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[guidance.retryAt]);
 const seconds=guidance.retryAt?Math.max(0,Math.ceil((guidance.retryAt-Date.now())/1000)):null;
 const latest=[...run.attempts].reverse().find(a=>a.output.trim()&&!['start','end','condition','join','parallel','review'].includes(run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type??''));
 return <section className="team-run-guidance" aria-label={tr('当前状态与下一步')}>
  <h3 aria-live="polite">{tr(guidance.title)}</h3><p>{tr(guidance.next)}</p>
  {seconds!==null&&<p>{seconds>0?tr('预计 {n} 秒后重试',{n:seconds}):tr('等待模型重试结果，时间以服务方响应为准。')}</p>}
  {guidance.detail&&['verify','paused','question'].includes(guidance.kind)&&<details><summary>{tr('查看停止原因')}</summary><pre>{guidance.detail}</pre></details>}
  {latest&&<details className="team-current-result" open={guidance.kind==='accept'||guidance.kind==='done'}><summary>{tr('本次已有结果')}</summary><pre>{latest.output}</pre></details>}
 </section>;
}
