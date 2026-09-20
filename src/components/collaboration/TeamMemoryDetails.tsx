import type { MemoryEntry, TeamRun } from '../../lib/collaboration';
import { selectTeamMemories } from '../../lib/team-memory';

export const memoryKinds={fact:'事实',preference:'偏好',experience:'经验'};
const reasonLabels:Record<string,string>={
 'selected: matching task keyword':'已选入：任务关键词匹配','selected: project scope':'已选入：项目通用',
 'omitted: expired at or before selection time':'未选入：创建运行时已过期','omitted: no task keyword match':'未选入：任务关键词未匹配',
 'omitted: memory exceeds context limit':'未选入：单条超过上下文上限','omitted: context limit reached':'未选入：上下文容量已满',
 'omitted: status is not adopted':'未选入：尚未采用','omitted: empty text':'未选入：内容为空',
 'omitted: task scope requires keywords':'未选入：任务范围缺少关键词',
};
export function TeamMemoryFields({value,onChange}:{value:MemoryEntry;onChange:(value:MemoryEntry)=>void}){
 const localDate=value.expiresAt&&Number.isFinite(value.expiresAt)?new Date(value.expiresAt-new Date(value.expiresAt).getTimezoneOffset()*60000).toISOString().slice(0,16):'';
 return <>
  <div className="team-form-grid">
   <label className="team-field"><span>记忆类型</span><select value={value.kind??'experience'} onChange={e=>onChange({...value,kind:e.target.value as MemoryEntry['kind']})}>{Object.entries(memoryKinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label className="team-field"><span>适用范围</span><select value={value.scope??'project'} onChange={e=>onChange({...value,scope:e.target.value as MemoryEntry['scope']})}><option value="project">项目通用</option><option value="task">匹配任务关键词</option></select></label>
  </div>
  {value.scope==='task'&&<label className="team-field"><span>任务关键词（逗号分隔）</span><input value={(value.keywords??[]).join(',')} onChange={e=>onChange({...value,keywords:e.target.value.split(/[,，]/)})}/><small>任一词出现在目标或验收条件中即可选入；这是字面匹配。</small></label>}
  <label className="team-field"><span>过期时间（本地时间，可留空）</span><input type="datetime-local" value={localDate} onChange={e=>onChange({...value,expiresAt:e.target.value?new Date(e.target.value).getTime():undefined})}/></label>
  <p className="team-note">按运行创建时的版本和时间筛选，续跑保持一致；选入上下文最多 6000 字符，超限记忆整条略过。</p>
 </>;
}
export function TeamMemoryAudit({run}:{run:TeamRun}){
 const selection=selectTeamMemories(run.memorySnapshot,run,{now:run.createdAt});
 return <details className="team-attempt"><summary>本次记忆选择 · {selection.snapshots.length} 条 · {selection.totalChars} / {selection.maxChars} 字符</summary>
  <p className="team-note">从创建运行时冻结的已采用版本中筛选；关键词匹配不代表内容已验证为真。</p>
  {selection.audit.map((item,i)=><p key={`${item.id}:${i}`}>{run.memorySnapshot.find(m=>m.id===item.id)?.title??item.id} · v{item.revision} · {reasonLabels[item.reason]??'未选入：记忆格式无效'}</p>)}
  {!!selection.prompt&&<details><summary>查看选入的完整内容</summary><pre>{selection.prompt}</pre></details>}
 </details>;
}
