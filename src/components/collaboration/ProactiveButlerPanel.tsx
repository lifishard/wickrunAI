import React from 'react';
import { useT } from '../../lib/i18n';
import { CLIENT_LABELS, type ClientKind } from '../../lib/connections';
import { DEFAULT_BUTLER_PREFERENCES, BUTLER_HABIT_PREFIX, butlerConsented, emptyButlerBrain, type ButlerProactivePreferences,
  type ButlerBrainState, type ButlerBrief, type ButlerJob, type ButlerResultRef, type ButlerRuntimeAction, type ButlerRuntimeController, type ButlerRuntimeSnapshot,
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
  const [consentOpen,setConsentOpen]=React.useState(false);
  const availableGroups=(settings.routeGroups??[]).filter(g=>g.routes.length>0);
  const consented=butlerConsented(pref);
  // An account that turned the Butler on before consent existed sees the notice first.
  const askConsent=consentOpen||(pref.enabled&&!consented);
  const sortedBriefs=[...snapshot.brain.briefs].sort((a,b)=>b.createdAt-a.createdAt);
  const todayBrief=sortedBriefs.find(b=>b.greeting&&Date.now()-b.createdAt<86_400_000)??sortedBriefs.find(b=>Date.now()-b.createdAt<86_400_000);
  const latestBriefs=sortedBriefs.filter(b=>b!==todayBrief).slice(0,4);
  const inbox=(snapshot.brain.jobs??[]).filter(j=>j.status==='proposed').sort((a,b)=>a.createdAt-b.createdAt);
  const goalTitle=(id?:string)=>snapshot.brain.goals.find(g=>g.id===id)?.title;
  const goals=[...snapshot.brain.goals].filter(g=>g.status!=='dismissed').sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,12);
  const proposals=snapshot.brain.skillProposals.filter(p=>p.status==='proposed').slice(0,10);
  const jobs=[...(snapshot.brain.jobs??[])].filter(j=>j.status!=='proposed'&&j.status!=='declined').sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
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

  const greeting=todayBrief?.greeting;
  return <section className="proactive-butler" aria-label={t('主动管家')}>
    <header className="proactive-head"><div><h2>{greeting??t('今天，有什么值得帮你做？')}</h2><p>{greeting?t(todayBrief?.period==='morning'?'早间简报':'晚间简报')+' · '+new Date(todayBrief!.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):t('发现需求，准备结果。由你决定判断是否准确、做法是否合适。')}</p></div>
      <span className={`proactive-state ${inactive||!consented?'off':'on'}`}>{snapshot.stopRequest?.status==='failed'?t('暂停请求需处理'):!pref.enabled?t('已关闭'):!consented?t('等你确认'):pref.paused?t('暂停请求已记录'):t('已启用')}</span></header>
    <div className="proactive-quickbar">
      <button className="btn" aria-expanded={setupOpen} onClick={()=>{if(!consented&&!pref.enabled){setConsentOpen(true);return;}setSetupOpen(value=>!value);}}><Icon name="settings"/>{t(pref.enabled?'管家设置':'开始设置')}</button>
      {pref.enabled&&consented&&<button className={`btn ${pref.paused?'':'danger'}`} disabled={working&&pref.paused} onClick={()=>void act({kind:pref.paused?'resume':'pause'})}><Icon name={pref.paused?'play':'pause'}/>{t(pref.paused?'恢复管家':'紧急暂停')}</button>}
      {pref.enabled&&consented&&<span className="proactive-host-chip">{snapshot.host.status==='local'?t(inactive?'执行电脑：本机':'本机后台执行'):snapshot.host.status==='connected'?t('执行电脑在线'):t('等待执行电脑')}</span>}
    </div>
    {inactive&&(pref.paused||snapshot.stopRequest)&&<div className="proactive-privacy" role="status" aria-live="polite">
      <strong>{t(snapshot.stopRequest?.status==='failed'?'部分暂停请求未能送达':snapshot.stopRequest?.status==='pending'?'正在提交暂停请求':'暂停请求已记录')}</strong>
      {snapshot.stopRequest?.status==='failed'&&<p>{t('暂停请求未能完整保存或转交。本机已拦住后续派发；重启后的状态与远端执行仍需核实。')}</p>}
      <p>{t(snapshot.host.status==='local'?'已阻止本机继续派发。正在执行的工具可能仍在结束，退出和结果尚未确认，请在 Work 会话核实。':'远端停止尚未确认。执行电脑在线不代表已停止；离线或旧版设备的执行状态未知。')}</p>
    </div>}
    {askConsent&&<ButlerConsent upgraded={pref.enabled&&!consented} disabled={working||!controller||!canEdit}
      onAccept={()=>void act({kind:'consent',granted:true}).then(ok=>{if(ok){setConsentOpen(false);setSetupOpen(true);}})}
      onDecline={()=>{setConsentOpen(false);if(pref.enabled)void act({kind:'turn-off'});}}/>}
    {!pref.enabled&&!askConsent&&<p className="proactive-empty">{t('先选大脑模型和执行电脑。启用后，管家会从需求中准备研究和简报；外部活动需另行同意。')}</p>}
    {!!inbox.length&&<section className="proactive-inbox" aria-label={t('建议收件箱')}>
      <div className="proactive-section-head"><h3>{t('建议收件箱')} · {inbox.length}</h3><small>{t('管家不会自己动手，等你决定。最多同时放三条。')}</small></div>
      {inbox.map(job=><ButlerProposal key={job.id} job={job} goal={goalTitle(job.goalId)} disabled={working||!controller}
        onAnswer={decision=>void act({kind:'answer-proposal',jobId:job.id,decision})}/>)}
    </section>}
    {todayBrief&&<BriefCard brief={todayBrief} featured result={result} feedback={feedback('brief',todayBrief.id)}/>}
    <form className="proactive-need" onSubmit={event=>{event.preventDefault();if(need.trim())void act({kind:'add-need',text:need.trim()}).then(ok=>{if(ok)setNeed('');});}}>
      <label htmlFor="butler-new-need">{t('补充一个需求')}</label><div><input id="butler-new-need" value={need} maxLength={2000} onChange={event=>setNeed(event.target.value)} placeholder={t('例如：每天帮我挑出适合工作的 AI skills')}/><button className="btn primary" disabled={working||!need.trim()||!controller}>{t('交给管家')}</button></div>
    </form>
    <details className="proactive-settings" open={setupOpen} onToggle={event=>setSetupOpen(event.currentTarget.open)}><summary>{t('模型、来源与每日安排')}</summary>
    <div className="proactive-privacy"><strong>{t('启用前了解数据范围')}</strong><p>{t('默认只使用 wickrunAI 内的对话与任务。浏览器、电脑、Android、已连接应用和分享链接都要分别启用，并在收集设备上单独同意。密码输入不采集；外部原始活动留在收集设备。增强理解会把脱敏后的可见内容片段发给你选定的模型，脱敏无法保证零泄露；账号脑只同步提炼后的目标与简报。已有 API 密钥仍按现有加密密钥同步方式处理。你可随时暂停、关闭或撤销来源。')}</p>
      <p>{t('活动线索只能形成待核对的假设，不会自动认定你的兴趣或目标。金融与谈判动作另需针对具体账户、对象、动作和金额的明确授权；风险声明本身不构成授权。')}</p></div>
    <div className="proactive-actions"><label className="team-check"><input type="checkbox" checked={pref.enabled&&consented} disabled={!canEdit} onChange={e=>{
        if(!e.target.checked)void act({kind:'turn-off'});
        else if(!consented)setConsentOpen(true);
        else change({enabled:true,paused:false});
      }}/>{t('启用主动管家')}</label>
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
        <p className="hint">{t('关闭时（默认），管家只把要做的事放进建议收件箱，你点「做吧」才开始。')}</p>
        <label className="team-check"><input type="checkbox" checked={pref.learnHabits!==false} disabled={!canEdit} onChange={e=>change({learnHabits:e.target.checked})}/>{t('学习我的使用习惯')}</label>
        <p className="hint">{t('在本机统计常用时段、常聊话题和是否使用 Work，只保存一句话摘要；关闭后会删除已学到的习惯。')}</p>
        <label className="team-field"><span>{t('每日新建议与主动任务上限')}</span><input type="number" min="1" max="10" value={pref.maxWorkPerDay??3} disabled={!canEdit} onChange={e=>change({maxWorkPerDay:Math.min(10,Math.max(1,Number(e.target.value)||3))})}/></label><p className="hint">{t('推测的需求也可先在独立工作区制作文件；原目录不会自动更新。执行过程可中断，已记录修改可在会话中回退。对外发送、发布、付款等另需确认。Work 使用普通任务预算，不计入上方的管家理解预算。')}</p>
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
        <div className="proactive-primary-actions"><button className="btn" disabled={working||!controller||!corrections[goal.id]?.trim()} onClick={()=>void act({kind:'review-goal',goalId:goal.id,decision:'correct',correction:corrections[goal.id]})}>{t('保存纠正')}</button>
          <button className="btn ghost danger" disabled={working||!controller} onClick={()=>void act({kind:'forget-goal',goalId:goal.id})}><Icon name="trash"/>{t('删除目标和依据')}</button></div>
      </details>{feedback('goal',goal.id)}
    </article>):<p className="proactive-empty">{t('你可以补充目标，也可以让管家从获准的线索中发现需求。所有推测都能纠正。')}</p>}
    <div className="proactive-section-head"><h3>{t(todayBrief?'以前的简报与研究':'早晚简报')}</h3><div className="team-actions"><button className="btn sm" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'morning'})}>{t('生成早间简报')}</button><button className="btn sm ghost" disabled={working||snapshot.busy||inactive||!controller} onClick={()=>void act({kind:'generate-brief',period:'evening'})}>{t('生成晚间简报')}</button></div></div>
    {latestBriefs.length?latestBriefs.map(brief=><BriefCard key={brief.id} brief={brief} result={result} feedback={feedback('brief',brief.id)}
      evidence={evidence([...new Set(brief.items.flatMap(item=>item.evidenceIds))])}/>):!todayBrief&&<p className="proactive-empty">{t('完成的研究和今日安排会出现在这里。')}</p>}
    <ButlerMemory brain={snapshot.brain} learnHabits={pref.learnHabits!==false} consented={consented} disabled={working||!controller}
      onForget={signalIds=>act({kind:'forget-signals',signalIds})} onForgetGoal={goalId=>act({kind:'forget-goal',goalId})}
      onForgetAll={()=>act({kind:'forget-all'})} onRevoke={()=>act({kind:'consent',granted:false})}
      onHabits={on=>change({learnHabits:on})}/>
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

const BRIEF_KIND:Record<string,string>={progress:'进展',finding:'发现',suggestion:'建议','needs-approval':'等你决定'};

/** Shown before the first start, and once to accounts that enabled the Butler before consent existed. */
function ButlerConsent({upgraded,disabled,onAccept,onDecline}:{upgraded:boolean;disabled:boolean;onAccept:()=>void;onDecline:()=>void}) {
  const t=useT(),[agreed,setAgreed]=React.useState(false);
  return <section className="proactive-consent" aria-labelledby="butler-consent-title">
    <h3 id="butler-consent-title">{t(upgraded?'管家升级了：确认数据范围后继续':'开启前，先看清管家会用到什么')}</h3>
    {upgraded&&<p>{t('新版本加入了同意和数据控制。确认之前，管家不会收集、分析或执行任何事。')}</p>}
    <div className="proactive-consent-grid">
      <div><h4>{t('会用到')}</h4><ul>
        <li>{t('你在 wickrunAI 里发出的对话和任务，提炼成脱敏的需求摘要。')}</li>
        <li>{t('使用习惯：几点常用、常聊什么、是否用 Work。在本机统计，只留一句话摘要。')}</li></ul></div>
      <div><h4>{t('会去哪里')}</h4><ul>
        <li>{t('摘要、推测的目标和简报同步到你的账号，你登录的设备共用。')}</li>
        <li>{t('分析和写简报时，摘要会发给你选的模型（API 路由组或本机订阅客户端）。')}</li></ul></div>
      <div><h4>{t('不会做')}</h4><ul>
        <li>{t('不读密码、密钥和输入框；浏览器、电脑、手机等外部来源默认关闭，要在各设备单独同意。')}</li>
        <li>{t('不付款、不转账、不谈判、不替你发消息。')}</li>
        <li>{t('不经你同意不动手：要做的事先放进建议收件箱。')}</li></ul></div>
      <div><h4>{t('随时可以')}</h4><ul>
        <li>{t('紧急暂停。')}</li>
        <li>{t('在「管家记住了什么」里逐条删除或全部清除，删除会同步到所有设备。')}</li>
        <li>{t('撤回同意，管家立即关闭。')}</li></ul></div>
    </div>
    <label className="team-check"><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>{t('我已了解，同意管家按以上范围工作')}</label>
    <div className="proactive-primary-actions"><button className="btn primary" disabled={disabled||!agreed} onClick={onAccept}><Icon name="shield"/>{t('同意并启用')}</button>
      <button className="btn ghost" disabled={disabled} onClick={onDecline}>{t(upgraded?'先关闭管家':'暂不开启')}</button></div>
  </section>;
}

function ButlerProposal({job,goal,disabled,onAnswer}:{job:ButlerJob;goal?:string;disabled:boolean;onAnswer:(decision:'accept'|'decline')=>void}) {
  const t=useT();
  return <article className="proactive-proposal">
    <div><span className="proactive-chip">{t(job.kind==='research'?'查资料':'准备成果')}</span><strong>{goal??t('管家的建议')}</strong></div>
    {job.summary&&<p>{job.summary}</p>}
    <div className="proactive-primary-actions"><button className="btn primary sm" disabled={disabled} onClick={()=>onAnswer('accept')}><Icon name="play"/>{t('做吧')}</button>
      <button className="btn ghost sm" disabled={disabled} onClick={()=>onAnswer('decline')}>{t('不用了')}</button></div>
  </article>;
}

function BriefCard({brief,featured,result,feedback,evidence}:{brief:ButlerBrief;featured?:boolean;result:(ref:ButlerResultRef|undefined)=>React.ReactNode;feedback:React.ReactNode;evidence?:{id:string;sourceLabel:string;summary:string}[]}) {
  const t=useT(),shown=featured?brief.items:brief.items.slice(0,2);
  const item=(i:ButlerBrief['items'][number])=><div className="proactive-brief-item" key={i.id}><div><span className="proactive-chip">{t(BRIEF_KIND[i.kind]??'建议')}</span><strong>{i.title}</strong></div><p>{i.summary}</p>{result(i.result)}</div>;
  return <article className={`proactive-card${featured?' proactive-today':''}`}>
    <h4>{t(brief.greeting?(brief.period==='morning'?'早间简报':'晚间简报'):brief.period==='morning'?'早间简报':'研究与晚间简报')} · {new Date(brief.createdAt).toLocaleDateString()}</h4>
    {!featured&&brief.greeting&&<p>{brief.greeting}</p>}
    {shown.map(item)}
    {brief.items.length>shown.length&&<details className="proactive-detail"><summary>{t('阅读完整结果与来源')}</summary>{brief.items.slice(shown.length).map(item)}</details>}
    {!!evidence?.length&&<details className="proactive-detail"><summary>{t('依据了哪些需求')}</summary>{evidence.map(s=><p key={s.id}>{s.sourceLabel} · {s.summary}</p>)}</details>}
    {feedback}
  </article>;
}

/** Everything the Butler keeps for this account, with its provenance, and the ways to remove it. */
function ButlerMemory({brain,learnHabits,consented,disabled,onForget,onForgetGoal,onForgetAll,onRevoke,onHabits}:{brain:ButlerBrainState;learnHabits:boolean;consented:boolean;disabled:boolean;
  onForget:(ids:string[])=>Promise<unknown>;onForgetGoal:(id:string)=>Promise<unknown>;onForgetAll:()=>Promise<unknown>;onRevoke:()=>Promise<unknown>;onHabits:(on:boolean)=>void}) {
  const t=useT(),[all,setAll]=React.useState(false),[confirm,setConfirm]=React.useState<'clear'|'revoke'|null>(null);
  const habits=brain.signals.filter(s=>s.id.startsWith(BUTLER_HABIT_PREFIX));
  const needs=brain.signals.filter(s=>!s.id.startsWith(BUTLER_HABIT_PREFIX)).sort((a,b)=>b.observedAt-a.observedAt);
  const goals=[...brain.goals].sort((a,b)=>b.updatedAt-a.updatedAt);
  const basis=(b:string)=>t(b==='user-stated'?'你明确提出':b==='result'?'任务结果':'活动推测');
  const download=()=>{
    const {actionGrants:_grants,...rest}=brain;
    const url=URL.createObjectURL(new Blob([JSON.stringify(rest,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`wickrun-butler-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <details className="proactive-detail proactive-memory"><summary>{t('管家记住了什么')} · {needs.length} {t('条线索')} · {goals.length} {t('个目标')}</summary>
    <p>{t('这里是管家为你的账号保存的全部内容，不含原始对话。删除会同步到你的所有设备，同样的内容不会再被学习。')}</p>
    <section><div className="proactive-section-head"><h4>{t('使用习惯')}</h4><label className="team-check"><input type="checkbox" checked={learnHabits} disabled={disabled} onChange={e=>onHabits(e.target.checked)}/>{t('学习使用习惯')}</label></div>
      {habits.length?habits.map(h=><div className="proactive-memory-row" key={h.id}><div><strong>{h.topic}</strong><p>{h.summary}</p><small>{t('本机统计')} · {new Date(h.observedAt).toLocaleDateString()}</small></div>
        <button className="btn sm ghost" disabled={disabled} onClick={()=>void onForget([h.id])}><Icon name="trash"/>{t('删除')}</button></div>)
        :<p className="hint">{t(learnHabits?'用上几天后，这里会出现你的使用节奏。':'已关闭，不会学习使用习惯。')}</p>}</section>
    <section><h4>{t('需求线索')}</h4>
      {needs.length?(all?needs:needs.slice(0,12)).map(s=><div className="proactive-memory-row" key={s.id}><div><strong>{s.topic}</strong><p>{s.summary}</p>
        <small>{s.sourceLabel} · {new Date(s.observedAt).toLocaleDateString()} · {basis(s.basis)}</small></div>
        <button className="btn sm ghost" disabled={disabled} onClick={()=>void onForget([s.id])}><Icon name="trash"/>{t('删除')}</button></div>)
        :<p className="hint">{t('还没有记住任何需求。')}</p>}
      {needs.length>12&&!all&&<button className="btn sm ghost" onClick={()=>setAll(true)}>{t('显示全部')} · {needs.length}</button>}</section>
    <section><h4>{t('目标')}</h4>
      {goals.length?goals.map(g=><div className="proactive-memory-row" key={g.id}><div><strong>{g.title}</strong>
        <small>{t(g.status==='proposed'?'待你确认':g.status==='confirmed'?'已确认':g.status==='corrected'?'已纠正':'你说不是你的需求')} · {g.evidenceIds.length} {t('条依据')}</small></div>
        <button className="btn sm ghost" disabled={disabled} onClick={()=>void onForgetGoal(g.id)}><Icon name="trash"/>{t('删除目标和依据')}</button></div>)
        :<p className="hint">{t('还没有目标。')}</p>}</section>
    <div className="proactive-primary-actions proactive-memory-actions">
      <button className="btn sm" onClick={download}><Icon name="download"/>{t('下载我的管家数据')}</button>
      {confirm==='clear'?<><span>{t('清除后无法恢复，此前的对话不会再被学习。')}</span><button className="btn sm danger" disabled={disabled} onClick={()=>void onForgetAll().then(()=>setConfirm(null))}>{t('确认清除')}</button><button className="btn sm ghost" onClick={()=>setConfirm(null)}>{t('取消')}</button></>
        :<button className="btn sm ghost danger" disabled={disabled} onClick={()=>setConfirm('clear')}><Icon name="trash"/>{t('清除全部记忆')}</button>}
      {consented&&(confirm==='revoke'?<><span>{t('管家会立即关闭；已记住的内容保留，可以再删除。')}</span><button className="btn sm danger" disabled={disabled} onClick={()=>void onRevoke().then(()=>setConfirm(null))}>{t('确认撤回')}</button><button className="btn sm ghost" onClick={()=>setConfirm(null)}>{t('取消')}</button></>
        :<button className="btn sm ghost" disabled={disabled} onClick={()=>setConfirm('revoke')}>{t('撤回同意并关闭')}</button>)}
    </div>
  </details>;
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
