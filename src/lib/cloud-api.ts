export type CloudUser = { id: string; name: string; email: string };
export type CloudStatus = { user: CloudUser | null; available: boolean; googleConfigured?: boolean;syncProtocol?:'layered-v1';fileRetentionDays?:number };
export type DesktopCloudState = { user: CloudUser | null; workspaceAccountId?:string; continuesLocalWorkspace?:boolean; origin: string; pending: { code: string; expires: number } | null; ready: CloudUser | null };
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
const webAccountListeners=new Set<(id:string|null)=>void>();
export function configureWebCloudAccount(id:string|null) {
  if(webAccountId===id)return;
  webAccountId=id;for(const listener of webAccountListeners)listener(id);
}
export function onWebCloudAccountChange(listener:(id:string|null)=>void):()=>void {
  webAccountListeners.add(listener);return()=>{webAccountListeners.delete(listener);};
}
export function webCloudAccount() { return webAccountId; }
export async function cloudAccountIdentity():Promise<string|null> {
  const native=cloudBridge();return native?(await native.cloudState()).user?.id??null:webAccountId;
}
export type CloudCallOptions = { signal?: AbortSignal; accountId?: string; timeoutMs?: number };
export async function cloudCall<T>(action: string, input: Record<string, unknown> = {}, options: CloudCallOptions = {}): Promise<T> {
  const { mediaTimed, mediaRetryAfter } = await import('./cloud-media-upload');
  const native = cloudBridge();
  if (native && options.signal === undefined && options.accountId === undefined && options.timeoutMs === undefined) return await native.cloudCall(action, input) as T;
  if (native) return mediaTimed(options.signal, options.timeoutMs ?? 20000, async () => {
    const result = await native.cloudCall(action, options.accountId !== undefined && action === 'collaboration' ? { ...input, expectedAccountId: options.accountId } : input) as T & {
      fileTransferError?: { message?: string; name?: string; status?: number; code?: string; retryAfter?: string };
    };
    if (options.accountId !== undefined && action === 'collaboration' && result?.fileTransferError) {
      const failure = result.fileTransferError;
      throw Object.assign(new Error(failure.message || '文件传输请求失败，请重试。'), { name: failure.name || 'Error', status: failure.status, code: failure.code, retryAfterMs: mediaRetryAfter(failure.retryAfter ?? null) });
    }
    return result;
  });
  const routes: Record<string, [string, string]> = { status: ['/api/cloud/status','GET'], read: ['/api/cloud/data','GET'], write: ['/api/cloud/data','PUT'], sync:['/api/cloud/sync','POST'],keys: ['/api/cloud/keys','GET'], collaboration:['/api/collaboration','POST'] };
  let route = routes[action];
  if (['keyGet','keySet','keyDelete'].includes(action)) route = ['/api/cloud/keys/'+encodeURIComponent(String(input.id)), {keyGet:'GET',keySet:'PUT',keyDelete:'DELETE'}[action]!];
  if (!route) throw new Error('Unsupported cloud operation');
  const hasBody=['PUT','POST'].includes(route[1]);
  if (options.accountId !== undefined && options.accountId !== webAccountId) throw new DOMException('账号已切换，已停止传输文件。', 'AbortError');
  const accountId = options.accountId ?? webAccountId;
  return mediaTimed(options.signal, options.timeoutMs ?? 20000, async signal => {
  const response = await fetch(route[0], { method:route[1], credentials:'same-origin', cache:'no-store', signal, headers:{...(accountId?{'X-Wickrun-Account':accountId}:{}),...(hasBody?{'Content-Type':'application/json'}:{})}, body:hasBody?JSON.stringify(input):undefined });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new CloudApiError(data.error || 'Cloud request failed', response.status), {
    code: typeof data.code === 'string' ? data.code : undefined, retryAfterMs: mediaRetryAfter(response.headers.get('Retry-After')),
  });
  return data as T;
  });
}

let keyAccount: string | null = null;
let profileIds = new Set<string>();
export function configureCloudKeys(userId: string | null, ids: string[]) { keyAccount=userId; profileIds=new Set(ids); }
export function usesCloudKey(id: string) { return Boolean(keyAccount && profileIds.has(id)); }
