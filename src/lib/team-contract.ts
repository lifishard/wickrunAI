import type { FlowNode, NodeAttempt, TeamRun } from './collaboration';

/** Derived from the durable run; this contract never becomes a second mutable task store. */
export function teamInputs(run:TeamRun,node:FlowNode):NodeAttempt[] {
 const ids=new Set(node.inputRefs);
 if(!ids.size){
  const queue=[node.id],seen=new Set(queue);
  while(queue.length){const id=queue.shift()!;for(const edge of run.version.graph.edges.filter(e=>e.to===id)){
   if(edge.from!==node.id)ids.add(edge.from);
   if(!seen.has(edge.from)){seen.add(edge.from);queue.push(edge.from);}
  }}
 }
 ids.delete(node.id);
 const latest=new Map<string,NodeAttempt>();
 for(const attempt of run.attempts)if(ids.has(attempt.nodeId)&&attempt.status==='completed')latest.set(attempt.nodeId,attempt);
 return [...latest.values()];
}

export function teamTaskContract(run:TeamRun,node:FlowNode,memberId:string,inputs:NodeAttempt[],roots:string[]=[]) {
 return {version:1,taskId:run.taskId,runId:run.id,workflowVersion:run.version.id,nodeId:node.id,memberId,
  goal:run.goal,acceptance:run.acceptance,scope:node.instructions,deliverable:node.outputRequirement,
  inputs:inputs.map(a=>({attemptId:a.id,nodeId:a.nodeId,visit:a.visit,outcome:a.outcome,artifacts:a.artifacts??[]})),
  permission:{roots,readOnly:node.type==='review'},
  limits:{memberTokens:run.members.find(m=>m.id===memberId)?.maxTokens,totalTokens:run.version.graph.maxTokens,maxVisits:node.maxVisits},
  stopConditions:['用户暂停或撤销','未知外部结果','预算或执行次数用尽'],
  completion:'返回产物、实际检查证据与未解决事项；执行结束不代表用户验收'};
}

/** A model verdict is still a model review, but must cite actual reads of the reviewed version. */
export function verifyTeamReview(text:string,attempt:NodeAttempt,receiverRoots:string[]=[]):{verdict:'pass'|'fail'|'unverifiable';evidence:string[];changes:string;method:'model';artifactIds:string[]} {
 let value:Record<string,unknown>;
 try{value=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));}catch{throw Error('质检需要完整 JSON：verdict、evidence、changes、artifactIds');}
 if(!value||!['pass','fail','unverifiable'].includes(String(value.verdict)))throw Error('质检结论必须是 pass、fail 或 unverifiable');
 const artifacts=attempt.inputArtifacts??[];
 const artifactIds=value.artifactIds;
 if(!Array.isArray(artifactIds)||artifactIds.length!==artifacts.length||new Set(artifactIds).size!==artifacts.length||artifacts.some(a=>!artifactIds.includes(a.id)))throw Error('质检必须引用本次接收的全部产物版本编号，不能沿用旧版本');
 const evidence=value.evidence;
 const steps=[...(attempt.state?.contextArchiveSteps??[]),...(attempt.state?.steps??[]),...attempt.steps];
 const reads=steps.filter(s=>s.status==='ok'&&['read_file','read_document','inspect_deliverable','read_tool_result'].includes(s.name));
 if(!Array.isArray(evidence)||evidence.length>30||evidence.some(id=>typeof id!=='string'||!reads.some(s=>s.callId===id||s.id===id)))throw Error('质检证据必须引用本次实际成功的读取/检查调用编号');
 if(value.verdict!=='unverifiable'&&!evidence.length)throw Error('没有实际读取或检查证据，不能宣告质检通过或失败');
 if(value.verdict==='pass'){
  const cited=reads.filter(s=>(evidence as string[]).includes(s.callId)||(evidence as string[]).includes(s.id));
  // Match the complete path in the receiving workspace, never a filename suffix.
  // Windows paths are case-insensitive; POSIX paths must retain their case.
  const canonical=(path:string)=>{
   const raw=path.replace(/\\/g,'/');
   const slashes=(raw.startsWith('//')?'/':'')+raw.replace(/\/{2,}/g,'/');
   if(!/^(?:[a-z]:\/|\/)/i.test(slashes))return undefined;
   const parts:string[]=[];
   for(const part of slashes.split('/')){if(part==='.')continue;if(part==='..'){if(parts.length<=1)return undefined;parts.pop();}else parts.push(part);}
   const resolved=parts.join('/').replace(/\/$/,'');
   return /^(?:[a-z]:|\/\/)/i.test(resolved)?resolved.toLowerCase():resolved;
  };
  const paths=cited.filter(s=>s.name!=='read_tool_result').flatMap(s=>{const args=s.args as {path?:unknown};return typeof args?.path==='string'?[canonical(args.path)]:[];});
  const missing=artifacts.flatMap(a=>a.files).filter(f=>f.afterHash!==null&&!receiverRoots.some(root=>{const expected=canonical(root+'/'+f.path);return expected!==undefined&&paths.includes(expected);}));
  if(missing.length)throw Error('质检通过前必须实际读取或检查全部改动文件：'+missing.map(f=>f.path).join('、'));
  if(!artifacts.length)throw Error('没有可核验的产物版本，不能宣告文件质检通过；请返回 unverifiable');
 }
 if(typeof value.changes!=='string'||!value.changes.trim())throw Error('质检需要逐项说明检查覆盖、缺陷或未能核实的条件');
 if(value.verdict==='pass'&&attempt.state?.requirements?.some(r=>r.verification?.status==='failed'))throw Error('已有交付检查失败，不能宣告质检通过');
 return {verdict:value.verdict as 'pass'|'fail'|'unverifiable',evidence:evidence as string[],changes:value.changes,method:'model',artifactIds:value.artifactIds as string[]};
}
