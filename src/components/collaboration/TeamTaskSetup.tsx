import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject, TeamTask, TeamFileScope } from '../../lib/collaboration';
import { prepareQuickTask, quickTaskRoles, type QuickTaskChoice, type QuickWorkStyle, type QuickRoleChoice, type QuickRoleId } from '../../lib/team-quick-start';
import { useT } from '../../lib/i18n';
import TeamFlowPreview from './TeamFlowPreview';
import TeamRoleSettings from './TeamRoleSettings';
import TeamFileSetup from './TeamFileSetup';

export default function TeamTaskSetup({settings,project,task,onPrepare,onSavePreset,onRemovePreset,onSettings}:{settings:AppSettings;project:TeamProject;task:TeamTask;onPrepare:(choice:QuickTaskChoice)=>Promise<void>;onSavePreset:(name:string,choice:QuickTaskChoice)=>Promise<string>;onRemovePreset:(id:string)=>Promise<void>;onSettings:()=>void}){
 const tr=useT();
 const profiles=settings.keyProfiles.filter(p=>!p.id.startsWith('client:')&&(!project.settings.allowedConnections.length||project.settings.allowedConnections.includes(p.id)));
 const initial=profiles.find(p=>p.id===settings.activeKeyProfileId)??profiles[0];
 const modelsFor=(id:string)=>[...new Map([...(settings.cachedModels[id]??[]),...(settings.customModels?.[id]??[])].map(m=>[m.id,m])).values()];
 const firstModel=(id:string)=>modelsFor(id).find(m=>m.id===settings.defaultConfig.model)?.id??modelsFor(id)[0]?.id??'';
 const [profileId,setProfileId]=React.useState(initial?.id??'');
 const [model,setModel]=React.useState(()=>initial?firstModel(initial.id):'');
 const [workStyle,setStyle]=React.useState<QuickWorkStyle>('direct');
 const [roles,setRoles]=React.useState<Partial<Record<QuickRoleId,QuickRoleChoice>>>({});
 const [fileScope,setFileScope]=React.useState<TeamFileScope|undefined>();
 const [presetId,setPresetId]=React.useState(''),[presetName,setPresetName]=React.useState(''),[notice,setNotice]=React.useState('');
 const style=task.intent==='explore'?'explore':workStyle;
 const [busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
 const listId=React.useId(),models=modelsFor(profileId);
 const choice:QuickTaskChoice={profileId,model,style,roles,fileScope};
 const changed=()=>{setPresetId('');setNotice('');setError('');};
 const useForAll=(nextProfile:string,nextModel:string)=>{
  setProfileId(nextProfile);setModel(nextModel);
  setRoles(previous=>Object.fromEntries(Object.entries(previous).map(([id,value])=>[id,{...value,profileId:nextProfile,model:nextModel}])));
  changed();setNotice(tr('已将全部助手改为所选模型；各自职责保持不变。'));
 };
 const presets=(project.quickPresets??[]).filter(p=>(p.choice.style==='explore')===(task.intent==='explore')&&(!fileScope||p.choice.style!=='discuss'));
 const preview=React.useMemo(()=>{
  try{const copy=structuredClone(project);const prepared=prepareQuickTask(copy,task.id,{profileId,model,style,roles,fileScope},profiles.map(p=>p.id));return {workflow:copy.workflows.find(f=>f.id===prepared.flowId)!,members:copy.members,error:''};}catch(error){return {error:tr(String(error instanceof Error?error.message:error))};}
 },[project,task.id,profileId,model,style,roles,fileScope,settings.keyProfiles]);
 const prepare=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await onPrepare(choice);}catch(error){setError(tr(String(error instanceof Error?error.message:error)));}finally{setBusy(false);}};
 return <form className="team-task-setup" onSubmit={prepare} aria-label={tr('准备任务')}>
  <h3>{tr(style==='explore'?'先一起理清方向':'选择怎么完成这项任务')}</h3>
  <p className="team-setup-intro">{tr(style==='explore'?'一位助手探索可能的方向，另一位整理问题和下一步建议。你不需要先设计流程。':'选择文本或文件任务，助手和流程会自动准备好。开始前可以检查实际安排。')}</p>
  {profiles.length?<>
   {style!=='explore'&&<fieldset className="team-work-styles"><legend>{tr('这次任务需要什么？')}</legend>
    <label><input type="radio" name={listId+'-kind'} checked={!fileScope} disabled={busy} onChange={()=>{setFileScope(undefined);changed();}}/><span><strong>{tr('只处理文本')}</strong><small>{tr('写作、讨论或整理想法，不访问本地文件。')}</small></span></label>
    <label><input type="radio" name={listId+'-kind'} checked={!!fileScope} disabled={busy} onChange={()=>{setFileScope({root:project.settings.roots.length===1?project.settings.roots[0]:'',capability:'read'});if(workStyle==='discuss'){setStyle('direct');setRoles(previous=>previous.executor?{executor:previous.executor}:{});}changed();}}/><span><strong>{tr('处理文件')}</strong><small>{tr('选择目录，再决定只读材料还是允许修改。')}</small></span></label>
   </fieldset>}
   {fileScope&&<TeamFileSetup scope={fileScope} roots={project.settings.roots} busy={busy} onChange={value=>{setFileScope(value);changed();}}/>}
   {!!presets.length&&<div className="team-preset-controls"><label className="team-field"><span id={listId+'-preset'}>{tr('使用已保存的团队方案')}</span><select aria-labelledby={listId+'-preset'} value={presetId} disabled={busy} onChange={e=>{
    const preset=presets.find(p=>p.id===e.target.value);if(!preset){setPresetId('');return;}
    const saved=structuredClone(preset.choice);setProfileId(saved.profileId);setModel(saved.model);setStyle(saved.style);setRoles(saved.roles??{});setPresetId(preset.id);setPresetName('');setError('');setNotice(tr('方案已载入，可继续调整；尚未准备或开始任务。'));
   }}><option value="">{tr('选择团队方案')}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    {presetId&&<button type="button" className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await onRemovePreset(presetId);setPresetId('');setNotice(tr('已删除保存的方案；当前设置和已有任务保留。'));}catch(e){setError(String(e instanceof Error?e.message:e));}finally{setBusy(false);}}}>{tr('删除方案')}</button>}
   </div>}
   <div className="team-form-grid">
    <label className="team-field"><span id={listId+'-profile'}>{tr('统一模型接入')}</span><select aria-labelledby={listId+'-profile'} value={profileId} onChange={e=>useForAll(e.target.value,firstModel(e.target.value))} disabled={busy}>{profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}{!profiles.some(p=>p.id===profileId)&&<option value={profileId} disabled>{tr('接入已不可用，请重新选择')}</option>}</select></label>
    <label className="team-field"><span>{tr('统一模型')}</span><input value={model} maxLength={200} list={listId} onChange={e=>useForAll(profileId,e.target.value)} disabled={busy} placeholder={tr('选择或输入模型 ID')}/><datalist id={listId}>{models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label>
   </div>
   <p className="team-note">{tr('修改统一模型会应用到所有助手。需要不同模型时，在下方分别设置；实际安排以助手列表为准。')}</p>
   {style!=='explore'&&<fieldset className="team-work-styles"><legend>{tr('工作方式')}</legend>{([
    ['direct','直接完成','适合范围清楚的小任务，一位助手完成后交给你。'],
    ['discuss','先讨论再完成','适合需要比较思路的任务，两位助手讨论后交付。'],
    ['review','完成后独立复核','第二位助手核对交付，不通过时有限返工；最后由你验收。'],
   ] as const).filter(([value])=>!fileScope||value!=='discuss').map(([value,label,description])=><label key={value}><input type="radio" name={listId+'-style'} checked={style===value} onChange={()=>{setStyle(value);setRoles(previous=>previous.executor?{executor:previous.executor}:{});changed();}} disabled={busy}/><span><strong>{tr(label)}</strong><small>{tr(description)}</small></span></label>)}</fieldset>}
   {fileScope&&style==='review'&&<p className="team-note">{tr(fileScope.capability==='read'?'复核分析结论的文本；不会把文本引用当成已核实文件事实。':'复核助手读取本次文件产物；未取得实际检查证据时会请你核实。')}</p>}
   <TeamRoleSettings settings={settings} project={project} choice={choice} busy={busy} onChange={(id,value)=>{setRoles(previous=>{const next={...previous};if(value)next[id]=value;else delete next[id];return next;});changed();}}/>
   <ul className="team-role-summary" aria-label={tr('本次助手安排')}>{quickTaskRoles(style,fileScope).map(role=>{
    const value=roles[role.id]??{profileId,model};return <li key={role.id}><strong>{tr(role.title)}</strong> · {profiles.find(p=>p.id===value.profileId)?.name??tr('接入已不可用，请重新选择')} · {value.model||tr('尚未选择模型')}</li>;
   })}</ul>
   <p className="team-note">{tr('每位助手使用上面列出的模型，不自动换路由。只有你选择的文件能力会启用。')}</p>
   <details className="team-preset-save"><summary>{tr('保存为可复用的团队方案')}</summary><p className="team-note">{tr('保存工作方式、各位助手的模型与职责。不会保存任务内容、权限或密钥；下次载入后仍需检查并确认开始。')}</p>
    <label className="team-field"><span>{tr('方案名称')}</span><input value={presetName} maxLength={80} disabled={busy} onChange={e=>setPresetName(e.target.value)} placeholder={tr('例如：写作与复核')}/></label>
    <button type="button" className="btn" disabled={busy||!!preview.error||!presetName.trim()} onClick={async()=>{if(busy)return;setBusy(true);setError('');try{const id=await onSavePreset(presetName,choice);setPresetId(id);setNotice(tr('团队方案已保存；未创建运行或调用模型。'));}catch(e){setError(tr(String(e instanceof Error?e.message:e)));}finally{setBusy(false);}}}>{tr('保存团队方案')}</button>
   </details>
   {notice&&<p role="status" className="team-note">{notice}</p>}
   {preview.error&&<p role="status">{preview.error}</p>}
   {error&&<p role="alert">{error}</p>}
   <button className="btn primary" disabled={busy||!!preview.error}>{tr(busy?'正在准备…':'准备并检查')}</button>
   <span className="team-note">{tr('下一步确认后才开始调用模型。')}</span>
   {preview.workflow&&preview.members&&<TeamFlowPreview workflow={preview.workflow} members={preview.members} proposed/>}
  </>:<><p>{tr('当前项目没有可用的 API 接入。请先添加接入，或在项目设置中允许已有接入。')}</p><button type="button" className="btn" onClick={onSettings}>{tr('管理模型与接入')}</button></>}
 </form>;
}
