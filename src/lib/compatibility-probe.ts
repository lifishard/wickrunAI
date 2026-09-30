import { isRateLimited } from './pacer';
import type { KeyProfile } from '../types';
import type { EffortLevel } from './effort';
import { buildHeaders, endpoint } from './api';
import { getTransport } from './transport';
import { quotaKey } from './adaptive';
import { compatibilityKey, readCompatibility, writeCompatibility, readVision, writeVision, type CompatibilityReport, type ThinkingFields, type VisionResult, type ImageFormat } from './compatibility-cache';
export interface ProbeReply { accepted:boolean; status?:number; note:string; text?:string }
export type ProbeSend=(body:Record<string,unknown>,signal?:AbortSignal)=>Promise<ProbeReply>;
const LEVELS:EffortLevel[]=['low','medium','high','xhigh','max'];
type ProbeJob={promise:Promise<CompatibilityReport>;control:AbortController;clients:number;done:boolean};
const pending=new Map<string,ProbeJob>();
function subscribe(job:ProbeJob,signal?:AbortSignal):Promise<CompatibilityReport>{
  if(signal?.aborted)return Promise.reject(new DOMException('已取消','AbortError'));
  job.clients++;
  return new Promise((resolve,reject)=>{let settled=false;const finish=(error:unknown,value?:CompatibilityReport)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);job.clients--;if(!job.clients&&!job.done)job.control.abort();if(error)reject(error);else resolve(value!);};const abort=()=>finish(new DOMException('已取消','AbortError'));signal?.addEventListener('abort',abort,{once:true});job.promise.then(value=>finish(null,value),error=>finish(error));});
}
/** Tests protocol validation, never asks the model to invent its own API schema. */
export async function discoverCompatibility(model:string,send:ProbeSend,signal?:AbortSignal):Promise<CompatibilityReport> {
  const report:CompatibilityReport={at:Date.now(),status:'inconclusive',mode:'default',requests:{},outputField:'max_tokens',evidence:[],note:'尚未完成验证'};
  let count=0;
  const check=async(fields:Record<string,unknown>)=>{
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    if(++count>16)throw Error('已达到探测请求上限');
    const result=await send({model,messages:[{role:'user',content:'Reply only OK.'}],stream:false,[report.outputField]:128,...fields},signal);
    report.evidence.push({fields:{...fields},...result});
    if(!result.accepted&&![400,422].includes(result.status??0))throw Error(result.note||'连接、权限或额度暂不可用');
    return result.accepted;
  };
  try {
    if(!await check({})) { report.outputField='max_completion_tokens';if(!await check({}))throw Error('基础请求未通过；请查看连接或模型设置'); }
    // A successful invalid control means this gateway may ignore the field. Do not call it supported.
    const styles:{make:(s:string)=>ThinkingFields;invalid:Record<string,unknown>;toggle?:boolean}[]=[
      {make:s=>({reasoning_effort:s}),invalid:{reasoning_effort:'__wickrun_invalid__'}},
      {make:s=>({thinking:{type:s==='off'?'disabled':'enabled'}}),invalid:{thinking:{type:'__wickrun_invalid__'}},toggle:true},
      {make:s=>({reasoning:{effort:s}}),invalid:{reasoning:{effort:'__wickrun_invalid__'}}},
      {make:s=>({enable_thinking:s!=='off'}),invalid:{enable_thinking:'__wickrun_invalid__'},toggle:true},
    ];
    for(const style of styles) {
      if(count>9)break;
      const first=style.make(style.toggle?'on':'high');
      if(!await check(first))continue;
      if(await check(style.invalid))continue;
      report.mode=style.toggle?'toggle':'levels';
      if(style.toggle){for(const l of LEVELS)report.requests[l]=first;report.requests.off=await check(style.make('off'))?style.make('off'):{};}
      else { report.requests.high=first;report.requests.off={};for(const l of LEVELS.filter(l=>l!=='high'))if(await check(style.make(l)))report.requests[l]=style.make(l); }
      break;
    }
    report.status='ready';
    if(report.mode==='default')report.requests.off={};
    report.note=report.mode==='levels'?'已验证可接受的强度请求；实际推理效果由上游决定':report.mode==='toggle'?'此路由已验证思考开关，不区分多个强度':'基础请求可用，未验证到可调思考参数；使用上游默认思考方式';
  } catch(e) { if(signal?.aborted)throw e;report.note=e instanceof Error?e.message:String(e); }
  return report;
}
/** 16×16 纯红 PNG。问它是什么颜色：答对才算真的看到了图，网关悄悄丢掉图片的不算。 */
const RED_PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=';
/**
 * 看图能力实测：发一张纯红小图问颜色。答出红色为 yes；上游以 400/422 拒收图片为 no；
 * 其余（限流、网络、答非所问）不下结论，返回 undefined，沿用接入声明的能力。
 */
export async function discoverVision(model:string,send:ProbeSend,signal?:AbortSignal,report?:CompatibilityReport):Promise<Omit<VisionResult,'at'>|undefined> {
  // 关掉思考、给够输出长度：思考型模型只给 32 个 token 时全花在思考上，正文为空，原来会被判成“测不出”
  const base={model,stream:false,[report?.outputField??'max_tokens']:512,...(report?.requests.off??{})};
  const question={type:'text',text:'What is the main color of this image? Reply with one word.'};
  const formats:[ImageFormat,unknown][]=[['object',{type:'image_url',image_url:{url:RED_PNG}}],['string',{type:'image_url',image_url:RED_PNG}]];
  let rejectedAsImage=0;
  for(const [format,part] of formats){
    if(signal?.aborted)throw new DOMException('已取消','AbortError');
    const reply=await send({...base,messages:[{role:'user',content:[question,part]}]},signal);
    if(reply.accepted){if(/red|红/i.test(reply.text??''))return {result:'yes',format};continue;}
    // 限流、鉴权、网络问题说明不了看图能力，整次测试算“测不出”
    if(![400,415,422].includes(reply.status??0))return undefined;
    // 只认明确提到图片的拒绝；“xx 参数不支持”之类不能当成不能看图
    if(/image|vision|multimodal|modal|图片|图像|视觉|多模态/i.test(reply.note))rejectedAsImage++;
  }
  return rejectedAsImage===formats.length?{result:'no'}:undefined;
}
export function probeCompatibility(profile:KeyProfile,model:string,key:string,options:{force?:boolean;signal?:AbortSignal}={}):Promise<CompatibilityReport> {
  if(options.signal?.aborted)return Promise.reject(new DOMException('已取消','AbortError'));
  const id=compatibilityKey(profile,model),existing=pending.get(id);
  if(existing&&!existing.control.signal.aborted)return subscribe(existing,options.signal);
  const cached=readCompatibility(profile,model);if(cached&&!options.force&&(cached.status==='ready'||!isRateLimited(cached.note)))return Promise.resolve(cached);
  const transport=getTransport();
  const send:ProbeSend=async(body,signal)=>{
    const requestId=`compat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result:ProbeReply={accepted:false,note:'响应未完成'};let received=false;let stopped=false;let failed=false;
    const abort=()=>{void transport.abort(requestId);};signal?.addEventListener('abort',abort,{once:true});
    try { await transport.chat({requestId,url:endpoint(profile.baseUrl,'chat/completions'),headers:buildHeaders(key,profile),body,stream:false,timeoutMs:15000,purpose:'probe',paceKey:quotaKey(profile),paceTokens:160},{
      onContent:d=>{received ||= !!d;result.text=(result.text??'')+d;},onReasoning:d=>{received ||= !!d;},onToolCalls(){},onUsage(){},onStop:info=>{stopped=!!info.reason&&info.droppedCalls===0;},
      onResponse:status=>{result.status=status;},onDone(){},onError:(_message,status)=>{failed=true;result.status=status??result.status;result.note=`上游请求失败${result.status?`（HTTP ${result.status}）`:''}${_message?`：${_message.slice(0,160)}`:''}`;},
    });result.accepted=!failed&&(received||stopped);if(result.accepted)result.note='请求被接受';return result;
    } finally {signal?.removeEventListener('abort',abort);}
  };
  const job:ProbeJob={promise:Promise.resolve(null as unknown as CompatibilityReport),control:new AbortController(),clients:0,done:false};
  job.promise=discoverCompatibility(model,send,job.control.signal).then(async report=>{
    // 同一轮顺带测看图能力（一次小请求），结论单独缓存；测不出结论不影响格式检测
    if(report.status==='ready'&&!readVision(profile,model))try{const r=await discoverVision(model,send,job.control.signal,report);if(r)writeVision(profile,model,{at:Date.now(),...r});}catch{/* 不影响格式检测 */}
    if(report.status==='ready'||!isRateLimited(report.note))writeCompatibility(profile,model,report);return report;}).finally(()=>{job.done=true;if(pending.get(id)===job)pending.delete(id);});
  pending.set(id,job);return subscribe(job,options.signal);
}
const visionPending=new Map<string,Promise<VisionResult|undefined>>();
/** 只测看图能力；结果按路由缓存 30 天。已有结论直接返回，除非 force。 */
export function probeVision(profile:KeyProfile,model:string,key:string,options:{force?:boolean;signal?:AbortSignal}={}):Promise<VisionResult|undefined> {
  const cached=readVision(profile,model);if(cached&&!options.force)return Promise.resolve(cached);
  const id=compatibilityKey(profile,model),existing=visionPending.get(id);if(existing)return existing;
  const transport=getTransport();
  const send:ProbeSend=async(body,signal)=>{
    const requestId=`vision-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result:ProbeReply={accepted:false,note:'响应未完成'};let failed=false;
    const abort=()=>{void transport.abort(requestId);};signal?.addEventListener('abort',abort,{once:true});
    try { await transport.chat({requestId,url:endpoint(profile.baseUrl,'chat/completions'),headers:buildHeaders(key,profile),body,stream:false,timeoutMs:30000,purpose:'probe',paceKey:quotaKey(profile),paceTokens:400},{
      onContent:d=>{result.text=(result.text??'')+d;},onReasoning(){},onToolCalls(){},onUsage(){},onStop(){},
      onResponse:status=>{result.status=status;},onDone(){},onError:(message,status)=>{failed=true;result.status=status??result.status;result.note=message.slice(0,300);}
    });result.accepted=!failed;return result;
    } finally {signal?.removeEventListener('abort',abort);}
  };
  const job=discoverVision(model,send,options.signal,readCompatibility(profile,model)).then(r=>{if(!r)return undefined;const v:VisionResult={at:Date.now(),...r};writeVision(profile,model,v);return v;}).finally(()=>visionPending.delete(id));
  visionPending.set(id,job);return job;
}
