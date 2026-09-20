import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject } from '../../lib/collaboration';
import { quickTaskRoles, type QuickTaskChoice, type QuickRoleChoice, type QuickRoleId } from '../../lib/team-quick-start';
import { useT } from '../../lib/i18n';
import './TeamRoleSettings.css';

export default function TeamRoleSettings({settings, project, choice, busy, onChange}: {
 settings: AppSettings; project: TeamProject; choice: QuickTaskChoice; busy: boolean;
 onChange: (id: QuickRoleId, value?: QuickRoleChoice) => void;
}) {
 const tr=useT(), uid=React.useId();
 const profiles=settings.keyProfiles.filter(p=>!p.id.startsWith('client:')&&(!project.settings.allowedConnections.length||project.settings.allowedConnections.includes(p.id)));
 const members=project.members.filter(m=>m.enabled&&profiles.some(p=>p.id===m.connectionId));
 return <details className="team-role-settings">
  <summary>{tr('分别设置助手与职责')}</summary>
  <p className="team-note">{tr('默认使用上方模型。你可以只调整其中一位，也可以复制已有成员的配置；原成员和以前的运行不会改变。')}</p>
  {quickTaskRoles(choice.style,choice.fileScope).map(role=>{
   const value=choice.roles?.[role.id]??{profileId:choice.profileId,model:choice.model,instructions:role.instructions};
   const change=(patch:Partial<QuickRoleChoice>)=>onChange(role.id,{...value,...patch});
   const models=[...new Map([...(settings.cachedModels[value.profileId]??[]),...(settings.customModels?.[value.profileId]??[])].map(m=>[m.id,m])).values()];
   const id=uid+'-'+role.id;
   return <fieldset key={role.id} className="team-role-setting" disabled={busy} data-role={role.id}>
    <legend>{tr(role.title)}</legend>
    <label className="team-field"><span id={id+'-source'}>{tr('从已有成员复制配置')}</span><select aria-labelledby={id+'-source'} value={value.memberId??''} onChange={e=>{
     const member=members.find(m=>m.id===e.target.value);
     onChange(role.id,member?{memberId:member.id,profileId:member.connectionId,model:member.model,instructions:member.instructions.trim()||role.instructions}:undefined);
    }}><option value="">{tr('为此任务设置')}</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}{value.memberId&&!members.some(m=>m.id===value.memberId)&&<option value={value.memberId} disabled>{tr('原成员已不可用，请重新选择')}</option>}</select></label>
    <div className="team-form-grid">
     <label className="team-field"><span id={id+'-profile'}>{tr('模型接入')}</span><select aria-labelledby={id+'-profile'} value={value.profileId} onChange={e=>change({profileId:e.target.value,model:settings.cachedModels[e.target.value]?.[0]?.id??settings.customModels?.[e.target.value]?.[0]?.id??''})}>
      {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}{!profiles.some(p=>p.id===value.profileId)&&<option value={value.profileId} disabled>{tr('接入已不可用，请重新选择')}</option>}
     </select></label>
     <label className="team-field"><span id={id+'-model'}>{tr('模型')}</span><input aria-labelledby={id+'-model'} value={value.model} maxLength={200} list={id+'-models'} onChange={e=>change({model:e.target.value})} placeholder={tr('选择或输入模型 ID')}/><datalist id={id+'-models'}>{models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label>
    </div>
    <label className="team-field"><span id={id+'-instructions'}>{tr('这位助手负责什么？')}</span><textarea aria-labelledby={id+'-instructions'} rows={3} maxLength={12000} value={value.instructions} onChange={e=>change({instructions:e.target.value})}/></label>
    {choice.roles?.[role.id]&&<button type="button" className="btn sm" onClick={()=>onChange(role.id)}>{tr('恢复默认分工')}</button>}
   </fieldset>;
  })}
  <p className="team-note">{tr('这里只复用模型与职责。文件能力由本次任务选择，不继承原成员的工具、技能或自动换路由设置。')}</p>
 </details>;
}
