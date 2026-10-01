import { Capacitor, registerPlugin } from '@capacitor/core';

/** Android's local context inbox. Nothing is uploaded by these calls. */
export interface MobileContextItem {
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
  drain(): Promise<{ items: MobileContextItem[] }>;
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
  drain: () => available() ? native.drain().then(result => result.items) : Promise.resolve([]),
};
