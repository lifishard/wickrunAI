import type { ChatMessage } from '../types';

/** Regeneration replays the original input, including media and quotes, not the current composer. */
export function replayUserQuestion(question: ChatMessage | undefined, content: string): ChatMessage | undefined {
  return question?.role === 'user' ? { ...question, content } : undefined;
}
