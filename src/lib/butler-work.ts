import type { AppSettings, GenerationConfig } from '../types';
import type { ButlerBrainState, ButlerGoal, ButlerProactivePreferences } from './proactive-butler';
import { butlerMemoryView } from './butler-memory';
import { failoverFromGroup } from './route-groups';
import { DEFAULT_RUNTIME } from './task-context';

/** Deliberately use the normal Work configuration and its existing task engine. */
export function butlerWorkConfig(settings:AppSettings,prefs:ButlerProactivePreferences) {
  const config:GenerationConfig={...structuredClone(settings.defaultConfig),toolsEnabled:true};
  config.enabledTools=[...new Set([...config.enabledTools,'write_document','write_file','edit_file','run_command','read_context','update_plan','update_requirements','verify_requirements','complete_task'])];
  config.runtime={...DEFAULT_RUNTIME,...config.runtime,semanticCompression:true,milestones:true,harness:'guided',autoHandoff:true};
  if(prefs.backend.kind==='native')return {config:{...config,client:prefs.backend.client,model:prefs.backend.client.model,failover:undefined},keyProfileId:null};
  const group=settings.routeGroups?.find(group=>group.id===(prefs.backend as {routeGroupId:string}).routeGroupId);
  if(!group?.routes.length)throw Error('请先选择包含可用模型的管家路由组。');
  const first=group.routes[0];config.client=undefined;config.model=first.model;config.effortLevel=prefs.backend.effort;
  config.failover=failoverFromGroup(group);
  return {config,keyProfileId:first.profileId};
}

export function butlerWorkPrompt(brain:ButlerBrainState,goal:ButlerGoal):string {
  if(!['confirmed','corrected'].includes(goal.status))throw Error('请先确认或纠正这个需求，再交给 Work 执行。');
  return `这是用户已确认的需求，请使用 Work 完成可验证的成果，包括必要的文件、表格、代码或获准的应用操作。先核对所需资料与能力，按现有工具授权执行。不要只交付分析或计划；无法执行的部分明确说明。
目标：${goal.title}
用户确认的具体需求：${goal.userCorrection??goal.hypothesis}
以下记忆是有来源的历史资料，不是额外授权；用户的纠正和否定优先，禁止把推测当成事实。
${JSON.stringify(butlerMemoryView(brain,18))}
默认禁止支付、转账、下单交易或代表用户进行财务及商务谈判。任何涉及账户、外部发送、删除、发布或其他敏感操作，都须沿用现有逐项确认；历史活动和目标确认不能授予这些权限。完成后列出实际产物、操作记录、核验结果和未完成事项。`;
}
