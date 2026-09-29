import type { KeyProfile, RouteOverrides } from '../types';
import type { EffortLevel } from './effort';
export type ThinkingFields = {reasoning_effort?:string;thinking?:{type:'enabled'|'disabled'};enable_thinking?:boolean;reasoning?:{effort:string}};
export interface ProbeEvidence { fields:Record<string,unknown>; accepted:boolean; status?:number; note:string }
export interface CompatibilityReport {
  at:number; status:'ready'|'inconclusive'; mode:'levels'|'toggle'|'default';
  requests:Partial<Record<EffortLevel,ThinkingFields>>; outputField:'max_tokens'|'max_completion_tokens';
  evidence:ProbeEvidence[]; note:string;
}
const KEY='wickrun:compatibility:v1';
const cache=new Map<string,CompatibilityReport>();
try { for(const [k,v] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(KEY)||'{}')))cache.set(k,v as CompatibilityReport); } catch { /* optional cache */ }
// Values are hashed so custom authentication headers never enter saved diagnostics.
export function compatibilityKey(p:KeyProfile,model:string):string {
  let hash=2166136261;for(const c of JSON.stringify(Object.entries(p.extraHeaders??{}).sort()))hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return `${p.id}::${p.baseUrl.trim().replace(/\/+$/,'')}::${p.protocol??'openai'}::${p.credentialRevision??0}::${hash>>>0}::${model}`;
}
export function readCompatibility(p:KeyProfile,model:string):CompatibilityReport|undefined {
  const value=cache.get(compatibilityKey(p,model));
  return value&&Date.now()-value.at<(value.status==='ready'?7*86400000:5*60000)?value:undefined;
}
export function writeCompatibility(p:KeyProfile,model:string,value:CompatibilityReport):void {
  cache.set(compatibilityKey(p,model),value);
  while(cache.size>200)cache.delete(cache.keys().next().value!);
  try { globalThis.localStorage?.setItem(KEY,JSON.stringify(Object.fromEntries(cache))); } catch { /* memory remains usable */ }
  globalThis.dispatchEvent?.(new Event('wickrun-compatibility'));
}
export function compatibilityRoute(p:KeyProfile,model:string):RouteOverrides {
  const key=`${p.baseUrl.trim().replace(/\/+$/,'')}::chat-completions::${model}`;
  const manual=p.routeProfiles?.[key]??{},report=readCompatibility(p,model);
  return {...(report?.status==='ready'?{compatibility:report,outputField:report.outputField}:{}),...manual};
}
