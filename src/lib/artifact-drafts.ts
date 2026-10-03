import { desktop } from './transport';
import type { BinarySnapshot } from './office-edit';

export interface TextRecovery { text: string; hash: string }
export interface OfficeRecovery { snapshot: BinarySnapshot; sheet: number; target: string; text: string; changed: Uint8Array | null; type: string; page: number; note: string; x: number; y: number }
export type DraftKind = 'text' | 'office';

// One queue also covers path aliases that the native journal normalizes.
let queue: Promise<unknown> = Promise.resolve();
let revision = 0;
const pending = new Map<string, { revision: number; kind: DraftKind; path: string; value: TextRecovery | OfficeRecovery; timer: ReturnType<typeof setTimeout>; waiters: { resolve: (v: unknown) => void; reject: (e: unknown) => void }[] }>();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => {}).then(action);
  queue = next;
  return next;
}
export function flushDrafts(): Promise<unknown> {
  for (const [key, entry] of [...pending].sort((a, b) => a[1].revision - b[1].revision)) {
    clearTimeout(entry.timer); pending.delete(key);
    void enqueue(() => desktop()!.artifactDraft('write', { kind: entry.kind, path: entry.path, value: entry.value }))
      .then(value => entry.waiters.forEach(w => w.resolve(value)), error => entry.waiters.forEach(w => w.reject(error)));
  }
  return queue;
}
export function readDraft<T extends TextRecovery | OfficeRecovery>(kind: DraftKind, path: string): Promise<T | null> {
  void flushDrafts().catch(() => {});
  return enqueue(() => desktop()!.artifactDraft('read', { kind, path }) as Promise<T | null>);
}
export function writeDraft(kind: DraftKind, path: string, value: TextRecovery | OfficeRecovery): Promise<unknown> {
  const key = kind + ':' + path;
  return new Promise((resolve, reject) => {
    const existing = pending.get(key);
    if (existing) { existing.value = value; existing.revision = ++revision; existing.waiters.push({ resolve, reject }); return; }
    pending.set(key, { revision: ++revision, kind, path, value, waiters: [{ resolve, reject }], timer: setTimeout(() => { void flushDrafts().catch(() => {}); }, 300) });
  });
}
export function removeDraft(kind: DraftKind, path: string): Promise<unknown> {
  void flushDrafts().catch(() => {});
  return enqueue(() => desktop()!.artifactDraft('remove', { kind, path })).catch(() => { throw Error('本地草稿清理失败，旧草稿可能在重启后再次出现，请重试清理。'); });
}
