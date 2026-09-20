import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject, TeamTask } from '../../lib/collaboration';
import { prepareQuickTask, type QuickTaskChoice, type QuickWorkStyle } from '../../lib/team-quick-start';
import { useT } from '../../lib/i18n';
import TeamFlowPreview from './TeamFlowPreview';

export default function TeamTaskSetup({settings,project,task,onPrepare,onSettings}:{settings:AppSettings;project:TeamProject;task:TeamTask;onPrepare:(choice:QuickTaskChoice)=>Promise<void>;onSettings:()=>void}){
 const tr=useT();
 const profiles=settings.keyProfiles.filter(p=>!project.settings.allowedConnections.length||project.settings.allowedConnections.includes(p.id));
 const initial=profiles.find(p=>p.id===settings.activeKeyProfileId)??profiles[0];
 const modelsFor=(id:string)=>[...new Map([...(settings.cachedModels[id]??[]),...(settings.customModels?.[id]??[])].map(m=>[m.id,m])).values()];
 const firstModel=(id:string)=>modelsFor(id).find(m=>m.id===settings.defaultConfig.model)?.id??modelsFor(id)[0]?.id??'';
 const [profileId,setProfileId]=React.useState(initial?.id??'');
 const [model,setModel]=React.useState(()=>initial?firstModel(initial.id):'');
 const [workStyle,setStyle]=React.useState<QuickWorkStyle>('direct');
 const style=task.intent==='explore'?'explore':workStyle;
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const listId=React.useId(),models=modelsFor(profileId);
 const preview=React.useMemo(()=>{
  try{const copy=structuredClone(project);const prepared=prepareQuickTask(copy,task.id,{profileId,model,style},profiles.map(p=>p.id));return {workflow:copy.workflows.find(f=>f.id===prepared.flowId)!,members:copy.members};}catch{return null;}
 },[project,task.id,profileId,model,style]);
 const prepare=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onPrepare({profileId,model,style});}catch(error){setError(tr(String(error instanceof Error?error.message:error)));}finally{setBusy(false);}};
 return <form className="team-task-setup" onSubmit={prepare} aria-label={tr('准备任务')}>
  <h3>{tr(style==='explore'?'先一起理清方向':'选择怎么完成这项任务')}</h3>
  <p className="team-setup-intro">{tr(style==='explore'?'一位助手探索可能的方向，另一位整理问题和下一步建议。你不需要先设计流程。':'先从文本任务开始。成员和流程会自动准备好，之后仍可编辑。')}</p>
  {profiles.length?<>
   <div className="team-form-grid">
    <label className="team-field"><span>{tr('模型接入')}</span><select value={profileId} onChange={e=>{const id=e.target.value;setProfileId(id);setModel(firstModel(id));}} disabled={busy}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="team-field"><span>{tr('模型')}</span><input required value={model} list={listId} onChange={e=>setModel(e.target.value)} disabled={busy} placeholder={tr('选择或输入模型 ID')}/><datalist id={listId}>{models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label>
   </div>
   {style!=='explore'&&<fieldset className="team-work-styles"><legend>{tr('工作方式')}</legend>{([
    ['direct','直接完成','适合范围清楚的小任务，一位助手完成后交给你。'],
    ['discuss','先讨论再完成','适合需要比较思路的任务，两位助手讨论后交付。'],
    ['review','完成后独立复核','适合需要检查的文本，第二位助手核对，不通过时有限返工。'],
   ] as const).map(([value,label,description])=><label key={value}><input type="radio" name={listId+'-style'} checked={style===value} onChange={()=>setStyle(value)} disabled={busy}/><span><strong>{tr(label)}</strong><small>{tr(description)}</small></span></label>)}</fieldset>}
   <p className="team-note">{tr('使用所选模型，不自动切换路由；不启用文件或命令工具。文件任务和更多定制在下方高级设置。')}</p>
   {error&&<p role="alert">{error}</p>}
   <button className="btn primary" disabled={busy||!model.trim()||!profiles.some(p=>p.id===profileId)}>{tr(busy?'正在准备…':'准备并检查')}</button>
   <span className="team-note">{tr('下一步确认后才开始调用模型。')}</span>
   {preview&&<TeamFlowPreview workflow={preview.workflow} members={preview.members} proposed/>}
  </>:<><p>{tr('当前项目没有可用的 API 接入。请先添加接入，或在项目设置中允许已有接入。')}</p><button type="button" className="btn" onClick={onSettings}>{tr('管理模型与接入')}</button></>}
 </form>;
}
