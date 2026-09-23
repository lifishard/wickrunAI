import React from 'react';
import type { ChatMessage, CodeChange, ToolStep } from '../types';
import { desktop } from '../lib/transport';
import { Modal } from './ui';
import './CodeChanges.css';

const STATUS = {pending:'待审核 · 尚未生效',applied:'已生效',denied:'已拒绝 · 未生效',conflict:'未应用 · 需重新审核',unknown:'执行结果待核实',reverted:'已回退'};
const KIND = {added:'新增',modified:'修改',deleted:'删除'};

export function ChangeDiff({change, expanded = false, loadFull}:{change:CodeChange;expanded?:boolean;loadFull?:()=>Promise<CodeChange>}) {
  const [opened,setOpened]=React.useState(expanded),[mode,setMode]=React.useState<'full'|'diff'>('full');
  const [full,setFull]=React.useState<{key:string;change:CodeChange}>(),[error,setError]=React.useState('');
  const fullKey=JSON.stringify([change.id,change.beforeHash,change.afterHash]),loader=React.useRef(loadFull);loader.current=loadFull;
  const fullChange=full?.key===fullKey?full.change:undefined,canLoad=Boolean(loadFull);
  React.useEffect(()=>{let stale=false;if(opened&&mode==='full'&&canLoad&&!fullChange){setError('');void loader.current!().then(value=>{if(!stale)setFull({key:fullKey,change:value});}).catch(e=>{if(!stale)setError(String(e.message??e));});}return()=>{stale=true;};},[opened,mode,canLoad,fullKey,fullChange]);
  const shown=canLoad&&mode==='full'&&fullChange?fullChange:change;
  return <details className="code-change" open={opened} onToggle={e=>setOpened(e.currentTarget.open)}>
    <summary><span className="change-path" title={change.path}>{KIND[change.kind]} · {change.path}</span><span className="change-count"><b>+{change.additions}</b> <i>−{change.deletions}</i></span></summary>
    <div className="change-meta"><span>{STATUS[change.status]}</span><time>{new Date(change.at).toLocaleString()}</time></div>
    {canLoad?<div className="file-view-toolbar"><div className="seg"><button type="button" className={mode==='full'?'on':''} aria-pressed={mode==='full'} onClick={()=>setMode('full')}>完整文件</button><button type="button" className={mode==='diff'?'on':''} aria-pressed={mode==='diff'} onClick={()=>setMode('diff')}>仅看差异</button></div><span>{mode==='full'?(fullChange?'保留全部上下文 · 红删绿增':'正在读取完整文件…'):'仅显示修改附近的内容'}</span></div>:null}
    {canLoad&&mode==='full'?<p className="file-version-hint">本轮结束时的文件版本，删除内容在原位置标红；左侧为原行号，右侧为新行号。</p>:null}
    {error&&mode==='full'?<p role="alert" className="version-error">完整文件读取失败：{error}。下方仅有差异片段。</p>:null}
    <div className="change-diff" role="region" aria-label={`代码差异：${change.path}`} tabIndex={0}>
      {shown.lines.map((line,index)=><div className={`diff-line diff-${line.kind}`} key={index}><span className="diff-number">{line.oldLine}</span><span className="diff-number">{line.newLine}</span><span className="diff-sign">{line.kind==='add'?'+':line.kind==='delete'?'−':' '}</span><code>{line.text || ' '}</code></div>)}
      {!shown.lines.length ? <p>文件内容未变化</p> : null}
    </div>
  </details>;
}

export function CodeChangeSummary({steps}:{steps:ToolStep[]}) {
  const changes=[...new Map(steps.flatMap(step=>step.codeChanges??[]).map(c=>[c.id,c])).values()], warnings=steps.flatMap(step=>step.codeAuditWarnings??[]);
  if(!changes.length&&!warnings.length)return null;
  return <details className="code-change-summary"><summary>代码改动 · {changes.length} 次 <span className="change-count"><b>+{changes.reduce((n,c)=>n+c.additions,0)}</b> <i>−{changes.reduce((n,c)=>n+c.deletions,0)}</i></span></summary>
    {changes.map(change=><ChangeDiff key={change.id} change={change}/>)}
    {warnings.length?<p className="hint">部分文件未记录逐行差异，请在右侧面板查看记录范围。</p>:null}
  </details>;
}

type VersionData = Awaited<ReturnType<NonNullable<NonNullable<ReturnType<typeof desktop>>['codeVersion']>>>;
function VersionCard({message,index,latest,filter,busy,onReverted}:{message:ChatMessage;index:number;latest:boolean;filter:string;busy:boolean;onReverted:()=>Promise<void>}) {
  const changes=[...new Map((message.steps??message.runState?.steps??[]).flatMap(s=>s.codeChanges??[]).map(c=>[c.id,c])).values()];
  const applied=changes.filter(c=>c.status==='applied'||c.status==='reverted');
  const ids=applied.flatMap(c=>c.revisionId?[c.revisionId]:[]),idKey=JSON.stringify(ids);
  const [data,setData]=React.useState<VersionData>(),[preview,setPreview]=React.useState<VersionData>(),[error,setError]=React.useState(''),[acting,setActing]=React.useState(false);
  const bridge=desktop();const available=Boolean(bridge?.codeVersion)&&ids.length>0&&ids.length===applied.length;
  React.useEffect(()=>{let stale=false;setData(undefined);setError('');if(available)void bridge!.codeVersion!('details',JSON.parse(idKey)).then(d=>{if(!stale)setData(d);}).catch(e=>{if(!stale)setError(String(e.message??e));});return()=>{stale=true;};},[idKey,available,busy]);
  const status=data?.entries?.every(e=>e.status==='reverted')?'reverted':data?.recovering?'reverting':data?.entries?.every(e=>e.status==='kept')?'kept':'applied';
  const blocked=busy||Boolean(message.pending)||acting||!available||!data||Boolean(data.warning)||status==='reverted';
  const net=data?.files?.length?data.files.map(c=>({...c,status:status==='reverted'?'reverted' as const:c.status})):changes;
  const visible=net.filter(c=>c.path.toLowerCase().includes(filter.toLowerCase()));
  async function act(action:'keep'|'preview'|'revert'){
    if(blocked)return;setActing(true);setError('');
    try{const result=await bridge!.codeVersion!(action,ids);if(action==='preview')setPreview(result);else{setPreview(undefined);setData(await bridge!.codeVersion!('details',ids));if(action==='revert')await onReverted();}}
    catch(e){setError(e instanceof Error?e.message:String(e));try{setData(await bridge!.codeVersion!('details',ids));}catch{/* retain last known state */}}
    finally{setActing(false);}
  }
  if(!visible.length)return null;
  return <section className="code-version">
    <div className="version-heading"><strong>第 {index} 轮改动</strong><span className="version-status">{message.pending?'改动中':status==='reverted'?'已回退':status==='reverting'?'回退待完成':status==='kept'?'已审阅 · 保留':applied.length?'已生效 · 待审阅':'未生效'}</span></div>
    <p className="hint">{new Date(message.createdAt).toLocaleString()} · {new Set(applied.map(c=>c.path)).size} 个文件 · {changes.length} 次编辑</p>
    {visible.map(c=><ChangeDiff key={c.id} change={c} expanded={latest&&net.length===1} loadFull={available&&data?.files?.length?async()=>{const result=await bridge!.codeVersion!('file',ids,c.path);if(!result.files?.[0])throw Error('快照中没有完整文件');return result.files[0];}:undefined}/>)}
    {applied.length?<div className="version-actions"><button className="btn sm" disabled={blocked||status==='kept'||status==='reverting'} onClick={()=>void act('keep')}>保留这一轮</button><button className="btn sm" disabled={blocked} onClick={()=>void act('preview')}>{status==='reverting'?'继续回退':'回退已记录改动'}</button></div>:null}
    {busy?<p className="hint">任务结束后可保留或回退。</p>:null}
    {applied.length&&!available?<p className="hint">仅可查看记录：{applied.find(c=>c.revertUnavailable)?.revertUnavailable??'这轮包含未保存快照的旧改动，无法完整回退。请使用本机桌面端查看有快照的新版本。'}</p>:null}
    {data?.warning?<p role="alert">{data.warning}；请查看操作明细。</p>:null}
    {error?<p className="version-error" role="alert">{error}</p>:null}
    {data?.files?.length?<details className="version-history"><summary>操作明细（{changes.length}）</summary>{changes.map(c=><ChangeDiff key={c.id} change={status==='reverted'&&c.revisionId?{...c,status:'reverted'}:c}/>)}</details>:null}
    {preview?<Modal title="回退这一轮已记录的改动" onClose={()=>{if(!acting)setPreview(undefined);}} wide footer={<><button className="btn" autoFocus disabled={acting} onClick={()=>setPreview(undefined)}>取消</button><button className="btn primary" disabled={blocked} onClick={()=>void act('revert')}>确认回退</button></>}><div className="modal-body"><p>以下差异将应用到文件。回退前会再次检查是否有后续编辑；未记录的文件和外部操作不在回退范围内。</p>{preview.files?.map((c,i)=><ChangeDiff key={c.path} expanded change={{...c,id:'revert-'+i,status:'pending',at:Date.now()}}/>)}{error?<p role="alert">{error}</p>:null}</div></Modal>:null}
  </section>;
}

export default function CodeChangesPanel({messages,onClose,busy=false,onReverted=async()=>{}}:{messages:ChatMessage[];onClose:()=>void;busy?:boolean;onReverted?:()=>Promise<void>}) {
  const [filter,setFilter]=React.useState('');
  const entries=React.useMemo(()=>messages.filter(m=>m.role==='assistant').flatMap(message=>(message.steps??message.runState?.steps??[]).flatMap(step=>(step.codeChanges??[]).map(change=>({change,step})))),[messages]);
  const warnings=[...new Set(messages.flatMap(m=>(m.steps??m.runState?.steps??[]).flatMap(s=>s.codeAuditWarnings??[])))];
  const unique=[...new Map(entries.map(entry=>[entry.change.id,entry])).values()];
  const filtered=unique.filter(({change})=>change.path.toLowerCase().includes(filter.toLowerCase()));
  const applied=unique.filter(({change})=>change.status==='applied');
  const versions=messages.filter(m=>m.role==='assistant'&&(m.steps??m.runState?.steps??[]).some(s=>s.codeChanges?.length));
  const exportDiff=()=>{
    const text=unique.map(({change,step})=>`# ${new Date(change.at).toISOString()} ${STATUS[change.status]} · ${step.name}\n# before ${change.beforeHash??'(new)'} after ${change.afterHash??'(deleted)'}\n--- ${change.kind==='added'?'/dev/null':change.path}\n+++ ${change.kind==='deleted'?'/dev/null':change.path}\n${change.lines.map(l=>(l.kind==='hunk'?'':l.kind==='add'?'+':l.kind==='delete'?'-':' ')+l.text).join('\n')}`).join('\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='wickrun-code-changes.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <aside className="code-changes-panel" aria-label="代码改动">
    <header><strong>代码改动</strong><button className="btn sm ghost" onClick={onClose}>关闭</button></header>
    <div className="code-changes-toolbar"><span>{new Set(entries.map(e=>e.change.path)).size} 个文件 · {applied.length} 次已生效</span><button className="btn sm" disabled={!entries.length} onClick={exportDiff}>导出记录</button></div>
    <p className="hint">先应用，按轮审阅。在完整文件中标出本轮改动，保留上下文，也可切换为仅看差异。命令与本机代理的快照可能包含同期外部编辑；忽略依赖、构建目录与链接。</p>
    <input aria-label="筛选改动文件" placeholder="按文件路径筛选" value={filter} onChange={e=>setFilter(e.target.value)}/>
    <div className="code-changes-body">
      {!entries.length?<p className="code-changes-empty">还没有代码改动。AI 修改文件后，新增、删除和修改记录会保存在这里。</p>:!filtered.length?<p>没有匹配的文件</p>:versions.map((m,i)=><VersionCard key={m.id} message={m} index={i+1} latest={i===versions.length-1} filter={filter} busy={busy} onReverted={onReverted}/>)}
      {warnings.length?<details className="audit-warnings"><summary>部分文件未记录差异（{warnings.length}）</summary>{warnings.map(w=><p key={w}>{w}</p>)}</details>:null}
    </div>
  </aside>;
}
