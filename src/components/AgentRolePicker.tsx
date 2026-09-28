import React from 'react';
import type { GenerationConfig } from '../types';
import { AGENT_ROLES } from '../lib/office';
import { teamRuntime } from '../lib/team-runtime';
import AgentAvatar from './AgentAvatar';
export default function AgentRolePicker({value,projectId,onChange,onBrain}:{value:GenerationConfig['agentRole'];projectId?:string|null;onChange:(role:GenerationConfig['agentRole'])=>void;onBrain:(profileId:string,model:string)=>void}){
  const [open,setOpen]=React.useState(false);const members=projectId?teamRuntime.project(projectId).members:[];
  return <details className="agent-role-picker" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{value?`职责 · ${value.name}`:'调用角色'}</summary><div className="agent-role-menu"><p>选择本轮负责的角色。模板沿用当前模型；办公室成员使用自己配置的模型。多成员独立执行请用协作空间。</p>{value&&<button className="btn sm" onClick={()=>{onChange(undefined);setOpen(false);}}>移除角色职责</button>}
    {members.filter(m=>m.enabled&&!m.connectionId.startsWith('client:')).map(m=><button className="office-role-option" key={m.id} onClick={()=>{onChange({id:m.id,name:m.name,instructions:m.instructions});onBrain(m.connectionId,m.model);setOpen(false);}}><AgentAvatar name={m.name} seed={m.roleTemplateId??m.id}/><span>{m.name}<small>办公室 · {m.model||'待配置模型'}</small></span></button>)}
    {AGENT_ROLES.map(r=><button className="office-role-option" key={r.id} onClick={()=>{onChange({id:r.id,name:r.name,instructions:r.instructions});setOpen(false);}}><AgentAvatar name={r.name} color={r.color} seed={r.id}/><span>{r.name}<small>{r.summary}</small></span></button>)}
  </div></details>;
}
