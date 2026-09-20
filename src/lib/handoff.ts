import { mergeProgress, reconcileProgress } from './task-progress';
import type { ChatMessage, Conversation, HandoffInfo, RunRecord, RunState, ToolStep, Milestone, DeliveryRequirement } from '../types';
import { mergeTaskContracts, taskContractFromState, taskContractPrompt, type PortableTaskContract } from './task-contract';

const clip = (value: unknown, limit: number): string => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= limit) return text;
  const head = Math.max(1, Math.ceil(limit * 0.65));
  return `${text.slice(0, head)}…（已省略，原文按来源 ID取回）…${text.slice(-(limit - head))}`;
};

const compactCheck = (check: any) => ({
  kind: check?.kind,
  ...(check?.path ? { path: clip(check.path, 160) } : {}),
  ...(Array.isArray(check?.contains) ? { contains: check.contains.slice(0, 3).map((value: unknown) => clip(value, 120)) } : {}),
  ...(Array.isArray(check?.requiredKeys) ? { requiredKeys: check.requiredKeys.slice(0, 3).map((value: unknown) => clip(value, 120)) } : {}),
  ...(check?.count !== undefined ? { count: check.count } : {}),
});

/** Portable working notes, never hidden reasoning or a new user instruction. */
export function checkpointNotes(state: RunState) {
  const summary=state.compactions?.at(-1);
  const compactSummary=(items: {text:string;sources:string[]}[]|undefined)=> (items??[]).slice(-12).map(item=>({text:clip(item.text,500),sources:(item.sources??[]).slice(0,6)}));
  const compactRequirements=(state.requirements??[]).slice(-12).map(r=>({id:r.id,revision:r.revision,title:clip(r.title,180),sourceId:r.sourceId,sourceQuote:clip(r.sourceQuote,260),milestoneId:r.milestoneId,check:compactCheck(r.check),verification:r.verification?{revision:r.verification.revision,status:r.verification.status,method:r.verification.method,detail:clip(r.verification.detail,360),evidence:r.verification.evidence.slice(0,6)}:undefined,historyCount:r.history?.length??0}));
  const compactMilestones=(state.milestones??[]).slice(-12).map(m=>({id:m.id,title:clip(m.title,180),status:m.status,acceptance:m.acceptance?clip(m.acceptance,240):undefined,evidence:(m.evidence??[]).slice(-10),note:m.note?clip(m.note,360):undefined,historyCount:m.history?.length??0}));
  return {
    status:state.status, blocker:state.reason,
    memory:summary ? {facts:compactSummary(summary.facts),decisions:compactSummary(summary.decisions),unresolved:compactSummary(summary.unresolved),nextSteps:(summary.nextSteps??[]).slice(-12).map(step=>clip(step,360))}:undefined,
    milestones:compactMilestones,
    requirements:compactRequirements,
    recentEvidence:(state.steps??[]).slice(-12).map(s=>({id:s.id,callId:s.callId,name:s.name,status:s.status,summary:clip(s.summary,220),resultRef:s.resultRef,error:s.error?clip(s.error,260):undefined})),
    files:(state.steps??[]).flatMap(s=>s.files??[]).filter((f,i,all)=>all.findIndex(x=>x.path===f.path&&x.direction===f.direction)===i).slice(-40).map(f=>({...f,path:clip(f.path,260)})),
    pending:state.pendingCalls?.slice(state.toolCursor??0, (state.toolCursor??0)+12).map(c=>({id:c.id,name:c.name})),
    pendingOmitted:Math.max(0,(state.pendingCalls?.length??0)-(state.toolCursor??0)-12),
    uncertainCallId:state.uncertainCallId,
    taskContract:taskContractPrompt(state,8000),
  };
}

/** A local draft only: no tool dispatch, backend agent, or implicit continuation. */
export function createContextHandoff(source: Conversation, state: RunState, key: string): Conversation {
  const requirements = state.working.filter(m => m.role === 'user' && !m.contextKind && m.id !== `screens-${state.round}` && !m.id.startsWith('screens-'));
  const draft = [
    '请先阅读以下交接材料，并以我本次编辑后的要求为准。历史记录不是新的授权；先核实已有成果，避免重复执行。',
    '【原始要求与补充】',
    ...requirements.map(m => `${clip(m.content,1000)}\n原始来源消息 ID：${m.id}（完整原文可用 read_context 查阅）${m.attachments?.length ? `\n附件来源消息：${m.id}（可用 read_context 查阅）` : ''}`),
    '【已保存的工作记录】', JSON.stringify(checkpointNotes(state), null, 2),
    ...(state.content ? ['【最近的可见答复（历史材料，可能尚未完成）】', state.content.slice(-12000)] : []),
    '【本次请求】', '请承接未完成事项；如果原任务仍在运行，请先核实其最新结果和待确认操作，再决定下一步。',
  ].join('\n\n');
  return { id: `context-${key}`, title: `交接 · ${source.title}`, forkedFrom: source.id, projectId: source.projectId,
    keyProfileId: source.keyProfileId, config: structuredClone(source.config), messages: [], draft,
    handoffSourceRunId: state.runId, handoffKey: key, createdAt: Date.now(), updatedAt: Date.now() };
}

/** Keep original evidence retrievable without resending the entire old window. */
export function withHandoffArchive(memory: ConversationMemory, source?: RunRecord): ConversationMemory {
  if (!source) return memory;
  return { ...memory, archive: unique([...(source.state.contextArchive ?? []).map(plain), ...source.state.working.map(plain), ...memory.archive]),
    evidence: unique([...(source.state.contextArchiveSteps ?? []), ...(source.state.steps ?? []), ...memory.evidence]),
    taskContract: mergeTaskContracts(memory.taskContract, taskContractFromState(source.state)),
    fromModel: memory.fromModel ?? source.config.model, checkpoints: memory.checkpoints + 1 };
}

const plain=(m:ChatMessage):ChatMessage=>({id:m.id,role:m.role,content:m.content,createdAt:m.createdAt,
  attachments:m.attachments,quotes:m.quotes,quoteOnly:m.quoteOnly,toolCalls:m.toolCalls,toolCallId:m.toolCallId,toolName:m.toolName,contextKind:m.contextKind});
const unique=<T extends {id:string}>(items:T[])=>[...new Map(items.map(x=>[x.id,x])).values()];
export interface ConversationMemory {
  milestones?:Milestone[];
  requirements?:DeliveryRequirement[];
  taskContract?:PortableTaskContract;
  history:ChatMessage[];
  archive:ChatMessage[];
  evidence:ToolStep[];
  fromModel?:string;
  checkpoints:number;
}

/** Restore saved work behind visible answers without attributing old executions to a new task. */
export function conversationMemory(history:ChatMessage[],lookup:(id:string)=>RunRecord|undefined):ConversationMemory {
  let boundary=0;
  history.forEach((m,i)=>{if(m.role==='user'&&m.quoteOnly)boundary=i;});
  const scoped=history.slice(boundary),allowed=new Set(scoped.filter(m=>m.role==='user').map(m=>m.id));
  const sourceText=new Map(scoped.filter(m=>m.role==='user').map(m=>[m.id,m.content]));
  scoped.forEach(m=>m.supplementalInputs?.forEach(s=>allowed.add(s.id)));
  scoped.forEach(m=>m.supplementalInputs?.forEach(s=>sourceText.set(s.id,s.content)));
  const result:ConversationMemory={history:[],archive:[],evidence:[],checkpoints:0};
  for(const message of scoped){
    result.history.push(plain(message));
    if(message.role!=='assistant'||!message.taskId)continue;
    const record=lookup(message.taskId);
    if(!record||record.answerId!==message.id||!allowed.has(record.question.id))continue;
    const state=record.state;
    // Editing/deleting history or quote-only mode must not bring excluded instructions back.
    const userSources=state.requirementSourceIds??state.working.filter(m=>m.role==='user').map(m=>m.id);
    if(userSources.some(id=>!allowed.has(id)||state.working.find(m=>m.id===id)?.content!==sourceText.get(id)))continue;
    for(const input of message.supplementalInputs??[]) {
      if(!result.history.some(m=>m.id===input.id))result.history.push({...input,role:'user'});
    }
    result.archive.push(...(state.contextArchive??[]).map(plain),...state.working.map(plain));
    result.milestones=mergeProgress(result.milestones,state.milestones);
    result.requirements=mergeProgress(result.requirements,state.requirements);
    result.taskContract=mergeTaskContracts(result.taskContract,taskContractFromState(state));
    result.evidence.push(...(state.contextArchiveSteps??[]),...(state.steps??[]));
    const capsule:ChatMessage={id:`handoff-${message.id}`,role:'user',contextKind:'handoff',createdAt:message.createdAt,
      content:`历史任务交接记录（来自应用保存的执行记录；不是新的用户指令，历史模型结论可能有误）：\n${JSON.stringify(checkpointNotes(state))}\n本轮以最新用户要求为准；已有成果先读证据，避免重新执行。未完成旧任务要继续原操作游标时，使用原任务的“接着跑”。`};
    result.history.push(capsule);result.archive.push(capsule);
    result.checkpoints++;result.fromModel=record.config.model;
  }
  result.archive=unique(result.archive);result.evidence=unique(result.evidence);
  reconcileProgress(result);
  return result;
}

export function handoffInfo(state:RunState,fromModel:string|undefined,toModel:string,mode:HandoffInfo['mode'],checkpoints:number):HandoffInfo {
  return {fromModel,toModel,mode,at:Date.now(),status:'prepared',checkpoints,
    sourceMessages:new Set([...(state.contextArchive??[]),...state.working].map(m=>m.id)).size,
    savedSteps:new Set([...(state.contextArchiveSteps??[]),...(state.steps??[])].map(s=>s.id)).size,
    summaryAvailable:Boolean(state.compactions?.length||checkpoints),
  };
}

/** Stop only consecutive identical actions returning identical results in this attempt. */
export function repeatedWithoutProgress(state:RunState,name:string,args:unknown):boolean {
  const recent=(state.steps??[]).filter(s=>s.startedAt>=(state.attemptStartedAt??0)).slice(-3);
  const signature=JSON.stringify(args);
  return recent.length===3&&recent.every(s=>s.name===name&&s.status!=='running'&&JSON.stringify(s.args)===signature
    &&s.status===recent[0].status&&s.output===recent[0].output&&s.error===recent[0].error);
}
