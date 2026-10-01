import { redactSecrets } from './memory-core';
import type { ClientSelection } from './connections';
import type { EffortLevel } from './effort';

/** The synced brain contains bounded observations, never raw app logs or credentials. */
export type ButlerSource = 'wickrun' | 'browser' | 'desktop' | 'android' | 'integration' | 'share';
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
  allowResearch: boolean;
  /** Financial and negotiation actions always need their own exact grant. */
  allowRoutineExecution: boolean;
}

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
  updatedAt: number;
}

export interface ButlerRuntimeSnapshot {
  brain: ButlerBrainState;
  host: {status:'local'|'connected'|'offline'|'unavailable';deviceName?:string;lastSeenAt?:number};
  busy: boolean;
  error?: string;
  /** Device-local collection consent and actual availability; never cloud-synced. */
  sources: Partial<Record<ButlerSource,{available:boolean;consented:boolean;note?:string}>>;
}

export type ButlerRuntimeAction =
  | {kind:'review-goal';goalId:string;decision:'confirm'|'dismiss'|'correct';correction?:string}
  | {kind:'review-skill';proposalId:string;decision:'accept'|'dismiss'}
  | {kind:'set-device-consent';source:ButlerSource;consented:boolean}
  | {kind:'run-research';goalId:string}
  | {kind:'pause'} | {kind:'resume'} | {kind:'turn-off'};

export function emptyButlerBrain(accountId:string):ButlerBrainState {
  return {schema:1,accountId,signals:[],goals:[],briefs:[],skillProposals:[],actionGrants:[],updatedAt:0};
}

export const DEFAULT_BUTLER_PREFERENCES:ButlerProactivePreferences = {
  enabled:false,paused:false,sources:{wickrun:true},backend:{kind:'route-group',routeGroupId:'',effort:'medium'},
  maxTokensPerDay:12000,cadence:'twice-daily',morning:'08:00',evening:'18:00',
  timezone:'UTC',allowResearch:true,allowRoutineExecution:false,
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
  if (!input.accountId || !consent[input.source] || (input.source!=='wickrun' && !deviceConsent[input.source])) return null;
  const topic=modelSafeSummary(input.topic,80),intent=modelSafeSummary(input.intent,120),summary=modelSafeSummary(input.summary,240);
  if(!topic || !summary || summary.includes('[REDACTED]'))return null;
  const sourceLabel=modelSafeSummary(input.sourceLabel,60);
  const sourceRef=input.sourceRef && /^[a-zA-Z0-9:_-]{1,120}$/.test(input.sourceRef) ? input.sourceRef : undefined;
  return {...input,topic,intent,summary,sourceLabel,sourceRef,modelSafe:true};
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
  return {...brain,goals:[...brain.goals,{...candidate,title,hypothesis,evidenceIds:[...new Set(candidate.evidenceIds)],confidence,status:'proposed',accountId:brain.accountId,updatedAt:now}],updatedAt:now};
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
