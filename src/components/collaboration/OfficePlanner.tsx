import { localizeRoles } from '../../lib/role-locale';
import { useT, useLocale } from '../../lib/i18n';
import { libraryRoles } from '../../lib/office-library';
import ButlerPreferences from './ButlerPreferences';
import ProjectMemoryPanel from '../ProjectMemoryPanel';
import { addMemory, redactSecrets, type ProjectMemoryItem } from '../../lib/memory-core';
import { loadSkills, makeSkill, saveSkills, type Skill } from '../../lib/skills';
import { butlerContext, validLearning } from '../../lib/butler';
import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject } from '../../lib/collaboration';
import { uid, secretGet } from '../../lib/store';
import { AGENT_ROLES, ensureOffice, officeOf, type PlanningTurn } from '../../lib/office';
import { plannerSystem, parsePlannerReply, adoptProposal } from '../../lib/office-planner';
import { requestAssistant } from '../../lib/assistant-request';
import { probeCompatibility } from '../../lib/compatibility-probe';
import Markdown from '../Markdown';
export default function OfficePlanner({project,settings,update,onTask,onSettings,onSettingsChange,memoryItems=[],onMemory}:{project:TeamProject;settings:AppSettings;update:(fn:(p:TeamProject)=>void)=>Promise<unknown>;onTask:(id:string)=>void;onSettings:()=>void;onSettingsChange?:(fn:(s:AppSettings)=>AppSettings)=>void;memoryItems?:ProjectMemoryItem[];onMemory?:(fn:(items:ProjectMemoryItem[])=>ProjectMemoryItem[])=>void}){
  const tx=useT(),locale=useLocale();
  const [skills,setSkills]=React.useState<Skill[]>([]);React.useEffect(()=>{void loadSkills().then(setSkills).catch(()=>{});},[]);
  const roles=localizeRoles(libraryRoles(settings.officeLibrary,project.office?.customRoles),locale);
  const office=officeOf(project),[draft,setDraft]=React.useState(office.draft??''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const [brain,setBrain]=React.useState(office.brain??{profileId:settings.activeKeyProfileId??settings.keyProfiles[0]?.id??'',model:settings.defaultConfig.model});
  const control=React.useRef<AbortController|null>(null);React.useEffect(()=>{if(office.planning?.some(t=>t.pending))void update(p=>{for(const t of ensureOffice(p).planning??[])if(t.pending){t.pending=false;t.error=tx("上次筹备中断，可继续说明你的想法；已有记录保留。");}}).catch(()=>{});return()=>control.current?.abort();},[]);
  const profile=settings.keyProfiles.find(p=>p.id===brain.profileId),history=office.planning??[];
  async function send(text:string){
    if(control.current||!text.trim())return;if(!profile||!brain.model){setError(tx("先为协作设计助手选择一个已配置的模型。"));return;}
    const controller=new AbortController();control.current=controller;setBusy(true);setError('');setDraft('');
    const user:PlanningTurn={id:uid('plan'),role:'user',text:text.trim()},answer:PlanningTurn={id:uid('plan'),role:'assistant',text:'',pending:true};
    let raw='';
    try {
      await update(p=>{const o=ensureOffice(p);o.brain=brain;o.draft='';o.planning=[...(o.planning??[]),user,answer];});
      const key=await secretGet(profile.id);if(!key)throw Error(tx("此接入尚未保存 API Key，请到设置中填写。"));
      const compatibility=await probeCompatibility(profile,brain.model,key,{signal:controller.signal});if(compatibility.status!=='ready')throw Error(compatibility.note);
      const cfg={...settings.defaultConfig,model:brain.model,client:undefined,effortLevel:'off' as const,thinkingStyle:'auto' as const,stream:true,params:{...settings.defaultConfig.params,max_tokens:{enabled:true,value:4096},max_completion_tokens:{enabled:false,value:4096}}};
      const completedRuns=project.runs.filter(r=>['completed','failed','cancelled'].includes(r.status)).slice(-5).map(r=>({id:r.id,goal:r.goal,status:r.status,results:r.attempts.map(a=>({output:redactSecrets(a.output).text.slice(-4000),error:a.error}))}));
      const context={completedRuns,existingDepartments:office.departments.map(d=>({name:d.name,purpose:d.purpose,members:d.memberIds.map(id=>project.members.find(m=>m.id===id)?.name)})),conversation:[...history.filter(t=>!t.pending).map(t=>({role:t.role,text:t.text,proposal:t.proposal,questions:t.questions,learning:t.learning,learningDecisions:t.learningDecisions})),{role:'user',text:user.text}]};
      raw=await requestAssistant(profile,cfg,JSON.stringify(context),controller.signal,plannerSystem(roles)+'\nRespond in the user’s language; if unclear, use '+(settings.locale??'zh-Hans')+'.\n\n'+butlerContext(settings,office.instructions??'',memoryItems,skills,text),value=>{raw=value;});
      const reply=parsePlannerReply(raw,roles);
      const evidence=[...history.filter(t=>t.role==='user').map(t=>t.text),user.text,JSON.stringify(completedRuns)].join('\n');
      const learning=settings.butler?.learning===false?[]:validLearning(reply.learning,evidence);
      await update(p=>{const t=ensureOffice(p).planning?.find(t=>t.id===answer.id);if(t)Object.assign(t,{text:reply.message,questions:reply.questions,proposal:reply.proposal,learning,pending:false});});
    }catch(e){const message=controller.signal.aborted?tx("筹备已停止，已有内容保留。"):e instanceof Error?e.message:String(e);setError(message);await update(p=>{const t=ensureOffice(p).planning?.find(t=>t.id===answer.id);if(t)Object.assign(t,{text:raw||tx("没有收到完整方案。"),pending:false,error:message});}).catch(()=>{});}
    finally{control.current=null;setBusy(false);}
  }
  return <section className="office-planner" aria-label={tx("wickrunAI 管家")}>
    <div className="office-heading"><div><h2>{tx("先说说，你想做成什么？")}</h2><p>{tx("和管家商量目标、了解客户端、调整团队或复盘经验。它拟方案，你来决定。")}</p></div><details><summary>{tx("助手的模型")}</summary><div className="office-brain"><select aria-label={tx("设计助手接入")} value={brain.profileId} onChange={e=>setBrain({profileId:e.target.value,model:settings.cachedModels[e.target.value]?.[0]?.id??''})}>{settings.keyProfiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><input aria-label={tx("设计助手模型")} value={brain.model} list="office-planner-models" onChange={e=>setBrain({...brain,model:e.target.value})}/><datalist id="office-planner-models">{(settings.cachedModels[brain.profileId]??[]).map(m=><option key={m.id} value={m.id}/>)}</datalist><button className="btn sm" onClick={onSettings}>{tx("管理接入")}</button></div></details></div>
    <ButlerPreferences settings={settings} onSettings={onSettingsChange} projectRules={office.instructions??''} onProjectRules={text=>{void update(p=>{ensureOffice(p).instructions=text;}).catch(e=>setError(String(e)));}} skills={skills}/>
    {onMemory&&<details className="butler-memory"><summary>{tx("查看、修改管家的项目记忆")}</summary><ProjectMemoryPanel items={memoryItems} onChange={items=>onMemory(()=>items)} detailed/></details>}
    {!history.length&&<div className="office-examples">{[tx("我想做一个自媒体账号，但还没想清楚从哪里开始"),tx("帮我把一个产品想法变成能试用的原型"),tx("我有一套现成流程，想调整其中的分工")].map(text=><button className="btn" key={text} onClick={()=>setDraft(text)}>{text}</button>)}</div>}
    <div className="office-planning-history">{history.map((turn,i)=><article key={turn.id} className={`office-turn ${turn.role}`}>
      <strong>{turn.role==='user'?tx("你"):tx("wickrunAI 管家")}</strong>
      {turn.pending?<p role="status">{tx("正在梳理需求与可行方案…")}</p>:turn.error?<details open><summary>{turn.error}</summary><pre>{turn.text}</pre></details>:<Markdown text={turn.text}/>}
      {turn.questions?.map((q,index)=><div className="office-question" key={index}><p>{q.text}</p><div>{q.options.map(option=><button className="btn sm" disabled={busy} key={option} onClick={()=>setDraft(v=>(v?v+'\n':'')+`${q.text}：${option}`)}>{option}</button>)}</div></div>)}
      {turn.learning?.map((item,index)=><div className="butler-learning" key={index}><strong>{item.kind==='skill'?tx("可复用技能建议"):tx("值得记住的经验 / 偏好")}</strong><p>{item.text}</p><small>{tx("适用：")}{item.applicability}</small><blockquote>{tx("依据：")}{item.sourceQuote}</blockquote>{turn.learningDecisions?.[index]?<small>{turn.learningDecisions[index]==='saved'?tx("已保存，可在记忆或技能管理中调整"):tx("已忽略")}</small>:<div className="team-actions"><button className="btn sm" disabled={!onMemory&&item.kind!=='skill'} onClick={()=>{void (async()=>{if(item.kind==='skill'){const list=await loadSkills(),body=tx("适用：{p0}\n\n{p1}\n\n来源：管家对话 {p2}\n证据：{p3}",{p0:item.applicability,p1:item.text,p2:turn.id,p3:item.sourceQuote});if(!list.some(s=>s.body===body))await saveSkills([...list,makeSkill({name:'butler-'+turn.id.slice(-8)+'-'+index,description:item.applicability,body,enabled:false,source:tx("wickrunAI 管家：用户采用的学习草案")})]);}else onMemory?.(items=>addMemory(items,{text:item.text,kind:item.kind==='preference'?'preference':'lesson',source:'candidate',sourceRef:turn.id,applicability:item.applicability,evidence:item.sourceQuote}).items);await update(p=>{const t=ensureOffice(p).planning!.find(t=>t.id===turn.id)!;(t.learningDecisions??={})[index]='saved';});})().catch(e=>setError(String(e)));}}>{item.kind==='skill'?tx("保存为停用的技能草案"):tx("采用为项目记忆")}</button><button className="btn sm ghost" onClick={()=>{void update(p=>{const t=ensureOffice(p).planning!.find(t=>t.id===turn.id)!;(t.learningDecisions??={})[index]='dismissed';}).catch(e=>setError(String(e)));}}>{tx("忽略")}</button></div>}</div>)}
      {turn.proposal&&<details className="office-proposal" open={i===history.length-1}><summary>{tx("方案草案 ·")}{turn.proposal.title}</summary><p><strong>{tx("会交给你：")}</strong>{turn.proposal.deliverable}</p><p><strong>{tx("怎样判断做好了：")}</strong>{turn.proposal.acceptance}</p>
        {!!turn.proposal.assumptions.length&&<div className="office-assumptions"><strong>{tx("这份方案采用的假设")}</strong><ul>{turn.proposal.assumptions.map(a=><li key={a}>{a}</li>)}</ul></div>}
        <p><strong>{tx("团队分工：")}</strong>{turn.proposal.departments.map(d=>`${d.name}（${d.purpose}）`).join('；')}</p>
        <p>{turn.proposal.mode==='parallel'?tx("这些工作并行开展"):tx("按下面顺序接力")}</p><ol>{turn.proposal.steps.map((s,index)=><li key={index}><strong>{roles.find(r=>r.id===s.roleId)?.name}</strong>：{s.instruction}<small>{tx("交付：")}{s.output}</small></li>)}<li>{turn.proposal.reviewRoleId?tx("独立复核后，交给你验收"):tx("交给你验收（本方案未配置独立质检）")}</li></ol>
        <div className="team-actions">{turn.adoptedTaskId?<button className="btn" onClick={()=>onTask(turn.adoptedTaskId!)}>{tx("打开已准备的任务")}</button>:<button className="btn primary" disabled={busy||!!turn.questions?.length} onClick={()=>{setError('');void update(p=>{adoptProposal(p,turn,brain,roles);}).catch(e=>setError(String(e)));}}>{tx("采用方案，建立团队和任务草案")}</button>}<button className="btn" disabled={busy} onClick={()=>setDraft(tx("关于“{p0}”，我想调整：",{p0:turn.proposal!.title}))}>{tx("继续商量")}</button></div><small>{tx("采用会新增独立团队与流程，不会执行任务；之后在任务页检查并开始。当前快捷方案交付文本，文件、视频制作和外部发布需另配能力。")}</small>
      </details>}
    </article>)}</div>
    <form onSubmit={e=>{e.preventDefault();void send(draft);}}><textarea aria-label={tx("告诉协作设计助手你的想法")} placeholder={tx("例如：我想每周做两条短视频，面向刚开始健身的人。先帮我想想怎样开始。")} rows={3} value={draft} onChange={e=>{const value=e.target.value;setDraft(value);void update(p=>{ensureOffice(p).draft=value;}).catch(()=>{});}}/><div className="team-actions"><small>{tx("先筹备，后启动。也可以直接说出对方案的修改意见。")}</small>{busy?<button type="button" className="btn" onClick={()=>control.current?.abort()}>{tx("停止筹备")}</button>:<button className="btn primary" disabled={!draft.trim()}>{tx("一起想清楚")}</button>}</div></form>
    {error&&<p role="alert" className="team-error">{error}</p>}
  </section>;
}
