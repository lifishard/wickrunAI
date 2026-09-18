import type { Attachment, MessageQuote } from '../types';

/** 生成期间又发的消息。conversationId 决定它属于哪个会话的队列。 */
export interface QueuedInput {
  toolsEnabled?: boolean;
  text: string;
  attachments: Attachment[];
  quotes: MessageQuote[];
  quoteOnly: boolean;
  conversationId: string | null;
}

/** 老数据里可能没写会话，按当前会话算。 */
function ownerOf(item: QueuedInput, activeId: string | null): string | null {
  return item.conversationId ?? activeId;
}

/** 当前会话自己排的队；index 是它在总队列里的位置，用来取消或立即送出。 */
export function conversationQueue(
  queue: QueuedInput[],
  activeId: string | null,
): { item: QueuedInput; index: number }[] {
  return queue
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => ownerOf(item, activeId) === activeId);
}

/**
 * 下一条该发的排队输入：它所属的会话既没有在跑，也没被挂起。
 * 别的会话正在跑不构成阻塞 —— 路由不同，额度各算各的。
 */
export function nextQueuedIndex(
  queue: QueuedInput[],
  state: { activeId: string | null; busyIds: Iterable<string>; pausedIds: Iterable<string> },
): number {
  const busy = new Set(state.busyIds);
  const paused = new Set(state.pausedIds);
  return queue.findIndex((item) => {
    const owner = ownerOf(item, state.activeId);
    return Boolean(owner) && !busy.has(owner!) && !paused.has(owner!);
  });
}
