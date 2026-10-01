import React from 'react';
import { useT } from '../../lib/i18n';
import { CLIENT_LABELS, type ClientKind } from '../../lib/connections';
import { DEFAULT_BUTLER_PREFERENCES, emptyButlerBrain, type ButlerProactivePreferences,
  type ButlerResultRef, type ButlerRuntimeAction, type ButlerRuntimeController, type ButlerRuntimeSnapshot,
  type ButlerSource } from '../../lib/proactive-butler';
import type { AppSettings } from '../../types';
import Icon from '../Icon';
import { DEFAULT_BUTLER_PRIVACY, type ButlerPrivacyPolicy, type ButlerSensitiveCategory, type ButlerSensitiveMode } from '../../lib/butler-privacy';
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
  const [sourceDeny,setSourceDeny]=React.useState<Partial<Record<ButlerSource,string>>>({});
  const [setupOpen,setSetupOpen]=React.useState(false);
  const [need,setNeed]=React.useState('');
  const [workInputs,setWorkInputs]=React.useState<Record<string,string>>({});
  const availableGroups=(settings.routeGroups??[]).filter(g=>g.routes.length>0);
  const latestBriefs=[...snapshot.brain.briefs].sort((a,b)=>b.createdAt-a.createdAt).slice(0,4);
  const goals=[...snapshot.brain.goals].filter(g=>g.status!=='dismissed').sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,12);
  const proposals=snapshot.brain.skillProposals.filter(p=>p.status==='proposed').slice(0,10);
  const jobs=[...(snapshot.brain.jobs??[])].sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
  const signals=new Map(snapshot.brain.signals.map(s=>[s.id,s]));
  const canEdit=!!onSettings;

  const act=async(action:ButlerRuntimeAction)=>{
    if(!controller)return;
    setWorking(true);setError('');
    try{await controller.action(action);return true;}catch(e){setError(String(e));return false;}finally{setWorking(false);}
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
        const denylist=(sourceDeny[source]??snapshot.sources[source]?.denylist?.join(',')??'').split(',').map(s=>s.trim()).filter(Boolean);
        if(on && ['browser','desktop','android','integration'].includes(source) && !allowlist.length)throw Error(t('先填写允许的站点、应用或连接范围。'));
        if(on)await controller.action({kind:'configure-source',source,allowlist,denylist});
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
  const feedback=(targetKind:'goal'|'brief'|'skill',targetId:string)=><ButlerFeedbackControl
    value={[...(snapshot.brain.feedback??[])].reverse().find(f=>f.targetKind===targetKind&&f.targetId===targetId)} disabled={working||!controller}
    onSend={(rating,comment)=>act({kind:'feedback',targetKind,targetId,rating,comment})}/>;

  return <section className="proactive-butler" aria-label={t('主动管家')}>
    <header className="proactive-head"><div><h2>{t('今天，有什么值得帮你做？')}</h2><p>{t('发现需求，准备结果。由你决定判断是否准确、做法是否合适。')}</p></div>
      <span className={`proactive-state ${inactive?'off':'on'}`}>{!pref.enabled?t('已关闭'):pref.paused?t('已暂停'):t('已启用')}</span></header>
    <div className="proactive-quickbar">
      <button className="btn" aria-expanded={setupOpen} onClick={()=>setSetupOpen(value=>!value)}><Icon name="settings"/>{t(pref.enabled?'管家设置':'开始设置')}</button>
      {pref.enabled&&<button className={`btn ${pref.paused?'':'danger'}`} onClick={()=>void act({kind:pref.paused?'resume':'pause'})}><Icon name={pref.paused?'play':'pause'}/>{t(pref.paused?'恢复管家':'紧急暂停')}</button>}
      {pref.enabled&&<span className="proactive-host-chip">{snapshot.host.status==='local'?t('本机后台执行'):snapshot.host.status==='connected'?t('执行电脑在线'):t('等待执行电脑')}</span>}
    </div>
    {!pref.enabled&&<p className="proactive-empty">{t('先选大脑模型和执行电脑。启用后，管家会从需求中准备研究和简报；外部活动需另行同意。')}</p>}
    <form className="proactive-need" onSubmit={event=>{event.preventDefault();if(need.trim())void act({kind:'add-need',text:need.trim()}).then(ok=>{if(ok)setNeed('');});}}>
      <label htmlFor="butler-new-need">{t('补充一个需求')}</label><div><input id="butler-new-need" value={need} maxLength={2000} onChange={event=>setNeed(event.target.value)} placeholder={t('例如：每天帮我挑出适合工作的 AI skills')}/><button className="btn primary" disabled={working||!need.trim()||!controller}>{t('交给管家')}</button></div>
    </form>
    <details className="proactive-settings" open={setupOpen} onToggle={event=>setSetupOpen(event.currentTarget.open)}><summary>{t('模型、来源与每日安排')}</summary>
    <div className="proactive-privacy"><strong>{t('启用前了解数据范围')}</strong><p>{t('默认只使用 wickrunAI 内的对话与任务。浏览器、电脑、Android、已连接应用和分享链接都要分别启用，并在收集设备上单独同意。密码输入不采集；外部原始活动留在收集设备。增强理解会把脱敏后的可见内容片段发给你选定的模型，脱敏无法保证零泄露；账号脑只同步提炼后的目标与简报。已有 API 密钥仍按现有加密密钥同步方式处理。你可随时暂停、关闭或撤销来源。')}</p>
      <p>{t('活动线索只能形成待核对的假设，不会自动认定你的兴趣或目标。金融与谈判动作另需针对具体账户、对象、动作和金额的明确授权；风险声明本身不构成授权。')}</p></div>
    <div className="proactive-actions"><label className="team-check"><input type="checkbox" checked={pref.enabled} disabled={!canEdit} onChange={e=>change({enabled:e.target.checked,paused:false})}/>{t('启用主动管家')}</label>
      {pref.enabled&&<button className="btn sm ghost" onClick={()=>void act({kind:'turn-off'})}>{t('关闭管家')}</button>}</div>
    <div className="proactive-grid">
      <section className="proactive-card"><h3>{t('活动来源')}</h3><p>{t('先开总开关，再单独选择来源。未接通的来源不会假装正在收集。')}</p>
        {(['wickrun',...EXTERNAL] as ButlerSource[]).map(source=>{
          const cap=snapshot.sources[source],external=source!=='wickrun';
          const scoped=['browser','desktop','android','integration'].includes(source);
          const allowlist=(sourceScope[source]??cap?.allowlist?.join(',')??'').split(',').map(s=>s.trim()).filter(Boolean);
          const denylist=(sourceDeny[source]??cap?.denylist?.join(',')??'').split(',').map(s=>s.trim()).filter(Boolean);
          return <div className="proactive-source-block" key={source}>
            <label className="proactive-source"><input type="checkbox" checked={!!pref.sources[source]}
              disabled={!canEdit||working||(external&&!cap?.available)} onChange={e=>void toggleSource(source,e.target.checked)}/>
              <span><strong>{t(SOURCE_LABEL[source])}</strong><small>{external?cap?.available?(cap.consented?t('本机已同意'):t('需要本机同意')):t(cap?.note||'此设备尚未提供该来源'):t('应用内来源')}</small></span></label>
            {cap?.available&&scoped&&<div className="proactive-scope"><label className="team-field"><span>{t(source==='browser'?'允许的域名（逗号分隔）':source==='desktop'?'允许的应用进程名（逗号分隔）':source==='android'?'允许的应用包名（逗号分隔）':'允许的连接（逗号分隔）')}</span><input value={sourceScope[source]??cap.allowlist?.join(', ')??''} disabled={!canEdit||working} placeholder={source==='browser'?'example.com, docs.example.org':source==='desktop'?'chrome.exe, code.exe':''} onChange={e=>setSourceScope(s=>({...s,[source]:e.target.value}))}/></label>
              <label className="team-field"><span>{t('禁止采集名单（逗号分隔，优先于允许名单）')}</span><input value={sourceDeny[source]??cap.denylist?.join(', ')??''} disabled={!canEdit||working} onChange={e=>setSourceDeny(s=>({...s,[source]:e.target.value}))}/></label>
              {['desktop','android'].includes(source)&&<details><summary>{t('从本机应用选择')}</summary><button className="btn sm ghost" disabled={working} onClick={()=>void act({kind:'list-source-apps'})}>{t('刷新应用列表')}</button>{cap.apps?.map(app=><label className="proactive-app-rule" key={app.id}><span>{app.name}<small>{app.id!==app.name?app.id:''}</small></span><select aria-label={app.name} value={denylist.includes(app.id)?'deny':allowlist.includes(app.id)?'allow':'off'} disabled={working} onChange={e=>{setSourceScope(s=>({...s,[source]:[...allowlist.filter(x=>x!==app.id),...(e.target.value==='allow'?[app.id]:[])].join(', ')}));setSourceDeny(s=>({...s,[source]:[...denylist.filter(x=>x!==app.id),...(e.target.value==='deny'?[app.id]:[])].join(', ')}));}}><option value="off">{t('不采集')}</option><option value="allow">{t('允许采集')}</option><option value="deny">{t('加入黑名单')}</option></select></label>)}</details>}
              <button className="btn sm ghost" disabled={!controller||working} onClick={()=>void act({kind:'configure-source',source,allowlist,denylist})}>{t('保存范围')}</button><small>{t('只采集允许名单内的应用，黑名单始终优先。保存新范围会清除该来源的旧线索。')}</small></div>}
          </div>;
        })}
        {snapshot.canHost&&snapshot.sources.browser?.available&&<><button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'install-browser-extension'})}><Icon name="link"/>{t('安装浏览器扩展')}</button><p className="hint">{t('打开扩展文件夹后，在 Chrome 或 Edge 扩展管理中开启开发者模式，选择“加载已解压的扩展程序”，选中该文件夹。')}</p></>}
        <p className="hint">{t('只理解授权范围内的可见文字；未实现视频、声音或屏幕录制识别。Android 需另行开启系统授权；仅使用已接通的来源。')}</p>
      </section>
      {snapshot.privacy&&<ButlerPrivacySettings policy={snapshot.privacy} background={snapshot.background} working={working} onSave={policy=>act({kind:'configure-privacy',policy})} onBackground={()=>act({kind:'open-background-settings'})}/>}
      <section className="proactive-card"><h3>{t('执行电脑与模型')}</h3><p>{t('手机可查看与发起任务；定时工作由同一账号下选定的常开电脑运行。')}</p>
        <div className="proactive-host"><strong>{snapshot.host.deviceName||t('尚未选择执行电脑')}</strong><span>{t(snapshot.host.status==='local'?'当前设备':snapshot.host.status==='connected'?'已连接':snapshot.host.status==='offline'?'离线':'不可用')}{snapshot.host.lastSeenAt?` · ${new Date(snapshot.host.lastSeenAt).toLocaleString()}`:''}</span></div>
        {snapshot.canHost&&snapshot.deviceId&&snapshot.host.deviceId!==snapshot.deviceId&&<button className="btn sm" disabled={working||!controller} onClick={()=>void act({kind:'select-host',deviceId:snapshot.deviceId!})}><Icon name="monitor"/>{t('将本机设为执行电脑')}</button>}
        {!!snapshot.brain.hosts?.length&&<label className="team-field"><span>{t('同账号的执行电脑')}</span><select value={pref.hostDeviceId??''} disabled={working||!controller} onChange={event=>void act({kind:'select-host',deviceId:event.target.value})}><option value="">{t('请选择')}</option>{snapshot.brain.hosts.map(host=><option key={host.id} value={host.id}>{host.name} · {new Date(host.lastSeenAt).toLocaleString()}</option>)}</select></label>}
        <label className="team-field"><span>{t('模型来源')}</span><select value={pref.backend.kind} disabled={!canEdit} onChange={e=>change({backend:e.target.value==='native'?{kind:'native',client:{kind:'codex',model:''}}:{kind:'route-group',routeGroupId:availableGroups[0]?.id??'',effort:'medium'}})}><option value="route-group">{t('API 路由组')}</option><option value="native">{t('本机订阅客户端')}</option></select></label>
        {pref.backend.kind==='route-group'?<><label className="team-field"><span>{t('路由组')}</span><select value={routeBackend.routeGroupId} disabled={!canEdit} onChange={e=>change({backend:{...routeBackend,routeGroupId:e.target.value}})}><option value="">{t('请选择')}</option>{availableGroups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.routes.length}</option>)}</select></label><label className="team-field"><span>{t('思考强度')}</span><select value={routeBackend.effort} disabled={!canEdit} onChange={e=>change({backend:{...routeBackend,effort:e.target.value as typeof routeBackend.effort}})}>{['off','low','medium','high','xhigh','max'].map(x=><option key={x} value={x}>{x}</option>)}</select></label></>
          :<><label className="team-field"><span>{t('客户端')}</span><select value={nativeBackend.client.kind} disabled={!canEdit} onChange={e=>{const kind=e.target.value as ClientKind,first=snapshot.nativeClients?.find(c=>c.kind===kind)?.models[0];change({backend:{kind:'native',client:{kind,model:first?.id??'',effort:first?.defaultEffort}}});}}>{CLIENTS.map(kind=><option key={kind} value={kind}>{CLIENT_LABELS[kind]}</option>)}</select></label><label className="team-field"><span>{t('模型')}</span><input value={nativeBackend.client.model} disabled={!canEdit} list="butler-native-models" onChange={e=>change({backend:{kind:'native',client:{...nativeBackend.client,model:e.target.value}}})}/><datalist id="butler-native-models">{snapshot.nativeClients?.find(c=>c.kind===nativeBackend.client.kind)?.models.map(m=><option key={m.id} value={m.id}/>)}</datalist></label><label className="team-field"><span>{t('思考强度')}</span><input value={nativeBackend.client.effort??''} disabled={!canEdit} onChange={e=>change({backend:{kind:'native',client:{...nativeBackend.client,effort:e.target.value}}})}/></label><small>{snapshot.nativeClients?.find(c=>c.kind===nativeBackend.client.kind)?.message||t('连接状态尚未检查；请在模型接入设置确认登录。')}</small></>}
      </section>
      <section className="proactive-card"><h3>{t('节奏与范围')}</h3><label className="team-field"><span>{t('每台设备每日预算（tokens）')}</span><input type="number" min="2000" max="500000" step="1000" value={pref.maxTokensPerDay} disabled={!canEdit} onChange={e=>change({maxTokensPerDay:Math.min(500000,Math.max(2000,Number(e.target.value)||2000))})}/></label><p className="hint">{t('采集设备可调用模型提取摘要，执行电脑负责持续研究。预算按设备估算；订阅客户端未返回用量时按预留量计算。')}</p>
        <label className="team-field"><span>{t('外部内容理解方式')}</span><select value={pref.externalUnderstanding} disabled={!canEdit} onChange={e=>change({externalUnderstanding:e.target.value as ButlerProactivePreferences['externalUnderstanding']})}><option value="redacted-context">{t('增强理解：脱敏片段交给选定模型')}</option><option value="local-topics">{t('仅本机主题提取')}</option></select></label>
        <label className="team-field"><span>{t('简报节奏')}</span><select value={pref.cadence} disabled={!canEdit} onChange={e=>change({cadence:e.target.value as 'daily'|'twice-daily'})}><option value="daily">{t('每天早晨')}</option><option value="twice-daily">{t('早晚各一次')}</option></select></label>
        <div className="proactive-times"><label className="team-field"><span>{t('早晨')}</span><input type="time" value={pref.morning} disabled={!canEdit} onChange={e=>change({morning:e.target.value})}/></label><label className="team-field"><span>{t('晚上')}</span><input type="time" value={pref.evening} disabled={!canEdit||pref.cadence==='daily'} onChange={e=>change({evening:e.target.value})}/></label></div>
        <label className="team-field"><span>{t('时区')}</span><input value={pref.timezone} disabled={!canEdit} onChange={e=>change({timezone:e.target.value})}/></label>
        <label className="team-check"><input type="checkbox" checked={pref.allowResearch} disabled={!canEdit} onChange={e=>change({allowResearch:e.target.checked})}/>{t('允许在既有权限内主动研究')}</label>
        <label className="team-check"><input type="checkbox" checked={pref.allowRoutineExecution} disabled={!canEdit} onChange={e=>change({allowRoutineExecution:e.target.checked})}/>{t('允许主动准备可撤销成果，无需逐项确认')}</label>
        <label className="team-field"><span>{t('每日主动 Work 任务上限')}</span><input type="number" min="1" max="10" value={pref.maxWorkPerDay??3} disabled={!canEdit} onChange={e=>change({maxWorkPerDay:Math.min(10,Math.max(1,Number(e.target.value)||3))})}/></label><p className="hint">{t('推测的需求也可先在独立工作区制作文件；原目录不会自动更新。执行过程可中断，已记录修改可在会话中回退。对外发送、发布、付款等另需确认。Work 使用普通任务预算，不计入上方的管家理解预算。')}</p>
      </section>
    </div>
    </details>
    {error&&<p role="alert" className="proactive-error">{error}</p>}{snapshot.error&&<p role="alert" className="proactive-error">{snapshot.error}</p>}
    {!!jobs.length&&<section className="proactive-jobs" aria-label={t('最近任务')}><h3>{t('最近任务')}</h3>{jobs.map(job=><div key={job.id} className="proactive-job"><span>{t(job.kind==='analyze'?'分析目标':job.kind==='research'?'研究目标':job.kind==='work'?'Work 执行':'生成简报')}</span><strong>{t(job.status==='queued'?'已排队，等待执行电脑':job.status==='running'?'执行中':job.status==='waiting'?'需要处理':job.status==='completed'?'已完成':'失败')}</strong>{job.error&&<small role="alert">{job.error}</small>}
      {job.summary&&<p>{job.summary}</p>}
      {job.status==='failed'&&job.kind!=='work'&&<button className="btn sm" disabled={working||inactive} onClick={()=>void act({kind:'retry-job',jobId:job.id})}><Icon name="retry"/>{t('重试')}</button>}
      {job.kind==='work'&&job.conversationId&&<div className="proactive-work-controls">{result({kind:'conversation',id:job.conversationId})}
        {job.status==='running'?<button className="btn sm" disabled={working||inactive} onClick={()=>void act({kind:'work-command',jobId:job.id,command:'pause'})}><Icon name="pause"/>{t('暂停任务')}</button>:job.status!=='completed'&&<button className="btn sm" disabled={working||inactive} onClick={()=>void act({kind:'work-command',jobId:job.id,command:'resume'})}><Icon name="play"/>{t('继续任务')}</button>}
        <details className="proactive-detail"><summary>{t('补充要求与查看说明')}</summary><p>{t('补充要求会进入原 Work 会话，保留上下文。敏感操作仍须在执行设备确认。产物和完整记录完成同步后可在会话中查看。')}</p><label className="team-field"><span>{t('给执行任务补充要求')}</span><textarea value={workInputs[job.id]??''} onChange={e=>setWorkInputs(values=>({...values,[job.id]:e.target.value}))}/></label><button className="btn" disabled={working||inactive||!workInputs[job.id]?.trim()} onClick={()=>void act({kind:'work-command',jobId:job.id,command:'message',text:workInputs[job.id]}).then(ok=>{if(ok)setWorkInputs(values=>({...values,[job.id]:''}));})}><Icon name="enter"/>{t('发送补充')}</button></details>
      </div>}
    </div>)}</section>}
    <div className="proactive-section-head"><h3>{t('待核对的目标')}</h3><div className="team-actions"><button className="btn sm" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'analyze-now'})}>{t('现在分析')}</button><button className="btn sm ghost" disabled={working||!controller} onClick={()=>void act({kind:'refresh'})}>{t('刷新')}</button></div></div>
    {goals.length?goals.map(goal=><article className="proactive-card proactive-goal" key={goal.id}>
      <div className="proactive-card-top"><h4>{goal.title}</h4><span>{t(goal.status==='proposed'?'待你确认':goal.status==='confirmed'?'已确认':'已纠正')}</span></div>
      <p>{goal.userCorrection??goal.hypothesis}</p>
      <div className="proactive-primary-actions">
        {goal.status==='proposed'&&<button className="btn" disabled={working||!controller} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'confirm'})}>{t('是我的需求')}</button>}
        <button className="btn ghost" disabled={working||!controller} onClick={()=>void act({kind:'feedback',targetKind:'goal',targetId:goal.id,rating:'not-my-need'})}>{t('不是我的需求')}</button>
        <button className="btn ghost" disabled={working||inactive||!controller} onClick={()=>void act({kind:'run-research',goalId:goal.id})}>{t('继续研究')}</button>
        {goal.status!=='proposed'&&<button className="btn primary" disabled={working||inactive||!controller} onClick={()=>void act({kind:'run-work',goalId:goal.id})}><Icon name="play"/>{t('执行这个需求')}</button>}
      </div>
      <details className="proactive-detail"><summary>{t('为什么这样判断 · 纠正目标')}</summary>
        <p>{t('判断依据：')}{goal.hypothesis}</p><p>{t('把握程度：')}{t(goal.confidence==='high'?'较有把握':goal.confidence==='medium'?'部分依据':'线索较弱')}</p>
        {evidence(goal.evidenceIds).map(s=><blockquote key={s.id}><strong>{s.sourceLabel||t(SOURCE_LABEL[s.source])}</strong><small> · {new Date(s.observedAt).toLocaleDateString()} · {t(s.basis==='user-stated'?'你明确提出':'活动推测')}</small><p>{s.summary}</p></blockquote>)}
        <label className="team-field"><span>{t('真正的需求是')}</span><textarea rows={2} value={corrections[goal.id]??''} onChange={event=>setCorrections(value=>({...value,[goal.id]:event.target.value}))}/></label>
        <button className="btn" disabled={working||!controller||!corrections[goal.id]?.trim()} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'correct',correction:corrections[goal.id]})}>{t('保存纠正')}</button>
      </details>{feedback('goal',goal.id)}
    </article>):<p className="proactive-empty">{t('你可以补充目标，也可以让管家从获准的线索中发现需求。所有推测都能纠正。')}</p>}
    <div className="proactive-section-head"><h3>{t('早晚简报')}</h3><div className="team-actions"><button className="btn sm" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'morning'})}>{t('生成早间简报')}</button><button className="btn sm ghost" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'evening'})}>{t('生成晚间简报')}</button></div></div>
    {latestBriefs.length?latestBriefs.map(brief=><article className="proactive-card" key={brief.id}>
      <h4>{t(brief.period==='morning'?'早间简报':'研究与晚间简报')} · {new Date(brief.createdAt).toLocaleDateString()}</h4>
      {brief.items.slice(0,2).map(item=><div className="proactive-brief-item" key={item.id}><strong>{item.title}</strong><p>{item.summary}</p>{result(item.result)}</div>)}
      {brief.items.length>2&&<details className="proactive-detail"><summary>{t('阅读完整结果与来源')}</summary>{brief.items.slice(2).map(item=><div className="proactive-brief-item" key={item.id}><strong>{item.title}</strong><p>{item.summary}</p>{result(item.result)}</div>)}</details>}
      <details className="proactive-detail"><summary>{t('依据了哪些需求')}</summary>{evidence([...new Set(brief.items.flatMap(item=>item.evidenceIds))]).map(s=><p key={s.id}>{s.sourceLabel} · {s.summary}</p>)}</details>
      {feedback('brief',brief.id)}
    </article>):<p className="proactive-empty">{t('完成的研究和今日安排会出现在这里。')}</p>}
    <details className="proactive-detail"><summary>{t('学习建议')} · {proposals.length}</summary>
      {proposals.map(proposal=><article className="proactive-card" key={proposal.id}><h4>{proposal.name}</h4><p>{proposal.description}</p>
        <details><summary>{t('查看技能内容与依据')}</summary><p>{proposal.body}</p>{evidence(proposal.evidenceIds).map(s=><p key={s.id}>{s.sourceLabel} · {s.summary}</p>)}</details>
        <p className="hint">{t('采用后管家会记住这个方法，并保存为停用的技能草案。可在技能管理中启用，权限不会扩大。')}</p>
        <div className="proactive-primary-actions"><button className="btn" disabled={working||!controller} onClick={()=>void adoptSkill(proposal.id)}>{t('采用方法')}</button><button className="btn ghost" disabled={working||!controller} onClick={()=>void act({kind:'review-skill',proposalId:proposal.id,decision:'dismiss'})}>{t('忽略')}</button></div>{feedback('skill',proposal.id)}</article>)}
    </details>
    <details className="proactive-detail proactive-transparency"><summary>{t('管家做了什么 · 行动记录')}</summary>
      <p>{t('计划、完成、失败和受阻分别记录。需求理解和研究可交给 Work 继续执行；Work 沿用现有工具、上下文、预算和审批。财务、消息发送和商业谈判需要另外的具体授权。')}</p>
      {[...(snapshot.brain.audit??[])].reverse().slice(0,80).map(entry=><article key={entry.id} className="proactive-audit"><div><strong>{entry.title}</strong><span>{t(entry.status==='planned'?'计划 / 已发起':entry.status==='completed'?'已完成':entry.status==='blocked'?'待授权':'失败')}</span></div><p>{entry.detail}</p><small>{new Date(entry.at).toLocaleString()}{entry.model?' · '+entry.model:''}</small></article>)}
      {snapshot.brain.goals.filter(goal=>goal.status==='dismissed').map(goal=><p key={goal.id}>{t('已排除的需求：')}{goal.title}</p>)}
    </details>
    {snapshot.sources.share?.available&&<form className="proactive-link" onSubmit={e=>{e.preventDefault();if(link.trim())void act({kind:'import-link',url:link.trim()}).then(ok=>{if(ok)setLink('');});}}><label className="team-field"><span>{t('主动分享链接作为线索')}</span><input type="url" value={link} onChange={e=>setLink(e.target.value)} placeholder="https://"/></label><button className="btn sm" disabled={!link.trim()||working||inactive}><Icon name="link"/>{t('加入线索')}</button></form>}
  </section>;
}

function ButlerPrivacySettings({policy,background,working,onSave,onBackground}:{policy:ButlerPrivacyPolicy;background:ButlerRuntimeSnapshot['background'];working:boolean;onSave:(policy:ButlerPrivacyPolicy)=>Promise<unknown>;onBackground:()=>Promise<unknown>}) {
  const t=useT(),[draft,setDraft]=React.useState(policy),[excluded,setExcluded]=React.useState(policy.excludedTerms.join('\n')),[encrypted,setEncrypted]=React.useState(policy.encryptedOnlyTerms.join('\n'));
  const signature=JSON.stringify(policy);
  React.useEffect(()=>{setDraft(policy);setExcluded(policy.excludedTerms.join('\n'));setEncrypted(policy.encryptedOnlyTerms.join('\n'));},[signature]);
  const parse=(text:string)=>text.split(/[\n,，]/).map(s=>s.trim()).filter(Boolean).slice(0,40);
  return <section className="proactive-card"><h3>{t('敏感内容与后台运行')}</h3><p>{t('这些规则只保存在当前采集设备。密码、密钥和可编辑输入始终排除；仅加密保存的内容不会进入模型或账号脑。')}</p>
    <label className="team-field"><span>{t('不得接触的关键词（每行一个）')}</span><textarea value={excluded} onChange={e=>setExcluded(e.target.value)}/></label>
    <label className="team-field"><span>{t('仅在本机加密保存的关键词（每行一个）')}</span><textarea value={encrypted} onChange={e=>setEncrypted(e.target.value)}/></label>
    {(Object.keys(DEFAULT_BUTLER_PRIVACY.categories) as ButlerSensitiveCategory[]).map(category=><label className="team-field" key={category}><span>{t(category==='contact'?'联系方式':category==='financial'?'账户与财务敏感信息':'病历与医疗信息')}</span><select value={draft.categories[category]} onChange={e=>setDraft({...draft,categories:{...draft.categories,[category]:e.target.value as ButlerSensitiveMode}})}><option value="exclude">{t('不采集，不保存')}</option><option value="encrypt-only">{t('仅本机加密，不交给模型')}</option><option value="redact">{t('遮蔽匹配内容后理解')}</option></select></label>)}
    <p className="hint">{policy.note}</p><p className="hint">{t('规则基于关键词与格式匹配，不能识别所有敏感内容。保存后会停止当前管家任务并清除旧线索，按新规则重新提取；已有文件和会话保留。')}</p><button className="btn" disabled={working} onClick={()=>void onSave({...draft,excludedTerms:parse(excluded),encryptedOnlyTerms:parse(encrypted)})}><Icon name="shield"/>{t('保存敏感规则')}</button>
    {background?.supported&&<><p>{t(background.unrestricted?'系统已允许不受电池优化限制':'后台可能受电池优化限制')}</p><p className="hint">{background.note}</p><button className="btn" disabled={working} onClick={()=>void onBackground()}>{t('设置后台运行权限')}</button></>}
  </section>;
}

function ButlerFeedbackControl({value,disabled,onSend}:{value?:{rating:'useful'|'not-useful'|'not-my-need';comment?:string};disabled:boolean;onSend:(rating:'useful'|'not-useful',comment?:string)=>Promise<unknown>}) {
  const t=useT(),[comment,setComment]=React.useState(value?.comment??'');
  return <div className="proactive-feedback"><div className="proactive-primary-actions"><span>{t('这个结果合适吗？')}</span>
    <button className="btn ghost" aria-pressed={value?.rating==='useful'} disabled={disabled} onClick={()=>void onSend('useful',comment)}><Icon name="thumbsUp"/>{t('喜欢')}</button>
    <button className="btn ghost" aria-pressed={value?.rating==='not-useful'} disabled={disabled} onClick={()=>void onSend('not-useful',comment)}><Icon name="thumbsDown"/>{t('不喜欢')}</button></div>
    <details><summary>{t('告诉管家怎么改')}</summary><label className="team-field"><span>{t('反馈原因（可选）')}</span><textarea rows={2} maxLength={1000} value={comment} onChange={event=>setComment(event.target.value)} placeholder={t('例如：主题对，但希望更具体，少一点基础介绍')}/></label>
      <button className="btn" disabled={disabled||!comment.trim()} onClick={()=>void onSend(value?.rating==='useful'?'useful':'not-useful',comment)}>{t('保存反馈')}</button></details>
    {value&&<small role="status">{t('反馈已记录，会影响后续判断和做法。')}</small>}
  </div>;
}
