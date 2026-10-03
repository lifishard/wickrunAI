import { redactSecrets } from './memory-core';
import type { ClientSelection } from './connections';
import type { ClientStatus } from './connections';
import type { EffortLevel } from './effort';
import { retainButlerSignals } from './butler-memory';
import type { ButlerPrivacyPolicy } from './butler-privacy';

/** The synced brain contains bounded observations, never raw app logs or credentials. */
export type ButlerSource = 'wickrun' | 'browser' | 'desktop' | 'android' | 'integration' | 'share';
export const BUTLER_SOURCES:ButlerSource[]=['wickrun','browser','desktop','android','integration','share'];
export type ButlerConfidence = 'low' | 'medium' | 'high';
export type ButlerGoalStatus = 'proposed' | 'confirmed' | 'corrected' | 'dismissed';

export interface ButlerProactivePreferences {
  enabled: boolean;
  paused: boolean;
  /** External sources also require a separate grant on each collecting device. */
  sources: Partial<Record<ButlerSource, boolean>>;
  backend: {kind:'route-group';routeGroupId:string;effort:EffortLevel} | {kind:'native';client:ClientSelection};
  maxTokensPerDay: number;
  cadence: 'daily' | 'twice-daily';
  morning: string;
  evening: string;
  timezone: string;
  /** Only this same-account device may run the recurring scheduler. */
  hostDeviceId?: string;
  allowResearch: boolean;
  /** Financial and negotiation actions always need their own exact grant. */
  allowRoutineExecution: boolean;
  /** New autonomous Work tasks per local calendar day; existing jobs resume separately. */
  maxWorkPerDay?: number;
  /** Redacted excerpts can be sent to the selected model only while collection is on. */
  externalUnderstanding: 'local-topics' | 'redacted-context';
  /** The data-scope notice the account accepted. Without a current one nothing is collected or sent. */
  consent?: {version:number;at:number};
  /** Learn when and how the app is used (hours, topics, chat versus Work), computed on the device. */
  learnHabits?: boolean;
}

/** Bump when the consent notice changes what is collected or where it goes. */
export const BUTLER_CONSENT_VERSION = 1;
export function butlerConsented(prefs:Pick<ButlerProactivePreferences,'consent'>|undefined):boolean {
  return !!prefs?.consent && prefs.consent.version>=BUTLER_CONSENT_VERSION && Number.isFinite(prefs.consent.at);
}
/** Ids of signals learned from usage patterns rather than from what the user wrote. */
export const BUTLER_HABIT_PREFIX = 'wickrun:habit-';

export interface ButlerSignal {
  id: string;
  accountId: string;
  source: ButlerSource;
  sourceLabel: string;
  /** Internal record id or local opaque reference; never a raw URL with query or credentials. */
  sourceRef?: string;
  topic: string;
  intent: string;
  summary: string;
  observedAt: number;
  confidence: ButlerConfidence;
  /** Only user statements can support a high-confidence user goal. */
  basis: 'user-stated' | 'behavior' | 'result';
  modelSafe: true;
}

export interface ButlerGoal {
  id: string;
  accountId: string;
  title: string;
  hypothesis: string;
  evidenceIds: string[];
  confidence: ButlerConfidence;
  status: ButlerGoalStatus;
  userCorrection?: string;
  updatedAt: number;
  dismissedAt?: number;
}

export interface ButlerResultRef {kind:'conversation'|'team-run'|'artifact'|'url';id:string;url?:string}
export interface ButlerBriefItem {
  id: string;
  kind: 'progress' | 'finding' | 'suggestion' | 'needs-approval';
  title: string;
  summary: string;
  goalId?: string;
  evidenceIds: string[];
  result?: ButlerResultRef;
}
export interface ButlerBrief {
  id: string;
  accountId: string;
  period: 'morning' | 'evening';
  createdAt: number;
  /** One or two sentences written by the model for the first open of the day. */
  greeting?: string;
  items: ButlerBriefItem[];
}

export interface ButlerSkillProposal {
  id: string;
  accountId: string;
  name: string;
  description: string;
  body: string;
  evidenceIds: string[];
  status: 'proposed' | 'accepted' | 'dismissed';
  createdAt: number;
  reviewedAt?: number;
}

/** A grant is tied to one action. A disclaimer or inferred goal is never a grant. */
export interface ButlerActionGrant {
  id: string;
  accountId: string;
  action: 'financial' | 'negotiation';
  account: string;
  target: string;
  amount: number;
  currency: string;
  expiresAt: number;
  grantedAt: number;
  consumedAt?: number;
}

export interface ButlerBrainState {
  schema: 1;
  accountId: string;
  signals: ButlerSignal[];
  goals: ButlerGoal[];
  briefs: ButlerBrief[];
  skillProposals: ButlerSkillProposal[];
  actionGrants: ButlerActionGrant[];
  jobs?: ButlerJob[];
  hosts?: ButlerHost[];
  feedback?: ButlerFeedback[];
  audit?: ButlerAudit[];
  /** What the user told the Butler to forget. Data observed before `at` is never learned again. */
  forgotten?: ButlerForget[];
  updatedAt: number;
}
/** id is a signal id, or '*' for everything observed before `at`. */
export interface ButlerForget {id:string;accountId:string;at:number}

export interface ButlerJob {
  id:string;accountId:string;kind:'analyze'|'research'|'brief'|'work';goalId?:string;period?:'morning'|'evening';
  /** proposed: waiting in the quiet inbox for the user to accept; declined: the user said no. */
  status:'proposed'|'declined'|'queued'|'running'|'waiting'|'completed'|'failed';createdAt:number;updatedAt:number;error?:string;
  conversationId?:string;summary?:string;commands?:ButlerWorkCommand[];automatic?:boolean;
  /** Started as an inbox proposal; it runs only after the user accepts it. */
  proposal?:boolean;
}
export interface ButlerWorkCommand {id:string;kind:'message'|'pause'|'resume';text?:string;createdAt:number}
export interface ButlerHost {id:string;accountId:string;name:string;lastSeenAt:number}
export interface ButlerFeedback {id:string;accountId:string;targetKind:'goal'|'brief'|'skill';targetId:string;rating:'useful'|'not-useful'|'not-my-need';comment?:string;createdAt:number}
export interface ButlerAudit {id:string;accountId:string;jobId?:string;at:number;kind:'inference'|'model'|'research'|'collection'|'control'|'feedback'|'work';title:string;detail:string;sourceIds?:string[];model?:string;status:'planned'|'completed'|'failed'|'blocked'}

export interface ButlerRuntimeSnapshot {
  brain: ButlerBrainState;
  deviceId?: string;
  canHost?: boolean;
  host: {status:'local'|'connected'|'offline'|'unavailable';deviceId?:string;deviceName?:string;lastSeenAt?:number};
  busy: boolean;
  error?: string;
  /** Device-local collection consent and actual availability; never cloud-synced. */
  sources: Partial<Record<ButlerSource,{available:boolean;consented:boolean;note?:string;allowlist?:string[];denylist?:string[];apps?:{id:string;name:string}[]}>>;
  privacy?:ButlerPrivacyPolicy;
  background?:{supported:boolean;unrestricted:boolean;note?:string};
  nativeClients?: ClientStatus[];
}

export type ButlerRuntimeAction =
  | {kind:'add-need';text:string}
  | {kind:'review-goal';goalId:string;decision:'confirm'|'dismiss'|'correct';correction?:string}
  | {kind:'review-skill';proposalId:string;decision:'accept'|'dismiss'}
  | {kind:'feedback';targetKind:'goal'|'brief'|'skill';targetId:string;rating:'useful'|'not-useful'|'not-my-need';comment?:string}
  | {kind:'set-device-consent';source:ButlerSource;consented:boolean}
  | {kind:'configure-source';source:ButlerSource;allowlist:string[];denylist?:string[]}
  | {kind:'configure-privacy';policy:ButlerPrivacyPolicy}
  | {kind:'open-background-settings'}
  | {kind:'list-source-apps'}
  | {kind:'install-browser-extension'}
  | {kind:'select-host';deviceId:string}
  | {kind:'refresh'} | {kind:'analyze-now'} | {kind:'generate-brief';period:'morning'|'evening'}
  | {kind:'import-link';url:string}
  | {kind:'run-research';goalId:string}
  | {kind:'run-work';goalId:string}
  | {kind:'work-command';jobId:string;command:'message'|'pause'|'resume';text?:string}
  | {kind:'retry-job';jobId:string}
  | {kind:'answer-proposal';jobId:string;decision:'accept'|'decline'}
  | {kind:'forget-signals';signalIds:string[]}
  | {kind:'forget-goal';goalId:string}
  | {kind:'forget-all'}
  | {kind:'consent';granted:boolean}
  | {kind:'pause'} | {kind:'resume'} | {kind:'turn-off'};

export interface ButlerRuntimeController {
  getSnapshot():ButlerRuntimeSnapshot;
  subscribe(listener:()=>void):()=>void;
  action(action:ButlerRuntimeAction):Promise<void>;
}

export function emptyButlerBrain(accountId:string):ButlerBrainState {
  return {schema:1,accountId,signals:[],goals:[],briefs:[],skillProposals:[],actionGrants:[],updatedAt:0};
}

export const DEFAULT_BUTLER_PREFERENCES:ButlerProactivePreferences = {
  enabled:false,paused:false,sources:{wickrun:true},backend:{kind:'route-group',routeGroupId:'',effort:'medium'},
  maxTokensPerDay:12000,cadence:'twice-daily',morning:'08:00',evening:'18:00',
  timezone:'UTC',allowResearch:true,allowRoutineExecution:false,maxWorkPerDay:3,externalUnderstanding:'redacted-context',learnHabits:true,
};

/** Remove raw links, identifiers and prompt-control text before a signal can leave a device. */
export function modelSafeSummary(raw:string,maxLength=240):string {
  const noUrls=String(raw??'').replace(/https?:\/\/[^\s<>]+/gi,'[link]').replace(/\b(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\s<>]+/g,'[local path]');
  const noIdentity=noUrls.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[email]')
    .replace(/\b(?:\+?\d[\d ().-]{8,}\d)\b/g,'[phone]');
  const redacted=redactSecrets(noIdentity).text;
  return redacted.replace(/<\/?(?:system|developer|assistant|user|tool)[^>]*>/gi,'')
    .replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,maxLength);
}

/** Collector input stays local. Only this bounded projection may enter the shared brain. */
export function projectButlerSignal(input:Omit<ButlerSignal,'topic'|'intent'|'summary'|'sourceLabel'|'sourceRef'|'modelSafe'> &
 {topic:string;intent:string;summary:string;sourceLabel:string;sourceRef?:string},
 consent:Partial<Record<ButlerSource,boolean>>,deviceConsent:Partial<Record<ButlerSource,boolean>>):ButlerSignal|null {
  const validId=(s:unknown):s is string=>typeof s==='string'&&/^[a-zA-Z0-9:_-]{1,120}$/.test(s);
  if (!validId(input.id)||!validId(input.accountId)||!BUTLER_SOURCES.includes(input.source)||
    !Number.isFinite(input.observedAt)||input.observedAt<=0||
    !['low','medium','high'].includes(input.confidence)||!['user-stated','behavior','result'].includes(input.basis)||
    !consent[input.source] || (input.source!=='wickrun' && !deviceConsent[input.source])) return null;
  const topic=modelSafeSummary(input.topic,80),intent=modelSafeSummary(input.intent,120),summary=modelSafeSummary(input.summary,240);
  if(!topic || !summary || [topic,intent,summary].some(s=>s.includes('[REDACTED]')))return null;
  const sourceLabel=modelSafeSummary(input.sourceLabel,60);
  const sourceRef=input.sourceRef && /^[a-zA-Z0-9:_-]{1,120}$/.test(input.sourceRef) ? input.sourceRef : undefined;
  return {id:input.id,accountId:input.accountId,source:input.source,sourceLabel,sourceRef,topic,intent,summary,
    observedAt:input.observedAt,confidence:input.confidence,basis:input.basis,modelSafe:true};
}

export function sameAccountEvidence(brain:ButlerBrainState,ids:string[]):ButlerSignal[] {
  const wanted=new Set(ids);
  return brain.signals.filter(s=>s.accountId===brain.accountId && wanted.has(s.id));
}

/** Never promote a model hypothesis to a confirmed goal without user review. */
export function addGoalProposal(brain:ButlerBrainState,candidate:Omit<ButlerGoal,'status'|'accountId'|'updatedAt'>,now=Date.now()):ButlerBrainState {
  const evidence=sameAccountEvidence(brain,candidate.evidenceIds);
  if(!evidence.length || evidence.length!==new Set(candidate.evidenceIds).size) return brain;
  const title=modelSafeSummary(candidate.title,100),hypothesis=modelSafeSummary(candidate.hypothesis,400);
  if(!title||!hypothesis||brain.goals.some(g=>g.id===candidate.id || (g.status!=='dismissed'&&g.title.toLocaleLowerCase()===title.toLocaleLowerCase())))return brain;
  const confidence:ButlerConfidence = candidate.confidence==='high' && !evidence.some(s=>s.basis==='user-stated') ? 'medium' : candidate.confidence;
  return {...brain,goals:[...brain.goals,{id:candidate.id,accountId:brain.accountId,title,hypothesis,evidenceIds:[...new Set(candidate.evidenceIds)],
    confidence,status:'proposed',updatedAt:now}],updatedAt:now};
}

export function reviewGoal(brain:ButlerBrainState,goalId:string,decision:'confirm'|'dismiss'|'correct',correction='',now=Date.now()):ButlerBrainState {
  const goal=brain.goals.find(g=>g.id===goalId && g.accountId===brain.accountId);
  if(!goal || (decision==='correct'&&!modelSafeSummary(correction)))return brain;
  return {...brain,goals:brain.goals.map(g=>g!==goal?g:{...g,status:decision==='confirm'?'confirmed':decision==='dismiss'?'dismissed':'corrected',
    userCorrection:decision==='correct'?modelSafeSummary(correction,400):g.userCorrection,updatedAt:now,...(decision==='dismiss'?{dismissedAt:now}:{})}),updatedAt:now};
}

export function actionGrantMatches(grant:ButlerActionGrant,request:Pick<ButlerActionGrant,'accountId'|'action'|'account'|'target'|'amount'|'currency'>,now=Date.now()):boolean {
  return !grant.consumedAt && grant.expiresAt>now && grant.accountId===request.accountId && grant.action===request.action &&
    grant.account===request.account && grant.target===request.target && grant.amount===request.amount && grant.currency===request.currency &&
    Number.isFinite(request.amount) && request.amount>0;
}

/** Revocation removes derived records, not just the collection toggle. */
export function revokeButlerSource(brain:ButlerBrainState,source:ButlerSource,now=Date.now()):ButlerBrainState {
  const signals=brain.signals.filter(s=>s.source!==source && s.accountId===brain.accountId);
  const kept=new Set(signals.map(s=>s.id));
  return {...brain,signals,
    goals:brain.goals.filter(g=>g.accountId===brain.accountId && g.evidenceIds.every(id=>kept.has(id))),
    briefs:brain.briefs.filter(b=>b.accountId===brain.accountId).map(b=>({...b,items:b.items.filter(i=>i.evidenceIds.every(id=>kept.has(id)))})).filter(b=>b.items.length>0),
    skillProposals:brain.skillProposals.filter(s=>s.accountId===brain.accountId && s.evidenceIds.every(id=>kept.has(id))),
    updatedAt:now};
}

export function reviewSkillProposal(brain:ButlerBrainState,id:string,decision:'accept'|'dismiss',now=Date.now()):ButlerBrainState {
  const proposal=brain.skillProposals.find(s=>s.id===id && s.accountId===brain.accountId && s.status==='proposed');
  if(!proposal || !sameAccountEvidence(brain,proposal.evidenceIds).length)return brain;
  return {...brain,skillProposals:brain.skillProposals.map(s=>s!==proposal?s:{...s,status:decision==='accept'?'accepted':'dismissed',reviewedAt:now}),updatedAt:now};
}

export function addButlerBrief(brain:ButlerBrainState,brief:ButlerBrief):ButlerBrainState {
  if(brief.accountId!==brain.accountId || brain.briefs.some(b=>b.id===brief.id))return brain;
  const ids=new Set(sameAccountEvidence(brain,brain.signals.map(s=>s.id)).map(s=>s.id));
  const items=brief.items.filter(i=>i.evidenceIds.length>0 && i.evidenceIds.every(id=>ids.has(id))).map(i=>({
    id:i.id,kind:i.kind,title:modelSafeSummary(i.title,100),summary:modelSafeSummary(i.summary,1200),
    goalId:i.goalId,evidenceIds:[...new Set(i.evidenceIds)],result:safeResultRef(i.result),
  })).filter(i=>i.title && i.summary && !i.summary.includes('[REDACTED]'));
  if(!items.length)return brain;
  const greeting=brief.greeting?modelSafeSummary(brief.greeting,300):'';
  return {...brain,briefs:[...brain.briefs,{id:brief.id,accountId:brain.accountId,period:brief.period,createdAt:brief.createdAt,...(greeting&&!greeting.includes('[REDACTED]')?{greeting}:{}),items}],updatedAt:Math.max(brain.updatedAt,brief.createdAt)};
}

/** When a signal id was last forgotten (directly or by "forget everything"); 0 if never. */
export function forgottenBefore(brain:Pick<ButlerBrainState,'forgotten'|'accountId'>,id:string):number {
  let at=0;
  for(const f of brain.forgotten??[])if(f.accountId===brain.accountId&&(f.id===id||f.id==='*')&&f.at>at)at=f.at;
  return at;
}

/** Drop what a forget covers and every record that only stood on it. */
function withoutSignals(brain:ButlerBrainState,remove:Set<string>,now:number):ButlerBrainState {
  const signals=brain.signals.filter(s=>!remove.has(s.id));
  const kept=new Set(signals.map(s=>s.id));
  const keep=(ids:string[])=>ids.filter(id=>kept.has(id));
  const goals=brain.goals.map(g=>({...g,evidenceIds:keep(g.evidenceIds)})).filter(g=>g.evidenceIds.length>0);
  const briefs=brain.briefs.map(b=>({...b,items:b.items.map(i=>({...i,evidenceIds:keep(i.evidenceIds)})).filter(i=>i.evidenceIds.length>0)})).filter(b=>b.items.length>0);
  const skillProposals=brain.skillProposals.map(p=>({...p,evidenceIds:keep(p.evidenceIds)})).filter(p=>p.evidenceIds.length>0);
  const targets={goal:new Set(goals.map(g=>g.id)),brief:new Set(briefs.map(b=>b.id)),skill:new Set(skillProposals.map(p=>p.id))};
  return {...brain,signals,goals,briefs,skillProposals,
    // Feedback and action records about what was forgotten go with it.
    feedback:brain.feedback?.filter(f=>targets[f.targetKind].has(f.targetId)),
    audit:brain.audit?.flatMap(a=>!a.sourceIds?.length?[a]:keep(a.sourceIds).length?[{...a,sourceIds:keep(a.sourceIds)}]:[]),
    updatedAt:now};
}

/** Newest tombstones first, never dropping the latest "forget everything" or keeping what it already covers. */
export function capForgotten(list:ButlerForget[],limit=600):ButlerForget[] {
  const star=list.filter(f=>f.id==='*').sort((a,b)=>b.at-a.at)[0];
  const rest=list.filter(f=>f.id!=='*'&&(!star||f.at>star.at)).sort((a,b)=>b.at-a.at).slice(0,star?limit-1:limit);
  return [...(star?[star]:[]),...rest].sort((a,b)=>a.at-b.at);
}

export function forgetButlerSignals(brain:ButlerBrainState,ids:string[],now=Date.now()):ButlerBrainState {
  const wanted=new Set(ids.filter(id=>brain.signals.some(s=>s.id===id)));
  if(!wanted.size)return brain;
  const next=withoutSignals(brain,wanted,now);
  const forgotten=capForgotten([...(brain.forgotten??[]).filter(f=>!wanted.has(f.id)),...[...wanted].map(id=>({id,accountId:brain.accountId,at:now}))]);
  const goals=new Set(next.goals.map(g=>g.id));
  return {...next,forgotten,jobs:brain.jobs?.map(j=>j.goalId&&!goals.has(j.goalId)&&['proposed','queued'].includes(j.status)?{...j,status:'failed' as const,error:'依据已被删除。',updatedAt:now}:j)};
}

/** A fresh start: nothing learned before now is kept or learned again. Running Work is left to its own controls. */
export function forgetAllButler(brain:ButlerBrainState,now=Date.now()):ButlerBrainState {
  return {...brain,signals:[],goals:[],briefs:[],skillProposals:[],feedback:[],audit:[],
    jobs:(brain.jobs??[]).filter(j=>j.kind==='work'&&['running','waiting'].includes(j.status)),
    forgotten:[{id:'*',accountId:brain.accountId,at:now}],updatedAt:now};
}

/** Cloud sync gets the account's normalized brain, without device-local grants. */
export function projectButlerBrainForSync(brain:ButlerBrainState):ButlerBrainState {
  const accountId=brain.accountId;
  const consent=Object.fromEntries(BUTLER_SOURCES.map(s=>[s,true])) as Record<ButlerSource,boolean>;
  const forgotten=capForgotten((brain.forgotten??[]).filter(f=>f.accountId===accountId&&typeof f.id==='string'&&/^(?:\*|[a-zA-Z0-9:_-]{1,120})$/.test(f.id)&&Number.isFinite(f.at)&&f.at>0));
  // Rows made before "forget everything" (or that only stood on forgotten data) do not come back
  // from a device that had not heard of the forget yet.
  const star=forgottenBefore({accountId,forgotten},'*');
  const signals=retainButlerSignals({...brain,signals:brain.signals.filter(s=>s.accountId===accountId&&s.modelSafe===true&&!(forgottenBefore({accountId,forgotten},s.id)>=s.observedAt))
    .map(s=>projectButlerSignal(s,consent,consent)).filter((s):s is ButlerSignal=>!!s)},500);
  const ids=new Set(signals.map(s=>s.id));
  // A record is gone when its signal was forgotten and has not been learned again since.
  const gone=(id:string)=>!ids.has(id)&&forgottenBefore({accountId,forgotten},id)>0;
  const refs=(evidenceIds:string[])=>[...new Set(evidenceIds.filter(id=>ids.has(id)))];
  const goals=brain.goals.filter(g=>g.accountId===accountId&&refs(g.evidenceIds).length>0).slice(-200);
  const goalIds=new Set(goals.map(g=>g.id));
  const briefs=brain.briefs.filter(b=>b.accountId===accountId&&b.createdAt>star).slice(-100).map(b=>({
      id:b.id,accountId,period:b.period,createdAt:b.createdAt,...(b.greeting?{greeting:modelSafeSummary(b.greeting,300)}:{}),
      items:b.items.filter(i=>refs(i.evidenceIds).length>0).map(i=>({id:i.id,kind:i.kind,
        title:modelSafeSummary(i.title,100),summary:modelSafeSummary(i.summary,1200),goalId:i.goalId,
        evidenceIds:refs(i.evidenceIds),result:safeResultRef(i.result)})),
    })).filter(b=>b.items.length>0);
  const skills=brain.skillProposals.filter(s=>s.accountId===accountId&&s.createdAt>star&&refs(s.evidenceIds).length>0).slice(-100);
  const briefIds=new Set(briefs.map(b=>b.id)),skillIds=new Set(skills.map(s=>s.id));
  return {schema:1,accountId,
    signals:signals.map(({sourceRef:_,...safe})=>safe),
    goals:goals.map(g=>({
      id:g.id,accountId,title:modelSafeSummary(g.title,100),hypothesis:modelSafeSummary(g.hypothesis,400),
      evidenceIds:refs(g.evidenceIds),confidence:g.confidence,status:g.status,
      userCorrection:g.userCorrection?modelSafeSummary(g.userCorrection,400):undefined,
      updatedAt:g.updatedAt,dismissedAt:g.dismissedAt,
    })),
    briefs,
    skillProposals:skills.map(s=>({
      id:s.id,accountId,name:modelSafeSummary(s.name,60),description:modelSafeSummary(s.description,160),
      body:modelSafeSummary(s.body,2000),evidenceIds:refs(s.evidenceIds),status:s.status,
      createdAt:s.createdAt,reviewedAt:s.reviewedAt,
    })),
    actionGrants:[],
    // Running Work stays under its own controls; other jobs go with the goal they served.
    jobs:brain.jobs?.filter(j=>j.accountId===accountId&&(j.kind==='work'&&['running','waiting'].includes(j.status)||j.createdAt>star&&(!j.goalId||goalIds.has(j.goalId)))).slice(-200).map(j=>({id:j.id,accountId,kind:j.kind,goalId:j.goalId,
      period:j.period,status:j.status,createdAt:j.createdAt,updatedAt:j.updatedAt,error:j.error?modelSafeSummary(j.error,200):undefined,
      conversationId:j.conversationId?modelSafeSummary(j.conversationId,120):undefined,summary:j.summary?modelSafeSummary(j.summary,800):undefined,
      automatic:j.automatic===true,...(j.proposal?{proposal:true}:{}),commands:j.commands?.slice(-20).map(c=>({id:modelSafeSummary(c.id,120),kind:c.kind,text:c.text?modelSafeSummary(c.text,2000):undefined,createdAt:c.createdAt}))})),
    hosts:brain.hosts?.filter(h=>h.accountId===accountId).slice(-20).map(h=>({id:h.id,accountId,name:modelSafeSummary(h.name,80),lastSeenAt:h.lastSeenAt})),
    feedback:brain.feedback?.filter(f=>f.accountId===accountId&&f.createdAt>star&&(f.targetKind==='goal'?goalIds:f.targetKind==='brief'?briefIds:skillIds).has(f.targetId)).slice(-300).map(f=>({id:f.id,accountId,targetKind:f.targetKind,
      targetId:f.targetId,rating:f.rating,comment:f.comment?modelSafeSummary(f.comment,500):undefined,createdAt:f.createdAt})),
    audit:brain.audit?.filter(a=>a.accountId===accountId&&a.at>star&&!(a.sourceIds?.length&&a.sourceIds.every(gone))).slice(-500).map(a=>({id:a.id,accountId,jobId:a.jobId,at:a.at,
      kind:a.kind,title:modelSafeSummary(a.title,100),detail:modelSafeSummary(a.detail,500),
      sourceIds:a.sourceIds?.filter(id=>ids.has(id)),model:a.model?modelSafeSummary(a.model,100):undefined,status:a.status})),
    ...(forgotten.length?{forgotten:forgotten.map(f=>({id:f.id,accountId,at:f.at}))}:{}),
    updatedAt:brain.updatedAt};
}

function safeResultRef(result:ButlerResultRef|undefined):ButlerResultRef|undefined {
  if(!result||!['conversation','team-run','artifact','url'].includes(result.kind)||!modelSafeSummary(result.id,120))return undefined;
  if(result.kind!=='url')return {kind:result.kind,id:modelSafeSummary(result.id,120)};
  try {const url=new URL(result.url??'');if(url.protocol!=='https:'||url.username||url.password)return undefined;
    url.search='';url.hash='';return {kind:'url',id:modelSafeSummary(result.id,120),url:url.toString()};}
  catch{return undefined;}
}
