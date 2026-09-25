/* ------------------------------------------------------------------
 * 跨设备同步 —— 决定「什么东西可以离开这台机器」。
 *
 * 这个文件是整条同步链路里唯一的安全边界。合并算法写错了，最坏是数据乱；
 * 这里写错了，是把 API key 或者一条能在别人电脑上执行的命令送了出去。
 * 所以规则是白名单制：没在 SYNC_KEYS 里的一律不同步，没在
 * SYNCABLE_SETTINGS 里的设置字段一律不出门。新增字段默认是「不同步」，
 * 这样忘了改这里的后果是「少同步了一样东西」，而不是「多泄露了一样东西」。
 *
 * 同步的是使用习惯和积累的经验，不是钱包。
 * ------------------------------------------------------------------ */

import type { AppSettings } from '../types';

/** 会话/项目/技能/任务/观测 —— 这些是「同一个账号」真正该跟着走的东西。 */
export const SYNC_KEYS = [
  'snc:conversations:v1',
  'snc:projects:v1',
  'snc:skills:v1',
  'snc:tasks:v1',
  'anyai:observations:v1',
  'snc:settings:v1', // 只同步 syncableSettings() 过滤后的子集
] as const;

/**
 * 明确点名不同步的。列在这里不是为了实现（白名单本来就不含它们），
 * 是为了让「为什么不同步」有个地方写下来，以后有人想加进去时先看见理由。
 */
export const NEVER_SYNC_KEYS: Record<string, string> = {
  // 配对令牌就是遥控入口的钥匙。它跟着同步走一圈，等于把入口钥匙复制到
  // 每一个同步落点上（网盘、U 盘、中转目录）。
  'snc:remote:token': '遥控配对令牌：同步出去等于复制入口钥匙',
  // 窗口位置是这块屏幕的事，同步过去只会让另一台设备的窗口跑到屏幕外。
  'snc:window-bounds:v1': '窗口位置：设备相关，同步过去只会添乱',
  'snc:device:id': '设备编号：每台机器一个，同步过去两台会抢同一个落点文件',
  'snc:sync:graves:v1': '删除账本：随同步包走的是它的内容，账本本身是本地的',
  'snc:sync:state:v1': '上次同步时间：本机状态',
};

/**
 * store.json 里的 secrets 桶整个不参与同步。
 *
 * 这一条没有开关，也不打算做开关。API key 经 safeStorage 加密，密钥材料绑
 * 这台机器的系统身份（Windows DPAPI / macOS Keychain / Linux libsecret）——
 * 密文搬到另一台机器上本来就解不开，硬要同步就只能先解密成明文再发出去，
 * 那就正好把 BYOK「密钥不离开本机」这条前提推翻了。
 *
 * 另一台设备想用同一条路由，两条路：自己填一个 key，或者走遥控转发到这台
 * 电脑执行。两条都不需要密钥离开它原来待的地方。
 */
export const SECRETS_NEVER_SYNC = true;

/**
 * 设置里允许出门的字段。
 *
 * 注意 hooks 不在里面，而且是故意的：钩子的内容是一条命令行，会在工具成功
 * 后自动执行。同步钩子意味着任何能往同步落点写东西的人，都能让一条命令在
 * 你的桌面上跑起来 —— 那是一条从「能写文件」到「能执行代码」的升级路径。
 * 换设备时钩子请手动重配，几条而已。
 */
export const SYNCABLE_SETTINGS = [
  'keyProfiles',      // 只同步结构，密钥另说，见 stripProfileSecrets
  'customModels',
  'defaultConfig',
  'theme',
  'locale',
  'uiDensity',
  'sendKey',
  'fontScale',
  'showReasoningByDefault',
  'requestTimeoutMs',
  'effortMappings',
  'autoRetry',
  'failover',
  'routeGroups',
  'notifications',
] as const;

/**
 * 明确留在本机的设置字段，附理由。
 * 这张表是给人看的；代码只认上面那份白名单。
 */
export const DEVICE_LOCAL_SETTINGS: Record<string, string> = {
  remote: '遥控地址和令牌：一台是服务端一台是客户端，同步过去两边都会指向自己',
  hooks: '事件钩子是命令行：同步等于让别的地方能往你的桌面投递可执行内容',
  tools: '工作目录、claudeBin、Chrome 端口都是本机路径，另一台机器上根本不存在',
  activeKeyProfileId: '当前选用哪条路由：这台机器有的 key 另一台未必有',
  cachedModels: '模型列表缓存：各自重新扫一遍就有，同步过去只会互相盖成过期数据',
  modelHealth: '路由健康：记的是「从这台机器出去通不通」，换个网络结论就不一样',
  grantLedger: '授权台账：记的是这台机器上批准过什么，是本机的审计记录',
  skillSync: '技能同步目录是本机路径',
  sync: '同步落点文件夹是本机路径，而且两台机器指的多半不是同一个盘符',
  collaborationView: '界面状态',
  clients: '本机命令行客户端的可执行文件路径',
};

/**
 * 凭据形状的字段名。和 electron/data-backup.cjs 里的 sensitive 保持一致 ——
 * tests/sync-policy.test.cjs 会逐字比对这两处，防止其中一边悄悄放宽。
 */
export const SENSITIVE_FIELD =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|authorization|password|client[_-]?secret|secret|token|cookie|set-cookie)$/i;

/** 递归剔掉凭据形状的字段。最后一道网，不是第一道。 */
export function scrubSensitive<T>(value: T): T {
  if (Array.isArray(value)) return value.map(scrubSensitive) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !SENSITIVE_FIELD.test(k))
        .map(([k, v]) => [k, scrubSensitive(v)]),
    ) as unknown as T;
  }
  return value;
}

/**
 * 找出一份数据里所有凭据形状的字段路径。
 * 发车前调用；返回非空就不发。见 assertSyncSafe。
 */
export function findSensitivePaths(value: unknown, at = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...findSensitivePaths(v, `${at}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const path = at ? `${at}.${k}` : k;
      if (SENSITIVE_FIELD.test(k)) found.push(path);
      else found.push(...findSensitivePaths(v, path));
    }
  }
  return found;
}

/**
 * 发车前的闸门。
 *
 * 白名单已经挡过一道了，这里再挡一道 —— 因为白名单挡的是「字段名」，
 * 而密钥可能哪天被人塞进一个白名单里的对象深处。两道网的失效方式不一样，
 * 这才叫两道网。
 */
export function assertSyncSafe(payload: unknown): void {
  const leaks = findSensitivePaths(payload);
  if (leaks.length) {
    throw new Error(`同步包里出现了凭据字段，已中止：${leaks.slice(0, 5).join('、')}`);
  }
}

/** keyProfiles 只带结构出门：名字、地址、附加头、路由偏好。密钥一律当作没有。 */
export function stripProfileSecrets(profiles: AppSettings['keyProfiles']): AppSettings['keyProfiles'] {
  return (profiles ?? []).map((p) => ({
    ...p,
    // 对面那台机器有没有这条 key，由它自己的 secrets 桶说了算，不由同步包说了算。
    hasSecret: false,
    extraHeaders: Object.fromEntries(
      Object.entries(p.extraHeaders ?? {}).filter(([k]) => !SENSITIVE_FIELD.test(k)),
    ),
  }));
}

/** 取出设置里允许同步的那一份。返回的对象可以直接进同步包。 */
export function syncableSettings(s: AppSettings): Partial<AppSettings> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCABLE_SETTINGS) {
    const v = (s as unknown as Record<string, unknown>)[key];
    if (v === undefined) continue;
    out[key] = key === 'keyProfiles' ? stripProfileSecrets(s.keyProfiles) : scrubSensitive(v);
  }
  assertSyncSafe(out);
  return out as Partial<AppSettings>;
}

/**
 * 收到对面的设置之后，把本机字段原样接回去。
 *
 * 顺序很关键：先铺本地，再盖同步来的白名单字段，最后再把本机字段盖回来。
 * 也就是说 —— 不管同步包里写了什么，本机字段永远赢。同步包里混进一个
 * remote.token 或者一条 hooks，到这里就被本地值直接覆盖掉了。
 */
export function graftDeviceLocal(incoming: Partial<AppSettings>, local: AppSettings): AppSettings {
  const merged: Record<string, unknown> = { ...local };
  for (const key of SYNCABLE_SETTINGS) {
    if (incoming[key as keyof AppSettings] !== undefined) {
      merged[key] = incoming[key as keyof AppSettings];
    }
  }
  for (const key of Object.keys(DEVICE_LOCAL_SETTINGS)) {
    merged[key] = (local as unknown as Record<string, unknown>)[key];
  }
  // hasSecret 以本机为准：同步包永远说 false，但这台机器自己可能真有这条 key。
  const localHas = new Map((local.keyProfiles ?? []).map((p) => [p.id, p.hasSecret]));
  merged.keyProfiles = ((merged.keyProfiles as AppSettings['keyProfiles']) ?? []).map((p) => ({
    ...p,
    hasSecret: localHas.get(p.id) ?? false,
  }));
  return merged as unknown as AppSettings;
}
