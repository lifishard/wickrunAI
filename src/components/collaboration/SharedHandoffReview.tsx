import React from 'react';
import {Modal,Field} from '../ui';
import {useT} from '../../lib/i18n';
import type {TeamProject} from '../../lib/collaboration';
import type {SharedConnection,SharedItem} from '../../lib/shared-resources';
import type {HandoffInput} from '../../lib/shared-handoff';
import './CollaborationHub.css';

export type HandoffReviewState={receipt:Record<string,unknown>;target:SharedItem;connection:SharedConnection;accountId:string};
export default function SharedHandoffReview({value,teams,projects,onClose,onOpen}:{value:HandoffReviewState;teams:Record<string,TeamProject>;projects:{id:string;name:string}[];onClose:()=>void;onOpen:(local?:HandoffInput['selectedLocal'],conversation?:boolean)=>Promise<void>}) {
  const t=useT(),[workflowKey,setWorkflowKey]=React.useState(''),[agentId,setAgentId]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const workflows=Object.entries(teams).filter(([id])=>projects.some(p=>p.id===id)).flatMap(([projectId,team])=>team.workflows.filter(w=>!w.archived).map(workflow=>({key:JSON.stringify([projectId,workflow.id]),projectId,workflow,team})));
  const chosen=workflows.find(w=>w.key===workflowKey);
  const payload=(value.receipt.payload??{}) as Record<string,unknown>;
  const remoteAgents=Array.isArray(value.target.payload.agents)?value.target.payload.agents as Record<string,unknown>[]:[];
  const remoteAgent=remoteAgents.find(a=>a.id===value.connection.targetAgentId);
  const open=async(conversation=false)=>{
    setBusy(true);setError('');
    try{await onOpen(!conversation&&chosen&&agentId?{projectId:chosen.projectId,workflowId:chosen.workflow.id,agentId}:undefined,conversation);}
    catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  return <div className="shared-handoff-review"><Modal title={t('选择交接的本地接收方')} onClose={()=>{if(!busy)onClose();}} footer={<div className="share-actions"><button className="btn primary" disabled={busy||!chosen||!chosen.team.members.some(m=>m.id===agentId)} onClick={()=>void open()}>{t('打开为 Agent 任务草稿')}</button><button className="btn ghost" disabled={busy} onClick={()=>void open(true)}>{t('作为普通对话草稿打开')}</button></div>}>
    <p>{t('共享接收方')}: {value.target.title}{value.connection.targetAgentId&&<> · {String(remoteAgent?.name??t('接收 Agent 已不可用'))}</>}</p>
    <p>{t('请选择自己的工作流与 Agent，检查草稿后再开始。')}</p>
    <h3>{String(payload.goal??'')}</h3><p>{String(payload.summary??'')}</p>
    {error&&<p role="alert">{error}</p>}
    <Field label={t('本地工作流')}><select value={workflowKey} disabled={busy} onChange={e=>{setWorkflowKey(e.target.value);setAgentId('');}}><option value="">{t('选择已有 Workflow')}</option>{workflows.map(w=><option key={w.key} value={w.key}>{projects.find(p=>p.id===w.projectId)?.name} · {w.workflow.name}</option>)}</select></Field>
    <Field label={t('本地接收 Agent')}><select value={agentId} disabled={busy||!chosen} onChange={e=>setAgentId(e.target.value)}><option value="">{t('请选择')}</option>{chosen?.team.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
    {!workflows.length&&<p>{t('尚无本地工作流，可先作为对话草稿检查。')}</p>}
  </Modal></div>;
}
