import type { ChatMessage } from '../types';
import { recoveryInfo } from './delivery';
import { milestonePassed } from './task-progress';

/** A view of saved evidence, independent of provider and answer wording. Never starts another run. */
export function stageOutcome(answer: ChatMessage) {
  if (answer.role !== 'assistant' || answer.pending) return null;
  const state = answer.runState;
  const milestones = state?.milestones ?? answer.milestones ?? [];
  const requirements = state?.requirements ?? state?.delivery?.requirements ?? answer.delivery?.requirements ?? [];
  if (!milestones.length && !requirements.length && !(state?.steps ?? answer.steps)?.length && !state) return null;
  const passed = requirements.filter(r => r.verification?.revision === r.revision && r.verification.status === 'passed');
  const completed = milestones.filter(m => m.status === 'completed' && milestonePassed(m.id, requirements));
  const remaining = [...new Set([
    ...milestones.filter(m => !completed.includes(m)).map(m => m.title),
    ...requirements.filter(r => !passed.includes(r)).map(r => r.title),
  ])];
  const paused = state && state.status !== 'completed';
  const title = state?.uncertainCallId ? '阶段结论 · 有操作结果待核实'
    : state?.stoppedBy === 'user' ? '阶段结论 · 已按你的要求暂停'
    : paused ? '阶段结论 · 已暂停，进度已保存'
    : remaining.length ? '阶段结论 · 仍有未完成或待验证事项'
    : !requirements.length ? '阶段结论 · 本轮已结束，结果待确认'
    : '阶段结论 · 已列条件检查通过';
  return {
    title,
    completed: completed.map(m => m.title),
    programChecks: passed.filter(r => r.verification?.method === 'program').length,
    modelChecks: passed.filter(r => r.verification?.method === 'model').length,
    requirementCount: requirements.length,
    remaining,
    reason: paused ? state.reason : undefined,
    next: paused ? recoveryInfo(state).next : remaining.length ? '继续处理待办，并核实已有结果。'
      : '请查看本轮成果；这些记录仅覆盖已列出的条件。',
  };
}
