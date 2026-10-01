import React from 'react';
import { useT } from '../../lib/i18n';
import { CLIENT_LABELS, type ClientKind } from '../../lib/connections';
import { loadSkills, makeSkill, saveSkills } from '../../lib/skills';
import { DEFAULT_BUTLER_PREFERENCES, emptyButlerBrain, type ButlerProactivePreferences,
  type ButlerResultRef, type ButlerRuntimeAction, type ButlerRuntimeController, type ButlerRuntimeSnapshot,
  type ButlerSource } from '../../lib/proactive-butler';
import type { AppSettings } from '../../types';
import './ProactiveButlerPanel.css';

const SOURCE_LABEL:Record<ButlerSource,string>={wickrun:'wickrunAI 对话与任务',browser:'浏览器活动',desktop:'电脑应用活动',android:'Android 活动',integration:'已连接应用',share:'主动分享的链接'};
const EXTERNAL:ButlerSource[]=['browser','desktop','android','integration','share'];
const CLIENTS:ClientKind[]=['codex','claude','kimi','grok','claude-desktop'];
const FALLBACK:ButlerRuntimeSnapshot={brain:emptyButlerBrain('local'),host:{status:'unavailable'},busy:false,sources:{}};
const noop=()=>()=>{};
const fallback=()=>FALLBACK;

export default function ProactiveButlerPanel({settings,onSettings,controller,onOpenResult}:{
  settings:AppSettings;
  onSettings?:(update:(s:AppSettings)=>AppSettings)=>void;
  controller?:ButlerRuntimeController;
  onOpenResult?:(result:ButlerResultRef)=>void;
}) {
  const t=useT();
  const subscription=React.useMemo(()=>controller?{
    subscribe:(listener:()=>void)=>controller.subscribe(listener),get:()=>controller.getSnapshot(),
  }:{subscribe:noop,get:fallback},[controller]);
  const snapshot=React.useSyncExternalStore(subscription.subscribe,subscription.get,subscription.get);
  const pref:ButlerProactivePreferences={...DEFAULT_BUTLER_PREFERENCES,...settings.butler?.proactive,
    sources:{...DEFAULT_BUTLER_PREFERENCES.sources,...settings.butler?.proactive?.sources}};
  const routeBackend:Extract<ButlerProactivePreferences['backend'],{kind:'route-group'}>=pref.backend.kind==='route-group'?pref.backend:{kind:'route-group',routeGroupId:'',effort:'medium'};
  const nativeBackend:Extract<ButlerProactivePreferences['backend'],{kind:'native'}>=pref.backend.kind==='native'?pref.backend:{kind:'native',client:{kind:'codex',model:''}};
  const [error,setError]=React.useState('');
  const [working,setWorking]=React.useState(false);
  const [corrections,setCorrections]=React.useState<Record<string,string>>({});
  const [link,setLink]=React.useState('');
  const [sourceScope,setSourceScope]=React.useState<Partial<Record<ButlerSource,string>>>({});
  const availableGroups=(settings.routeGroups??[]).filter(g=>g.routes.length>0);
  const latestBriefs=[...snapshot.brain.briefs].sort((a,b)=>b.createdAt-a.createdAt).slice(0,4);
  const goals=[...snapshot.brain.goals].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,20);
  const proposals=snapshot.brain.skillProposals.filter(p=>p.status==='proposed').slice(0,10);
  const jobs=[...(snapshot.brain.jobs??[])].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
  const signals=new Map(snapshot.brain.signals.map(s=>[s.id,s]));
  const canEdit=!!onSettings;

  const act=async(action:ButlerRuntimeAction)=>{
    if(!controller)return;
    setWorking(true);setError('');
    try{await controller.action(action);}catch(e){setError(String(e));}finally{setWorking(false);}
  };
  const save=(next:ButlerProactivePreferences)=>{
    onSettings?.(s=>({...s,butler:{...s.butler,proactive:next}}));
  };
  const change=(part:Partial<ButlerProactivePreferences>)=>save({...pref,...part});
  const toggleSource=async(source:ButlerSource,on:boolean)=>{
    if(source!=='wickrun' && controller){
      setWorking(true);setError('');
      try{
        const allowlist=(sourceScope[source]??snapshot.sources[source]?.allowlist?.join(',')??'').split(',').map(s=>s.trim()).filter(Boolean);
        if(on && ['browser','desktop','integration'].includes(source) && !allowlist.length)throw Error(t('先填写允许的站点、应用或连接范围。'));
        if(on)await controller.action({kind:'configure-source',source,allowlist});
        await controller.action({kind:'set-device-consent',source,consented:on});
      }
      catch(e){setError(String(e));setWorking(false);return;}
      setWorking(false);
    }
    change({sources:{...pref.sources,[source]:on}});
  };
  const adoptSkill=async(id:string)=>{
    const proposal=snapshot.brain.skillProposals.find(p=>p.id===id && p.status==='proposed');
    if(!proposal || !controller)return;
    setWorking(true);setError('');
    try{
      const existing=await loadSkills();
      const source=`wickrunAI Butler proposal ${proposal.id}`;
      if(!existing.some(s=>s.source===source))await saveSkills([...existing,makeSkill({name:proposal.name,description:proposal.description,
        body:proposal.body,enabled:false,source})]);
      await controller.action({kind:'review-skill',proposalId:id,decision:'accept'});
    }catch(e){setError(String(e));}finally{setWorking(false);}
  };
  const evidence=(ids:string[])=>ids.map(id=>signals.get(id)).filter((s):s is NonNullable<typeof s>=>!!s);
  const result=(ref:ButlerResultRef|undefined)=>{
    if(!ref)return null;
    if(ref.kind==='url'&&ref.url)return <a href={ref.url} target="_blank" rel="noreferrer">{t('查看结果')}</a>;
    if(onOpenResult)return <button className="btn sm ghost" onClick={()=>onOpenResult(ref)}>{t('查看结果')}</button>;
    return <span className="butler-ref">{t('结果引用')} · {ref.id}</span>;
  };
  const inactive=!pref.enabled||pref.paused;

  return <section className="proactive-butler" aria-label={t('主动管家')}>
    <header className="proactive-head"><div><h2>{t('主动管家')}</h2><p>{t('把你明确提出的目标和可选择的活动线索汇成可审阅的建议；由选定的常开电脑执行定时研究与简报。')}</p></div>
      <span className={`proactive-state ${inactive?'off':'on'}`}>{!pref.enabled?t('已关闭'):pref.paused?t('已暂停'):t('已启用')}</span></header>
    <div className="proactive-privacy"><strong>{t('启用前了解数据范围')}</strong><p>{t('默认只使用 wickrunAI 内的对话与任务。浏览器、电脑、Android、已连接应用和分享链接都要分别启用，并在收集设备上单独同意。外部原始活动、截图和密码内容留在本机；仅有界的主题与意图摘要可用于模型并随账号同步。已有 API 密钥仍按现有加密密钥同步方式处理。你可随时暂停、关闭或撤销来源。')}</p>
      <p>{t('活动线索只能形成待核对的假设，不会自动认定你的兴趣或目标。金融与谈判动作另需针对具体账户、对象、动作和金额的明确授权；风险声明本身不构成授权。')}</p></div>
    <div className="proactive-actions"><label className="team-check"><input type="checkbox" checked={pref.enabled} disabled={!canEdit} onChange={e=>change({enabled:e.target.checked,paused:false})}/>{t('启用主动管家')}</label>
      {pref.enabled&&<button className="btn sm" disabled={working} onClick={()=>{change({paused:!pref.paused});void act({kind:pref.paused?'resume':'pause'});}}>{pref.paused?t('继续'):t('紧急暂停')}</button>}
      {pref.enabled&&<button className="btn sm ghost" disabled={working} onClick={()=>{change({enabled:false,paused:true});void act({kind:'turn-off'});}}>{t('关闭')}</button>}</div>
    <div className="proactive-grid">
      <section className="proactive-card"><h3>{t('活动来源')}</h3><p>{t('先开总开关，再单独选择来源。未接通的来源不会假装正在收集。')}</p>
        {(['wickrun',...EXTERNAL] as ButlerSource[]).map(source=>{
          const cap=snapshot.sources[source],external=source!=='wickrun';
          const scoped=['browser','desktop','integration'].includes(source);
          const allowlist=(sourceScope[source]??cap?.allowlist?.join(',')??'').split(',').map(s=>s.trim()).filter(Boolean);
          return <div className="proactive-source-block" key={source}>
            <label className="proactive-source"><input type="checkbox" checked={!!pref.sources[source]}
              disabled={!canEdit||working||(external&&!cap?.available)} onChange={e=>void toggleSource(source,e.target.checked)}/>
              <span><strong>{t(SOURCE_LABEL[source])}</strong><small>{external?cap?.available?(cap.consented?t('本机已同意'):t('需要本机同意')):t(cap?.note||'此设备尚未提供该来源'):t('应用内来源')}</small></span></label>
            {cap?.available&&scoped&&<div className="proactive-scope"><label className="team-field"><span>{t(source==='browser'?'允许的域名（逗号分隔）':source==='desktop'?'允许的应用进程名（逗号分隔）':'允许的连接（逗号分隔）')}</span><input value={sourceScope[source]??cap.allowlist?.join(', ')??''} disabled={!canEdit||working} placeholder={source==='browser'?'example.com, docs.example.org':source==='desktop'?'chrome.exe, code.exe':''} onChange={e=>setSourceScope(s=>({...s,[source]:e.target.value}))}/></label><button className="btn sm ghost" disabled={!controller||working||!allowlist.length} onClick={()=>void act({kind:'configure-source',source,allowlist})}>{t('保存范围')}</button><small>{t('只采集列出的范围。关闭来源会撤销本机同意。')}</small></div>}
          </div>;
        })}
        {snapshot.deviceId&&<button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'install-browser-extension'})}>{t('安装浏览器扩展')}</button>}
        <p className="hint">{t('不读取私信、密码页、视频或声音；Instagram 收藏等平台接口可能不可用。Android 将通过主动分享入口接入，未提供时不可选择。')}</p>
      </section>
      <section className="proactive-card"><h3>{t('执行电脑与模型')}</h3><p>{t('手机可查看与发起任务；定时工作由同一账号下选定的常开电脑运行。')}</p>
        <div className="proactive-host"><strong>{snapshot.host.deviceName||t('尚未选择执行电脑')}</strong><span>{t(snapshot.host.status==='local'?'当前设备':snapshot.host.status==='connected'?'已连接':snapshot.host.status==='offline'?'离线':'不可用')}{snapshot.host.lastSeenAt?` · ${new Date(snapshot.host.lastSeenAt).toLocaleString()}`:''}</span></div>
        {snapshot.deviceId&&snapshot.host.deviceId!==snapshot.deviceId&&<button className="btn sm" disabled={working||!controller} onClick={()=>{change({hostDeviceId:snapshot.deviceId});void act({kind:'select-host',deviceId:snapshot.deviceId!});}}>{t('将本机设为执行电脑')}</button>}
        <label className="team-field"><span>{t('模型来源')}</span><select value={pref.backend.kind} disabled={!canEdit} onChange={e=>change({backend:e.target.value==='native'?{kind:'native',client:{kind:'codex',model:''}}:{kind:'route-group',routeGroupId:availableGroups[0]?.id??'',effort:'medium'}})}><option value="route-group">{t('API 路由组')}</option><option value="native">{t('本机订阅客户端')}</option></select></label>
        {pref.backend.kind==='route-group'?<><label className="team-field"><span>{t('路由组')}</span><select value={routeBackend.routeGroupId} disabled={!canEdit} onChange={e=>change({backend:{...routeBackend,routeGroupId:e.target.value}})}><option value="">{t('请选择')}</option>{availableGroups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.routes.length}</option>)}</select></label><label className="team-field"><span>{t('思考强度')}</span><select value={routeBackend.effort} disabled={!canEdit} onChange={e=>change({backend:{...routeBackend,effort:e.target.value as typeof routeBackend.effort}})}>{['off','low','medium','high','xhigh','max'].map(x=><option key={x} value={x}>{x}</option>)}</select></label></>
          :<><label className="team-field"><span>{t('客户端')}</span><select value={nativeBackend.client.kind} disabled={!canEdit} onChange={e=>{const kind=e.target.value as ClientKind,first=snapshot.nativeClients?.find(c=>c.kind===kind)?.models[0];change({backend:{kind:'native',client:{kind,model:first?.id??'',effort:first?.defaultEffort}}});}}>{CLIENTS.map(kind=><option key={kind} value={kind}>{CLIENT_LABELS[kind]}</option>)}</select></label><label className="team-field"><span>{t('模型')}</span><input value={nativeBackend.client.model} disabled={!canEdit} list="butler-native-models" onChange={e=>change({backend:{kind:'native',client:{...nativeBackend.client,model:e.target.value}}})}/><datalist id="butler-native-models">{snapshot.nativeClients?.find(c=>c.kind===nativeBackend.client.kind)?.models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label><label className="team-field"><span>{t('思考强度')}</span><input value={nativeBackend.client.effort??''} disabled={!canEdit} onChange={e=>change({backend:{kind:'native',client:{...nativeBackend.client,effort:e.target.value}}})}/></label><small>{snapshot.nativeClients?.find(c=>c.kind===nativeBackend.client.kind)?.message||t('连接状态尚未检查；请在模型接入设置确认登录。')}</small></>}
      </section>
      <section className="proactive-card"><h3>{t('节奏与范围')}</h3><label className="team-field"><span>{t('每日最多 tokens')}</span><input type="number" min="1000" max="1000000" step="1000" value={pref.maxTokensPerDay} disabled={!canEdit} onChange={e=>change({maxTokensPerDay:Math.max(1000,Number(e.target.value)||1000)})}/></label>
        <label className="team-field"><span>{t('简报节奏')}</span><select value={pref.cadence} disabled={!canEdit} onChange={e=>change({cadence:e.target.value as 'daily'|'twice-daily'})}><option value="daily">{t('每天早晨')}</option><option value="twice-daily">{t('早晚各一次')}</option></select></label>
        <div className="proactive-times"><label className="team-field"><span>{t('早晨')}</span><input type="time" value={pref.morning} disabled={!canEdit} onChange={e=>change({morning:e.target.value})}/></label><label className="team-field"><span>{t('晚上')}</span><input type="time" value={pref.evening} disabled={!canEdit||pref.cadence==='daily'} onChange={e=>change({evening:e.target.value})}/></label></div>
        <label className="team-field"><span>{t('时区')}</span><input value={pref.timezone} disabled={!canEdit} onChange={e=>change({timezone:e.target.value})}/></label>
        <label className="team-check"><input type="checkbox" checked={pref.allowResearch} disabled={!canEdit} onChange={e=>change({allowResearch:e.target.checked})}/>{t('允许在既有权限内主动研究')}</label>
        <label className="team-check"><input type="checkbox" checked={pref.allowRoutineExecution} disabled={!canEdit} onChange={e=>change({allowRoutineExecution:e.target.checked})}/>{t('允许低风险例行任务按现有权限执行')}</label>
      </section>
    </div>
    {error&&<p role="alert" className="proactive-error">{error}</p>}{snapshot.error&&<p role="alert" className="proactive-error">{snapshot.error}</p>}
    {!!jobs.length&&<section className="proactive-jobs" aria-label={t('最近任务')}><h3>{t('最近任务')}</h3>{jobs.map(job=><div key={job.id} className="proactive-job"><span>{t(job.kind==='analyze'?'分析目标':job.kind==='research'?'研究目标':'生成简报')}</span><strong>{t(job.status==='queued'?'已排队，等待执行电脑':job.status==='running'?'执行中':job.status==='completed'?'已完成':'失败')}</strong>{job.error&&<small role="alert">{job.error}</small>}</div>)}</section>}
    <div className="proactive-section-head"><h3>{t('待核对的目标')}</h3><div className="team-actions"><button className="btn sm" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'analyze-now'})}>{t('现在分析')}</button><button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'refresh'})}>{t('刷新')}</button></div></div>
    {goals.length?goals.map(goal=><article className="proactive-card proactive-goal" key={goal.id}><div className="proactive-card-top"><h4>{goal.title}</h4><span>{t(goal.status==='proposed'?'待核对':goal.status==='confirmed'?'已确认':goal.status==='corrected'?'已纠正':'已忽略')} · {t(goal.confidence==='high'?'较有把握':goal.confidence==='medium'?'部分依据':'线索较弱')}</span></div><p>{goal.hypothesis}</p>{goal.userCorrection&&<p><strong>{t('你的纠正：')}</strong>{goal.userCorrection}</p>}<div className="proactive-evidence">{evidence(goal.evidenceIds).map(s=><small key={s.id}>{s.sourceLabel||t(SOURCE_LABEL[s.source])} · {new Date(s.observedAt).toLocaleDateString()} · {s.topic}</small>)}</div>{goal.status==='proposed'&&<div className="proactive-review"><input aria-label={t('纠正目标')} placeholder={t('如果判断不对，请写下正确目标')} value={corrections[goal.id]??''} onChange={e=>setCorrections(v=>({...v,[goal.id]:e.target.value}))}/><div className="team-actions"><button className="btn sm" disabled={working||!controller} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'confirm'})}>{t('确认')}</button><button className="btn sm" disabled={working||!controller||!corrections[goal.id]?.trim()} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'correct',correction:corrections[goal.id]})}>{t('纠正')}</button><button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'dismiss'})}>{t('忽略')}</button><button className="btn sm ghost" disabled={working||inactive||!controller} onClick={()=>void act({kind:'run-research',goalId:goal.id})}>{t('研究这个目标')}</button></div></div>}</article>):<p className="proactive-empty">{t('目前没有可靠的目标线索。你可以在管家对话中明确说出目标；活动记录不会被当作确定意图。')}</p>}
    <div className="proactive-section-head"><h3>{t('早晚简报')}</h3><div className="team-actions"><button className="btn sm" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'morning'})}>{t('生成早间简报')}</button><button className="btn sm ghost" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'evening'})}>{t('生成晚间简报')}</button></div></div>
    {latestBriefs.length?latestBriefs.map(brief=><article className="proactive-card" key={brief.id}><h4>{t(brief.period==='morning'?'早间简报':'晚间简报')} · {new Date(brief.createdAt).toLocaleString()}</h4>{brief.items.map(item=><div className="proactive-brief-item" key={item.id}><strong>{item.title}</strong><p>{item.summary}</p><div className="proactive-evidence">{evidence(item.evidenceIds).map(s=><small key={s.id}>{s.sourceLabel||t(SOURCE_LABEL[s.source])} · {s.topic}</small>)}</div>{result(item.result)}</div>)}</article>):<p className="proactive-empty">{t('还没有简报。')}</p>}
    <div className="proactive-section-head"><h3>{t('学习建议')}</h3></div>{proposals.length?proposals.map(proposal=><article className="proactive-card" key={proposal.id}><h4>{proposal.name}</h4><p>{proposal.description}</p><div className="proactive-evidence">{evidence(proposal.evidenceIds).map(s=><small key={s.id}>{s.sourceLabel||t(SOURCE_LABEL[s.source])} · {s.topic}</small>)}</div><p className="hint">{t('采用后保存为停用的技能草案；你仍需查看并主动启用，权限不会扩大。')}</p><div className="team-actions"><button className="btn sm" disabled={working||!controller} onClick={()=>void adoptSkill(proposal.id)}>{t('保存为停用技能')}</button><button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'review-skill',proposalId:proposal.id,decision:'dismiss'})}>{t('忽略')}</button></div></article>):<p className="proactive-empty">{t('暂无可审阅的技能建议。')}</p>}
    {snapshot.sources.share?.available&&<form className="proactive-link" onSubmit={e=>{e.preventDefault();if(link.trim())void act({kind:'import-link',url:link.trim()}).then(()=>setLink(''));}}><label className="team-field"><span>{t('主动分享链接作为线索')}</span><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://"/></label><button className="btn sm" disabled={!link.trim()||working||inactive}>{t('加入线索')}</button></form>}
  </section>;
}
