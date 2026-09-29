import React from 'react';
import { useT } from '../../lib/i18n';
import type { WorkspacePlan, WorkspaceEnvironment } from '../../lib/workspace-planner';
import type { TeamProject } from '../../lib/collaboration';
import { plannerRoutes } from '../../lib/office-planner';
import { addPlanMember, assignPlanStep, editPlanMember, memberReferences, normalizedPlanEffort, planEffortOptions, planMembers, removePlanMember, type PlanMember } from '../../lib/workspace-plan-edit';
import { compatibilityRoute } from '../../lib/compatibility-cache';
import { probeCompatibility } from '../../lib/compatibility-probe';
import { secretGet } from '../../lib/store';
import { TOOLS } from '../../lib/tools/registry';

export default function WorkspaceRosterEditor({plan,project,environment,disabled,onChange,onError}:{plan:WorkspacePlan;project:TeamProject;environment:WorkspaceEnvironment;disabled:boolean;onChange:(edit:(plan:WorkspacePlan)=>WorkspacePlan)=>void;onError:(text:string)=>void}){
  const tx=useT(),members=planMembers(plan),[selection,setSelection]=React.useState(members[0]?.ref??''),[query,setQuery]=React.useState(''),[template,setTemplate]=React.useState(''),[removing,setRemoving]=React.useState(false),[replacement,setReplacement]=React.useState('');
  const [probing,setProbing]=React.useState(false),[probeNote,setProbeNote]=React.useState(''),[,refresh]=React.useReducer(x=>x+1,0);
  const departments=plan.changes.filter(c=>c.kind==='department');
  const member=members.find(m=>m.ref===selection)??members[0],profile=environment.settings.keyProfiles.find(p=>p.id===member?.profileId);
  const routes=plannerRoutes(environment.settings,project,project.office?.brain??{profileId:environment.settings.activeKeyProfileId??'',model:environment.settings.defaultConfig.model});
  for(const m of project.members.filter(m=>m.connectionId.startsWith('client:')))if(!routes.some(r=>r.profileId===m.connectionId&&r.model===m.model))routes.push({profileId:m.connectionId,model:m.model,label:m.connectionId+' · '+m.model});
  const route=profile&&member?compatibilityRoute(profile,member.model):{},efforts=planEffortOptions(route),value=route.compatibility?.mode==='toggle'&&member?.effort!=='off'&&!route.effortStyle?'high':member?.effort??'off';
  const roles=environment.roles.filter(r=>!query||`${r.name} ${r.originalName??''} ${r.division}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  React.useEffect(()=>{const fn=()=>refresh();window.addEventListener('wickrun-compatibility',fn);return()=>window.removeEventListener('wickrun-compatibility',fn);},[]);
  React.useEffect(()=>{
    setProbeNote('');if(!profile||!member||disabled)return;
    if(route.compatibility?.status==='ready')return;
    const controller=new AbortController();setProbing(true);
    void (async()=>{const key=await secretGet(profile.id);if(!key)throw Error(tx('此接入尚未保存 API Key，请到设置中填写。'));const result=await probeCompatibility(profile,member.model,key,{signal:controller.signal});if(!controller.signal.aborted){refresh();setProbeNote(result.status==='ready'?tx('请求格式检测完成'):tx('检测暂未完成，请稍后重试。'));}})().catch(e=>{if(!controller.signal.aborted)setProbeNote(String(e instanceof Error?e.message:e));}).finally(()=>{if(!controller.signal.aborted)setProbing(false);});
    return()=>{controller.abort();setProbing(false);};
  },[member?.profileId,member?.model,disabled]);
  React.useEffect(()=>{
    if(!member||disabled)return;
    const effort=normalizedPlanEffort(member.effort,route);
    if(effort!==member.effort)onChange(plan=>editPlanMember(plan,member.ref,{effort}));
  },[member?.ref,member?.model,member?.profileId,member?.effort,route.compatibility?.at,route.effortStyle,disabled]);
  const patch=(p:Partial<PlanMember>)=>member&&onChange(plan=>editPlanMember(plan,member.ref,p));
  const add=()=>{const route=routes[0]??{profileId:'',model:''};let ref='';onChange(plan=>{const added=addPlanMember(plan,route,environment.roles.find(r=>r.id===template));ref=added.ref;return added.plan;});if(ref){setSelection(ref);setRemoving(false);}};
  const choose=(ref:string)=>{setSelection(ref);setRemoving(false);setReplacement('');};
  return <section className="workspace-roster" aria-label={tx('岗位操控面板')}>
    <header><div><h4>{tx('岗位与模型')}</h4><p>{tx('直接调整分工；修改自动保存在这份草稿中。')}</p></div></header>
    <div className="workspace-roster-layout">
      <div className="workspace-roster-list"><div className="workspace-roster-people" role="group" aria-label={tx('选择岗位')}>
        {members.map(m=><button type="button" className="workspace-roster-person" aria-pressed={m.ref===member?.ref} key={m.ref} onClick={()=>choose(m.ref)}><strong>{m.name||tx('未命名岗位')}</strong><small>{m.model||tx('请选择可用模型')}</small><small>{tx('思考强度')} · {tx(planEffortOptions(environment.settings.keyProfiles.some(p=>p.id===m.profileId)?compatibilityRoute(environment.settings.keyProfiles.find(p=>p.id===m.profileId)!,m.model):{}).find(e=>e.value===m.effort)?.label??m.effort)}</small></button>)}
        {!members.length&&<p>{tx('还没有岗位，先添加一个。')}</p>}
      </div><details className="workspace-roster-add" open={!members.length}><summary>{tx('新增岗位')}</summary><label>{tx('搜索角色模板')}<input value={query} onChange={e=>setQuery(e.target.value)} placeholder={tx('名称或分类')}/></label><label>{tx('角色模板')}<select value={template} onChange={e=>setTemplate(e.target.value)}><option value="">{tx('自定义岗位')}</option>{template&&!roles.some(r=>r.id===template)&&<option value={template}>{environment.roles.find(r=>r.id===template)?.name}</option>}{roles.map(r=><option key={r.id} value={r.id}>{r.name} · {tx(r.division)}</option>)}</select></label><button className="btn" disabled={disabled} onClick={add}>{tx('添加岗位')}</button></details></div>
      {member&&<div className="workspace-roster-editor" key={member.ref}>
        <fieldset disabled={disabled}><legend>{tx('编辑岗位：{name}',{name:member.name||tx('未命名岗位')})}</legend>
          <div className="workspace-roster-fields"><label>{tx('岗位名称')}<input maxLength={160} value={member.name??''} onChange={e=>patch({name:e.target.value})}/></label><label>{tx('所属部门')}<select aria-label={tx('所属部门')} value={departments.find(c=>c.existingId===member.department)?.ref??member.department??''} onChange={e=>patch({department:e.target.value||null})}><option value="">{tx('未分配部门')}</option>{plan.changes.filter(c=>c.kind==='department').map(c=><option key={c.ref} value={c.ref}>{c.name}</option>)}{project.office?.departments.filter(d=>!plan.changes.some(c=>c.kind==='department'&&(c.ref===d.id||c.existingId===d.id))).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label></div>
          <div className="workspace-roster-fields"><label>{tx('模型与接入')}<select aria-label={tx('模型与接入')} value={JSON.stringify([member.profileId,member.model])} onChange={e=>{const [profileId,model]=JSON.parse(e.target.value);patch({profileId,model,effort:'off'});}}>{!routes.some(r=>r.profileId===member.profileId&&r.model===member.model)&&<option value={JSON.stringify([member.profileId,member.model])}>{tx('请选择可用模型')} · {member.model}</option>}{routes.map(r=><option key={JSON.stringify([r.profileId,r.model])} value={JSON.stringify([r.profileId,r.model])}>{r.label}</option>)}</select></label><label>{tx('思考强度')}<select aria-label={tx('思考强度')} value={value} onChange={e=>patch({effort:e.target.value as PlanMember['effort']})}>{!efforts.some(e=>e.value===value)&&<option value={value} disabled>{tx('原强度不可用，请重选')}</option>}{efforts.map(e=><option key={e.value} value={e.value}>{tx(e.label)}</option>)}</select></label></div>
          <p className="hint" role="status">{probing?tx('正在检测此模型可用的思考设置…'):route.compatibility?.status==='ready'?tx(route.compatibility.mode==='toggle'?'此模型仅支持思考开关，不区分强度。':route.compatibility.mode==='default'?'此模型使用上游默认思考方式。':'仅显示此接入已验证可用的强度。'):probeNote||tx('强度按已有映射发送；尚未验证的档位不代表上游一定支持。')}</p>
          <label>{tx('职责与工作说明')}<textarea rows={5} value={member.instructions??''} maxLength={12000} onChange={e=>patch({instructions:e.target.value})}/></label>
          <details open={!plan.changes.some(c=>c.kind==='workflow'&&c.nodes.some(n=>memberReferences(member).has(n.member??'')||n.participants?.some(id=>memberReferences(member).has(id))))}><summary>{tx('参与步骤与讨论')}</summary><p className="hint">{tx('勾选讨论加入发言；执行步骤可选择负责人。质检会保持独立实例。')}</p>{plan.changes.filter(c=>c.kind==='workflow').map(flow=><div key={flow.ref}><strong>{flow.name}</strong>{flow.nodes.filter(n=>['agent','discussion','review','handoff'].includes(n.type)).map(n=>n.type==='discussion'?<label className="workspace-step-check" key={n.id}><input type="checkbox" checked={!!n.participants?.some(id=>memberReferences(member).has(id))} onChange={e=>onChange(plan=>assignPlanStep(plan,flow.ref,n.id,member.ref,e.target.checked))}/>{n.title}</label>:<label key={n.id}>{n.title}<select value={members.find(m=>memberReferences(m).has(n.member??''))?.ref??''} onChange={e=>onChange(plan=>assignPlanStep(plan,flow.ref,n.id,e.target.value,true))}><option value="" disabled>{tx('请选择负责岗位')}</option>{members.map(m=><option key={m.ref} value={m.ref}>{m.name||tx('未命名岗位')}</option>)}</select></label>)}</div>)}</details>
          <details><summary>{tx('工具与技能')}</summary><p>{tx('工具：')}{member.tools.length?member.tools.map(name=>tx(TOOLS.find(t=>t.name===name)?.label??name)).join('、'):tx('无')}</p><p>{tx('技能：')}{member.skills.length?member.skills.join('、'):tx('无')}</p></details>
          {!removing?<button className="btn ghost" onClick={()=>setRemoving(true)}>{tx('移除这个岗位')}</button>:<div className="workspace-roster-remove"><p>{tx('从这份安排移除；已有成员和历史记录保留。')}</p><label>{tx('由谁接替已有步骤')}<select aria-label={tx('由谁接替已有步骤')} value={replacement} onChange={e=>setReplacement(e.target.value)}><option value="">{tx('不接替，仅移除讨论席位')}</option>{members.filter(m=>m.ref!==member.ref).map(m=><option key={m.ref} value={m.ref}>{m.name||tx('未命名岗位')}</option>)}</select></label><div className="team-actions"><button className="btn" onClick={()=>{try{const next=removePlanMember(plan,member.ref,replacement||undefined);onChange(()=>next);setSelection(planMembers(next)[0]?.ref??'');setRemoving(false);}catch(e){onError(e instanceof Error?e.message:String(e));}}}>{tx('确认移除岗位')}</button><button className="btn ghost" onClick={()=>setRemoving(false)}>{tx('取消')}</button></div></div>}
        </fieldset>
      </div>}
    </div>
  </section>;
}
