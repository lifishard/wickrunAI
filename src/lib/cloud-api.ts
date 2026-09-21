export type CloudUser = { id: string; name: string; email: string };
export type CloudStatus = { user: CloudUser | null; available: boolean; googleConfigured?: boolean };
export type DesktopCloudState = { user: CloudUser | null; origin: string; pending: { code: string; expires: number } | null; ready: CloudUser | null };
export interface CloudBridge {
  cloudState(): Promise<DesktopCloudState>;
  cloudLogin(): Promise<{ code: string; expires: number }>;
  cloudPoll(): Promise<{ pending?: boolean; ready?: boolean; user?: CloudUser }>;
  cloudCall(action: string, input?: unknown): Promise<unknown>;
  cloudGuestData(): Promise<Record<string, string>>;
  cloudSwitch(logout: boolean): Promise<void>;
}
export const cloudBridge = (): CloudBridge | null => {
  const bridge = typeof window !== 'undefined' ? window.snc : null;
  return bridge && 'cloudCall' in bridge ? bridge as unknown as CloudBridge : null;
};
export class CloudApiError extends Error { constructor(message: string, public status: number) { super(message); } }
let webAccountId: string | null = null;
export function configureWebCloudAccount(id:string|null) { webAccountId=id; }
export async function cloudCall<T>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const native = cloudBridge();
  if (native) return await native.cloudCall(action, input) as T;
  const routes: Record<string, [string, string]> = { status: ['/api/cloud/status','GET'], read: ['/api/cloud/data','GET'], write: ['/api/cloud/data','PUT'], keys: ['/api/cloud/keys','GET'] };
  let route = routes[action];
  if (['keyGet','keySet','keyDelete'].includes(action)) route = ['/api/cloud/keys/'+encodeURIComponent(String(input.id)), {keyGet:'GET',keySet:'PUT',keyDelete:'DELETE'}[action]!];
  if (!route) throw new Error('Unsupported cloud operation');
  const response = await fetch(route[0], { method:route[1], credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(20000), headers:{...(webAccountId?{'X-Wickrun-Account':webAccountId}:{}),...(route[1]==='PUT'?{'Content-Type':'application/json'}:{})}, body:route[1]==='PUT'?JSON.stringify(input):undefined });
  const data = await response.json();
  if (!response.ok) throw new CloudApiError(data.error || 'Cloud request failed', response.status);
  return data as T;
}

let keyAccount: string | null = null;
let profileIds = new Set<string>();
export function configureCloudKeys(userId: string | null, ids: string[]) { keyAccount=userId; profileIds=new Set(ids); }
export function usesCloudKey(id: string) { return Boolean(keyAccount && profileIds.has(id)); }
