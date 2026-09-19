/* ------------------------------------------------------------------
 * 跨设备合并。
 *
 * 目标只有一个：两台设备互相同步之后，双方手里的东西必须一模一样，
 * 而且跟「谁先合并、合并了几次」无关。做不到这一点的合并，用户会看到
 * 会话在两台机器之间来回抖 —— 那比不同步还糟。
 *
 * 所以这里所有的取舍都服从「确定性」：
 *   - 时间戳大的赢
 *   - 时间戳一样就比内容，内容序列化后字典序小的赢
 * 第二条看起来很随意，它的作用不是「选对」，是「两边选得一样」。时间戳
 * 撞车本来就无从判断谁新，随便挑一个但两边挑得一致，胜过各挑各的。
 *
 * 时钟是不可信的：两台设备的系统时间可以差几分钟，也可以有人手动改过。
 * 这里不试图纠正它 —— 纠正需要一个权威时钟，而这套东西没有服务器。
 * 能做的是把影响限制在「单条记录选错版本」，而不是「整个库被旧数据盖掉」，
 * 所以合并一律是逐条的，从来没有整份替换。
 * ------------------------------------------------------------------ */

export interface Identified {
  id: string;
}

/** 删除标记。没有它，删掉的东西会被另一台设备原样同步回来。 */
export interface Tombstone {
  id: string;
  deletedAt: number;
  /** 哪台设备删的，只用于排查，不参与判定 */
  by?: string;
}

export interface SyncCollection<T extends Identified> {
  items: T[];
  tombstones: Tombstone[];
}

export interface MergeOptions<T extends Identified> {
  /** 取这条记录的更新时间。没有更新时间的集合（比如技能）传创建时间。 */
  stampOf: (item: T) => number;
  /** 墓碑保留多久。过了就清掉，否则墓碑会无限增长。 */
  tombstoneTtlMs?: number;
  now?: number;
}

/** 墓碑保留 90 天，和观测记录的保留期一致。 */
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** 稳定序列化：键排序后再 JSON，保证两台设备算出同一个字符串。 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * 两条同 id 记录里挑一条。
 * 时间戳大的赢；一样大就比内容字典序 —— 只为让两边挑得一样。
 */
export function pick<T>(a: T, b: T, stamp: (x: T) => number): T {
  const sa = stamp(a);
  const sb = stamp(b);
  if (sa !== sb) return sa > sb ? a : b;
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return a;
  return ca < cb ? a : b;
}

export function mergeCollection<T extends Identified>(
  local: SyncCollection<T>,
  remote: SyncCollection<T>,
  opts: MergeOptions<T>,
): SyncCollection<T> {
  const { stampOf } = opts;
  const now = opts.now ?? Date.now();
  const ttl = opts.tombstoneTtlMs ?? TOMBSTONE_TTL_MS;

  // 墓碑先并起来：同一条被两边都删过，取更早的那次删除时间。取早的而不是
  // 取晚的，是因为「删除发生在什么时候」决定了它能不能压住一次编辑，
  // 取早的更保守 —— 编辑更容易赢，数据更不容易丢。
  const graves = new Map<string, Tombstone>();
  for (const t of [...(local.tombstones ?? []), ...(remote.tombstones ?? [])]) {
    if (!t || typeof t.id !== 'string') continue;
    const prev = graves.get(t.id);
    if (!prev || t.deletedAt < prev.deletedAt) graves.set(t.id, t);
  }

  const byId = new Map<string, T>();
  for (const item of local.items ?? []) if (item && typeof item.id === 'string') byId.set(item.id, item);
  for (const item of remote.items ?? []) {
    if (!item || typeof item.id !== 'string') continue;
    const mine = byId.get(item.id);
    byId.set(item.id, mine ? pick(mine, item, stampOf) : item);
  }

  const items: T[] = [];
  for (const [id, item] of byId) {
    const grave = graves.get(id);
    if (!grave) {
      items.push(item);
      continue;
    }
    // 删除之后又改过 —— 那次编辑是更晚的意图，记录复活，墓碑作废。
    // 反过来，删除不早于最后一次编辑，就认删除。
    if (stampOf(item) > grave.deletedAt) {
      graves.delete(id);
      items.push(item);
    }
  }

  // 墓碑过期就清掉。清早了会让一条老记录从另一台设备复活，所以 TTL 要比
  // 两台设备之间可能的最长失联时间宽。90 天已经很宽了。
  const tombstones = [...graves.values()].filter((t) => now - t.deletedAt < ttl);

  items.sort((a, b) => a.id.localeCompare(b.id));
  tombstones.sort((a, b) => a.id.localeCompare(b.id));
  return { items, tombstones };
}

/**
 * 观测记录的合并。
 *
 * 它不是普通集合：tasks 逐条合是对的，但 droppedTasks / writeFailures
 * 这类计数器不能相加 —— 同一份数据同步两次就会翻倍，而这些数字是给
 * 「路由做成率」当分母用的，翻倍等于把统计结论改掉。所以计数器取两边
 * 的最大值：它们本来就是单调递增的本地计数，取 max 至少不会凭空变大。
 *
 * epoch 也不合并。epoch 换了代表用户清过记录，两边的 epoch 不一样时
 * 以本地为准 —— 清记录是一个明确的本地意图，不该被另一台设备撤销。
 */
export interface ObservationLike {
  version: 1;
  epoch: string;
  createdAt: number;
  tasks: Array<{ id: string; lastAt?: number; startedAt?: number }>;
  droppedTasks: number;
  writeFailures: number;
  ignoredRecordIds: string[];
  clearedAt?: number;
  lastError?: string;
}

export function mergeObservations<T extends ObservationLike>(
  local: T,
  remote: T,
  opts: { tombstones?: Tombstone[]; now?: number } = {},
): T {
  const stampOf = (t: { lastAt?: number; startedAt?: number }) => t.lastAt ?? t.startedAt ?? 0;
  const merged = mergeCollection(
    { items: local.tasks ?? [], tombstones: opts.tombstones ?? [] },
    { items: remote.tasks ?? [], tombstones: [] },
    { stampOf, now: opts.now },
  );
  return {
    ...local,
    tasks: merged.items,
    // 单调计数器取 max，不相加 —— 相加会在重复同步时虚增，而它们是分母。
    droppedTasks: Math.max(local.droppedTasks ?? 0, remote.droppedTasks ?? 0),
    writeFailures: Math.max(local.writeFailures ?? 0, remote.writeFailures ?? 0),
    // 忽略名单取并集：任何一台设备说「这条别算」，就都别算。
    ignoredRecordIds: [...new Set([...(local.ignoredRecordIds ?? []), ...(remote.ignoredRecordIds ?? [])])].sort(),
    createdAt: Math.min(local.createdAt ?? 0, remote.createdAt ?? 0) || local.createdAt,
    epoch: local.epoch,
  };
}

/**
 * 整份设置的合并：白名单字段按整体的时间戳取新的那一份。
 *
 * 不做字段级合并，是因为设置里的字段互相之间有约束（比如 failover 列表
 * 引用 keyProfiles 里的 id）。逐字段各取各的新值，能拼出一份两边都没有
 * 出现过、而且自相矛盾的设置。整体取新虽然会丢掉另一边的改动，但至少
 * 丢掉的是一份自洽的旧设置。
 *
 * 这个函数只负责挑，挑完还要过 graftDeviceLocal 把本机字段接回去。
 */
export function pickSettings<T>(
  local: { value: T; updatedAt: number },
  remote: { value: T; updatedAt: number },
): T {
  return pick(local, remote, (x) => x.updatedAt).value;
}
