import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject } from '../../lib/collaboration';
import type { QuickTaskChoice, QuickWorkStyle } from '../../lib/team-quick-start';
import { useT } from '../../lib/i18n';

export default function TeamTaskSetup({settings,project,onPrepare,onSettings}:{settings:AppSettings;project:TeamProject;onPrepare:(choice:QuickTaskChoice)=>Promise<void>;onSettings:()=>void}){
 const tr=useT();
 const profiles=settings.keyProfiles.filter(p=>!project.settings.allowedConnections.length||project.settings.allowedConnections.includes(p.id));
 const initial=profiles.find(p=>p.id===settings.activeKeyProfileId)??profiles[0];
 const modelsFor=(id:string)=>[...new Map([...(settings.cachedModels[id]??[]),...(settings.customModels?.[id]??[])].map(m=>[m.id,m])).values()];
 const firstModel=(id:string)=>modelsFor(id).find(m=>m.id===settings.defaultConfig.model)?.id??modelsFor(id)[0]?.id??'';
 const [profileId,setProfileId]=React.useState(initial?.id??'');
 const [model,setModel]=React.useState(()=>initial?firstModel(initial.id):'');
 const [style,setStyle]=React.useState<QuickWorkStyle>('direct');
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const listId=React.useId(),models=modelsFor(profileId);
 const prepare=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onPrepare({profileId,model,style});}catch(error){setError(tr(String(error instanceof Error?error.message:error)));}finally{setBusy(false);}};
 return <form className="team-task-setup" onSubmit={prepare} aria-label={tr('准备任务')}>
  <h3>{tr('选择怎么完成这项任务')}</h3>
  <p className="team-setup-intro">{tr('先从文本任务开始。成员和流程会自动准备好，之后仍可编辑。')}</p>
  {profiles.length?<>
   <div className="team-form-grid">
    <label className="team-field"><span>{tr('模型接入')}</span><select value={profileId} onChange={e=>{const id=e.target.value;setProfileId(id);setModel(firstModel(id));}} disabled={busy}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="team-field"><span>{tr('模型')}</span><input required value={model} list={listId} onChange={e=>setModel(e.target.value)} disabled={busy} placeholder={tr('选择或输入模型 ID')}/><datalist id={listId}>{models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label>
   </div>
   <label className="team-field"><span>{tr('工作方式')}</span><select value={style} onChange={e=>setStyle(e.target.value as QuickWorkStyle)} disabled={busy}>
    <option value="direct">{tr('直接完成 · 1 位成员')}</option><option value="discuss">{tr('先讨论再完成 · 2 位成员')}</option><option value="review">{tr('完成后独立复核 · 2 位成员')}</option>
   </select></label>
   <p className="team-setup-description">{tr(style==='direct'?'一位成员完成文本，最后由你验收。':style==='discuss'?'两位成员先讨论，再由执行成员交付；会增加模型调用。':'执行成员交付后，另一位成员引用原文复核；未通过可有限返工，会增加模型调用。')}</p>
   <p className="team-note">{tr('使用所选模型，不自动切换路由；不启用文件或命令工具。文件任务和更多定制在下方高级设置。')}</p>
   {error&&<p role="alert">{error}</p>}
   <button className="btn primary" disabled={busy||!model.trim()||!profiles.some(p=>p.id===profileId)}>{tr(busy?'正在准备…':'准备并检查')}</button>
   <span className="team-note">{tr('下一步确认后才开始调用模型。')}</span>
  </>:<><p>{tr('当前项目没有可用的 API 接入。请先添加接入，或在项目设置中允许已有接入。')}</p><button type="button" className="btn" onClick={onSettings}>{tr('管理模型与接入')}</button></>}
 </form>;
}
