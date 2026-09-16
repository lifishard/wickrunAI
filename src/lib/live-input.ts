import type { RunState, ChatMessage } from '../types';
import { formatUserAnswers, validateUserAnswers, type UserQuestionAnswers } from './user-questions';

/** An asynchronous answer is a new user message, never a second result for the old tool call. */
export function acceptLiveAnswer(state:RunState,id:string,answers:UserQuestionAnswers):void {
  const pending=state.userQuestion;
  if(!pending||pending.request.id!==id||!pending.nonBlocking)throw Error('该问题已处理或需要从保存的任务继续');
  const normalized=validateUserAnswers(pending.request,answers);
  const input:ChatMessage={id:`answer-${pending.request.id}`,role:'user',content:formatUserAnswers(pending.request,normalized),createdAt:Date.now()};
  state.userQuestionHistory=[...(state.userQuestionHistory??[]),{request:structuredClone(pending.request),answers:normalized,at:Date.now()}];
  state.supplementalInputs=[...(state.supplementalInputs??[]),input];
  state.pendingInputMessages=[...(state.pendingInputMessages??[]),input];state.replanPending=true;
  state.userQuestion=undefined;if(state.waitKind==='question')state.waitKind=undefined;
}

export function consumeLiveInputs(state:RunState):void {
  if(!state.pendingInputMessages?.length)return;
  state.working.push(...state.pendingInputMessages);
  state.requirementSourceIds=[...new Set([...(state.requirementSourceIds??[]),...state.pendingInputMessages.map(m=>m.id)])];
  state.pendingInputMessages=[];state.replanPending=false;
}
