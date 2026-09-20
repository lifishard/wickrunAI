import React from 'react';
import type { TeamFileScope } from '../../lib/collaboration';
import { desktop } from '../../lib/transport';
import { useT } from '../../lib/i18n';

export default function TeamFileSetup({scope,roots,busy,onChange}:{scope:TeamFileScope;roots:string[];busy:boolean;onChange:(scope:TeamFileScope)=>void}){
 const tr=useT(),id=React.useId();
 const [picking,setPicking]=React.useState(false),[error,setError]=React.useState('');
 const available=[...new Set([...roots,...(scope.root?[scope.root]:[])])];
 const pick=async()=>{
  setPicking(true);setError('');
  try{const host=desktop();if(!host)throw Error(tr('选择本地目录需要桌面版'));const root=await host.pickFolder();if(root)onChange({...scope,root});}
  catch(e){setError(String(e instanceof Error?e.message:e));}finally{setPicking(false);}
 };
 return <section className="team-file-setup" aria-label={tr('文件任务范围')}>
  <div className="team-preset-controls"><label className="team-field"><span id={id+'-root'}>{tr('工作目录')}</span><select aria-labelledby={id+'-root'} value={scope.root} disabled={busy||picking} onChange={e=>onChange({...scope,root:e.target.value})}>
   <option value="">{tr('选择这次任务使用的目录')}</option>{available.map(root=><option key={root} value={root}>{root}</option>)}
  </select></label><button type="button" className="btn" disabled={busy||picking} onClick={()=>void pick()}>{tr(picking?'正在选择…':'选择其他目录')}</button></div>
  {scope.root&&<p className="team-file-path">{scope.root}</p>}
  {error&&<p role="alert">{error}</p>}
  <fieldset className="team-work-styles" disabled={busy}><legend>{tr('助手可以做什么？')}</legend>
   <label><input type="radio" name={id+'-ability'} checked={scope.capability==='read'} onChange={()=>onChange({...scope,capability:'read'})}/><span><strong>{tr('只读材料')}</strong><small>{tr('阅读、搜索文件并给出结论，不修改文件。')}</small></span></label>
   <label><input type="radio" name={id+'-ability'} checked={scope.capability!=='read'} onChange={()=>onChange({...scope,capability:'edit'})}/><span><strong>{tr('读取并修改')}</strong><small>{tr('在副本中新增或修改文件，检查差异后由你合并。')}</small></span></label>
  </fieldset>
  {scope.capability!=='read'&&<details className="team-file-command"><summary>{tr(scope.capability==='command'?'命令已启用：每次需确认':'还需要运行命令？')}</summary>
   <label><input type="checkbox" checked={scope.capability==='command'} disabled={busy} onChange={e=>onChange({...scope,capability:e.target.checked?'command':'edit'})}/>{tr('允许运行命令')}</label>
   <p className="team-note">{tr('适合安装依赖、构建或运行测试。每次命令都需批准；副本只是工作目录，不能限制命令访问整个系统。')}</p>
  </details>}
  <p className="team-note">{tr('读取也使用独立副本。修改和命令逐项确认，复核助手只能读取。副本不含 .git、node_modules、dist、build、.next，目录上限 128 MB。')}</p>
 </section>;
}

export function TeamFileScopeSummary({scope}:{scope:TeamFileScope}){
 const tr=useT();
 return <div className="team-file-scope-summary"><p>{tr('本次工作目录')}：{scope.root}</p><p>{tr('允许能力')}：{tr(scope.capability==='read'?'只读材料':scope.capability==='edit'?'读取并修改':'读取、修改与运行命令')}</p>
  <p className="team-note">{tr(scope.capability==='read'?'只读取本次目录的独立副本并交付结论，不修改原文件，也不会产生待合并修改。':'在独立副本中工作，修改和命令逐项确认。交付后前往「文件与产物」检查差异并合并，原目录才会更新。')}</p>
  {scope.capability==='command'&&<p className="team-note">{tr('命令的工作目录不是系统沙箱；批准前请检查命令的实际影响范围。')}</p>}
 </div>;
}
