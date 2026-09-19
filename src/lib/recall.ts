import type { RunRecord } from '../types';
import type { ObservationStore } from './observations';
import { verdictOf } from './routing-memory';

/* ------------------------------------------------------------------ *
 * 回想过去的任务
 *
 * 约定是「新会话与旧会话除同属一个项目外不应有任何关联」。这条要守住 ——
 * 默认零关联是对的，自动把旧对话塞进新对话只会污染上下文。
 *
 * 但零关联和「查不到」是两件事。这里给的是中间态，抄的是 ChatGPT Work 的
 * Personal Context：不默认关联，模型想不起来时**显式调用**才去查，
 * 返回的是压缩过的摘要而不是原文。三个好处：约定保住了、用户在步骤里看得见、
 * 调用发生在消息尾部，不动 system 前缀，缓存不受影响。
 *
 * 检索范围跟着项目走：在项目里就只查这个项目，不在项目里就只查同样不属于
 * 任何项目的。跨项目翻找不是「想不起来」，那是另一件事。
 * ------------------------------------------------------------------ */

export interface RecalledTask {
  id: string;
  title: string;
  at: number;
  model: string;
  /** 做成 / 没做成 / 说不清 —— 跟记分用同一套判据，不另立标准 */
  verdict: 'done' | 'not_done' | 'unknown';
  /** 用户后来怎么说的 */
  feedback?: string;
  /** 验收条件的一句话摘要 */
  acceptance?: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

export function recallFrom(
  records: RunRecord[],
  store: ObservationStore | null,
  args: { query: string; projectId?: string | null; limit?: number; excludeConversationId?: string },
): RecalledTask[] {
  const query = String(args.query ?? '').trim();
  if (!query) return [];
  const terms = query.split(/\s+/).map(norm).filter(Boolean);
  const scope = args.projectId ?? null;
  const limit = Math.max(1, Math.min(10, args.limit ?? 5));
  const byRecord = new Map((store?.tasks ?? []).map((t) => [t.recordId, t]));

  return records
    .filter((r) => (r.projectId ?? null) === scope)
    .filter((r) => r.conversationId !== args.excludeConversationId)
    .map((r) => {
      const haystack = norm(`${r.title ?? ''} ${r.question?.content ?? ''}`);
      const hits = terms.filter((t) => haystack.includes(t)).length;
      return { record: r, hits };
    })
    .filter((x) => x.hits > 0)
    // 命中的词多的在前，同样多的按时间倒序 —— 最近的更可能还作数
    .sort((a, b) => b.hits - a.hits || (b.record.state?.at ?? 0) - (a.record.state?.at ?? 0))
    .slice(0, limit)
    .map(({ record }) => {
      const t = byRecord.get(record.id);
      const reqs = record.state?.requirements ?? [];
      return {
        id: record.id,
        title: (record.question?.content ?? record.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 160),
        at: record.state?.at ?? record.question?.createdAt ?? 0,
        model: record.config?.model ?? 'unknown',
        verdict: t ? verdictOf(t) : 'unknown',
        feedback: t?.feedback?.outcome,
        acceptance: reqs.length
          ? `${reqs.length} 条验收，通过 ${reqs.filter((r) => r.verification?.status === 'passed' && r.verification.revision === r.revision).length} 条`
          : undefined,
      };
    });
}
