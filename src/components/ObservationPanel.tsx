import React from 'react';
import { useT } from '../lib/i18n';
import { Modal } from './ui';
import { clearObservations, observationSnapshot, isCurrentFeedback, type ObservationStore } from '../lib/observations';
import { acceptanceLabel, acceptanceVars, buildAnalysisFiles, filterTasks, outcomeLabel, redactSelectedText, statusLabel, summarizeTasks, type ObservationFilter } from '../lib/observation-export';
import { zipTextFiles } from '../lib/export-zip';
import { runRecord, runTitle } from '../lib/runs';
import { desktop } from '../lib/transport';

export default function ObservationPanel({onClose,onOpenTask}:{onClose:()=>void;onOpenTask:(conversationId:string,answerId:string)=>void}) {
  const t = useT();
  const [store,setStore]=React.useState<ObservationStore>();const [from,setFrom]=React.useState(''),[to,setTo]=React.useState('');
  const [model,setModel]=React.useState(''),[version,setVersion]=React.useState('');const [selected,setSelected]=React.useState('');
  const [hideModels,setHideModels]=React.useState(false),[include,setInclude]=React.useState<string[]>([]);
  const [preview,setPreview]=React.useState<Record<string,string>>(),[previewFile,setPreviewFile]=React.useState('report.md');
  const [error,setError]=React.useState(''),[saved,setSaved]=React.useState(''),[busy,setBusy]=React.useState(false),[clearConfirm,setClearConfirm]=React.useState(false);
  React.useEffect(()=>{let live=true;let timer:ReturnType<typeof setTimeout>|undefined;const read=()=>{void observationSnapshot().then(s=>{if(live)setStore(s);}).catch(()=>{if(live)setError(t('统计暂时无法读取'));});};const update=()=>{if(timer)clearTimeout(timer);timer=setTimeout(read,200);};read();window.addEventListener('anyai:observations',update);return()=>{live=false;if(timer)clearTimeout(timer);window.removeEventListener('anyai:observations',update);};},[]);
  const filter:ObservationFilter=React.useMemo(()=>({from:from?new Date(from+'T00:00:00').getTime():undefined,to:to?new Date(to+'T23:59:59.999').getTime():undefined,model:model||undefined,version:version||undefined}),[from,to,model,version]);
  const tasks=React.useMemo(()=>store?filterTasks(store.tasks,filter):[],[store,filter]);const summary=React.useMemo(()=>summarizeTasks(tasks),[tasks]);
  const selectedTask=tasks.find(t=>t.id===selected),record=selectedTask?runRecord(selectedTask.recordId):undefined;
  const snippets=React.useMemo(()=>record?[
    {id:'question',label:t('用户原始要求'),text:record.question.content},
    {id:'answer',label:t('已输出的答案'),text:record.state.content??''},
    ...(record.state.errorInfo?[{id:'error',label:t('错误说明'),text:record.state.errorInfo.detail}]:[]),
    ...(record.state.supplementalInputs??[]).map((s,i)=>({id:`input-${i}`,label:t('用户补充 {n}',{n:i+1}),text:s.content})),
    ...(record.state.requirements??[]).map((r,i)=>({id:`requirement-${i}`,label:t('验收说明 {n}',{n:i+1}),text:JSON.stringify({title:r.title,sourceQuote:r.sourceQuote,check:r.check,verification:r.verification,verificationHistory:r.verificationHistory,history:r.history})})),
    ...(record.state.steps??[]).filter(s=>s.output||s.error).map((s,i)=>({id:`tool-${i}`,label:t('工具结果 {n} · {name}',{n:i+1,name:s.name}),text:s.error??s.output??''})),
  ]:[],[record?.state.at,record?.id]);
  const build=()=>{
    if(!store)return;setError('');setSaved('');
    const chosen=selectedTask?[selectedTask]:tasks;
    const files=buildAnalysisFiles(store,chosen,filter,hideModels);
    if(selectedTask){
      files['diagnostic.json']=JSON.stringify({taskId:selectedTask.id,observationOnly:true,selectedSnippets:snippets.filter(s=>include.includes(s.id)).map(s=>({label:s.label,text:redactSelectedText(s.text.slice(0,20000)),truncated:s.text.length>20000})),
        note:t('只包含明确选择的片段；不包含凭据存储或思考内容。常见凭据已替换，但分享前仍需检查自行选择的正文。')},null,2);
      const manifest=JSON.parse(files['manifest.json']);manifest.files.push('diagnostic.json');manifest.selectedSnippets=include.length;manifest.redaction.body=include.length>0;files['manifest.json']=JSON.stringify(manifest,null,2);
    }
    setPreview(files);setPreviewFile(selectedTask&&include.length?'diagnostic.json':'report.md');
  };
  const save=async()=>{
    if(!preview)return;setBusy(true);setError('');
    try{
      const bytes=zipTextFiles(preview),name=`wickrunAI-${preview['diagnostic.json']?'task-diagnostic':'usage-analysis'}-${new Date().toISOString().slice(0,10)}.zip`;
      const bridge=desktop();
      if(bridge?.saveAnalysisExport){const file=await bridge.saveAnalysisExport(name,bytes);if(file)setSaved(file.path);}
      else{const url=URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type:'application/zip'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setSaved(t('已交给浏览器下载，可将导出包交给助手分析。'));}
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  return <Modal title={t('任务记录与分析')} onClose={onClose} wide><div className="modal-body observation-panel">
    <p>{t('先看任务实际结果，再定位问题。统计保留最近 90 天、最多 500 个任务，并受 4MB 索引容量限制；未反馈或未继续均不算失败。数据保存于本机。')}</p>
    {store?.lastError?<p className="observation-error" role="alert">{store.lastError}</p>:null}
    <div className="observation-filters">
      <label>{t('任务开始日期')}<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPreview(undefined);}}/></label>
      <label>{t('截至日期')}<input type="date" value={to} onChange={e=>{setTo(e.target.value);setPreview(undefined);}}/></label>
      <label>{t('曾使用的模型')}<select value={model} onChange={e=>{setModel(e.target.value);setPreview(undefined);}}><option value="">{t('全部模型')}</option>{[...new Set(store?.tasks.flatMap(t=>t.attempts.map(a=>a.model))??[])].map(m=><option key={m}>{m}</option>)}</select></label>
      <label>{t('曾使用的版本')}<select value={version} onChange={e=>{setVersion(e.target.value);setPreview(undefined);}}><option value="">{t('全部版本')}</option>{[...new Set(store?.tasks.flatMap(t=>t.attempts.map(a=>a.appVersion))??[])].map(v=><option key={v}>{v}</option>)}</select></label>
    </div>
    <div className="observation-summary" aria-live="polite">
      <strong>{t('当前范围：{n} 个任务',{n:summary.total})}</strong>
      <p>{Object.entries(summary.stateCounts).map(([k,n])=>`${t(statusLabel[k]??'未知')} ${n}`).join(' · ')||t('新任务运行后会逐步记录；没有记录不代表没有使用过。')}</p>
      <p>{t('已列验收条件全部通过 {accepted} 个；未建清单或含未检查条件 {unchecked} 个；含未通过条件 {failed} 个；含无法核验条件 {unverifiable} 个。后三类可重叠。',{accepted:summary.accepted,unchecked:summary.unchecked,failed:summary.failedAcceptance,unverifiable:summary.unverifiable})}</p>
      <p>{t('当前阶段的用户反馈 {feedback}/{total} 个任务：可用 {usable}、部分可用 {partial}、未解决 {unresolved}。未反馈结果未知。',{feedback:summary.feedback,total:summary.total,usable:summary.usable,partial:summary.partial,unresolved:summary.unresolved})}{summary.historicalFeedback?t('另有 {n} 个任务只保留较早阶段的反馈。',{n:summary.historicalFeedback}):''}</p>
      <details><summary>{t('运行改进依据')}</summary>
        <p>{t('结束状态不等于任务质量。当前范围中，{noList} 个已结束任务没有验收清单；{withHarness} 个任务有新版执行检查记录。',{noList:tasks.filter(x=>x.status==='completed'&&x.acceptance.total===0).length,withHarness:tasks.filter(x=>x.harness).length})}</p>
        <p>{t('提前结束检查触发续跑 {continuations} 次；临时子代理返回 {done}/{total} 个。旧记录缺少这些字段，不能当成零失败。',{continuations:tasks.reduce((n,x)=>n+(x.harness?.continuations||0),0),done:tasks.reduce((n,x)=>n+(x.harness?.subagentsCompleted||0),0),total:tasks.reduce((n,x)=>n+(x.harness?.subagents||0),0)})}</p>
        <p>{t('改进流程：选取未解决或遗漏的任务，导出脱敏排查包，提出具体修复，再用相同任务核对正确性、耗时和用量。通过回归检查后才更新执行规则；用户反馈与模型自查分别统计，不自动改写项目规范。')}</p>
      </details>
    </div>
    <div className="observation-task-list">{tasks.slice().reverse().map(item=><article key={item.id} className={selected===item.id?'selected':''}>
      <div><strong>{runTitle(item.recordId)??t('已保存的任务')}</strong><small> · {new Date(item.startedAt).toLocaleString()}</small><p>{t(statusLabel[item.status]??'未知')} · {t(acceptanceLabel(item),acceptanceVars(item))} · {item.feedback?(isCurrentFeedback(item)?'':t('较早阶段反馈：'))+t(outcomeLabel[item.feedback.outcome]):t('未反馈')}</p>
        <small>{t('续跑 {resumes} 次 · 暂停 {pauses} 次',{resumes:item.resumeCount,pauses:item.pauseCount})} · {item.attempts.map(a=>a.model).filter((x,i,a)=>a.indexOf(x)===i).join(' → ')}</small>
        {item.missing.length||item.droppedEvents||item.detailLimitReached?<p className="hint">{t('有观测缺口或明细裁剪，导出报告中会注明。')}</p>:null}</div>
      <div className="recovery-actions"><button className="btn sm" onClick={()=>onOpenTask(item.conversationId,item.answerId)}>{t('查看任务')}</button><button className="btn sm" aria-pressed={selected===item.id} onClick={()=>{setSelected(selected===item.id?'':item.id);setInclude([]);setPreview(undefined);}}>{t('选择排查')}</button></div>
    </article>)}</div>
    <div className="observation-export"><strong>{selectedTask?t('导出指定任务排查包'):t('导出使用分析包')}</strong>
      <p>{t('默认包含状态、检查方法、用量和事件关联；不包含对话正文、完整路径、接口地址、凭据或思考内容。')}</p>
      <label><input type="checkbox" checked={hideModels} onChange={e=>{setHideModels(e.target.checked);setPreview(undefined);}}/>{t('隐藏模型名称')}</label>
      {selectedTask?<><button className="btn sm ghost" onClick={()=>{setSelected('');setInclude([]);setPreview(undefined);}}>{t('改为导出当前范围全部任务')}</button>
        <details><summary>{t('选择需要分享的具体片段（可选）')}</summary><p>{t('仅在需要核对内容时选择。常见凭据会替换，请在导出预览中检查剩余私人信息；每个片段最多 20,000 字符。')}</p>
          {snippets.map(s=><label className="observation-snippet" key={s.id}><input type="checkbox" checked={include.includes(s.id)} onChange={e=>{setInclude(old=>e.target.checked?[...old,s.id]:old.filter(x=>x!==s.id));setPreview(undefined);}}/>{s.label}</label>)}
        </details></>:null}
      <div className="recovery-actions"><button className="btn sm primary" disabled={!tasks.length||busy} onClick={build}>{t('生成导出预览')}</button></div>
      {preview?<div className="export-preview"><label>{t('预览文件')}<select value={previewFile} onChange={e=>setPreviewFile(e.target.value)}>{Object.keys(preview).map(name=><option key={name}>{name}</option>)}</select></label>
        <pre>{preview[previewFile]?.slice(0,100000)}</pre>{preview[previewFile]?.length>100000?<p>{t('预览显示前 100,000 字符，导出包含完整文件。')}</p>:null}
        <button className="btn sm primary" disabled={busy} onClick={()=>void save()}>{t('保存导出包')}</button><small>{t('保存当前预览快照；不会自动上传。')}</small>
      </div>:null}
      {saved?<p role="status" className="delivery-path">{saved}</p>:null}{error?<p role="alert" className="observation-error">{error}</p>:null}
    </div>
    <details className="observation-retention"><summary>{t('记录范围与清理')}</summary><p>{t('当前索引自 {since} 开始；此前任务不自动推断成功。累计裁剪 {dropped} 个任务、统计读写问题 {failures} 次。每任务最多保留 200 条事件；超过追踪上限后仅更新汇总并标明缺口。删除对话会删除关联统计。',{since:store?new Date(store.createdAt).toLocaleString():'—',dropped:store?.droppedTasks??0,failures:store?.writeFailures??0})}</p>
      {clearConfirm?<><p>{t('清空会删除统计和反馈，并重置导出标识；原任务和文件仍保留。旧任务不会重新进入统计。')}</p><button className="btn sm" onClick={()=>{void clearObservations().then(()=>{setPreview(undefined);setSelected('');setInclude([]);setClearConfirm(false);});}}>{t('确认清空统计')}</button><button className="btn sm ghost" onClick={()=>setClearConfirm(false)}>{t('取消')}</button></>:<button className="btn sm" onClick={()=>setClearConfirm(true)}>{t('清空统计与反馈')}</button>}
    </details>
  </div></Modal>;
}
