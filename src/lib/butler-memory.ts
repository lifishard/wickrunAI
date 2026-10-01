import type { ButlerBrainState, ButlerGoal, ButlerSignal } from './proactive-butler';
import { modelSafeSummary } from './proactive-butler';

/** Pin the complete evidence of reviewed goals and accepted skills before recent observations. */
export function retainButlerSignals(brain: ButlerBrainState, limit = 500): ButlerSignal[] {
  const cap = Math.max(1, Math.floor(limit));
  const byId = new Map(brain.signals.filter(s => s.accountId === brain.accountId).map(s => [s.id, s]));
  const protectedIds = new Set<string>();
  for (const goal of brain.goals.filter(g => g.accountId === brain.accountId && g.status !== 'proposed'))
    for (const id of goal.evidenceIds) if (byId.has(id)) protectedIds.add(id);
  for (const skill of brain.skillProposals.filter(s => s.accountId === brain.accountId && s.status === 'accepted'))
    for (const id of skill.evidenceIds) if (byId.has(id)) protectedIds.add(id);
  const pinned = [...protectedIds].map(id => byId.get(id)!).sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id));
  const recent = [...byId.values()].filter(s => !protectedIds.has(s.id)).sort((a, b) => b.observedAt - a.observedAt || a.id.localeCompare(b.id));
  // If protected evidence alone exceeds the storage cap, surface the overflow to the caller.
  // Silently dropping one source would make later source revocation incomplete.
  if (pinned.length > cap) throw Error(`Butler reviewed evidence exceeds the ${cap}-signal retention limit`);
  return [...pinned, ...recent.slice(0, cap - pinned.length)].sort((a, b) => a.observedAt - b.observedAt || a.id.localeCompare(b.id));
}

const normalizeTitle = (value: string) => modelSafeSummary(value, 100).toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** A dismissal remains a durable negative preference even when the next inference paraphrases its title. */
export function repeatsDeniedGoal(brain: ButlerBrainState, candidate: Pick<ButlerGoal, 'title' | 'evidenceIds'>): boolean {
  const title = normalizeTitle(candidate.title);
  const ids = new Set(candidate.evidenceIds);
  return brain.goals.some(goal => goal.accountId === brain.accountId && goal.status === 'dismissed' &&
    (normalizeTitle(goal.title) === title || goal.evidenceIds.length > 0 &&
      goal.evidenceIds.filter(id => ids.has(id)).length >= Math.min(goal.evidenceIds.length, Math.max(1, ids.size))));
}

export interface ButlerMemoryView {
  signals: ButlerSignal[];
  reviewedGoals: { id: string; status: 'confirmed' | 'corrected' | 'dismissed'; title: string; intent: string; evidenceIds: string[] }[];
  recentGoals: { id: string; status: 'proposed'; title: string; intent: string; evidenceIds: string[] }[];
  feedback: { targetKind: 'goal' | 'brief' | 'skill'; targetId: string; rating: 'useful' | 'not-useful' | 'not-my-need'; comment?: string }[];
  acceptedSkills: { id: string; name: string; description: string; body: string; evidenceIds: string[] }[];
}

/** A bounded, sourced prompt view; not a replacement for the persisted brain or raw evidence. */
export function butlerMemoryView(brain: ButlerBrainState, signalLimit = 24): ButlerMemoryView {
  const cap = Math.max(1, Math.floor(signalLimit));
  const ownSignals = brain.signals.filter(s => s.accountId === brain.accountId && s.modelSafe === true);
  const byId = new Map(ownSignals.map(s => [s.id, s]));
  const reviewed = brain.goals.filter(g => g.accountId === brain.accountId && g.status !== 'proposed')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  const proposed = brain.goals.filter(g => g.accountId === brain.accountId && g.status === 'proposed')
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  const accepted = brain.skillProposals.filter(s => s.accountId === brain.accountId && s.status === 'accepted')
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const selected: ButlerSignal[] = [], seen = new Set<string>();
  const take = (id: string) => { const signal = byId.get(id); if (signal && !seen.has(id) && selected.length < cap) { selected.push(signal); seen.add(id); } };
  // Reserve a representative source for each durable decision before filling with recent activity.
  for (const goal of reviewed.slice(0,Math.max(1,Math.floor(cap/2)))) { const id = goal.evidenceIds.find(candidate => byId.has(candidate)); if (id) take(id); }
  for (const skill of accepted.slice(0,Math.max(1,Math.floor(cap/4)))) { const id = skill.evidenceIds.find(candidate => byId.has(candidate)); if (id) take(id); }
  for (const signal of [...ownSignals].sort((a, b) => b.observedAt - a.observedAt)) take(signal.id);
  const goalView = (goal: ButlerGoal) => ({id: goal.id, status: goal.status, title: modelSafeSummary(goal.title, 100),
    intent: modelSafeSummary(goal.userCorrection ?? goal.hypothesis, 220), evidenceIds: goal.evidenceIds.filter(id => byId.has(id)).slice(0, 12)});
  return {
    signals: selected,
    reviewedGoals: reviewed.map(goalView) as ButlerMemoryView['reviewedGoals'],
    recentGoals: proposed.map(goalView) as ButlerMemoryView['recentGoals'],
    feedback: (brain.feedback ?? []).filter(f => f.accountId === brain.accountId).sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20).map(f => ({targetKind: f.targetKind, targetId: f.targetId, rating: f.rating,
        comment: f.comment ? modelSafeSummary(f.comment, 160) : undefined})),
    acceptedSkills: accepted.map(s => ({id: s.id, name: modelSafeSummary(s.name, 60),
      description: modelSafeSummary(s.description, 160), body: modelSafeSummary(s.body, 500),
      evidenceIds: s.evidenceIds.filter(id => byId.has(id)).slice(0, 12)})),
  };
}

/** A small initial context with explicit access to full, individually addressable records. */
export function butlerMemoryCapsule(brain:ButlerBrainState,maxChars=4000) {
  const view=butlerMemoryView(brain,12);
  const capsule={...view,reviewedGoals:view.reviewedGoals.slice(0,8),recentGoals:view.recentGoals.slice(0,4),feedback:view.feedback.slice(0,6),acceptedSkills:view.acceptedSkills.slice(0,2),
    archive:'Full records: read_source_text({id:"signal:<id>" | "goal:<id>" | "skill:<id>" | "feedback:<id>",part:1}). A complete archive is also available as butler-brain. Summaries do not replace archived evidence.',
    counts:{signals:brain.signals.length,goals:brain.goals.length,skills:brain.skillProposals.length,feedback:brain.feedback?.length??0}};
  while(JSON.stringify(capsule).length>maxChars){
    if(capsule.recentGoals.length) capsule.recentGoals.pop();
    else if(capsule.signals.length>1)capsule.signals.pop();
    else if(capsule.acceptedSkills.length)capsule.acceptedSkills.pop();
    else if(capsule.feedback.length)capsule.feedback.pop();
    else if(capsule.reviewedGoals.length)capsule.reviewedGoals.pop();
    else break;
  }
  return capsule;
}

export function butlerMemorySources(brain:ButlerBrainState):{id:string;text:string}[] {
  const groups=[['signal',brain.signals],['goal',brain.goals],['skill',brain.skillProposals],['feedback',brain.feedback??[]]] as const;
  return [{id:'butler-brain',text:JSON.stringify({signals:brain.signals,goals:brain.goals,skills:brain.skillProposals,feedback:brain.feedback??[]})},
    ...groups.flatMap(([kind,items])=>items.map(item=>({id:`${kind}:${item.id}`,text:JSON.stringify(item)})))];
}
