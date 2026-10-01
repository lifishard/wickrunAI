import React from 'react';
import WorkflowCanvas, {type CanvasSelection} from './WorkflowCanvas';
import {nodeLabels, type Graph, type NodeKind} from '../../lib/collaboration';
import {useT} from '../../lib/i18n';
import './SharedWorkflowEditor.css';

type Data=Record<string,unknown>;
const rows=(value:unknown):Data[]=>Array.isArray(value)?value as Data[]:[];
const words=(value:unknown)=>typeof value==='string'?value:'';
const blankGraph=():Graph=>({nodes:[],edges:[],maxSteps:100,maxMinutes:60,maxTokens:100000});

export default function SharedWorkflowEditor({payload,onChange,readOnly}:{payload:Data;onChange:(payload:Data)=>void;readOnly:boolean}){
  const t=useT();
  const [selection,setSelection]=React.useState<CanvasSelection>(null);
  const [viewport,setViewport]=React.useState({x:20,y:20,zoom:.8});
  const [newKind,setNewKind]=React.useState<NodeKind>('agent');
  const [from,setFrom]=React.useState(''),[to,setTo]=React.useState('');
  const graph={...blankGraph(),...(payload.definition as Partial<Graph>??{})};
  const agents=rows(payload.agents),schedules=rows(payload.schedules),runs=rows(payload.runs);
  const node=selection?.type==='node'?graph.nodes.find(n=>n.id===selection.id):undefined;
  const edge=selection?.type==='edge'?graph.edges.find(e=>e.id===selection.id):undefined;
  const write=(next:Data)=>{if(!readOnly)onChange(next);};
  const changeGraph=(next:Graph)=>write({...payload,definition:next});
  const addNode=(x=50+graph.nodes.length*40,y=80)=>{
    const id=crypto.randomUUID();
    changeGraph({...graph,nodes:[...graph.nodes,{id,type:newKind,title:nodeLabels[newKind],x,y,instructions:'',inputRefs:[],outputRequirement:'',maxVisits:3,join:'all',
      ports:['condition','review','approval'].includes(newKind)?[{id:'pass',label:'通过'},{id:'fail',label:'不通过'},{id:'default',label:'其他'}]:[{id:'next',label:'继续'}]}]});
    setSelection({type:'node',id});
  };
  const changeNode=(patch:Data)=>{if(node)changeGraph({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,...patch}:n)});};
  const changeEdge=(patch:Data)=>{if(edge)changeGraph({...graph,edges:graph.edges.map(e=>e.id===edge.id?{...e,...patch}:e)});};
  const connect=(a:string,b:string,port='next')=>{
    if(!a||!b||graph.edges.some(e=>e.from===a&&e.to===b&&e.port===port))return;
    const id=crypto.randomUUID();
    changeGraph({...graph,edges:[...graph.edges,{id,from:a,to:b,port,label:t('继续'),maxTraversals:1,loop:a===b}]});setSelection({type:'edge',id});
  };
  const remove=()=>{
    if(node)changeGraph({...graph,nodes:graph.nodes.filter(n=>n.id!==node.id).map(n=>({...n,inputRefs:n.inputRefs.filter(id=>id!==node.id),condition:n.condition?.source===node.id?undefined:n.condition})),edges:graph.edges.filter(e=>e.from!==node.id&&e.to!==node.id)});
    else if(edge)changeGraph({...graph,edges:graph.edges.filter(e=>e.id!==edge.id)});
    setSelection(null);
  };
  const duplicate=()=>{
    if(!node)return;const id=crypto.randomUUID();changeGraph({...graph,nodes:[...graph.nodes,{...structuredClone(node),id,x:node.x+40,y:node.y+50}]});setSelection({type:'node',id});
  };
  return <div className="shared-workflow-editor">
    <label className="share-field"><span>{t('工作流说明')}</span><textarea data-share-field="description" rows={3} readOnly={readOnly} value={words(payload.description)} onChange={e=>write({...payload,description:e.target.value})}/></label>
    <section className="shared-workflow-inspector"><h4>{t('执行上限')}</h4>{(['maxSteps','maxMinutes','maxTokens'] as const).map(key=><label key={key}>{t({maxSteps:'总步骤上限',maxMinutes:'总时间上限（分钟）',maxTokens:'总用量上限（Token）'}[key])}<input type="number" min={1} disabled={readOnly} value={graph[key]} onChange={e=>changeGraph({...graph,[key]:Math.max(1,Number(e.target.value))})}/></label>)}</section>
    <div className="share-actions"><label>{t('新增步骤')} <select disabled={readOnly} value={newKind} onChange={e=>setNewKind(e.target.value as NodeKind)}>{Object.entries(nodeLabels).map(([kind,label])=><option key={kind} value={kind}>{t(label)}</option>)}</select></label>{!readOnly&&<button className="btn sm" onClick={()=>addNode()}>{t('添加步骤')}</button>}</div>
    <div className="shared-workflow-canvas"><WorkflowCanvas nodes={graph.nodes.map(n=>({...n,subtitle:n.instructions?.slice(0,70)}))} edges={graph.edges} viewport={viewport} selection={selection}
      readOnly={readOnly} onSelect={setSelection} onViewportChange={setViewport} onAddNode={addNode}
      onMoveNode={(id,x,y)=>changeGraph({...graph,nodes:graph.nodes.map(n=>n.id===id?{...n,x,y}:n)})} onConnect={connect}
      onDeleteSelection={remove} onDuplicateSelection={duplicate} onUndo={()=>{}} onRedo={()=>{}} canUndo={false} canRedo={false}/></div>
    {node&&<section className="shared-workflow-inspector"><h4>{t('步骤设置')}</h4>
      <label>{t('步骤名称')}<input readOnly={readOnly} value={node.title} onChange={e=>changeNode({title:e.target.value})}/></label>
      <label>{t('步骤说明')}<textarea data-share-field="node" data-share-entry={node.id} readOnly={readOnly} rows={4} value={node.instructions} onChange={e=>changeNode({instructions:e.target.value})}/></label>
      <label>{t('输出 / 验收要求')}<textarea readOnly={readOnly} rows={3} value={node.outputRequirement} onChange={e=>changeNode({outputRequirement:e.target.value})}/></label>
      {['agent','review','handoff','approval'].includes(node.type)&&<label>{t('负责的 Agent')}<select disabled={readOnly} value={node.memberId??''} onChange={e=>changeNode({memberId:e.target.value||undefined})}><option value="">{t('请选择')}</option>{agents.map(a=><option key={words(a.id)} value={words(a.id)}>{words(a.name)}</option>)}</select></label>}
      {node.type==='review'&&<label>{t('复核范围')}<select disabled={readOnly} value={node.reviewMode??'files'} onChange={e=>changeNode({reviewMode:e.target.value})}><option value="files">{t('读取文件复核')}</option><option value="text">{t('仅复核文本')}</option></select></label>}
      {node.type==='join'&&<label>{t('汇合规则')}<select disabled={readOnly} value={node.join??'all'} onChange={e=>changeNode({join:e.target.value})}><option value="all">{t('等待全部分支')}</option><option value="any">{t('任一分支完成')}</option></select></label>}
      {node.type==='discussion'&&<fieldset disabled={readOnly}><legend>{t('参与讨论的 Agent')}</legend>{agents.map(a=><label className="share-visibility" key={words(a.id)}><input type="checkbox" checked={(node.participants??[]).includes(words(a.id))} onChange={e=>changeNode({participants:e.target.checked?[...(node.participants??[]),words(a.id)]:(node.participants??[]).filter(id=>id!==a.id)})}/>{words(a.name)}</label>)}</fieldset>}
      <label>{t('读取哪些步骤的结果')}<select multiple disabled={readOnly} value={node.inputRefs??[]} onChange={e=>changeNode({inputRefs:Array.from(e.target.selectedOptions,o=>o.value)})}>{graph.nodes.filter(n=>n.id!==node.id).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label>
      {node.type==='condition'&&<><label>{t('判断依据')}<select disabled={readOnly} value={node.condition?.source??''} onChange={e=>changeNode({condition:{source:e.target.value,contains:node.condition?.contains??''}})}><option value="">{t('请选择')}</option>{graph.nodes.filter(n=>n.id!==node.id).map(n=><option key={n.id} value={n.id}>{n.title}</option>)}</select></label><label>{t('包含的文字')}<input readOnly={readOnly} value={node.condition?.contains??''} onChange={e=>changeNode({condition:{source:node.condition?.source??'',contains:e.target.value}})}/></label></>}
      <label>{t('最多执行几次')}<input type="number" min={1} max={100} disabled={readOnly} value={node.maxVisits} onChange={e=>changeNode({maxVisits:Math.max(1,Number(e.target.value))})}/></label>
      {!readOnly&&<div className="share-actions"><button className="btn sm" onClick={duplicate}>{t('复制步骤')}</button><button className="btn sm ghost" onClick={remove}>{t('删除步骤')}</button></div>}
    </section>}
    {edge&&<section className="shared-workflow-inspector"><h4>{t('连线设置')}</h4><label>{t('连线名称')}<input readOnly={readOnly} value={edge.label} onChange={e=>changeEdge({label:e.target.value})}/></label><label>{t('出口')}<select disabled={readOnly} value={edge.port??'next'} onChange={e=>changeEdge({port:e.target.value})}>{(graph.nodes.find(n=>n.id===edge.from)?.ports??[{id:'next',label:'继续'}]).map(p=><option value={p.id} key={p.id}>{t(p.label)}</option>)}</select></label><label>{t('最多走几次')}<input type="number" min={1} disabled={readOnly} value={edge.maxTraversals} onChange={e=>changeEdge({maxTraversals:Math.max(1,Number(e.target.value))})}/></label>{!readOnly&&<button className="btn sm ghost" onClick={remove}>{t('删除连线')}</button>}</section>}
    {!readOnly&&graph.nodes.length>1&&<div className="shared-workflow-connect"><select aria-label={t('连线起点')} value={from} onChange={e=>setFrom(e.target.value)}><option value="">{t('连线起点')}</option>{graph.nodes.map(n=><option value={n.id} key={n.id}>{n.title}</option>)}</select><span>→</span><select aria-label={t('连线终点')} value={to} onChange={e=>setTo(e.target.value)}><option value="">{t('连线终点')}</option>{graph.nodes.map(n=><option value={n.id} key={n.id}>{n.title}</option>)}</select><button className="btn sm" disabled={!from||!to} onClick={()=>connect(from,to)}>{t('添加连线')}</button></div>}
    <section className="share-entries"><h4>{t('Agent 分工')}</h4>{agents.map((a,i)=><div className="share-entry" key={words(a.id)}><label>{t('名称')}<input readOnly={readOnly} value={words(a.name)} onChange={e=>write({...payload,agents:agents.map((v,n)=>n===i?{...v,name:e.target.value}:v)})}/></label><label>{t('负责什么')}<textarea readOnly={readOnly} rows={2} value={words(a.description)} onChange={e=>write({...payload,agents:agents.map((v,n)=>n===i?{...v,description:e.target.value}:v)})}/></label>{!readOnly&&<button className="btn sm ghost" onClick={()=>{const id=words(a.id);write({...payload,agents:agents.filter((_,n)=>n!==i),definition:{...graph,nodes:graph.nodes.map(n=>({...n,memberId:n.memberId===id?undefined:n.memberId,participants:(n.participants??[]).filter(x=>x!==id)}))}});}}>{t('移除')}</button>}</div>)}{!readOnly&&<button className="btn sm" onClick={()=>write({...payload,agents:[...agents,{id:crypto.randomUUID(),name:t('新 Agent'),description:''}]})}>{t('添加 Agent')}</button>}</section>
    <section className="share-entries"><h4>{t('Routine 时段')}</h4><p className="share-muted">{t('共同设置目标与时段；执行电脑需要另行启用 routine。')}</p>{schedules.map((s,i)=><div className="share-entry" key={words(s.id)}>{(['name','goal','acceptance','timezone'] as const).map(k=><label key={k}>{t({name:'名称',goal:'目标',acceptance:'验收标准',timezone:'时区'}[k])}<input readOnly={readOnly} value={words(s[k])} onChange={e=>write({...payload,schedules:schedules.map((v,n)=>n===i?{...v,[k]:e.target.value}:v)})}/></label>)}<div className="share-two">{(['hour','minute'] as const).map(k=><label key={k}>{t(k==='hour'?'小时':'分钟')}<input type="number" min={0} max={k==='hour'?23:59} disabled={readOnly} value={Number(s[k]??0)} onChange={e=>write({...payload,schedules:schedules.map((v,n)=>n===i?{...v,[k]:Number(e.target.value)}:v)})}/></label>)}</div>{!readOnly&&<button className="btn sm ghost" onClick={()=>write({...payload,schedules:schedules.filter((_,n)=>n!==i)})}>{t('移除')}</button>}</div>)}{!readOnly&&<button className="btn sm" onClick={()=>write({...payload,schedules:[...schedules,{id:crypto.randomUUID(),name:t('新 Routine'),goal:'',acceptance:'',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC',hour:9,minute:0}]})}>{t('添加 Routine')}</button>}</section>
    <section className="share-entries"><h4>{t('执行与交互记录')}</h4>{!runs.length&&<p className="share-muted">{t('还没有执行记录。')}</p>}{[...runs].reverse().map(run=><details className="shared-workflow-run" key={words(run.id)}><summary>{words(run.goal)} · {words(run.status)} · {new Date(Number(run.updatedAt??run.createdAt)).toLocaleString()}</summary>{Boolean(run.workflowVersionId)&&<p>{t('执行的流程版本')}：{words(run.workflowVersionId)}</p>}<p>{words(run.acceptance)}</p>{run.definition&&typeof run.definition==='object'?<details><summary>{t('本次执行的流程快照')}</summary>{rows((run.definition as Data).nodes).map(n=><p key={words(n.id)}><strong>{words(n.title)}</strong><br/>{words(n.instructions)}<br/>{words(n.outputRequirement)}</p>)}</details>:null}{rows(run.events).map(e=><p key={words(e.id)}><time>{new Date(Number(e.at)).toLocaleString()}</time> · {words(e.text)}</p>)}{rows(run.outputs).map(o=><pre key={words(o.id)}>{words(o.text)}</pre>)}</details>)}</section>
  </div>;
}
