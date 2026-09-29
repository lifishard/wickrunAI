import React from 'react';
import { desktop } from '../../lib/transport';
import { useT } from '../../lib/i18n';
import type { NativeAiProvider, NativeAiState } from '../../lib/native-ai';
import { meetingKinds, meetingNames, meetingPhases, meetingMinutesText, type MeetingRoom as Room, type MeetingQuestion, type ContributionKind, type MeetingPhase } from '../../lib/meeting-room';
import './MeetingRoom.css';

const providers:NativeAiProvider[]=['claude-desktop','chatgpt'];
const kinds:ContributionKind[]=['viewpoint','question','concern','response','proposal','summary','pass'];
const phases=Object.keys(meetingPhases) as MeetingPhase[];
const minutesFields={agreements:'共识与依据',disagreements:'仍有分歧的观点',openQuestions:'待验证或暂缓的问题',actions:'行动建议、负责人和下一步'};
const readable=(error:unknown)=>String(error instanceof Error?error.message:error).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');

function QuestionCard({question,disabled,onAnswer}:{question:MeetingQuestion;disabled:boolean;onAnswer:(text:string,defer:boolean)=>Promise<void>}) {
  const tr=useT(),[answer,setAnswer]=React.useState('');
  return <section className="meeting-question" aria-label={tr('等待你决定')}>
    <strong>{tr('需要你拍板')}</strong><h3>{question.text}</h3><p>{question.reason}</p>
    {question.options.map((option,i)=><button key={i} type="button" className="meeting-option" aria-pressed={answer===option.label} disabled={disabled||question.status!=='pending'} onClick={()=>setAnswer(option.label)}><b>{option.label}</b><span>{option.impact}</span></button>)}
    {question.recommendation&&<p><b>{tr('成员建议')}：</b>{question.recommendation}</p>}
    {question.status==='pending'?<form onSubmit={e=>{e.preventDefault();void onAnswer(answer,false);}}>
      <label className="team-field"><span>{tr('你的答复（可选择上面的选项，也可自由填写）')}</span><textarea aria-label={tr('你的答复（可选择上面的选项，也可自由填写）')} required maxLength={6000} rows={3} value={answer} onChange={e=>setAnswer(e.target.value)} disabled={disabled}/></label>
      <div className="team-actions"><button className="btn primary" disabled={disabled||!answer.trim()}>{tr('提交决定')}</button><button className="btn" type="button" disabled={disabled||!answer.trim()} onClick={()=>void onAnswer(answer,true)}>{tr('说明原因并暂缓')}</button></div>
      <p className="team-note">{tr('没有默认答案；未回答不会视为同意。暂缓的问题仍保留在纪要中。')}</p>
    </form>:<p className="meeting-human-answer"><b>{tr(question.status==='answered'?'你的决定':'你已暂缓')}：</b>{question.answer}</p>}
  </section>;
}

export default function MeetingRoom({projectId,initialRoomId,onDraftTask}:{projectId:string;initialRoomId?:string;onDraftTask:(title:string,goal:string)=>void}) {
  const tr=useT();
  const [autoFocus,setAutoFocus]=React.useState('先理解已有观点，指出需要补充的依据，提出可行改进。需要用户取舍时直接提问。');
  const [rounds,setRounds]=React.useState(2);
  const [rooms,setRooms]=React.useState<Room[]>([]),[selected,setSelected]=React.useState(initialRoomId||'');
  const [loaded,setLoaded]=React.useState(false),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState('');
  const [creating,setCreating]=React.useState(false),[title,setTitle]=React.useState(''),[purpose,setPurpose]=React.useState(''),[material,setMaterial]=React.useState('');
  const [participants,setParticipants]=React.useState<NativeAiProvider[]>(providers);
  const [body,setBody]=React.useState(''),[kind,setKind]=React.useState<ContributionKind>('viewpoint'),[replyTo,setReplyTo]=React.useState('');
  const [inviteProvider,setInviteProvider]=React.useState<NativeAiProvider>('claude-desktop'),[focus,setFocus]=React.useState(''),[independent,setIndependent]=React.useState(false);
  const [connection,setConnection]=React.useState<NativeAiState|null>(null),[config,setConfig]=React.useState(''),[joinPrompt,setJoinPrompt]=React.useState('');
  const [promptProvider,setPromptProvider]=React.useState<NativeAiProvider>('claude-desktop');
  const [minutes,setMinutes]=React.useState({agreements:'',disagreements:'',openQuestions:'',actions:''}),[minutesBasis,setMinutesBasis]=React.useState<number|null>(null);
  const endRef=React.useRef<HTMLDivElement>(null),requestId=React.useRef(0),acting=React.useRef(false);
  const api=desktop();
  const refresh=React.useCallback(async()=>{
    const id=++requestId.current;
    const next=await desktop()!.meetingState(projectId);
    if(id===requestId.current){setRooms(next);setLoaded(true);}
  },[projectId]);
  React.useEffect(()=>{
    let alive=true;
    const poll=async()=>{try{await refresh();}catch(e){if(alive)setError(readable(e));}};
    void poll();const timer=setInterval(()=>{if(!acting.current)void poll();},3000);
    return()=>{alive=false;requestId.current++;clearInterval(timer);};
  },[refresh]);
  React.useEffect(()=>{if(initialRoomId)setSelected(initialRoomId);},[initialRoomId]);
  const room=rooms.find(r=>r.id===selected),closed=room?.phase==='closed';
  React.useEffect(()=>{setBody('');setReplyTo('');setFocus('');setIndependent(false);setJoinPrompt('');setMinutesBasis(null);setMinutes({agreements:'',disagreements:'',openQuestions:'',actions:''});},[selected]);
  React.useEffect(()=>{if(room)setInviteProvider(room.participants[0]);},[room?.id]);
  const act=async(fn:()=>Promise<void>)=>{
    if(acting.current)return;acting.current=true;setBusy(true);setError('');setNotice('');
    try{await fn();await refresh();}catch(e){setError(readable(e));}finally{acting.current=false;setBusy(false);}
  };
  const action=async(name:string,input:Record<string,unknown>)=>{await api!.meetingAction(name,{roomId:room?.id,...input});};
  const copy=async(value:string)=>{await navigator.clipboard.writeText(value);setNotice(tr('已复制'));};
  const checkConnection=()=>act(async()=>{setConnection(await api!.nativeAiState());});
  const prompt=async(p:NativeAiProvider)=>{const value=await api!.meetingPrompt(room!.id,p);setJoinPrompt(value);setPromptProvider(p);};
  const pending=room?.questions.filter(q=>q.status==='pending')||[];
  const minutesFresh=room?.minutes&&(closed||room.minutes.basedOn===room.messages.length);
  if(!api?.meetingState)return <p>{tr('请在支持会议室的新版桌面端打开。')}</p>;
  return <div className="meeting-room">
    <div className="team-toolbar"><div><h1>{tr('会议室')}</h1><p>{tr('共同理解问题、改进方案。保留不同意见，由你拍板。')}</p></div><button className="btn primary" onClick={()=>setCreating(!creating)} disabled={busy}>{tr(creating?'收起新会议':'新建会议')}</button></div>
    {error&&<div className="team-error" role="alert">{error}<button className="btn sm" onClick={()=>void act(async()=>{})}>{tr('刷新')}</button></div>}
    {notice&&<p role="status">{notice}</p>}
    {creating&&<form className="meeting-create team-card" onSubmit={e=>{e.preventDefault();void act(async()=>{const created=await api.meetingAction('create',{projectId,title,purpose,material,participants}) as Room;setSelected(created.id);setCreating(false);setTitle('');setPurpose('');setMaterial('');});}}>
      <label className="team-field"><span>{tr('会议议题')}</span><input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="team-field"><span>{tr('这次希望想清楚什么，或做出什么决定？')}</span><textarea required rows={3} maxLength={3000} value={purpose} onChange={e=>setPurpose(e.target.value)}/></label>
      <label className="team-field"><span>{tr('背景、材料和已知约束（可选）')}</span><textarea rows={4} maxLength={24000} value={material} onChange={e=>setMaterial(e.target.value)}/></label>
      <fieldset><legend>{tr('参会成员')}</legend><p>{tr('你担任主持人与决策者；AI 使用各自客户端中的会话。')}</p>{providers.map(p=><label className="team-check" key={p}><input type="checkbox" checked={participants.includes(p)} onChange={e=>setParticipants(all=>e.target.checked?[...all,p]:all.filter(x=>x!==p))}/>{meetingNames[p]}</label>)}</fieldset>
      <button className="btn primary" disabled={busy||!participants.length}>{tr('创建会议')}</button>
    </form>}
    <details className="meeting-setup"><summary>{tr('参会接入与会议约定')}</summary>
      <p>{tr('先连接客户端，再开始自动轮流。在各自客户端发送一次加入指令，成员保持参会后便会自动接收后续邀请。已停止或关闭的聊天仍需手动重新加入。模型与思考强度在各自客户端选择。')}</p>
      <div className="team-actions"><button className="btn" disabled={busy} onClick={()=>void act(async()=>{const result=await api.nativeAiExtension();setConnection(result.state);setNotice(tr('请在 Claude Desktop 完成扩展安装并启用会议工具。'));})}>{tr('安装 Claude 参会扩展')}</button><button className="btn" disabled={busy} onClick={()=>void act(async()=>{const result=await api.meetingConnection('chatgpt');setConfig(JSON.stringify(result,null,2));setConnection(await api.nativeAiState());})}>{tr('准备 ChatGPT 会议连接')}</button><button className="btn" disabled={busy} onClick={checkConnection}>{tr('检查连接')}</button></div>
      {connection&&providers.map(p=>{const c=connection.connections.find(c=>c.provider===p);return <p key={p}>{meetingNames[p]}：{tr(c?.connected?'连接已有响应':c?.configured?'已准备，等待客户端接入':'尚未接入')}</p>;})}
      <p>{tr('ChatGPT 需要支持插件的会话及开发者模式。可通过官方 Secure MCP Tunnel 连接这台电脑的会议工具；普通 Chat 模式和桌面版本的支持需在你的账户中确认。此处不会用 Codex 或 API 回答替代 ChatGPT。')}</p>
      {config&&<><p>{tr('供本机隧道运行器使用的 stdio 配置（不是可粘贴到 ChatGPT 的网址）：')}</p><pre>{config}</pre><button className="btn sm" onClick={()=>void act(()=>copy(config))}>{tr('复制本机连接配置')}</button></>}
      <a href="https://developers.openai.com/api/docs/guides/secure-mcp-tunnels" target="_blank" rel="noreferrer">{tr('查看 ChatGPT 官方隧道连接步骤')}</a>
      <ul><li>{tr('先理解再评价，提供依据与改进建议；允许修正立场和暂无补充。')}</li><li>{tr('需要你决定时公开提问，依赖决定的步骤等待；不相关的讨论可由你另行邀请。')}</li><li>{tr('会议共识、纪要确认和行动建议都不代表质检通过，不会自动执行任务。')}</li><li>{tr('每次邀请一次贡献，每场最多 30 次 AI 发言；保留原始记录，不自动无限循环。')}</li></ul>
    </details>
    {loaded&&!rooms.length&&!creating&&<div className="team-empty">{tr('提出一个议题，邀请 Claude Desktop 和 ChatGPT 一起讨论。')}</div>}
    {!loaded&&<p role="status">{tr('正在读取会议记录…')}</p>}
    {rooms.length>0&&<label className="team-field meeting-picker"><span>{tr('选择会议')}</span><select aria-label={tr('选择会议')} value={selected} onChange={e=>setSelected(e.target.value)}><option value="">{tr('请选择会议')}</option>{rooms.slice().reverse().map(r=><option key={r.id} value={r.id}>{r.title} · {tr(meetingPhases[r.phase])}{r.questions.some(q=>q.status==='pending')?' · '+tr('等待你决定'):''}</option>)}</select></label>}
    {room&&<>
      <header className="meeting-heading"><h2>{room.title}</h2><p>{room.purpose}</p><span className="team-status">{tr(meetingPhases[room.phase])}</span></header>
      <div className="meeting-stages" aria-label={tr('会议阶段')}>{phases.filter(p=>p!=='closed').map(p=><button type="button" key={p} className={room.phase===p?'active':''} aria-current={room.phase===p?'step':undefined} disabled={busy||closed||room.phase===p||(p==='decision'&&pending.length>0)} onClick={()=>void act(()=>action('phase',{phase:p}))}>{tr(meetingPhases[p])}</button>)}</div>
      <p className="team-note">{tr('你可以按讨论需要调整阶段；切换阶段会撤回尚未完成的发言邀请。')}</p>
      {room.material&&<details><summary>{tr('共享材料')}</summary><p className="meeting-text">{room.material}</p></details>}
      {!closed&&<section className="meeting-auto team-card" aria-label={tr('自动轮流讨论')}>
        <h3>{tr('自动轮流讨论')}</h3>
        <p>{tr('每位成员在自己的客户端加入一次，随后自动轮流收到邀请。遇到需要你拍板的问题等待答复；决定会写入双方后续阅读的记录。')}</p>
        {room.auto&&<p role="status"><b>{room.auto.reason}</b> · {tr('剩余发言次数')} {room.auto.remaining}</p>}
        {room.auto?.status==='running'?<>
          <div className="team-actions">{room.participants.map(p=><button key={p} className="btn" disabled={busy} onClick={()=>void act(async()=>{const value=await api.meetingPrompt(room.id,p);await copy(value);setNotice(`${meetingNames[p]}：${tr('加入指令已复制，请在该客户端会话发送一次。')}`);})}>{tr('复制加入指令')} · {meetingNames[p]}</button>)}<button className="btn" disabled={busy} onClick={()=>void act(()=>action('auto_pause',{}))}>{tr('暂停自动轮流')}</button></div>
          <ul>{room.attendance?.map(a=><li key={a.provider}>{meetingNames[a.provider]}：{tr(a.waiting?'正在等待下一次邀请':a.connected?'已加入，等待发言或继续接收邀请':'尚未加入或连接已过期')}</li>)}</ul>
        </>:<form onSubmit={e=>{e.preventDefault();void act(()=>action('auto_start',{rounds,focus:autoFocus}));}}>
          <label className="team-field"><span>{tr('这轮共同讨论的重点')}</span><textarea aria-label={tr('这轮共同讨论的重点')} required rows={2} maxLength={2000} value={autoFocus} onChange={e=>setAutoFocus(e.target.value)} disabled={busy}/></label>
          <label className="team-field"><span>{tr('每位成员最多发言几次')}</span><select aria-label={tr('每位成员最多发言几次')} value={rounds} onChange={e=>setRounds(Number(e.target.value))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
          <button className="btn primary" disabled={busy||!autoFocus.trim()||pending.length>0||room.invitations.some(i=>i.status==='waiting')}>{tr('开始自动轮流')}</button>
        </form>}
        <p className="team-note">{tr('自动邀请只发送给正在参会的客户端。约三分钟没有讨论进展会暂停，成员连续暂无补充会结束本轮；不会自动确认纪要、执行任务或替代质检。')}</p>
      </section>}
      {pending.length>0&&<div className="meeting-waiting" role="status">{tr('有问题等待你决定')}（{pending.length}） · <button className="btn sm" onClick={()=>document.getElementById(`meeting-message-${pending[0].messageId}`)?.scrollIntoView({block:'center',behavior:'smooth'})}>{tr('查看问题')}</button></div>}
      <div className="meeting-transcript" aria-label={tr('会议发言')}>
        {!room.messages.length&&<p className="team-empty">{tr('先补充议题或邀请成员阅读材料、提出各自观点。')}</p>}
        {room.messages.map(m=>{const parent=room.messages.find(x=>x.id===m.replyTo),q=room.questions.find(q=>q.id===m.questionId&&q.messageId===m.id);return <article id={`meeting-message-${m.id}`} className={`meeting-message ${m.author==='user'?'human':''}`} key={m.id}>
          <header><b>{tr(meetingNames[m.author])}</b><span>{tr(meetingKinds[m.kind])}{m.to?' · '+meetingNames[m.to]:''}</span><time dateTime={new Date(m.at).toISOString()}>{new Date(m.at).toLocaleTimeString()}</time><small>#{m.seq}</small></header>
          {parent&&<button className="meeting-quote" onClick={()=>document.getElementById(`meeting-message-${parent.id}`)?.scrollIntoView({block:'center'})}>{tr('回应')} #{parent.seq} · {meetingNames[parent.author]}：{parent.text.slice(0,180)}</button>}
          {q?<QuestionCard question={q} disabled={busy||Boolean(closed)} onAnswer={(text,defer)=>act(()=>action('answer',{questionId:q.id,text,defer}))}/>:<p className="meeting-text">{m.kind==='phase'?tr(meetingPhases[m.text as MeetingPhase]||m.text):m.text}</p>}
          {m.basedOn!==undefined&&<small>{tr('基于已读取的发言')} #{m.basedOn} {m.basedOn<m.seq-1?tr('（之后的发言尚未包含在本次阅读中）'):''}</small>}
          {!closed&&<button className="btn sm ghost" onClick={()=>{setReplyTo(m.id);setKind('response');endRef.current?.scrollIntoView({block:'center'});}}>{tr('引用并回应')}</button>}
        </article>;})}
      </div>
      {!closed&&<div ref={endRef} className="meeting-compose">
        {replyTo&&<p>{tr('正在回应')} #{room.messages.find(m=>m.id===replyTo)?.seq}<button className="btn sm ghost" onClick={()=>setReplyTo('')}>{tr('取消引用')}</button></p>}
        <form onSubmit={e=>{e.preventDefault();void act(async()=>{await action('post',{text:body,kind,replyTo:replyTo||undefined});setBody('');setReplyTo('');});}}>
          <label className="team-field"><span>{tr('你的发言')}</span><textarea rows={3} required maxLength={6000} value={body} onChange={e=>setBody(e.target.value)} placeholder={tr('补充信息、追问、提出异议或调整讨论方向')}/></label>
          <div className="team-actions"><select aria-label={tr('发言类型')} value={kind} onChange={e=>setKind(e.target.value as ContributionKind)}>{kinds.map(k=><option key={k} value={k}>{tr(meetingKinds[k])}</option>)}</select><button className="btn primary" disabled={busy||!body.trim()}>{tr('发送发言')}</button></div>
        </form>
        <form className="meeting-invite" onSubmit={e=>{e.preventDefault();void act(async()=>{await action('invite',{provider:inviteProvider,focus,replyTo:replyTo||undefined,independent});await prompt(inviteProvider);setFocus('');setReplyTo('');setIndependent(false);});}}>
          <h3>{tr('邀请成员发言')}</h3><select aria-label={tr('发言成员')} value={inviteProvider} onChange={e=>setInviteProvider(e.target.value as NativeAiProvider)}>{room.participants.map(p=><option key={p} value={p}>{meetingNames[p]}</option>)}</select>
          <label className="team-field"><span>{tr('希望对方讨论什么？')}</span><textarea required rows={2} maxLength={2000} value={focus} onChange={e=>setFocus(e.target.value)} placeholder={tr('例如：先概括对方的建议，再指出需要补充的依据和可行改进')}/></label>
          {pending.length>0&&<label className="team-check"><input type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/>{tr('这次讨论不依赖尚未回答的决定')}</label>}
          <button className="btn" disabled={busy||room.auto?.status==='running'||!focus.trim()||(pending.length>0&&!independent)||room.invitations.some(i=>i.provider===inviteProvider&&i.status==='waiting')}>{tr('邀请并生成参会指令')}</button>
        </form>
        {room.invitations.filter(i=>i.status==='waiting').map(i=><div className="meeting-invitation" key={i.id}><span>{meetingNames[i.provider]} · {tr(i.readAt?'已读取，等待回应':'等待读取邀请')}</span><div className="team-actions"><button className="btn sm" disabled={busy} onClick={()=>void act(()=>prompt(i.provider))}>{tr('查看参会指令')}</button><button className="btn sm" disabled={busy} onClick={()=>void act(()=>action('cancel_invite',{invitationId:i.id}))}>{tr('撤回邀请')}</button></div></div>)}
        {joinPrompt&&<div className="meeting-handoff"><p>{tr('在对应客户端的会话中发送以下指令。后续轮次沿用同一会话；如果客户端已停止，需在那里继续。')}</p><textarea aria-label={tr('参会指令')} readOnly value={joinPrompt} rows={4}/><div className="team-actions"><button className="btn" onClick={()=>void act(()=>copy(joinPrompt))}>{tr('复制参会指令')}</button><button className="btn" onClick={()=>void act(async()=>{await api.nativeAiOpen(promptProvider);})}>{tr('打开对应客户端')}</button></div></div>}
      </div>}
      <section className="meeting-minutes"><h2>{tr('纪要与下一步')}</h2><p>{tr('归纳共识、分歧、未决问题和行动建议。只有你能确认；确认纪要不会替代独立质检。')}</p>
        {room.minutes&&<div className="meeting-confirmed"><p><b>{tr(minutesFresh?'纪要已经你确认':'确认后出现了新发言，请重新核对纪要')}</b></p>{Object.entries(minutesFields).map(([key,label])=><div key={key}><h3>{tr(label)}</h3><p className="meeting-text">{room.minutes![key as keyof typeof minutesFields]}</p></div>)}</div>}
        {!closed&&<details><summary>{tr('整理或更新纪要')}</summary><p>{tr('可以请成员先发一条“归纳草案”，再将内容整理到下方；不要把未回应写成一致同意。')}</p><button className="btn sm" disabled={busy} onClick={()=>{setMinutesBasis(room.messages.length);if(room.minutes)setMinutes({agreements:room.minutes.agreements,disagreements:room.minutes.disagreements,openQuestions:room.minutes.openQuestions,actions:room.minutes.actions});}}>{tr('已读最新发言，开始整理')}</button>
          <form onSubmit={e=>{e.preventDefault();void act(()=>action('minutes',{...minutes,basedOn:minutesBasis}));}}>{Object.entries(minutesFields).map(([key,label])=><label className="team-field" key={key}><span>{tr(label)}</span><textarea aria-label={tr(label)} rows={3} required maxLength={6000} disabled={minutesBasis===null} value={minutes[key as keyof typeof minutes]} onChange={e=>setMinutes(m=>({...m,[key]:e.target.value}))}/></label>)}<p className="team-note">{tr('没有的项目请填“无”。有新发言时需重新阅读后再确认。')}</p><button className="btn primary" disabled={busy||pending.length>0||minutesBasis===null||minutesBasis!==room.messages.length}>{tr('确认这份会议纪要')}</button></form>
        </details>}
        <div className="team-actions"><button className="btn" disabled={busy} onClick={()=>void act(async()=>{await api.saveArtifact('会议记录.md',meetingMinutesText(room));})}>{tr('导出会议记录')}</button><button className="btn" disabled={!minutesFresh||pending.length>0} onClick={()=>onDraftTask(room.title+' · '+tr('后续任务'),meetingMinutesText(room))}>{tr('整理为任务草稿')}</button>{!closed&&<button className="btn" disabled={busy||pending.length>0||!minutesFresh} onClick={()=>void act(()=>action('phase',{phase:'closed'}))}>{tr('结束会议')}</button>}</div>
      </section>
    </>}
  </div>;
}
