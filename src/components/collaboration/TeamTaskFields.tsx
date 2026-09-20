import React from 'react';
import type { TeamTask, Member } from '../../lib/collaboration';
import { useT } from '../../lib/i18n';

export default function TeamTaskFields({value,onChange,members,isNew}:{value:TeamTask;onChange:(value:TeamTask)=>void;members:Member[];isNew:boolean}){
 const tr=useT(),explore=value.intent==='explore';
 return <div className="team-task-fields">
  {isNew&&!value.sourceRunId&&<fieldset className="team-intent"><legend>{tr('从哪里开始？')}</legend>
   <label><input type="radio" name="task-intent" checked={explore} onChange={()=>onChange({...value,intent:'explore'})}/><span><strong>{tr('帮我理清想法')}</strong><small>{tr('只有一个念头也可以，先看看有哪些方向。')}</small></span></label>
   <label><input type="radio" name="task-intent" checked={!explore} onChange={()=>onChange({...value,intent:'deliver',acceptance:''})}/><span><strong>{tr('我知道要做什么')}</strong><small>{tr('直接说明要完成的事，选择合适的协作方式。')}</small></span></label>
  </fieldset>}
  {value.sourceRunId&&<p className="team-note">{tr('以下内容是模型建议，请按你的决定修改。保存后还需选择工作方式，不会立即执行。')}</p>}
  <label className="team-field"><span>{tr(explore?'你在想做什么？':'你希望完成什么？')}</span><textarea autoFocus rows={4} value={value.goal} placeholder={tr(explore?'比如：我想办一场社区活动，但还没想好做什么。':'写下希望得到的结果，可以随时修改。')} onChange={e=>onChange({...value,goal:e.target.value})}/></label>
  {explore?<p className="team-note">{tr('不用先写计划或完成标准。两位助手会探索方向、整理建议；本轮只产出方案，由你决定下一步。')}</p>:<label className="team-field"><span>{tr('怎样算做好？')}</span><textarea rows={3} placeholder={tr('例如：给出三个方案，说明时间、费用和各自的取舍。')} value={value.acceptance} onChange={e=>onChange({...value,acceptance:e.target.value})}/></label>}
  <details><summary>{tr('更多设置：名称与负责人')}</summary>
   <label className="team-field"><span>{tr('任务名称（可选）')}</span><input value={value.title} placeholder={tr('留空时使用想法的开头')} onChange={e=>onChange({...value,title:e.target.value})}/></label>
   {!explore&&members.some(m=>m.enabled)&&<label className="team-field"><span>{tr('负责人')}</span><select value={value.ownerId??''} onChange={e=>onChange({...value,ownerId:e.target.value||undefined})}><option value="">{tr('未指定')}</option>{members.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
  </details>
 </div>;
}
