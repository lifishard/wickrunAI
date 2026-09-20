import React from 'react';
import type { TeamProject } from '../../lib/collaboration';
import { adoptedPlanTasks, discoverySelectionIssues, type DiscoveryPlanDraft } from '../../lib/team-discovery-plan';
import { useT } from '../../lib/i18n';
import { Modal } from '../ui';
import './TeamTaskDependencies.css';

export default function TeamPlanEditor({project, value, onChange, onSave, onDiscard, onClose}: {
 project: TeamProject; value: DiscoveryPlanDraft; onChange: (value: DiscoveryPlanDraft) => void;
 onSave: () => Promise<void>; onDiscard: () => Promise<void>; onClose: () => void;
}) {
 const tr = useT(), fieldId = React.useId(), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
 const existing = adoptedPlanTasks(project, value), issues = discoverySelectionIssues(project, value);
 const patch = (id: string, fields: Partial<DiscoveryPlanDraft['items'][number]>) => onChange({...value, items: value.items.map(item => item.id === id ? {...item, ...fields} : item)});
 return <Modal title={tr('选择并编辑下一步任务')} onClose={() => {if (!busy) onClose();}} footer={<><button className="btn" disabled={busy} onClick={async () => {
  if (busy) return; setBusy(true); setError(''); try {await onDiscard();} catch (e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}
 }}>{tr('放弃草稿')}</button><button className="btn primary" disabled={busy || !!issues.length} onClick={async () => {
  if (busy) return; setBusy(true); setError(''); try {await onSave();} catch (e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}
 }}>{tr(busy ? '正在保存…' : '保存所选任务')}</button></>}>
  <div className="team-plan-editor">
   <p>{tr('勾选你要做的事，再修改目标和完成标准。保存后不会立即执行，开始时再选择助手和工作方式。')}</p>
   <p className="team-note">{tr('有前置任务时，必须等它完成并经你验收，才能开始后续任务。后续任务会收到已验收的文本产出。')}</p>
   {value.items.map(item => <section key={item.id} className="team-plan-item">
    <label className="team-check"><input type="checkbox" checked={item.selected} disabled={busy || existing.has(item.id)} onChange={e => patch(item.id, {selected: e.target.checked})}/><strong>{item.title || tr('未命名任务')}</strong>{existing.has(item.id) && <span>{tr('已建立')}</span>}</label>
    {item.choiceGroup && <p className="team-note">{tr('备选方向 {group}：同组只选一项。', {group: item.choiceGroup})}</p>}
    {item.selected && !existing.has(item.id) && <fieldset disabled={busy}>
     <label className="team-field"><span id={`${fieldId}-${item.id}-title`}>{tr('任务名称')}</span><input aria-labelledby={`${fieldId}-${item.id}-title`} value={item.title} maxLength={200} onChange={e => patch(item.id, {title: e.target.value})}/></label>
     <label className="team-field"><span id={`${fieldId}-${item.id}-goal`}>{tr('你希望完成什么？')}</span><textarea aria-labelledby={`${fieldId}-${item.id}-goal`} rows={2} value={item.goal} maxLength={12000} onChange={e => patch(item.id, {goal: e.target.value})}/></label>
     <label className="team-field"><span id={`${fieldId}-${item.id}-acceptance`}>{tr('怎样算做好？')}</span><textarea aria-labelledby={`${fieldId}-${item.id}-acceptance`} rows={2} value={item.acceptance} maxLength={12000} onChange={e => patch(item.id, {acceptance: e.target.value})}/></label>
     <p className="team-note">{item.dependsOn.length ? tr('先完成并验收：{tasks}', {tasks: item.dependsOn.map(id => value.items.find(item => item.id === id)?.title ?? id).join('、')}) : tr('没有前置任务，可单独准备。')}</p>
     {value.items.length > 1 && <details><summary>{tr('调整先后关系')}</summary>{value.items.filter(other => other.id !== item.id).map(other => <label key={other.id} className="team-check"><input type="checkbox" checked={item.dependsOn.includes(other.id)} onChange={e => patch(item.id, {dependsOn: e.target.checked ? [...item.dependsOn, other.id] : item.dependsOn.filter(id => id !== other.id)})}/>{other.title || tr('未命名任务')}</label>)}</details>}
    </fieldset>}
   </section>)}
   {!!issues.length && <p role="status">{issues[0]}</p>}
   {error && <p role="alert">{error}</p>}
   <p className="team-note">{tr('关闭后会保留编辑草稿，可从总览继续。')}</p>
  </div>
 </Modal>;
}
