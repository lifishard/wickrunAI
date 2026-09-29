import type { FlowNode, NodeAttempt, TeamRun, TeamTextArtifact } from './collaboration';
import type { ToolResult } from '../types';
import { teamInputs } from './team-contract';

/** 不超过这个长度直接放进提示词；更长的分段读取，读完才能判通过，仍然不截断。 */
export const TEXT_REVIEW_LIMIT=20000;
export const TEXT_REVIEW_PART=10000;
export const textReviewPaged=(texts:{text:string}[])=>texts.reduce((n,a)=>n+a.text.length,0)>TEXT_REVIEW_LIMIT;
export const reviewPartCount=(text:string)=>Math.max(1,Math.ceil(text.length/TEXT_REVIEW_PART));

/** 原样返回一段前置记录或待复核文本（不做 JSON 转义），引用才能逐字核对。 */
export function readSourceText(texts:{id:string;text:string}[],args:Record<string,unknown>):ToolResult {
 const artifact=texts.find(a=>a.id===(args.id??args.artifactId));
 if(!artifact)return {ok:false,content:'',error:'找不到这个产物编号；可用编号：'+texts.map(a=>a.id).join('、')};
 const parts=reviewPartCount(artifact.text),part=Number(args.part);
 if(!Number.isInteger(part)||part<1||part>parts)return {ok:false,content:'',error:`part 必须是 1 到 ${parts} 的整数`};
 const start=(part-1)*TEXT_REVIEW_PART,end=Math.min(artifact.text.length,start+TEXT_REVIEW_PART);
 return {ok:true,content:`【${artifact.id} 第 ${part}/${parts} 段，字符 ${start+1}–${end}，共 ${artifact.text.length}】\n${artifact.text.slice(start,end)}`};
}
/** 2.20.20 的旧名字，已声明过的调用仍能执行 */
export const readReviewText=readSourceText;
export const SOURCE_READ_TOOLS=['read_source_text','read_review_text'];
export const SOURCE_PAGED_INSTRUCTIONS='前置记录较长，没有放进本条消息。「前置记录目录」列出了上游产出和本轮已有发言的编号、字数和段数；用 read_source_text 按编号和段号（从 1 开始）读取需要的原文。给出结论前，读完与本步骤相关的全部内容；不要凭目录猜测内容。';

/** Sources are immutable completed attempts in the existing durable run. */
export async function textReviewInputs(run:TeamRun,node:FlowNode):Promise<TeamTextArtifact[]> {
 const inputs=teamInputs(run,node).filter(a=>['agent','handoff','discussion'].includes(run.version.graph.nodes.find(n=>n.id===a.nodeId)?.type??''));
 if(inputs.some(a=>a.artifacts?.some(item=>item.files.length)))throw Error('文本复核不能替代文件变更检查，请选择文件复核');
 if(!inputs.length||inputs.some(a=>!a.output.trim()))throw Error('文本复核缺少已完成的上游文本产物');
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
 if(value.verdict==='pass'&&textReviewPaged(saved)){
  // 分段复核：每一段都要有成功读取记录才能判通过；发现缺陷判不通过则不要求读完
  const read=new Set(Object.values(attempt.memberStates??{}).flatMap(s=>s?.steps??[]).filter(s=>SOURCE_READ_TOOLS.includes(s.name)&&s.status==='ok').map(s=>{const a=(s.args??{}) as Record<string,unknown>;return `${a.id??a.artifactId}#${a.part}`;}));
  const missing=saved.flatMap(a=>Array.from({length:reviewPartCount(a.text)},(_,i)=>`${a.id}#${i+1}`)).filter(k=>!read.has(k));
  if(missing.length)throw Error(`文本较长，需分段读完全部原文才能判通过；还有 ${missing.length} 段未读：${missing.slice(0,5).join('、')}`);
 }
 return {verdict:value.verdict as 'pass'|'fail'|'unverifiable',artifactIds:value.artifactIds as string[],textEvidence:evidence,changes:value.changes,method:'model'};
}

export const TEXT_REVIEW_PAGED_INSTRUCTIONS='待复核文本较长，没有放进本条消息。用 read_source_text 按编号和段号（从 1 开始）逐段读取「文本产物目录」列出的全部段落；每段都成功读过才能给 pass，少读一段会被判为未完成。发现足以判定不通过的缺陷时可以直接给 fail。引用必须逐字取自读到的原文。';
export const TEXT_REVIEW_INSTRUCTIONS='本步骤只复核已提供的文本快照，不调用文件或外部工具。以 JSON 返回 {"verdict":"pass 或 fail 或 unverifiable","artifactIds":["本次全部 text: 编号"],"textEvidence":[{"artifactId":"对应编号","quote":"该文本中逐字一致的一段原文"}],"changes":"逐项覆盖、缺陷或无法核实的事项"}。通过时引用全部产物，每段至少 8 字符（短文本可引用全文），不得虚构原文；版本和引用可核对不等于事实为真。文件、外部事实或执行效果缺少证据时返回 unverifiable。';
