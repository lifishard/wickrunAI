import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ButlerCollectorState } from './butler-runtime';
import { BUTLER_CONSENT_VERSION, modelSafeSummary, type ButlerSource } from './proactive-butler';

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
  deniedPackages: string[];
  privateCount: number;
  storageError?: boolean;
  privacy: MobilePrivacy;
  background: {supported:boolean;unrestricted:boolean};
}
export interface MobileContextApp { packageName: string; label: string }
export interface MobilePrivacy {
  excludedTerms:string[];
  encryptedOnlyTerms:string[];
  categories:{contact:'exclude'|'encrypt-only'|'redact';financial:'exclude'|'encrypt-only'|'redact';health:'exclude'|'encrypt-only'|'redact'};
  encryptedStorage:boolean;
}

interface NativeContext {
  getStatus(): Promise<MobileContextStatus>;
  listApps(): Promise<{ apps: MobileContextApp[] }>;
  setAllowedPackages(options: { packages: string[]; deniedPackages:string[] }): Promise<MobileContextStatus>;
  configurePrivacy(options:{policy:MobilePrivacy}):Promise<MobileContextStatus>;
  setDataScopeConsent(options:{version:number;share:boolean;android:boolean}):Promise<MobileContextStatus>;
  setEnabled(options: { enabled: boolean; dataScopeVersion?:number }): Promise<MobileContextStatus>;
  openAccessibilitySettings(): Promise<MobileContextStatus>;
  openNotificationSettings(): Promise<MobileContextStatus>;
  requestNotificationPermission(): Promise<MobileContextStatus>;
  openBackgroundSettings(): Promise<MobileContextStatus>;
  revokeSource(options:{kind:'accessibility'|'share'}):Promise<MobileContextStatus>;
  poll(): Promise<{ items: MobileContextItem[] }>;
  ack(options: { ids: string[] }): Promise<MobileContextStatus>;
}

const native = registerPlugin<NativeContext>('WickrunContext');
const available = () => Capacitor.getPlatform() === 'android';

export const mobileContext = {
  available,
  status: () => available() ? native.getStatus() : Promise.resolve(null),
  apps: () => available() ? native.listApps().then(result => result.apps) : Promise.resolve([]),
  allowApps: (packages: string[], deniedPackages:string[] = []) => native.setAllowedPackages({ packages, deniedPackages }),
  configurePrivacy: (policy:MobilePrivacy) => native.configurePrivacy({policy}),
  setDataScopeConsent:(version:number,share:boolean,android:boolean)=>native.setDataScopeConsent({version,share,android}),
  enable: () => native.setEnabled({ enabled: true, dataScopeVersion:BUTLER_CONSENT_VERSION }),
  stop: () => native.setEnabled({ enabled: false }),
  openAccessibilitySettings: () => native.openAccessibilitySettings(),
  openNotificationSettings: () => native.openNotificationSettings(),
  requestNotificationPermission: () => native.requestNotificationPermission(),
  openBackgroundSettings: () => native.openBackgroundSettings(),
  revokeSource:(kind:'accessibility'|'share')=>native.revokeSource({kind}),
  poll: () => available() ? native.poll().then(result => result.items) : Promise.resolve([]),
  ack: (ids: string[]) => native.ack({ ids }),
};

let selectedSources: Partial<Record<ButlerSource, boolean>> = {};
let suspended = true;
let dataScopeVersion = 0;
let controlEpoch = 0;
let sourceEpoch = 0;
let nativeUpdates:Promise<unknown>=Promise.resolve();
function updateNative(work:()=>Promise<unknown>) {
  const next=nativeUpdates.catch(()=>{}).then(work);nativeUpdates=next;return next;
}
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
  if((action==='suspend'||action==='consent')&&typeof input.sourceEpoch==='number'){
    if(input.sourceEpoch<sourceEpoch)return empty;
    sourceEpoch=input.sourceEpoch;
  }
  if (action === 'status') {
    const state = await mobileContext.status();
    if (!state) return empty;
    const effective=state.allowedPackages.filter(name=>!state.deniedPackages.includes(name));
    const apps=await mobileContext.apps();
    return { sources: {
      android: { available: true, consented: state.serviceGranted && state.notificationGranted && effective.length > 0 && !state.storageError,
        allowlist: state.allowedPackages, denylist:state.deniedPackages,apps:apps.map(app=>({id:app.packageName,name:app.label})),
        note: state.storageError?'加密存储不可用':!state.serviceGranted ? '请开启 Android 阅读授权' : !state.notificationGranted ? '请允许状态通知' : state.active ? '正在读取所选应用' : '已停止读取' },
      share: { available: true, consented: true, note: '可从其他应用的分享菜单发送文字或链接' },
    }, privacy:state.privacy, background:state.background, deviceName: 'Android 手机' };
  }
  if (action === 'list-source-apps') return androidButlerCollector('status');
  if (action === 'configure' && input.source === 'android') {
    await mobileContext.allowApps(Array.isArray(input.allowlist) ? input.allowlist.filter((name): name is string => typeof name === 'string') : [],
      Array.isArray(input.denylist)?input.denylist.filter((name):name is string=>typeof name==='string'):[]);
    return androidButlerCollector('status');
  }
  if (action === 'configure-privacy' && input.policy && typeof input.policy === 'object') {
    await mobileContext.configurePrivacy(input.policy as MobilePrivacy);
    return androidButlerCollector('status');
  }
  if (action === 'open-background-settings') {
    await mobileContext.openBackgroundSettings();
    return androidButlerCollector('status');
  }
  if (action === 'consent' && input.source === 'android') {
    if (input.consented && input.dataScopeVersion!==BUTLER_CONSENT_VERSION) throw Error('请先确认管家的数据范围。');
    // Selecting a source does not resume a paused Butler. The runtime unlocks it separately.
    if (!input.consented) {controlEpoch++;selectedSources.android=false;await updateNative(()=>mobileContext.revokeSource('accessibility'));}
    return androidButlerCollector('status');
  }
  if (action === 'consent' && input.source === 'share') {
    if (input.consented && input.dataScopeVersion!==BUTLER_CONSENT_VERSION) throw Error('请先确认管家的数据范围。');
    if (!input.consented) {controlEpoch++;selectedSources.share=false;await updateNative(()=>mobileContext.revokeSource('share'));}
    return androidButlerCollector('status');
  }
  if (action === 'suspend') {
    const epoch=++controlEpoch;
    dataScopeVersion=input.dataScopeVersion===BUTLER_CONSENT_VERSION?BUTLER_CONSENT_VERSION:0;
    suspended = input.suspended !== false || dataScopeVersion!==BUTLER_CONSENT_VERSION;
    if (input.sources && typeof input.sources === 'object') selectedSources = input.sources as typeof selectedSources;
    if (input.mode === 'local-topics' || input.mode === 'redacted-context') mode = input.mode;
    // Native writes are serialized so an older enable cannot finish after a revoke.
    await updateNative(async()=>{
      if(epoch!==controlEpoch)return;
      await mobileContext.setDataScopeConsent(suspended?0:dataScopeVersion,!suspended&&selectedSources.share===true,!suspended&&selectedSources.android===true);
      if(epoch!==controlEpoch)return;
      if (suspended || !selectedSources.android) await mobileContext.stop();
      else {
        const state = await mobileContext.status();
        if (epoch===controlEpoch && !suspended && selectedSources.android && state?.serviceGranted && state.notificationGranted && state.allowedPackages.length) await mobileContext.enable();
      }
    });
    return androidButlerCollector('status');
  }
  if (action === 'poll') {
    if (suspended || dataScopeVersion!==BUTLER_CONSENT_VERSION) return empty;
    const epoch=controlEpoch;
    const items = (await mobileContext.poll()).filter(item => selectedSources[item.kind === 'share' ? 'share' : 'android']);
    if(epoch!==controlEpoch || suspended)return empty;
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
    const url=new URL(input.url.trim());
    if(url.protocol!=='https:')throw Error('只接受 HTTPS 链接。');
    const text=`用户分享了 ${url.hostname} 的链接。`, item: MobileContextItem = { id: `share:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      kind: 'share', packageName: null, text, capturedAt: Date.now() };
    return { sources: {}, signals: [summarized(item)] };
  }
  return empty;
}
