import React from 'react';
import { nodeLabels, type Member, type Workflow } from '../../lib/collaboration';
import { teamFlowPreview } from '../../lib/team-flow-preview';
import { useT } from '../../lib/i18n';

const labels={start:'你的输入',agent:'完成这一步',discussion:'一起讨论',condition:'根据结果选择',parallel:'分头进行',join:'汇总结果',review:'独立检查',approval:'请你确认',handoff:'交给下一位',end:'由你验收'};
export default function TeamFlowPreview({workflow,members,versionId,compact=false,proposed=false}:{workflow:Workflow;members:Member[];versionId?:string;compact?:boolean;proposed?:boolean}){
 const tr=useT(),preview=teamFlowPreview(workflow,members,versionId);
 const [selected,setSelected]=React.useState<string>(),marker=React.useId().replace(/:/g,'');
 const chosen=preview.nodes.find(n=>n.id===selected);
 const title=(node:typeof preview.nodes[number])=>tr(node.title===nodeLabels[node.type]?labels[node.type]:node.title);
 const name=(id:string)=>{const node=preview.nodes.find(n=>n.id===id);return node?title(node):tr('步骤已不存在');};
 const edgeName=(edge:typeof preview.edges[number])=>edge.label||tr(edge.port==='pass'?'通过':edge.port==='fail'?'不通过':edge.port==='default'?'其他':'继续');
 const peers=Math.max(1,...preview.layers.map(l=>l.nodeIds.length)),width=peers*240+120,height=preview.layers.length*112+32;
 const position=(node:typeof preview.nodes[number])=>({x:60+node.orderInLayer*240+(peers-(preview.layers.find(l=>l.index===node.layer)?.nodeIds.length??1))*120,y:12+node.layer*112});
 const diagram=<>
  <div className="team-flow-map" role="group" aria-label={tr('协作步骤示意图')}>
   <svg viewBox={`0 0 ${width} ${height}`} style={{width:Math.max(320,width)}} role="img" aria-label={tr('连线表示下一步；虚线表示返回或返工。')}>
    <defs><marker id={marker} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z" fill="currentColor"/></marker></defs>
    {preview.edges.map((edge,i)=>{
     const from=preview.nodes.find(n=>n.id===edge.from),to=preview.nodes.find(n=>n.id===edge.to);if(!from||!to)return null;
     const a=position(from),b=position(to),back=edge.loop||b.y<=a.y;
     const offset=preview.edges.filter(e=>e.from===edge.from&&e.to===edge.to).findIndex(e=>e.id===edge.id)*20;
     const route=back?`M${a.x} ${a.y+32} H${25+(i%3)*9} V${b.y+32} H${b.x-4}`:`M${a.x+108+offset} ${a.y+64} C${a.x+108+offset} ${a.y+89},${b.x+108+offset} ${b.y-25},${b.x+108+offset} ${b.y-4}`;
     return <g key={edge.id}><path d={route} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={back?'5 4':undefined} markerEnd={`url(#${marker})`}/><title>{name(edge.from)} → {name(edge.to)}: {edgeName(edge)}</title>{!back&&offset===0&&<text x={a.x+124} y={a.y+87} className="team-flow-edge-label">{edgeName(edge).slice(0,12)}</text>}</g>;
    })}
    {preview.nodes.map(node=>{const pos=position(node),who=node.members.map(m=>m.name?.split(' · ').at(-1)||tr('成员已不存在')).join('、');return <g key={node.id}><title>{title(node)}{who?' · '+who:''}</title><rect x={pos.x} y={pos.y} width="216" height="64" rx="9" className={node.id===selected?'selected':''}/><text x={pos.x+12} y={pos.y+25}>{title(node).slice(0,17)}</text><text x={pos.x+12} y={pos.y+47} className="team-flow-role">{(who||tr(labels[node.type])).slice(0,22)}</text></g>;})}
   </svg>
  </div>
  <p className="team-note">{tr('下方可查看每一步的负责人、产出和去向。分支按连线执行，不按列表顺序执行。')}</p>
  <div className="team-flow-steps">{preview.nodes.map(node=><button type="button" className="btn sm" key={node.id} aria-pressed={node.id===selected} onClick={()=>setSelected(node.id===selected?undefined:node.id)}>{title(node)}</button>)}</div>
  {chosen&&<div className="team-flow-step-detail">
   <strong>{title(chosen)}</strong><p>{tr('负责人')}：{chosen.members.map(m=>m.missing?tr('成员已不存在'):m.name).join('、')||tr(['end','approval'].includes(chosen.type)?'你':'系统安排')}{chosen.hasMissingMember&&<span role="alert"> · {tr('需要配置成员')}</span>}</p>
   {chosen.instructions&&<p>{tr('要做什么')}：{chosen.instructions}</p>}{chosen.outputs&&<p>{tr('你会得到')}：{chosen.outputs}</p>}
   {chosen.type==='parallel'&&<p>{tr('满足预算与并发限制时，各分支可分头进行。')}</p>}
   {chosen.type==='join'&&<p>{tr(chosen.join==='all'?'所有前置步骤到齐后继续。':'有前置结果到达即可继续。')}</p>}
   {chosen.condition&&<p>{tr('判断依据')}：{name(chosen.condition.source)} / {chosen.condition.contains}</p>}
   <ul>{preview.edges.filter(e=>e.from===chosen.id).map(e=><li key={e.id}>{edgeName(e)} → {name(e.to)}{e.loop&&` · ${tr('返回，最多 {n} 次',{n:e.maxTraversals})}`}</li>)}</ul>
  </div>}
  {preview.edges.some(e=>e.loop)&&<p className="team-note">{preview.edges.filter(e=>e.loop).map(e=>`${name(e.from)} → ${name(e.to)} · ${edgeName(e)} · ${tr('返回，最多 {n} 次',{n:e.maxTraversals})}`).join('；')}</p>}
  {preview.edges.some(e=>e.missingFrom||e.missingTo)&&<p role="alert">{tr('部分连线指向已不存在的步骤，请先修复流程。')}</p>}
 </>;
 return <section className="team-flow-preview" aria-label={tr('接下来会发生什么')}>
  {!compact&&<h3>{tr('接下来会发生什么')}</h3>}
  <p className="team-flow-source">{workflow.name} · {proposed?tr('待准备方案'):preview.source==='version'?tr('运行版本 {n}',{n:preview.versionNumber!}):tr('草稿预览，保存版本后才能运行')}</p>
  {preview.hasDraftChanges&&<p className="team-note">{tr('草稿另有修改；下面显示的是本次将运行的已保存版本。')}</p>}
  {compact?<details><summary>{tr('查看步骤与分工')}</summary>{diagram}</details>:diagram}
 </section>;
}
