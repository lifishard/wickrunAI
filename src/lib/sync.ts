/* ------------------------------------------------------------------
 * 同步的编排层：把「读本地 → 过滤 → 封包 → 落点」和「落点 → 拆包 → 合并
 * → 写回本地」两条路串起来。
 *
 * 真正要紧的判断都不在这个文件里：
 *   - 什么能出门     → sync-policy.ts（白名单 + 发车前闸门）
 *   - 两份怎么合     → sync-merge.ts（确定性、幂等、方向无关）
 *   - 出门前怎么封   → electron/sync-crypto.cjs（scrypt + AES-256-GCM）
 * 这里只负责按顺序调用它们，并且保证顺序不会被绕过。
 * ------------------------------------------------------------------ */

import type { AppSettings, Conversation } from '../types';
import { getTransport, desktop } from './transport';
import {
  SYNC_KEYS,
  assertSyncSafe,
  graftDeviceLocal,
  syncableSettings,
} from './sync-policy';
import {
  mergeCollection,
  mergeObservations,
  pick,
  type SyncCollection,
  type Tombstone,
} from './sync-merge';

const K_SETTINGS = 'snc:settings:v1';
const K_CONVS = 'snc:conversations:v1';
const K_SKILLS = 'snc:skills:v1';
const K_TASKS = 'snc:tasks:v1';
const K_PROJECTS = 'snc:projects:v1';
const K_OBS = 'anyai:observations:v1';
/** 本地墓碑账本。不同步出去的是账本本身，随包走的是它的内容。 */
const K_GRAVES = 'snc:sync:graves:v1';
/** 上一次同步的时刻，只用来在界面上显示。 */
export const K_SYNC_STATE = 'snc:sync:state:v1';

export interface SyncBundle {
  v: 1;
  settings?: { value: Partial<AppSettings>; updatedAt: number };
  conversations?: SyncCollection<Conversation>;
  skills?: SyncCollection<{ id: string; installedAt: number }>;
  tasks?: SyncCollection<{ id: string; updatedAt?: number; createdAt?: number }>;
  projects?: SyncCollection<{ id: string; updatedAt?: number; createdAt?: number }>;
  observations?: unknown;
}

export interface SyncReport {
  pushed: boolean;
  devices: number;
  merged: Record<string, number>;
  failures: Array<{ file: string; error: string }>;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await getTransport().kvGet(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}

async function graves(): Promise<Record<string, Tombstone[]>> {
  return readJson<Record<string, Tombstone[]>>(K_GRAVES, {});
}

/** 删东西的时候叫一下，否则另一台设备会把它同步回来。 */
export async function recordDeletion(collection: string, id: string, deviceId = ''): Promise<void> {
  const all = await graves();
  const list = all[collection] ?? [];
  if (!list.some((t) => t.id === id)) list.push({ id, deletedAt: Date.now(), by: deviceId });
  all[collection] = list;
  await getTransport().kvSet(K_GRAVES, JSON.stringify(all));
}

const listOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const stampCreated = (x: { updatedAt?: number; createdAt?: number }) => x.updatedAt ?? x.createdAt ?? 0;

/** 组一份可以出门的包。返回的东西已经过了发车前闸门。 */
export async function buildBundle(settings: AppSettings): Promise<SyncBundle> {
  const g = await graves();
  const bundle: SyncBundle = {
    v: 1,
    settings: {
      value: syncableSettings(settings),
      // 设置没有自己的修改时间，用这次组包的时刻。整份取新，见 pickSettings。
      updatedAt: Date.now(),
    },
    conversations: { items: listOf<Conversation>(await readJson(K_CONVS, [])), tombstones: g[K_CONVS] ?? [] },
    skills: { items: listOf(await readJson(K_SKILLS, [])), tombstones: g[K_SKILLS] ?? [] },
    tasks: { items: listOf(await readJson(K_TASKS, [])), tombstones: g[K_TASKS] ?? [] },
    projects: { items: listOf(await readJson(K_PROJECTS, [])), tombstones: g[K_PROJECTS] ?? [] },
    observations: await readJson(K_OBS, null),
  };
  // 最后一道网。白名单挡字段名，这里挡「密钥被塞进了白名单字段深处」。
  assertSyncSafe(bundle);
  return bundle;
}

/**
 * 把收到的若干份包合进本地。
 *
 * 逐条合、逐 key 写。任何一步失败都只影响那一个 key —— 不做「全成功才写」，
 * 因为那意味着一条坏会话能挡住全部同步，而同步是低频动作，用户可能几天后
 * 才发现什么都没同步上。
 */
export async function applyBundles(
  incoming: SyncBundle[],
  localSettings: AppSettings,
): Promise<{ settings: AppSettings; merged: Record<string, number> }> {
  const t = getTransport();
  const g = await graves();
  const merged: Record<string, number> = {};
  let settings = localSettings;

  const collections: Array<[string, keyof SyncBundle, (x: never) => number]> = [
    [K_CONVS, 'conversations', ((x: { updatedAt: number }) => x.updatedAt) as never],
    [K_SKILLS, 'skills', ((x: { installedAt: number }) => x.installedAt ?? 0) as never],
    [K_TASKS, 'tasks', stampCreated as never],
    [K_PROJECTS, 'projects', stampCreated as never],
  ];

  for (const [key, field, stampOf] of collections) {
    try {
      let acc: SyncCollection<{ id: string }> = {
        items: listOf(await readJson(key, [])),
        tombstones: g[key] ?? [],
      };
      for (const b of incoming) {
        const theirs = b[field] as SyncCollection<{ id: string }> | undefined;
        if (!theirs) continue;
        acc = mergeCollection(acc, theirs, { stampOf: stampOf as (x: { id: string }) => number });
      }
      await t.kvSet(key, JSON.stringify(acc.items));
      g[key] = acc.tombstones;
      merged[key] = acc.items.length;
    } catch {
      // 这一个 key 没合上，其余照常。
    }
  }

  try {
    const local = await readJson<Record<string, unknown> | null>(K_OBS, null);
    let acc = local;
    for (const b of incoming) {
      if (!b.observations || !acc) continue;
      acc = mergeObservations(acc as never, b.observations as never) as never;
    }
    if (acc) {
      await t.kvSet(K_OBS, JSON.stringify(acc));
      merged[K_OBS] = ((acc as { tasks?: unknown[] }).tasks ?? []).length;
    }
  } catch {
    /* 观测合不上不影响别的 */
  }

  try {
    // 本地这份的时刻取 0：本地的值已经在 localSettings 里了，这里只是给它一个
    // 参与比较的位置。任何一份真实的远端包都比它新，除非远端也没有设置。
    let best = { value: syncableSettings(localSettings), updatedAt: 0 };
    for (const b of incoming) if (b.settings) best = pick(best, b.settings, (x) => x.updatedAt);
    // graftDeviceLocal 把本机字段原样接回去 —— 不管包里写了什么，本机字段永远赢。
    settings = graftDeviceLocal(best.value, localSettings);
  } catch {
    settings = localSettings;
  }

  await t.kvSet(K_GRAVES, JSON.stringify(g));
  return { settings, merged };
}

/** 跑一趟完整的同步：先把自己的推上去，再把别人的拉下来合掉。 */
export async function syncOnce(
  dir: string,
  passphrase: string,
  localSettings: AppSettings,
): Promise<SyncReport & { settings: AppSettings }> {
  const bridge = desktop();
  if (!bridge) throw new Error('同步只能在桌面端跑：它要往一个本地文件夹读写。');
  // 顺序是「先拉、合完再推」，不是「先推再拉」。
  // 先推的话，推上去的是合并之前的状态，对面要等到下一趟才看得到这一趟的结果 ——
  // 两台设备得来回同步两次才对齐。先拉后推一趟就收敛。
  const { bundles, failures } = await bridge.syncPull(dir, passphrase);
  const { settings, merged } = await applyBundles(
    bundles.map((b) => b.payload as SyncBundle),
    localSettings,
  );
  await bridge.syncPush(dir, await buildBundle(settings), passphrase);
  await getTransport().kvSet(K_SYNC_STATE, JSON.stringify({ at: Date.now(), devices: bundles.length }));
  return { pushed: true, devices: bundles.length, merged, failures, settings };
}

export { SYNC_KEYS };
