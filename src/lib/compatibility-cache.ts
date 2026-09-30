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
/** 看图能力的实测结果：网关 /models 里的 input_modalities 常常不准，以实测为准。 */
/** format：这条路由认哪种图片写法。object = image_url:{url}（OpenAI 标准），string = image_url:"data:..."（部分网关）。 */
export type ImageFormat = 'object'|'string';
export type VisionResult = { at:number; result:'yes'|'no'; format?:ImageFormat };
// v1 的探针只试一种写法、只给 32 个 token，思考型模型常被误判；换键让旧结论作废
const VISION_KEY='wickrun:vision:v2';
const vision=new Map<string,VisionResult>();
try { for(const [k,v] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(VISION_KEY)||'{}')))vision.set(k,v as VisionResult); } catch { /* optional cache */ }
export function readVision(p:KeyProfile,model:string):VisionResult|undefined {
  const value=vision.get(compatibilityKey(p,model));
  return value&&Date.now()-value.at<30*86400000?value:undefined;
}
export function writeVision(p:KeyProfile,model:string,value:VisionResult):void {
  vision.set(compatibilityKey(p,model),value);
  while(vision.size>200)vision.delete(vision.keys().next().value!);
  try { globalThis.localStorage?.setItem(VISION_KEY,JSON.stringify(Object.fromEntries(vision))); } catch { /* memory remains usable */ }
  globalThis.dispatchEvent?.(new Event('wickrun-compatibility'));
}
export function compatibilityRoute(p:KeyProfile,model:string):RouteOverrides {
  const key=`${p.baseUrl.trim().replace(/\/+$/,'')}::chat-completions::${model}`;
  const manual=p.routeProfiles?.[key]??{},report=readCompatibility(p,model);
  return {...(report?.status==='ready'?{compatibility:report,outputField:report.outputField}:{}),...manual};
}
