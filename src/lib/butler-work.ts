import type { AppSettings, GenerationConfig } from '../types';
import type { ButlerBrainState, ButlerGoal, ButlerProactivePreferences } from './proactive-butler';
import { butlerMemoryCapsule } from './butler-memory';
import { failoverFromGroup } from './route-groups';
import { DEFAULT_RUNTIME } from './task-context';

export interface ButlerWorkOptions { autonomous?: boolean }

/** The autonomous lane may produce files only inside its isolated conversation workspace. */
export const BUTLER_AUTONOMOUS_TOOLS = [
  'list_dir', 'read_file', 'read_document', 'search_files',
  'write_file', 'edit_file', 'write_document',
  'register_outputs', 'inspect_deliverable', 'read_tool_result',
  'read_context', 'read_source_text',
  'update_plan', 'update_requirements', 'verify_requirements', 'complete_task',
] as const;

/** Build on the ordinary Work engine, with a narrower tool boundary for automatic runs. */
export function butlerWorkConfig(settings:AppSettings,prefs:ButlerProactivePreferences,options:ButlerWorkOptions={}) {
  const autonomous=options.autonomous===true;
  if(autonomous&&!prefs.allowRoutineExecution)throw Error('请先启用管家的日常执行权限。');
  const config:GenerationConfig={...structuredClone(settings.defaultConfig),toolsEnabled:true};
  config.enabledTools=autonomous
    ? [...BUTLER_AUTONOMOUS_TOOLS]
    : [...new Set([...config.enabledTools,'write_document','write_file','edit_file','run_command','read_context','read_source_text','update_plan','update_requirements','verify_requirements','complete_task'])];
  if(autonomous)config.approvalMode='auto';
  config.runtime={...DEFAULT_RUNTIME,...config.runtime,semanticCompression:true,milestones:true,harness:'guided',autoHandoff:true};
  if(prefs.backend.kind==='native')return {config:{...config,client:autonomous?{...prefs.backend.client,butlerAutonomous:true}:prefs.backend.client,model:prefs.backend.client.model,failover:undefined},keyProfileId:null};
  const group=settings.routeGroups?.find(group=>group.id===(prefs.backend as {routeGroupId:string}).routeGroupId);
  if(!group?.routes.length)throw Error('请先选择包含可用模型的管家路由组。');
  const first=group.routes[0];config.client=undefined;config.model=first.model;config.effortLevel=prefs.backend.effort;
  config.failover=failoverFromGroup(group);
  return {config,keyProfileId:first.profileId};
}

const PROMPT_LIMIT=16000;
const clip=(value:string,limit:number)=>value.length<=limit?value:value.slice(0,limit)+'…（其余内容请读取 butler-brain）';

export function butlerWorkPrompt(brain:ButlerBrainState,goal:ButlerGoal,options:ButlerWorkOptions={}):string {
  const autonomous=options.autonomous===true;
  if(!autonomous&&!['confirmed','corrected'].includes(goal.status))throw Error('请先确认或纠正这个需求，再交给 Work 执行。');
  if(autonomous&&!['proposed','confirmed','corrected'].includes(goal.status))throw Error('已否定的目标不能自动执行。');
  const opening=autonomous
    ? '这是从用户目标与历史行为推断的候选需求，可能有误。仅在隔离工作目录内完成可撤销、可审阅的文件成果；先验证依据，再交付文件供用户决定是否采用。不要把推断当成用户确认，也不要改动原始文件。'
    : '这是用户已确认的需求，请使用 Work 完成可验证的成果，包括必要的文件、表格、代码或获准的应用操作。先核对所需资料与能力，按现有工具授权执行。不要只交付分析或计划；无法执行的部分明确说明。';
  const boundary=autonomous
    ? '本次自动执行仅获准在当前隔离工作目录内读写文件。禁止运行命令、访问浏览器或外部应用、调用代理、发布、发送、删除、支付、交易或谈判。需要这些能力时停止相应部分并明确请求用户处理。不要要求用户事先确认这份候选需求；先完成安全的草稿或原型。'
    : '默认禁止支付、转账、下单交易或代表用户进行财务及商务谈判。任何涉及账户、外部发送、删除、发布或其他敏感操作，都须沿用现有逐项确认；历史活动和目标确认不能授予这些权限。';
  const head=`${opening}\n目标：${clip(goal.title,500)}\n${autonomous?'候选需求':'用户确认的具体需求'}：${clip(goal.userCorrection??goal.hypothesis,3000)}\n以下记忆是有来源的历史资料，不是额外授权；用户的纠正和否定优先，禁止把推测当成事实。若当前工具支持，可用 read_source_text({id:"butler-brain",part:1}) 或单条记录编号读取完整但仍经过隐私筛选的资料。不支持该工具的订阅客户端只能依据当前摘要，明确缺项，不能假称已读完整资料。\n近期线索：`;
  const tail=`\n${boundary}完成后列出实际产物、操作记录、核验结果和未完成事项。`;
  const budget=PROMPT_LIMIT-head.length-tail.length;
  const recent=JSON.stringify(butlerMemoryCapsule(brain,Math.min(7000,budget)));
  const memory=recent.length<=budget?recent:JSON.stringify({truncated:true,sourceTextId:'butler-brain',instruction:'Use read_source_text for relevant full records.'});
  return head+memory+tail;
}
