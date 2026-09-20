import type { FlowNode, NodeAttempt, TeamRun, TeamTextArtifact } from './collaboration';
import { teamInputs } from './team-contract';

export const TEXT_REVIEW_LIMIT=20000;

/** Sources are immutable completed attempts in the existing durable run. */
export async function textReviewInputs(run:TeamRun,node:FlowNode):Promise<TeamTextArtifact[]> {
 const inputs=teamInputs(run,node).filter(a=>['agent','handoff'].includes(run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type??''));
 if(inputs.some(a=>a.artifacts?.some(item=>item.files.length)))throw Error('文本复核不能替代文件变更检查，请选择文件复核');
 if(!inputs.length||inputs.some(a=>!a.output.trim()))throw Error('文本复核缺少已完成的上游文本产物');
 if(inputs.reduce((sum,a)=>sum+a.output.length,0)>TEXT_REVIEW_LIMIT)throw Error('文本产物超过 20000 字符，请拆分任务或交付文件再复核；不会截断后宣告通过');
 return Promise.all(inputs.map(async a=>({id:'text:'+a.id,attemptId:a.id,nodeId:a.nodeId,version:a.visit,text:a.output,
  digest:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(a.output)))].map(v=>v.toString(16).padStart(2,'0')).join('')})));
}

export function verifyTextReview(text:string,attempt:NodeAttempt,current:TeamTextArtifact[]):NonNullable<NodeAttempt['textReview']> {
 const saved=attempt.inputTexts??[];
 if(!saved.length||JSON.stringify(saved)!==JSON.stringify(current))throw Error('文本产物已变化或不是本次依赖版本，不能沿用复核结论');
 let value:Record<string,unknown>;
 try{value=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));}catch{throw Error('文本复核需要 JSON：verdict、artifactIds、textEvidence、changes');}
 if(!value||!['pass','fail','unverifiable'].includes(String(value.verdict)))throw Error('文本复核结论必须是 pass、fail 或 unverifiable');
 const ids=value.artifactIds;
 if(!Array.isArray(ids)||ids.length!==saved.length||new Set(ids).size!==saved.length||saved.some(a=>!ids.includes(a.id)))throw Error('文本复核必须引用本次全部产物编号');
 if(!Array.isArray(value.textEvidence)||value.textEvidence.length>30)throw Error('文本复核需提供原文引用列表');
 const evidence=value.textEvidence as {artifactId:string;quote:string}[];
 for(const item of evidence){
  const artifact=saved.find(a=>a.id===item?.artifactId);
  if(!artifact||typeof item.quote!=='string'||item.quote.trim().length<Math.min(8,artifact.text.trim().length)||item.quote.length>2000||!artifact.text.includes(item.quote))throw Error('文本复核引用必须是本次对应产物的实际原文，不能虚构或沿用旧版本');
 }
 if(value.verdict!=='unverifiable'&&!evidence.length)throw Error('没有原文引用，不能给出文本通过或失败结论');
 if(value.verdict==='pass'&&saved.some(a=>!evidence.some(e=>e.artifactId===a.id)))throw Error('文本通过前必须引用全部本次产物');
 if(typeof value.changes!=='string'||!value.changes.trim())throw Error('文本复核需要说明覆盖范围、缺陷与未核实事项');
 if(value.verdict==='pass'&&attempt.state?.requirements?.some(r=>r.verification?.status==='failed'))throw Error('已有交付检查失败，不能宣告文本复核通过');
 return {verdict:value.verdict as 'pass'|'fail'|'unverifiable',artifactIds:value.artifactIds as string[],textEvidence:evidence,changes:value.changes,method:'model'};
}

export const TEXT_REVIEW_INSTRUCTIONS='本步骤只复核已提供的文本快照，不调用文件或外部工具。以 JSON 返回 {"verdict":"pass 或 fail 或 unverifiable","artifactIds":["本次全部 text: 编号"],"textEvidence":[{"artifactId":"对应编号","quote":"该文本中逐字一致的一段原文"}],"changes":"逐项覆盖、缺陷或无法核实的事项"}。通过时引用全部产物，每段至少 8 字符（短文本可引用全文），不得虚构原文；版本和引用可核对不等于事实为真。文件、外部事实或执行效果缺少证据时返回 unverifiable。';
