import type { TeamProject, TeamTask } from './collaboration';
import type { SharedConnection, SharedItem } from './shared-resources';

type Receipt = { id: unknown; payload?: unknown; actorId?: unknown; actorName?: unknown; createdAt?: unknown };
type LocalTarget = { projectId: string; workflowId: string; agentId: string };
export type HandoffResolution =
  | { kind: 'task'; projectId: string; task: TeamTask; existing: boolean; reviewed: boolean }
  | { kind: 'project'; projectId: string }
  | { kind: 'review'; reason: string; targetTitle: string; targetAgentId?: string; targetWorkflowId?: string };

export interface HandoffInput {
  receipt: Receipt;
  connection: SharedConnection;
  target?: SharedItem;
  canonicalId: string;
  teams: Record<string, TeamProject>;
  localProjectIds: readonly string[];
  /** Only set after the recipient explicitly selects a local workflow and Agent. */
  selectedLocal?: LocalTarget;
}

const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Resolve remote intent into a local, unsent task. Shared IDs alone never grant local execution rights. */
export function resolveSharedHandoff(input: HandoffInput): HandoffResolution {
  const { receipt, connection, target, canonicalId, teams, localProjectIds, selectedLocal } = input;
  const targetTitle = target?.title ?? 'Shared target';
  const review = (reason: string): HandoffResolution => ({ kind: 'review', reason, targetTitle,
    targetAgentId: connection.targetAgentId, targetWorkflowId: target?.kind === 'workflow' ? target.sourceId : undefined });
  if (!str(receipt.id) || !str(canonicalId) || !target || connection.targetItemId !== target.id)
    return review('The handoff or receiving target could not be verified.');
  const payload = record(receipt.payload);
  const goal = str(payload.goal);
  if (!goal) return review('The handoff has no goal to review.');

  if (target.kind === 'project' && !selectedLocal) {
    if (target.ownerId === canonicalId && target.sourceId && localProjectIds.includes(target.sourceId))
      return { kind: 'project', projectId: target.sourceId };
    return review('This shared project is not a local project owned by your account.');
  }
  if (target.kind !== 'workflow' && !selectedLocal) return review('Choose one of your local workflows and Agents to receive this handoff.');

  let projectId: string | undefined;
  let workflowId: string | undefined;
  let agentId: string | undefined;
  if (selectedLocal) {
    ({ projectId, workflowId, agentId } = selectedLocal);
  } else if (target.kind === 'workflow' && target.ownerId === canonicalId && target.sourceId && connection.targetAgentId) {
    const matched = Object.entries(teams).filter(([, team]) => team.workflows.some(w => w.id === target.sourceId)
      && team.members.some(m => m.id === connection.targetAgentId));
    if (matched.length === 1) {
      projectId = matched[0][0]; workflowId = target.sourceId; agentId = connection.targetAgentId;
    }
  }
  if (!projectId || !workflowId || !agentId) return review('The receiving Agent or workflow is not available locally. Choose your own target before opening this handoff.');
  const team = teams[projectId];
  if (!team || !localProjectIds.includes(projectId) || !team.workflows.some(w => w.id === workflowId && !w.archived)
    || !team.members.some(m => m.id === agentId))
    return review('The selected local workflow or Agent is no longer available.');

  const id = `shared-handoff-${str(receipt.id)}`;
  const prior = Object.entries(teams).find(([, candidate]) => candidate.tasks.some(t => t.id === id));
  if (prior && prior[0] !== projectId)
    return review('This handoff already has a draft in another local project. Open that draft before changing the target.');
  const existing = team.tasks.find(t => t.id === id);
  if (existing) {
    if (existing.workflowId !== workflowId || existing.ownerId !== agentId)
      return review('This handoff already has a draft for another local target. Review it before changing the target.');
    return { kind: 'task', projectId, task: existing, existing: true, reviewed: Boolean(selectedLocal) };
  }
  const summary = str(payload.summary);
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts.map(a => {
    const file = record(a), name = str(file.name), text = str(file.text);
    return [name, text].filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n') : '';
  const at = Number(receipt.createdAt) || Date.now();
  const author = str(receipt.actorName) || str(receipt.actorId) || 'Shared sender';
  const provenance = `Shared handoff ${str(receipt.id)} from ${str(receipt.actorId) || author}; source ${connection.sourceItemId}; target ${target.id}.`;
  const task: TeamTask = { id, title: goal.replace(/\s+/g, ' ').slice(0, 80), goal, acceptance: '',
    workflowId, ownerId: agentId, status: '草稿', intent: 'explore', createdAt: at,
    entries: [{ id: `${id}-source`, at, author, kind: 'handoff', text: [provenance, summary, artifacts].filter(Boolean).join('\n\n') }] };
  return { kind: 'task', projectId, task, existing: false, reviewed: Boolean(selectedLocal) };
}
