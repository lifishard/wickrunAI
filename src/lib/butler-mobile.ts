import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ButlerCollectorState } from './butler-runtime';
import { modelSafeSummary, type ButlerSource } from './proactive-butler';

/** Android's local context inbox. Nothing is uploaded by these calls. */
export interface MobileContextItem {
  id: string;
  kind: 'accessibility' | 'share';
  packageName: string | null;
  text: string;
  capturedAt: number;
}
export interface MobileContextStatus {
  enabled: boolean;
  active: boolean;
  serviceGranted: boolean;
  notificationGranted: boolean;
  allowedPackages: string[];
}
export interface MobileContextApp { packageName: string; label: string }

interface NativeContext {
  getStatus(): Promise<MobileContextStatus>;
  listApps(): Promise<{ apps: MobileContextApp[] }>;
  setAllowedPackages(options: { packages: string[] }): Promise<MobileContextStatus>;
  setEnabled(options: { enabled: boolean }): Promise<MobileContextStatus>;
  openAccessibilitySettings(): Promise<MobileContextStatus>;
  openNotificationSettings(): Promise<MobileContextStatus>;
  requestNotificationPermission(): Promise<MobileContextStatus>;
  poll(): Promise<{ items: MobileContextItem[] }>;
  ack(options: { ids: string[] }): Promise<MobileContextStatus>;
}

const native = registerPlugin<NativeContext>('WickrunContext');
const available = () => Capacitor.getPlatform() === 'android';

export const mobileContext = {
  available,
  status: () => available() ? native.getStatus() : Promise.resolve(null),
  apps: () => available() ? native.listApps().then(result => result.apps) : Promise.resolve([]),
  allowApps: (packages: string[]) => native.setAllowedPackages({ packages }),
  enable: () => native.setEnabled({ enabled: true }),
  stop: () => native.setEnabled({ enabled: false }),
  openAccessibilitySettings: () => native.openAccessibilitySettings(),
  openNotificationSettings: () => native.openNotificationSettings(),
  requestNotificationPermission: () => native.requestNotificationPermission(),
  poll: () => available() ? native.poll().then(result => result.items) : Promise.resolve([]),
  ack: (ids: string[]) => native.ack({ ids }),
};

let selectedSources: Partial<Record<ButlerSource, boolean>> = {};
let suspended = true;
let mode: 'local-topics' | 'redacted-context' = 'local-topics';

function summarized(item: MobileContextItem) {
  const source: ButlerSource = item.kind === 'share' ? 'share' : 'android';
  const label = source === 'share' ? '主动分享的内容' : `Android · ${item.packageName ?? '应用'}`;
  const topic = modelSafeSummary(item.text.split('\n').find(Boolean) ?? '', 80);
  return {
    id: item.id, source, sourceLabel: label, sourceRef: item.packageName ?? undefined,
    topic: topic || '浏览活动', intent: source === 'share' ? '用户主动分享了内容' : '可能关注此主题',
    summary: topic ? `阅读了与「${topic}」有关的内容。` : '浏览了已允许应用的可见内容。',
    observedAt: item.capturedAt, confidence: 'low' as const, basis: 'behavior' as const,
  };
}

/** Adapter for ButlerRuntime's device-local collector contract. Poll never consumes records. */
export async function androidButlerCollector(action: string, input: Record<string, unknown> = {}): Promise<ButlerCollectorState> {
  const empty: ButlerCollectorState = { sources: {} };
  if (!available()) return empty;
  if (action === 'status') {
    const state = await mobileContext.status();
    if (!state) return empty;
    return { sources: {
      android: { available: true, consented: state.serviceGranted && state.notificationGranted && state.allowedPackages.length > 0,
        allowlist: state.allowedPackages, note: !state.serviceGranted ? '请开启 Android 阅读授权' : !state.notificationGranted ? '请允许状态通知' : state.active ? '正在读取所选应用' : '已停止读取' },
      share: { available: true, consented: true, note: '可从其他应用的分享菜单发送文字或链接' },
    }, deviceName: 'Android 手机' };
  }
  if (action === 'configure' && input.source === 'android') {
    await mobileContext.allowApps(Array.isArray(input.allowlist) ? input.allowlist.filter((name): name is string => typeof name === 'string') : []);
    return androidButlerCollector('status');
  }
  if (action === 'consent' && input.source === 'android') {
    if (input.consented) await mobileContext.enable(); else await mobileContext.stop();
    return androidButlerCollector('status');
  }
  if (action === 'suspend') {
    suspended = input.suspended === true;
    if (input.sources && typeof input.sources === 'object') selectedSources = input.sources as typeof selectedSources;
    if (input.mode === 'local-topics' || input.mode === 'redacted-context') mode = input.mode;
    if (suspended || !selectedSources.android) await mobileContext.stop();
    else {
      const state = await mobileContext.status();
      if (state?.serviceGranted && state.notificationGranted && state.allowedPackages.length) await mobileContext.enable();
    }
    return androidButlerCollector('status');
  }
  if (action === 'poll') {
    if (suspended) return empty;
    const items = (await mobileContext.poll()).filter(item => selectedSources[item.kind === 'share' ? 'share' : 'android']);
    return { sources: {}, recordIds: items.map(item => item.id), signals: items.map(summarized),
      contexts: mode === 'redacted-context' ? items.map(item => ({ id: item.id, source: item.kind === 'share' ? 'share' : 'android',
        sourceLabel: item.kind === 'share' ? '主动分享的内容' : `Android · ${item.packageName ?? '应用'}`,
        observedAt: item.capturedAt, text: item.text })) : [] };
  }
  if (action === 'ack') {
    await mobileContext.ack(Array.isArray(input.ids) ? input.ids.filter((id): id is string => typeof id === 'string') : []);
    return empty;
  }
  if (action === 'import-link' && typeof input.url === 'string') {
    const text = input.url.trim().slice(0, 2000), item: MobileContextItem = { id: `share:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: 'share', packageName: null, text, capturedAt: Date.now() };
    return { sources: {}, signals: [summarized(item)], contexts: mode === 'redacted-context' ? [{ id: item.id, source: 'share',
      sourceLabel: '主动分享的链接', observedAt: item.capturedAt, text }] : [] };
  }
  return empty;
}
