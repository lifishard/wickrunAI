import type { ChatMessage, DeliveryRequirement, Milestone, RunState } from '../types';

export const mergeProgress = <T extends {id:string}>(old:T[] = [], updates:T[] = []):T[] =>
  structuredClone([...new Map([...old,...updates].map(item=>[item.id,item])).values()]);

export function validProgressEvidence(state:RunState,e:string):boolean {
  return [...(state.contextArchiveSteps??[]),...(state.steps??[])].some(s=>(s.id===e||s.callId===e)&&s.status==='ok'&&!['update_plan','update_requirements','verify_requirements','read_skill','recall_past_task'].includes(s.name)) ||
    (e.startsWith('text:')&&e.length>15&&[state.content??'',...[...(state.contextArchive??[]),...state.working].filter(m=>m.role==='assistant').map(m=>m.content)].some(text=>text.includes(e.slice(5))));
}
export function milestonePassed(id:string,requirements:DeliveryRequirement[]=[]):boolean {
  const checks=requirements.filter(r=>r.milestoneId===id);
  return checks.length>0&&checks.every(r=>r.verification?.revision===r.revision&&r.verification.status==='passed');
}
export function progressHistory(item:Milestone,reason:string):NonNullable<Milestone['history']> {
  return [...(item.history??[]),{title:item.title,status:item.status,acceptance:item.acceptance,evidence:[...item.evidence],reason,at:Date.now()}].slice(-30);
}
/** A failed check revokes completion; a new turn alone never does. */
export function reconcileProgress(state:Pick<RunState,'milestones'|'requirements'>):void {
  for(const m of state.milestones??[])if(m.status==='completed'&&!milestonePassed(m.id,state.requirements)){
    const failure=state.requirements?.find(r=>r.milestoneId===m.id&&r.verification?.status==='failed');
    const reason=failure?`质检未通过：${failure.verification!.detail}`:'完成证据已保留，等待当前验收条件的质检';
    m.history=progressHistory(m,reason);m.status='verifying';m.note=reason;m.updatedAt=Date.now();
  }
}
/** Count consecutive failures of the same acceptance revision, across model switches. */
export function qualityLoop(state:Pick<RunState,'requirements'>):string|undefined {
  const r=state.requirements?.find(r=>{
    if(r.verification?.status!=='failed'||r.verification.revision!==r.revision)return false;
    const checks=[...(r.verificationHistory??[]),...(r.verification?[r.verification]:[])].filter(v=>v.revision===r.revision).slice(-3);
    return checks.length===3&&checks.every(v=>v.status==='failed');
  });
  return r?`“${r.title}”连续三次质检未通过。已有失败记录保留，请先定位原因并改变修复方法，避免继续重复检查。`:undefined;
}
export const qualityCheckpoint=(state:Pick<RunState,'requirements'>)=>JSON.stringify((state.requirements??[]).map(r=>[r.id,r.revision,r.verification,r.verificationHistory?.length??0]));
/** The sidebar plan is conversation-scoped; selecting a round changes only its execution log. */
export function visibleProgress(messages:ChatMessage[]) {
  let boundary=0;messages.forEach((m,i)=>{if(m.role==='user'&&m.quoteOnly)boundary=i;});
  let milestones:Milestone[]=[],requirements:DeliveryRequirement[]=[];
  const scoped=messages.slice(boundary);
  for(const m of scoped.filter(m=>m.role==='assistant')){
    milestones=mergeProgress(milestones,m.runState?.milestones??m.milestones);
    requirements=mergeProgress(requirements,m.runState?.requirements??m.delivery?.requirements);
  }
  const result={milestones,requirements};reconcileProgress(result);
  return {...result,steps:scoped.flatMap(m=>[...(m.runState?.contextArchiveSteps??[]),...(m.steps??m.runState?.steps??[])]),
    saved:[...scoped].reverse().find(m=>m.progress)?.progress};
}
