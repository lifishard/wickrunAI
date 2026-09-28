import type { GenerationConfig } from '../types';
import type { AgentRole } from './office';
/** Only explicit delegation wording opens the bounded pool; workers still inherit no edit permission. */
export function requestedRoleDelegation(text:string,roles:AgentRole[]):boolean {
  if(/(?:不要|不需要|无需|禁止|don't|do not|without).{0,25}(?:子代理|subagents?|分派|分发)/i.test(text))return false;
  const names=roles.filter(r=>[r.name,r.originalName].some(name=>name&&text.toLocaleLowerCase().includes(name.toLocaleLowerCase())));
  return /(?:调用|使用|启用|安排|启动|派发|分派|分发|use|spawn|delegate).{0,50}(?:子代理|subagents?|多个角色|多角色)/i.test(text)||/(?:子代理|subagents?).{0,35}(?:分别|协作|执行|处理|完成|并行)/i.test(text)||(names.length>=2&&/(?:请|让|安排|调用|分工|delegate|use)/i.test(text));
}
export function withRequestedDelegation(config:GenerationConfig,text:string,roles:AgentRole[],profileId:string):GenerationConfig {
  if(config.client||config.subagents?.enabled||!requestedRoleDelegation(text,roles))return config;
  return {...config,subagents:{enabled:true,workers:config.subagents?.workers.length?structuredClone(config.subagents.workers):[{id:'current-model',profileId,model:config.model,label:'当前模型'}],maxCalls:config.subagents?.maxCalls??4,allowEdits:false}};
}
