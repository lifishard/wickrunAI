import React from 'react';
import { useT } from '../lib/i18n';
import { Modal } from './ui';
import { desktop } from '../lib/transport';
import type { Conversation } from '../types';
import type { FileSession } from '../lib/collaboration';
export interface CoordinatedTask {id:string;title:string;mode:string;status:string;isolated:boolean;roots:string[];blockedBy:string[];progress:string}
const labels:Record<string,string>={running:'正在执行',queued:'等待开始',waiting_workspace:'等待工作目录',waiting:'等待输入',paused:'已暂停',completed:'已完成',blocked:'工作区需处理',draft:'草稿'};
export default function ConversationCoordination(props:{active:Conversation;tasks:CoordinatedTask[];busy:boolean;onClose:()=>void;onOpen:(id:string)=>void;onMessage:(id:string,text:string)=>Promise<void>;onMerged:()=>Promise<void>}){
 const t=useT();
 const [target,setTarget]=React.useState(props.tasks.find(t=>t.id!==props.active.id)?.id??''),[text,setText]=React.useState(''),[notice,setNotice]=React.useState(''),[pending,setPending]=React.useState(false);
 const [files,setFiles]=React.useState<FileSession|null>(null),[preview,setPreview]=React.useState<{path:string;before:string|null;after:string|null}|null>(null);
 async function act(work:()=>Promise<void>){setPending(true);try{await work();}catch(e){setNotice(String(e));}finally{setPending(false);}}
 return <Modal title={t('并行任务协调')} onClose={props.onClose} wide footer={<button className="btn" onClick={props.onClose}> {t('关闭')}</button>}>
  <div style={{padding:16,display:'grid',gap:16,minWidth:0}}>
   <p className="hint"> {t('各任务保留独立上下文；本机 Work 可使用独立文件副本。协调消息在下一次请求模型时读取，MCP Bridge 在下次交接时带入。暂停或完成的任务不会自动重启。')}</p>
   {props.tasks.map(task=><article key={task.id} style={{border:'1px solid var(--border)',borderRadius:10,padding:12,minWidth:0}}>
    <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><strong style={{overflowWrap:'anywhere'}}>{task.title}</strong><span className="chip">{task.mode==='work'?'Work':'Chat'}</span><span className="chip">{t(labels[task.status]??task.status)}</span><button className="btn sm" onClick={()=>props.onOpen(task.id)}> {t('打开会话')}</button></div>
    {task.mode==='work'&&<p className="hint">{task.isolated?t('文件在独立副本中修改'):task.roots.length?t('共用目录，重叠任务会排队'):t('未占用本机工作目录')}</p>}
    {!!task.blockedBy.length&&<p>{t('等待：')}{task.blockedBy.map(id=>props.tasks.find(t=>t.id===id)?.title??t('其他任务')).join('、')}</p>}
    {!!task.progress&&<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:160,overflow:'auto'}}>{task.progress}</p>}
   </article>)}
   {props.tasks.some(t=>t.id!==props.active.id)&&<div style={{display:'grid',gap:8}}>
    <label> {t('接收任务')}<select aria-label={t('接收任务')} value={target} onChange={e=>setTarget(e.target.value)} style={{width:'100%',minWidth:0}}>{props.tasks.filter(t=>t.id!==props.active.id).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
    <textarea aria-label={t('协调消息')} value={text} onChange={e=>setText(e.target.value)} maxLength={4000} rows={3} placeholder={t('说明分工、共享发现或需要对方避开的文件')}/>
    <button className="btn" disabled={pending||!text.trim()||!target} onClick={()=>void act(async()=>{await props.onMessage(target,text);setText('');setNotice(t('协调消息已保存，等待接收任务读取。'));})}> {t('发送协调消息')}</button>
   </div>}
   {!!props.active.coordinationMessages?.length&&<details><summary>{t('收到的协调消息（{count}）',{count:props.active.coordinationMessages.length})}</summary>{props.active.coordinationMessages.map(m=><p key={m.id} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}><strong>{m.fromTitle}</strong><br/>{m.text}</p>)}</details>}
   {props.active.workspace&&desktop()&&<section style={{display:'grid',gap:8}}>
    <strong> {t('当前任务的文件副本')}</strong><p className="hint" style={{overflowWrap:'anywhere'}}>{props.active.workspace.isolatedRoot}</p>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn" onClick={()=>void act(async()=>{await desktop()!.openPath(props.active.workspace!.isolatedRoot);})}> {t('打开文件夹')}</button><button className="btn" disabled={pending||props.busy} onClick={()=>void act(async()=>{setFiles(await desktop()!.teamFilesDiff(props.active.workspace!.id));setPreview(null);})}> {t('检查文件差异')}</button></div>
    {props.busy&&<p className="hint"> {t('运行中的任务结束或暂停后，可核对并应用文件改动。')}</p>}
    {files?.recoveryRequired&&<><p role="alert">{files.recoveryReason}</p><button className="btn" disabled={pending||props.busy} onClick={()=>void act(async()=>{setFiles(await desktop()!.teamFilesRecover(files.id));})}> {t('核实并恢复')}</button></>}
    {files?.files.map(f=><button className="btn" style={{textAlign:'left',overflowWrap:'anywhere',whiteSpace:'normal'}} key={f.path} onClick={()=>void act(async()=>setPreview(await desktop()!.teamFilesPreview(files.id,f.path)))}>{f.path} · {f.status==='conflict'?t('原文件已变化'):!f.beforeHash?t('新增'):f.afterHash?t('修改'):t('删除')}</button>)}
    {files?.status==='conflict'&&<p role="alert"> {t('原文件已变化，不能覆盖。请核对其他任务的修改。')}</p>}
    {files?.status==='pending'&&files.files.length>0&&<button className="btn primary" disabled={pending||props.busy} onClick={()=>void act(async()=>{setFiles(await desktop()!.teamFilesMerge(files.id,files.files.map(({path,beforeHash,afterHash})=>({path,beforeHash,afterHash}))));await props.onMerged();setNotice(t('已应用核对过的文件改动。后续修改请新建 Work 副本。'));})}>{t('应用已检查的 {count} 个文件',{count:files.files.length})}</button>}
    {files&&!files.files.length&&<p className="hint"> {t('没有文件改动。')}</p>}
    {preview&&<details open><summary>{preview.path}</summary><p> {t('原内容')}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:200,overflow:'auto'}}>{preview.before??t('（不存在）')}</pre><p> {t('修改后')}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:200,overflow:'auto'}}>{preview.after??t('（已删除）')}</pre></details>}
   </section>}
   {notice&&<p role="status" style={{overflowWrap:'anywhere'}}>{notice}</p>}
  </div>
 </Modal>;
}
