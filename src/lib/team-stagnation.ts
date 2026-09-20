import type { FlowNode, NodeAttempt, TeamRun } from './collaboration';
import type { ToolStep } from '../types';

export interface ReviewStagnation {
  fingerprint:string;
  repeats:2;
  reason:string;
}

const digest=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))]
  .map(byte=>byte.toString(16).padStart(2,'0')).join('');
const normalizedPath=(value:string)=>value.replace(/\\/g,'/').replace(/\/+/g,'/').replace(/^\.\//,'').replace(/\/$/,'');

function failedReview(attempt:NodeAttempt,node:FlowNode):boolean {
  return node.reviewMode==='text'?attempt.textReview?.verdict==='fail':attempt.review?.verdict==='fail';
}

async function contentFingerprint(attempt:NodeAttempt,node:FlowNode):Promise<string|undefined>{
  if(node.reviewMode==='text'){
    const values=attempt.inputTexts?.map(item=>item.digest.trim().toLowerCase());
    if(!values?.length||values.some(value=>!/^[a-f0-9]{64}$/.test(value)))return;
    return 'text:'+await digest(JSON.stringify(values.sort()));
  }
  const files=attempt.inputArtifacts?.flatMap(artifact=>artifact.files??[]);
  if(!files?.length)return;
  const values:string[]=[];
  for(const file of files){
    if(typeof file.path!=='string'||!file.path.trim()||(file.afterHash!==null&&
      (typeof file.afterHash!=='string'||!/^[a-f0-9]{64}$/i.test(file.afterHash))))return;
    const path=normalizedPath(file.path.trim());
    if(!path||path==='.')return;
    values.push(`${path}\0${file.afterHash===null?'deleted':file.afterHash.toLowerCase()}`);
  }
  return 'files:'+await digest(JSON.stringify(values.sort()));
}

function requirementSubstance(attempt:NodeAttempt,run:TeamRun,node:FlowNode):string {
  const requirements=(attempt.state?.requirements??[]).map(requirement=>({
    title:requirement.title,sourceQuote:requirement.sourceQuote,
    check:requirement.check,
  })).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return JSON.stringify({goal:run.goal,acceptance:run.acceptance,nodeId:node.id,instructions:node.instructions,
    outputRequirement:node.outputRequirement,supplementalInstructions:attempt.reviewInstructionSnapshot??[],requirements});
}

function allSteps(attempt:NodeAttempt):ToolStep[]{
  const unique=new Map<string,ToolStep>();
  for(const step of [...(attempt.state?.contextArchiveSteps??[]),...(attempt.state?.steps??[]),...attempt.steps])
    unique.set(step.callId||step.id,step);
  return [...unique.values()];
}

function manifestPaths(attempt:NodeAttempt):string[]|undefined {
  const files=attempt.inputArtifacts?.flatMap(artifact=>artifact.files??[]);
  if(!files?.length)return;
  const paths=files.map(file=>typeof file.path==='string'?normalizedPath(file.path.trim()):'');
  return paths.every(Boolean)?[...new Set(paths)].sort((a,b)=>b.length-a.length):undefined;
}

function relativeManifestPath(raw:string,paths:string[]):string|undefined {
  const full=normalizedPath(raw.trim());
  const matching=paths.filter(path=>full===path||full.endsWith('/'+path));
  if(matching.length!==1)return;
  return matching[0];
}

async function evidenceSubstance(attempt:NodeAttempt,node:FlowNode):Promise<Set<string>|undefined>{
  if(node.reviewMode==='text'){
    const inputs=new Map((attempt.inputTexts??[]).map(item=>[item.id,item.digest.toLowerCase()]));
    const evidence=attempt.textReview?.textEvidence;
    if(!evidence?.length)return;
    const values:string[]=[];
    for(const item of evidence){const input=inputs.get(item.artifactId);if(!input||typeof item.quote!=='string')return;
      values.push(`text:${input}:${await digest(item.quote)}`);}
    return new Set(values);
  }
  const ids=attempt.review?.evidence,paths=manifestPaths(attempt);
  if(!ids?.length||!paths)return;
  const steps=allSteps(attempt),values:string[]=[];
  for(const id of ids){
    const matches=steps.filter(step=>step.status==='ok'&&(step.id===id||step.callId===id));
    if(matches.length!==1)return;
    const step=matches[0],args=step.args as {path?:unknown};
    if(!['read_file','read_document'].includes(step.name)||typeof args?.path!=='string'||typeof step.output!=='string')return;
    const path=relativeManifestPath(args.path,paths);if(!path)return;
    values.push(`${step.name}:${path}:${await digest(step.output)}`);
  }
  return new Set(values);
}

/**
 * Detects exact repeated inputs and checks only. It does not judge whether the review defect is
 * semantically the same or whether the work is correct. Anything that cannot be normalized fails open.
 */
export async function repeatedReviewStagnation(run:TeamRun,node:FlowNode,current:NodeAttempt):Promise<ReviewStagnation|undefined>{
  if(node.type!=='review'||!failedReview(current,node))return;
  const index=run.attempts.findIndex(attempt=>attempt.id===current.id);if(index<0)return;
  let previous:NodeAttempt|undefined;
  for(let i=index-1;i>=0;i--)if(run.attempts[i].nodeId===node.id){previous=run.attempts[i];break;}
  const completeFailure=previous?.status==='completed'&&previous.outcome==='fail';
  const explicitRetry=previous?.status==='failed'&&previous.outcome==='fail'&&previous.resolution?.startsWith('retry:');
  if(!previous||(!completeFailure&&!explicitRetry)||!failedReview(previous,node))return;
  const [currentContent,previousContent,currentEvidence,previousEvidence]=await Promise.all([
    contentFingerprint(current,node),contentFingerprint(previous,node),evidenceSubstance(current,node),evidenceSubstance(previous,node),
  ]);
  if(!currentContent||currentContent!==previousContent||!currentEvidence||!previousEvidence)return;
  if(requirementSubstance(current,run,node)!==requirementSubstance(previous,run,node))return;
  if([...currentEvidence].some(value=>!previousEvidence.has(value)))return;
  const fingerprint=await digest(`${currentContent}\n${requirementSubstance(current,run,node)}\n${[...currentEvidence].sort().join('\n')}`);
  return {fingerprint,repeats:2,reason:`连续 2 次复核面对完全相同的已交付内容和要求，且没有新增可区分的检查证据（重复指纹 ${fingerprint.slice(0,12)}）。这只能确认精确产物与检查重复，不能判断语义缺陷是否已解决；已停止自动返工，等待人工核实后选择接受或重试。`};
}
