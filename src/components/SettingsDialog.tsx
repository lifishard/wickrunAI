import { usesCloudKey } from '../lib/cloud-api';
import React from 'react';
import { useT, LOCALES } from '../lib/i18n';
import type { AppSettings, KeyProfile, SearchProvider } from '../types';
import { BASE_URL_PRESETS, normalizeBaseUrl } from '../lib/api';
import { secretDelete, secretGet, secretSet, uid } from '../lib/store';
import { desktop, getTransport, type ChromeStatus, type RemoteStatus } from '../lib/transport';
import {
  EFFORT_LEVELS,
  STYLE_LABEL,
  defaultEffortMappings,
  type EffortMapping,
  type EffortStyle,
} from '../lib/effort';
import { Field, Modal, Segmented, Switch } from './ui';
import RouteGroupsSettings from './RouteGroupsSettings';

type Tab = 'keys' | 'routes' | 'tools' | 'effort' | 'remote' | 'sync' | 'look';

const TAB_LABEL: Record<Tab, string> = {
  keys: 'API 凭据',
  routes: '路由组',
  tools: '工具',
  effort: '思考强度',
  remote: '遥控',
  sync: '同步',
  look: '外观',
};

/* ------------------------------------------------------------------ *
 * 一个密钥输入框：进来时不显示已存的密钥，只显示「已保存」
 * ------------------------------------------------------------------ */

function SecretInput(props: {
  secretId: string;
  placeholder: string;
  onSaved?: () => void;
}) {
  const t = useT();
  const [value, setValue] = React.useState('');
  const [saved, setSaved] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void secretGet(props.secretId).then((v) => {
      if (alive) setSaved(Boolean(v));
    });
    return () => {
      alive = false;
    };
  }, [props.secretId]);

  return (
    <div className="row">
      <input
        type="password"
        placeholder={saved && !dirty ? t('已保存（留空不改动）') : props.placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setDirty(true);
        }}
      />
      <button
        className="btn sm"
        disabled={!value.trim()}
        onClick={async () => {
          await secretSet(props.secretId, value.trim());
          setValue('');
          setDirty(false);
          setSaved(true);
          props.onSaved?.();
        }}
      >
        {t('保存')}
      </button>
      {saved ? (
        <button
          className="btn sm danger"
          onClick={async () => {
            await secretDelete(props.secretId);
            setSaved(false);
            setValue('');
          }}
        >
          {t('清除')}
        </button>
      ) : null}
    </div>
  );
}



/* ------------------------------------------------------------------ *
 * Chrome 段落。带 hooks，独立成组件。
 * ------------------------------------------------------------------ */


/**
 * GitHub API 额度显示。
 *
 * /rate_limit 这个接口本身**不计入额度**，所以查它是免费的。
 * 这是「有没有入口重置」这个问题唯一能给的诚实答案：重置不了，但至少能看见
 * 还剩多少、什么时候自己恢复。
 */
/** 构建时间戳，本地时区显示。拿不到就说明是开发模式下跑的 */
function buildTime(): string {
  try {
    return new Date(__BUILD_TIME__).toLocaleString();
  } catch {
    return '开发模式（未打包）';
  }
}

function RateLimitRow() {
  const t = useT();
  const [state, setState] = React.useState<
    { remaining: number; limit: number; resetAt: number } | null
  >(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const check = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await getTransport().callTool(
        'github_api',
        { method: 'GET', path: '/rate_limit' },
        { toolTimeoutMs: 20000 } as never,
      );
      if (!res.ok) throw new Error(res.error ?? t('查询失败'));
      const data = JSON.parse(res.content) as {
        resources?: { core?: { remaining: number; limit: number; reset: number } };
      };
      const core = data.resources?.core;
      if (!core) throw new Error(t('返回里没有 core 额度'));
      setState({ remaining: core.remaining, limit: core.limit, resetAt: core.reset * 1000 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mins = state ? Math.max(0, Math.round((state.resetAt - Date.now()) / 60000)) : 0;

  return (
    <div className="row" style={{ alignItems: 'center', gap: 8, marginTop: 4 }}>
      <button className="btn sm" onClick={() => void check()} disabled={busy}>
        {busy ? t('查询中…') : t('查看剩余额度')}
      </button>
      {state ? (
        <span className="hint">
          {t('还剩 {remaining} / {limit} 次', { remaining: state.remaining, limit: state.limit })}
          {state.remaining === 0 ? t('，{mins} 分钟后自动恢复', { mins }) : t('，{mins} 分钟后重置计数', { mins })}
          {state.limit <= 60 ? t('（这是未登录的额度，填 token 会变成 5000）') : t('（token 生效中）')}
        </span>
      ) : null}
      {err ? <span className="hint" style={{ color: 'var(--danger-fg, #b91c1c)' }}>{err}</span> : null}
    </div>
  );
}

function ChromeSection(props: { port: number; onPort: (p: number) => void }) {
  const t = useT();
  const bridge = desktop();
  const [status, setStatus] = React.useState<ChromeStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    if (!bridge) return;
    setStatus(await bridge.chromeStatus(props.port));
  }, [bridge, props.port]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="section">
      <div className="section-title">Chrome</div>

      <div className="hint" style={{ marginBottom: 10, lineHeight: 1.85 }}>
        {t('Chrome 136 之后，--remote-debugging-port 在默认用户目录下会被直接忽略。Google 用这条变更堵住「拿调试端口偷 cookie」，所以没法直接控制你日常那个 Chrome，必须用一份独立的配置目录。')}
        <br />
        {t('下面这个按钮会用一份专属配置拉起 Chrome。第一次需要在那个窗口里登录一遍你要用的网站，之后配置一直留着，不用重复登录，也完全不碰你日常那份。')}
      </div>

      <Field label={t('远程调试端口')}>
        <input
          type="number"
          value={props.port}
          onChange={(e) => props.onPort(Number(e.target.value) || 9222)}
        />
      </Field>

      {bridge ? (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  const r = await bridge.chromeLaunch(props.port);
                  if (r.ok) {
                    setMsg(
                      r.alreadyRunning
                        ? t('端口上已经有一个实例在跑：{browser}', { browser: r.browser ?? '' })
                        : t('已启动 {name}{detail}', { name: r.browserName ?? '', detail: r.browser ? `（${r.browser}）` : '' }),
                    );
                  } else {
                    setMsg(r.error ?? t('启动失败'));
                  }
                } finally {
                  setBusy(false);
                  void refresh();
                }
              }}
            >
              {busy ? t('启动中…') : t('启动可控制的 Chrome')}
            </button>
            <button className="btn" onClick={() => void refresh()}>
              {t('检测')}
            </button>
            <span className="chip">{status?.running ? t('已连通') : t('未连通')}</span>
          </div>

          {msg ? (
            <div className="hint" style={{ color: status?.running ? 'var(--ok)' : 'var(--danger)' }}>
              {msg}
            </div>
          ) : null}

          <div className="hint" style={{ marginTop: 8 }}>
            {status?.browserPath ? (
              <>
                {t('找到的浏览器：')}<code>{status.browserPath}</code>
                <br />
              </>
            ) : (
              <>{t('没在常见位置找到 Chrome 或 Edge。')}<br /></>
            )}
            {status?.profileDir ? (
              <>
                {t('专属配置目录：')}<code>{status.profileDir}</code>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <div className="hint">{t('Chrome 只能从桌面端启动。手机端配好遥控后，操作会转发到电脑执行。')}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 遥控页签。带 hooks，所以必须是独立组件 —— 定义在渲染函数里再条件调用
 * 会违反 hooks 调用顺序必须稳定的规则。
 * ------------------------------------------------------------------ */

/** 地址档位对应的中文标签。cgnat 段（100.64.0.0/10）就是 Tailscale 的 tailnet。 */
const SCOPE_LABEL: Record<string, string> = {
  cgnat: '私有网络',
  private: '局域网',
  linklocal: '链路本地',
  loopback: '本机',
};

function RemoteTab(props: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const t = useT();
  const bridge = desktop();
  const s = props.settings;
  const [status, setStatus] = React.useState<RemoteStatus | null>(null);
  const [port, setPort] = React.useState(8719);
  const [busy, setBusy] = React.useState(false);
  const [ping, setPing] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!bridge) return;
    void bridge.remoteStatus().then((st) => {
      setStatus(st);
      if (st.port) setPort(st.port);
    });
  }, [bridge]);

  if (bridge) {
    return (
      <div>
        <div className="hint" style={{ marginBottom: 14, lineHeight: 1.8 }}>
          {t('手机上没有文件系统权限、控不了 Chrome、也没有 claude CLI，所以手机端的这些工具调用会转发到这台电脑执行。打开下面的服务，然后把地址和令牌抄到手机端的「遥控」设置里。')}
          <br />
          <strong>{t('只在内网用。')}</strong>{t('别把这个端口做端口转发暴露到公网。它背后就是你电脑的命令行。')}
          <br />
          {t('想在外面也能用：给两台设备装 Tailscale（或自建 WireGuard），让它们进同一个私有网络。那样地址就变成下面标了「私有网络」的那条，换到哪个 Wi-Fi 都通，而且不用把任何端口暴露出去。')}
        </div>

        <Field label={t('监听端口')}>
          <input
            type="number"
            value={port}
            disabled={Boolean(status?.running)}
            onChange={(e) => setPort(Number(e.target.value) || 8719)}
          />
        </Field>

        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className={`btn ${status?.running ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(
                  status?.running ? await bridge.remoteStop() : await bridge.remoteStart(port, ''),
                );
              } catch (e) {
                setPing(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {status?.running ? t('停止服务') : t('启动服务')}
          </button>
          <span className="chip">{status?.running ? t('运行中') : t('已停止')}</span>
          {ping ? <span className="hint" style={{ color: 'var(--danger)' }}>{ping}</span> : null}
        </div>

        {status?.running ? (
          <>
            <Field
              label={t('手机端填这个地址')}
              hint={
                status.hasPrivateNetwork
                  ? t('挑第一条「私有网络」的，它不挑 Wi-Fi。')
                  : t('同一个 Wi-Fi 下，挑能通的那条。')
              }
            >
              {status.endpoints?.length ? (
                <div className="remote-endpoints">
                  {status.endpoints.map((e) => (
                    <div key={e.url} className="remote-endpoint">
                      <span className={`chip scope-${e.scope}`}>{t(SCOPE_LABEL[e.scope])}</span>
                      <code className="mono">{e.url}</code>
                      <span className="hint">{e.iface}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  className="mono"
                  rows={Math.max(2, status.addresses.length)}
                  readOnly
                  value={status.addresses.join('\n')}
                />
              )}
            </Field>
            {status.publicInterfaces?.length ? (
              <div className="hint" style={{ color: 'var(--danger)', marginBottom: 12, lineHeight: 1.8 }}>
                {t('这台机器有直接连公网的网卡（{ifaces}）。服务会掐掉公网来源的连接，但这说明它不在路由器后面 —— 任何一条端口转发或者防火墙放行，都会立刻把这个入口变成公网入口。', { ifaces: status.publicInterfaces.join('、') })}
              </div>
            ) : null}
            <Field label={t('配对令牌')} hint={t('抄到手机端。换端口重启会保留同一个令牌。')}>
              <input
                type="text"
                readOnly
                value={status.token}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
            </Field>
          </>
        ) : null}
      </div>
    );
  }

  const r = s.remote;
  const patch = (p: Partial<typeof r>) => props.onChange({ remote: { ...r, ...p } });

  return (
    <div>
      <div className="hint" style={{ marginBottom: 14, lineHeight: 1.8 }}>
        {t('在电脑上打开 设置 → 遥控 里的服务，把那边显示的地址和令牌填到这里。填好之后，手机上也能让模型读你电脑的文件、控 Chrome、调 Claude Code。')}
      </div>

      <div className="field">
        <Switch checked={r.enabled} onChange={(v) => patch({ enabled: v })} label={t('启用遥控')} />
      </div>

      <Field label={t('电脑地址')}>
        <input
          type="text"
          value={r.url}
          placeholder="http://192.168.1.10:8719"
          onChange={(e) => patch({ url: e.target.value })}
        />
      </Field>

      <Field label={t('配对令牌')}>
        <input type="text" value={r.token} onChange={(e) => patch({ token: e.target.value })} />
      </Field>

      <button
        className="btn block"
        onClick={async () => {
          setPing(t('连接中…'));
          try {
            const res = await fetch(`${r.url.replace(/\/+$/, '')}/ping`);
            const j = await res.json();
            setPing(j.ok ? t('连通了：{host}', { host: j.host }) : t('对面返回了意外内容'));
          } catch (e) {
            setPing(t('连不上：{reason}', { reason: e instanceof Error ? e.message : String(e) }));
          }
        }}
      >
        {t('测试连通')}
      </button>
      {ping ? <div className="hint" style={{ marginTop: 8 }}>{ping}</div> : null}
    </div>
  );
}

function SyncTab(props: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const t = useT();
  const bridge = desktop();
  const cfg = props.settings.sync ?? { dir: '', auto: false };
  const patch = (p: Partial<typeof cfg>) => props.onChange({ sync: { ...cfg, ...p } });
  const [pass, setPass] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const [bad, setBad] = React.useState(false);
  const [peers, setPeers] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!bridge || !cfg.dir) { setPeers(null); return; }
    void bridge.syncPeek(cfg.dir).then((list) => setPeers(list.length)).catch(() => setPeers(null));
  }, [bridge, cfg.dir]);

  if (!bridge) {
    return (
      <div className="hint" style={{ lineHeight: 1.8 }}>
        {t('同步要往一个本地文件夹读写，所以只能在桌面端跑。手机端拿到同一份数据有两条路：把桌面端的同步文件夹放进网盘，或者用「遥控」把工具调用转发到桌面执行。')}
      </div>
    );
  }

  return (
    <div>
      <div className="hint" style={{ marginBottom: 14, lineHeight: 1.8 }}>
        {t('同步的是会话、项目、技能、定时任务、任务记录和路由做成率 —— 也就是这个应用积累下来的使用习惯。')}
        <br />
        <strong>{t('API 密钥不参与同步，一次也不会。')}</strong>
        {t('密钥用系统的加密能力锁在本机（Windows 是 DPAPI，macOS 是钥匙串），搬到另一台机器上本来也解不开。另一台设备要用同一条路由，自己填一个密钥，或者走遥控转发。')}
        <br />
        {t('事件钩子也不同步：钩子是一条会自动执行的命令行，同步它等于让任何能写这个文件夹的人往你的桌面投递可执行内容。换设备请手动重配。')}
      </div>

      <Field
        label={t('同步文件夹')}
        hint={t('放进网盘、Syncthing 的共享目录、或者局域网/Tailscale 上挂的共享盘都行。落点上躺的永远是密文，所以这个文件夹本身不需要可信。')}
      >
        <div className="row">
          <input type="text" value={cfg.dir} readOnly placeholder={t('还没选')} />
          <button
            className="btn"
            onClick={async () => {
              const d = await bridge.syncPickFolder();
              if (d) patch({ dir: d });
            }}
          >
            {t('选文件夹')}
          </button>
        </div>
      </Field>

      <Field
        label={t('同步口令')}
        hint={t('至少 12 位。每次同步现输，不保存 —— 存下来就等于把锁和钥匙放在一起。两台设备必须用同一串。忘了只能重新配一次同步。')}
      >
        <input
          type="password"
          value={pass}
          autoComplete="off"
          onChange={(e) => setPass(e.target.value)}
          placeholder={t('至少 12 位')}
        />
      </Field>

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className="btn primary"
          disabled={busy || !cfg.dir || pass.length < 12}
          onClick={async () => {
            setBusy(true);
            setBad(false);
            setNote(t('同步中…'));
            try {
              const { syncOnce } = await import('../lib/sync');
              const r = await syncOnce(cfg.dir, pass, props.settings);
              props.onChange(r.settings);
              const counts = Object.values(r.merged).reduce((a, b) => a + b, 0);
              setNote(
                r.failures.length
                  ? t('同步完成：{devices} 台设备，{items} 条记录；{bad} 个包没打开（口令不对或写到一半）。', {
                      devices: String(r.devices), items: String(counts), bad: String(r.failures.length),
                    })
                  : t('同步完成：{devices} 台设备，{items} 条记录。', {
                      devices: String(r.devices), items: String(counts),
                    }),
              );
              setBad(r.failures.length > 0);
              void bridge.syncPeek(cfg.dir).then((l) => setPeers(l.length)).catch(() => {});
            } catch (e) {
              setBad(true);
              setNote(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('立即同步')}
        </button>
        {peers !== null ? (
          <span className="chip">{t('文件夹里有 {n} 台设备', { n: String(peers) })}</span>
        ) : null}
      </div>

      {note ? (
        <div className="hint" style={{ color: bad ? 'var(--danger)' : undefined, lineHeight: 1.8 }}>{note}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function SettingsDialog(props: {
  tab: string;
  onTab: (t: string) => void;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  onTestProfile: (p: KeyProfile) => Promise<string>;
  encryptionAvailable: boolean | null;
  storePath: string;
}) {
  const t = useT();
  const tab = (['keys', 'routes', 'tools', 'effort', 'remote', 'sync', 'look'] as Tab[]).includes(props.tab as Tab)
    ? (props.tab as Tab)
    : 'keys';
  const setTab = (t: Tab) => props.onTab(t);
  const s = props.settings;
  const bridge = desktop();

  /* ---------------- 凭据 ---------------- */

  function updateProfile(id: string, patch: Partial<KeyProfile>) {
    props.onChange({
      keyProfiles: s.keyProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    });
  }

  function addProfile() {
    const p: KeyProfile = {
      id: uid('k'),
      name: t('凭据 {n}', { n: s.keyProfiles.length + 1 }),
      baseUrl: BASE_URL_PRESETS[0].url,
      hasSecret: false,
      extraHeaders: {},
      createdAt: Date.now(),
    };
    props.onChange({
      keyProfiles: [...s.keyProfiles, p],
      activeKeyProfileId: s.activeKeyProfileId ?? p.id,
    });
  }

  const [testing, setTesting] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<Record<string, string>>({});

  function KeysTab() {
    return (
      <div>
        {props.encryptionAvailable === false ? (
          <div className="card" style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}>
            {t('这台机器上系统级加密不可用，密钥会以明文存在 {path}。别把这个文件同步到云盘或共享出去。', { path: props.storePath })}
          </div>
        ) : null}

        {s.keyProfiles.length === 0 ? (
          <div className="empty">
            {t('还没有登记任何凭据。')}
            <br />
            {t('去 platform.sensenova.cn 控制台复制一个 API Key 回来。')}
          </div>
        ) : null}

        {s.keyProfiles.map((p) => (
          <div className="card" key={p.id}>
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                type="text"
                value={p.name}
                onChange={(e) => updateProfile(p.id, { name: e.target.value })}
                style={{ fontWeight: 600 }}
              />
              <label className="switch" title={t('设为当前使用的凭据')}>
                <input
                  type="radio"
                  name="activeProfile"
                  checked={s.activeKeyProfileId === p.id}
                  onChange={() => props.onChange({ activeKeyProfileId: p.id })}
                  style={{ appearance: 'auto', width: 16, height: 16 }}
                />
                <span style={{ fontSize: 12 }}>{t('当前')}</span>
              </label>
              <button
                className="btn sm danger"
                onClick={() => {
                  void secretDelete(p.id);
                  const rest = s.keyProfiles.filter((x) => x.id !== p.id);
                  props.onChange({
                    keyProfiles: rest,
                    activeKeyProfileId:
                      s.activeKeyProfileId === p.id ? (rest[0]?.id ?? null) : s.activeKeyProfileId,
                  });
                }}
              >
                {t('删除')}
              </button>
            </div>

            <Field
              label="API Base URL"
              hint={t('免费额度走 token 端点；企业账号或自建网关填自己的地址。末尾不用加斜杠。')}
            >
              <input
                type="text"
                value={p.baseUrl}
                onChange={(e) => updateProfile(p.id, { baseUrl: e.target.value })}
                onBlur={(e) => updateProfile(p.id, { baseUrl: normalizeBaseUrl(e.target.value) })}
                list={`presets-${p.id}`}
              />
              <datalist id={`presets-${p.id}`}>
                {BASE_URL_PRESETS.map((b) => (
                  <option key={b.url} value={b.url}>
                    {b.label}
                  </option>
                ))}
              </datalist>
            </Field>

            <p className="hint" style={{ marginTop: -6, lineHeight: 1.8 }}>
              {t('找免费额度：社区清单 github.com/raullenchai/free-llm-api-resources 列了各家的免费档位和限流，它 fork 自 cheahjs/free-llm-api-resources。')}
              <br />
              {t('wickrunAI 与该清单的作者、以及清单内任何 API 供应商之间均无关联关系；本应用不对其作出任何认可或推荐，亦未获其认可或赞助。额度与条款由各供应商自行订立并可随时变更。')}
            </p>

            <Field label={t('给 Claude Code / Codex 当大脑时的接口协议')} hint={t('大多数路由是 OpenAI 兼容，由 wickrunAI 本机代理转换；只有端点本身支持 Anthropic /v1/messages 时才选原生，请求会原样转发。')}>
              <select aria-label={t('给 Claude Code / Codex 当大脑时的接口协议')} value={p.protocol ?? 'openai'} onChange={(e) => updateProfile(p.id, { protocol: e.target.value === 'anthropic' ? 'anthropic' : undefined })}>
                <option value="openai">{t('OpenAI 兼容（自动转换）')}</option>
                <option value="anthropic">{t('Anthropic 原生')}</option>
              </select>
            </Field>

            <Field label="API Key" hint={usesCloudKey(p.id) ? t('此账号的 API 密钥会加密保存到云端，并在已登录的设备上使用。') : t('保存后就只留在本机的安全存储里，界面上不再回显。')}>
              <SecretInput
                secretId={p.id}
                placeholder={t('粘贴 API Key')}
                onSaved={() => updateProfile(p.id, { hasSecret: true })}
              />
            </Field>

            <div className="row">
              <button
                className="btn sm"
                disabled={testing === p.id}
                onClick={async () => {
                  setTesting(p.id);
                  const msg = await props.onTestProfile(p);
                  setTestResult((r) => ({ ...r, [p.id]: msg }));
                  setTesting(null);
                }}
              >
                {testing === p.id ? t('测试中…') : t('测试连接')}
              </button>
              {testResult[p.id] ? (
                <span className="hint" style={{ flex: 1 }}>
                  {testResult[p.id]}
                </span>
              ) : null}
            </div>
          </div>
        ))}

        <button className="btn block" onClick={addProfile}>
          {t('＋ 添加一份凭据')}
        </button>

      </div>
    );
  }

  /* ---------------- 工具 ---------------- */

  function ToolsTab() {
    const tools = s.tools;
    const patch = (p: Partial<typeof tools>) => props.onChange({ tools: { ...tools, ...p } });

    return (
      <div>
        <div className="section">
          <div className="section-title">{t('代码改动')}</div>
          <label className="row"><input type="checkbox" checked={tools.showCodeChanges !== false} onChange={e=>patch({showCodeChanges:e.target.checked})} />{t('显示代码改动面板与对话摘要')}</label>
          <label className="row"><input type="checkbox" checked={tools.reviewCodeChanges === true} onChange={e=>patch({reviewCodeChanges:e.target.checked})} />{t('逐项修改前确认（可选）')}</label>
          <p className="hint">{t('默认先应用文件修改，任务结束后按整轮查看差异，选择保留或回退已记录的改动，无需逐项批准。隐藏面板仍保留记录。命令等其他权限确认继续有效。开启此选项才会逐项预审，并阻止命令、本机代理等无法提前预览的写入。该设置从下一次任务启动起作用。')}</p>
        </div>
        <div className="section">
          <div className="section-title">{t('工作目录')}</div>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t('文件和命令行工具只能在这些目录里动手。')}<strong>{t('一个都不加的话，这类工具会全部拒绝执行')}</strong>
            {t('。这是故意的，默认不给整块磁盘的权限。')}
          </div>

          {tools.workspaceRoots.map((root, i) => (
            <div className="row" key={`${root}-${i}`} style={{ marginBottom: 6 }}>
              <input type="text" value={root} readOnly style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
              <button
                className="btn sm danger"
                onClick={() => patch({ workspaceRoots: tools.workspaceRoots.filter((_, j) => j !== i) })}
              >
                {t('移除')}
              </button>
            </div>
          ))}

          {bridge ? (
            <button
              className="btn block"
              onClick={async () => {
                const dir = await bridge.pickFolder();
                if (dir && !tools.workspaceRoots.includes(dir)) {
                  patch({ workspaceRoots: [...tools.workspaceRoots, dir] });
                }
              }}
            >
              {t('＋ 选一个目录')}
            </button>
          ) : (
            <div className="hint">{t('工作目录只能在桌面端添加。')}</div>
          )}
        </div>

        <div className="section">
          <div className="section-title">{t('操作放行')}</div>
          <div className="hint" style={{ lineHeight: 1.85 }}>
            {t('危险操作问不问，已经挪到输入框左下角那个按钮上了：逐步确认 / 自动批准编辑 / 全部放行。每个会话各自记住自己的档位，随时能在对话中途切。')}
            <br />
            {t('放这儿不合适：这是个会话级、需要频繁切换的决定，藏在设置里等于逼你每次都翻两层。')}
          </div>
        </div>

        <div className="section">
          <div className="section-title">{t('权限台账')}</div>
          <div className="hint" style={{ lineHeight: 1.85, marginBottom: 10 }}>
            {t('每次放行或拒绝都记一笔，只增不改。上面那个「记住」决定的是下次还问不问，这里记的是你到底同意过什么 —— 那是最该能回头核对的东西。')}
          </div>
          {(s.grantLedger ?? []).length ? <>
            <ul className="grant-ledger">
              {[...(s.grantLedger ?? [])].reverse().slice(0, 50).map((g, i) => <li key={`${g.at}-${i}`}>
                <span className={g.granted ? 'badge-ok' : 'badge-off'}>{t(g.granted ? '已放行' : '已拒绝')}</span>
                <code>{g.scope === 'path' ? g.target : t(g.scope === 'screen' ? '屏幕控制' : '管理员权限')}</code>
                <small>{new Date(g.at).toLocaleString()}{g.remembered ? t('· 已记住') : ''}</small>
                {g.reason ? <small className="hint">{g.reason}</small> : null}
              </li>)}
            </ul>
            <button className="btn sm ghost" onClick={() => props.onChange({ grantLedger: [] })}>{t('清空台账')}</button>
          </> : <p className="hint">{t('还没有放行记录。')}</p>}
        </div>

        <div className="section">
          <div className="section-title">{t('事件驱动护栏')}</div>
          <div className="hint" style={{ lineHeight: 1.85, marginBottom: 10 }}>
            {t('模型每次改完东西，自动跑一条你写的检查命令。没通过就把原文摆到它面前，让它这一轮就看见；通过了一声不吭。')}
            <br />
            {t('适合放那些「每次都必须做、但模型总会忘」的规矩，比如改完 package.json 就核对版本号是不是三处都同步了。')}
            <br />
            <strong>{t('这些命令只从这里读，绝不从工作目录读。')}</strong>
            {t('否则任何一个克隆下来的仓库都能在你机器上自动执行命令。')}
          </div>
          {(s.hooks ?? []).map((hook, i) => <div className="section" key={hook.id} style={{ marginBottom: 8 }}>
            <Field label={t('名称')}>
              <input aria-label={t('护栏名称')} value={hook.name}
                onChange={e => props.onChange({ hooks: (s.hooks ?? []).map((h, x) => x === i ? { ...h, name: e.target.value } : h) })} />
            </Field>
            <Field label={t('检查命令')} hint={t('在工作目录里用本机的 shell 运行（Windows 是 cmd）。退出码非 0 就算没通过。')}>
              <input aria-label={t('检查命令')} value={hook.command} placeholder="node scripts/check-version.mjs"
                onChange={e => props.onChange({ hooks: (s.hooks ?? []).map((h, x) => x === i ? { ...h, command: e.target.value } : h) })} />
            </Field>
            <Field label={t('改动路径匹配')} hint={t('正则，留空表示不限。例如 package\\.json$')}>
              <input aria-label={t('改动路径匹配')} value={hook.pathPattern ?? ''}
                onChange={e => props.onChange({ hooks: (s.hooks ?? []).map((h, x) => x === i ? { ...h, pathPattern: e.target.value || undefined } : h) })} />
            </Field>
            <Field label={t('只在这个工作目录下触发')} hint={t('留空表示所有工作目录。')}>
              <input aria-label={t('只在这个工作目录下触发')} value={hook.workspaceRoot ?? ''}
                onChange={e => props.onChange({ hooks: (s.hooks ?? []).map((h, x) => x === i ? { ...h, workspaceRoot: e.target.value || undefined } : h) })} />
            </Field>
            <div className="field">
              <Switch checked={hook.enabled} label={t('启用')}
                onChange={v => props.onChange({ hooks: (s.hooks ?? []).map((h, x) => x === i ? { ...h, enabled: v } : h) })} />
            </div>
            <button className="btn sm ghost" onClick={() => props.onChange({ hooks: (s.hooks ?? []).filter((_, x) => x !== i) })}>{t('删除这条护栏')}</button>
          </div>)}
          <button className="btn sm" onClick={() => props.onChange({ hooks: [...(s.hooks ?? []), { id: uid('hook'), name: '', command: '', enabled: true }] })}>{t('添加一条护栏')}</button>
        </div>

        <div className="section">
          <div className="section-title">{t('搜索')}</div>
          <Field label={t('搜索源')}>
            <Segmented<SearchProvider>
              value={tools.searchProvider}
              options={[
                { value: 'tavily', label: 'Tavily' },
                { value: 'brave', label: 'Brave' },
                { value: 'searxng', label: 'SearXNG' },
              ]}
              onChange={(v) => patch({ searchProvider: v })}
            />
          </Field>

          {tools.searchProvider === 'tavily' ? (
            <Field label="Tavily API Key" hint={t('app.tavily.com 注册后拿，免费额度每月 1000 次。')}>
              <SecretInput secretId="tool:tavily" placeholder="tvly-..." />
            </Field>
          ) : null}

          {tools.searchProvider === 'brave' ? (
            <Field
              label="Brave Search API Key"
              hint={t('brave.com/search/api 申请，免费档每月 2000 次。注意 Brave 只给标题和摘要，需要正文时让模型再 fetch_url。')}
            >
              <SecretInput secretId="tool:brave" placeholder="BSA..." />
            </Field>
          ) : null}

          {tools.searchProvider === 'searxng' ? (
            <Field
              label={t('SearXNG 地址')}
              hint={t('自建实例的地址。要在它的 settings.yml 里打开 json 格式输出，否则会返回 403。')}
            >
              <input
                type="text"
                value={tools.searxngUrl}
                placeholder="http://127.0.0.1:8080"
                onChange={(e) => patch({ searxngUrl: e.target.value })}
              />
            </Field>
          ) : null}
        </div>

        <ChromeSection port={tools.chromePort} onPort={(v) => patch({ chromePort: v })} />

        <div className="section">
          <div className="section-title">GitHub</div>
          <Field
            label="Personal Access Token"
            hint={t('不填也能用，但只能读公开内容，而且限额是按 IP 每小时 60 次。填了变成 5000 次。代码搜索必须要 token。')}
          >
            <SecretInput secretId="tool:github" placeholder={t('ghp_... 或 github_pat_...')} />
          </Field>
          <RateLimitRow />
          <div className="hint" style={{ marginTop: 6, lineHeight: 1.8 }}>
            {t('到哪拿：github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token。Repository access 选「Public Repositories (read-only)」就够装技能了，什么权限都不用勾。')}
            <br />
            {t('已经装了 GitHub CLI 的话更快：命令行跑 gh auth login，然后 gh auth token 会把 token 打印出来，复制粘贴进上面那个框。')}
            <br />
            <b>{t('限额不能重置')}</b> —— 它是 GitHub 服务端按 IP 算的滚动窗口，客户端没有任何手段清零，
            只能等窗口滚过去，或者换成 token 额度。
          </div>
        </div>

        <div className="section">
          <div className="section-title">Claude Code</div>
          <Field label={t('claude 可执行文件')} hint={t('留空就用 PATH 里的 claude。装了但找不到就填绝对路径。')}>
            <input
              type="text"
              value={tools.claudeBin}
              placeholder="claude"
              onChange={(e) => patch({ claudeBin: e.target.value })}
            />
          </Field>
          <Field
            label={t('附加命令行参数')}
            hint={t('默认给了 --permission-mode acceptEdits，否则 headless 模式下它遇到要授权的操作会直接卡住。想让它更放得开可以调，但那意味着它改什么都不问你。')}
          >
            <input
              type="text"
              value={tools.claudeExtraArgs}
              onChange={(e) => patch({ claudeExtraArgs: e.target.value })}
            />
          </Field>
          <Field label={t('超时：{seconds} 秒', { seconds: Math.round(tools.claudeTimeoutMs / 1000) })}>
            <input
              type="range"
              min={30000}
              max={3600000}
              step={30000}
              value={tools.claudeTimeoutMs}
              onChange={(e) => patch({ claudeTimeoutMs: Number(e.target.value) })}
            />
          </Field>
        </div>
      </div>
    );
  }


  /* ---------------- 思考强度映射 ---------------- */

  function EffortTab() {
    const mappings = s.effortMappings;
    const setMappings = (next: EffortMapping[]) => props.onChange({ effortMappings: next });
    const patchAt = (i: number, patch: Partial<EffortMapping>) =>
      setMappings(mappings.map((m, j) => (j === i ? { ...m, ...patch } : m)));

    const levels = EFFORT_LEVELS.filter((l) => l.value !== 'off');
    const EMPTY_LEVELS = { low: '', medium: '', high: '', xhigh: '', max: '' };

    return (
      <div>
        <div className="hint" style={{ marginBottom: 14, lineHeight: 1.85 }}>
          {t('同一件事（「多想一会儿」）各家 API 长得完全不一样：OpenAI 用 reasoning_effort 字符串，Anthropic 用 thinking 对象带 token 预算，通义智谱用 enable_thinking 加预算，DeepSeek 的 reasoner 干脆没有开关。')}
          <br />
          {t('所以输入框右下角只给一档五级刻度，切模型不用重学。这张表负责翻译：')}
          <strong>{t('按顺序匹配模型 ID，第一条命中的生效')}</strong>。
          <br />
          {t('标了「推测」的几条是按厂商惯例填的，没有逐个实测。报 400 就改这里，不用改代码。')}
        </div>

        {mappings.map((m, i) => (
          <div className="card" key={m.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={m.label}
                onChange={(e) => patchAt(i, { label: e.target.value })}
                style={{ fontWeight: 600, flex: '0 0 150px' }}
              />
              <input
                type="text"
                value={m.pattern}
                onChange={(e) => patchAt(i, { pattern: e.target.value })}
                placeholder={t('匹配模型 ID 的正则')}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
              />
              {m.unverified ? <span className="badge-danger">{t('推测')}</span> : null}
              <button className="icon-btn" title={t('上移')} onClick={() => {
                if (i === 0) return;
                const next = [...mappings];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                setMappings(next);
              }}>↑</button>
              <button className="btn sm danger" onClick={() => setMappings(mappings.filter((_, j) => j !== i))}>
                {t('删除')}
              </button>
            </div>

            <Field label={t('下发方式')}>
              <select
                value={m.style}
                onChange={(e) => patchAt(i, { style: e.target.value as EffortStyle })}
              >
                {(Object.keys(STYLE_LABEL) as EffortStyle[]).map((k) => (
                  <option key={k} value={k}>
                    {t(STYLE_LABEL[k])}
                  </option>
                ))}
              </select>
            </Field>

            {m.style !== 'none' ? (
              <div>
                <div className="field-label" style={{ marginBottom: 4 }}>
                  {t('每一级发什么')}
                  <span style={{ fontWeight: 400, color: 'var(--fg-faint)' }}>
                    {m.style === 'openai'
                      ? t('（填字符串，例如 low / medium / high）')
                      : m.style === 'custom'
                        ? t('（填 JSON 片段）')
                        : t('（填 token 预算数字）')}
                  </span>
                </div>
                {levels.map((l) => (
                  <div className="param-row" key={l.value}>
                    <span className="popup-icon">{l.short}</span>
                    <span className="name">{l.label}</span>
                    <input
                      type="text"
                      value={(m.levels ?? EMPTY_LEVELS)[l.value as keyof typeof EMPTY_LEVELS] ?? ''}
                      placeholder={t('留空 = 这一级不下发')}
                      onChange={(e) =>
                        patchAt(i, {
                          levels: { ...EMPTY_LEVELS, ...m.levels, [l.value]: e.target.value },
                        })
                      }
                      style={{ width: m.style === 'custom' ? 200 : 120 }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}

        <div className="row">
          <button
            className="btn"
            onClick={() =>
              setMappings([
                {
                  id: `m-${Date.now()}`,
                  pattern: '',
                  label: '新规则',  // 用户可改的规则名，存进设置，不随语言变
                  style: 'openai',
                  levels: { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' },
                },
                ...mappings,
              ])
            }
          >
            {t('＋ 加一条（插到最前面）')}
          </button>
          <button className="btn" onClick={() => setMappings(defaultEffortMappings())}>
            {t('恢复默认')}
          </button>
        </div>
      </div>
    );
  }

  /* ---------------- 外观 ---------------- */

  function LookTab() {
    return (
      <div>
        <Field label={t('主题')}>
          <Segmented
            value={s.theme}
            options={[
              { value: 'system' as const, label: t('跟随系统') },
              { value: 'light' as const, label: t('浅色') },
              { value: 'dark' as const, label: t('深色') },
            ]}
            onChange={(v) => props.onChange({ theme: v })}
          />
        </Field>

        <Field label={t('界面语言')}>
          <Segmented
            value={s.locale ?? 'zh-Hans'}
            options={LOCALES.map((item) => ({ value: item.value, label: item.label2 }))}
            onChange={(v) => props.onChange({ locale: v })}
          />
        </Field>

        <Field label={t('控件密度')}>
          <Segmented
            value={s.uiDensity ?? 'default'}
            options={[
              { value: 'compact' as const, label: t('紧凑') },
              { value: 'default' as const, label: t('默认') },
              { value: 'roomy' as const, label: t('宽松') },
            ]}
            onChange={(v) => props.onChange({ uiDensity: v })}
          />
        </Field>

        <div className="field"><Switch checked={s.notifications?.enabled!==false} onChange={enabled=>props.onChange({notifications:{...s.notifications,enabled}})} label={t('后台任务通知（提问、暂停、完成）')} /></div>
        <div className="field"><Switch checked={s.notifications?.sound!==false} onChange={sound=>props.onChange({notifications:{...s.notifications,sound}})} label={t('通知提示音（遵循系统声音与勿扰设置）')} /></div>
        <Field label={t('发送快捷键')}>
          <Segmented
            value={s.sendKey}
            options={[
              { value: 'enter' as const, label: t('Enter 发送') },
              { value: 'mod-enter' as const, label: t('Ctrl/⌘+Enter 发送') },
            ]}
            onChange={(v) => props.onChange({ sendKey: v })}
          />
        </Field>

        <Field label={t('字号：{percent}%', { percent: Math.round(s.fontScale * 100) })}>
          <input
            type="range"
            min={0.85}
            max={1.4}
            step={0.05}
            value={s.fontScale}
            onChange={(e) => props.onChange({ fontScale: Number(e.target.value) })}
          />
        </Field>

        <div className="field">
          <Switch
            checked={s.showReasoningByDefault}
            onChange={(v) => props.onChange({ showReasoningByDefault: v })}
            label={t('生成时自动展开思考过程')}
          />
        </div>

        <Field label={t('请求超时：{seconds} 秒', { seconds: Math.round(s.requestTimeoutMs / 1000) })}>
          <input
            type="range"
            min={30000}
            max={600000}
            step={10000}
            value={s.requestTimeoutMs}
            onChange={(e) => props.onChange({ requestTimeoutMs: Number(e.target.value) })}
          />
        </Field>

        <div className="hint" style={{ marginTop: 16, lineHeight: 1.9 }}>
          {props.storePath ? (
            <>
              {t('数据文件：')}<code>{props.storePath}</code>
              <br />
            </>
          ) : null}
          {t('构建于：')}<code>{t(buildTime())}</code>
          <br />
          {t('改了代码之后要重新跑一次打包，这里的时间才会变。遇到「明明改了却没生效」先看这个。')}
        </div>
      </div>
    );
  }

  return (
    <Modal title={t('设置')} onClose={props.onClose} wide>
      <div className="tabs">
        {(Object.keys(TAB_LABEL) as Tab[]).map((name) => (
          <button key={name} className={name === tab ? 'on' : ''} onClick={() => setTab(name)}>
            {t(TAB_LABEL[name])}
          </button>
        ))}
      </div>
      <div className="modal-body">
        {tab === 'keys' ? KeysTab() : null}
        {tab === 'routes' ? <RouteGroupsSettings settings={s} onChange={props.onChange} /> : null}
        {tab === 'tools' ? ToolsTab() : null}
        {tab === 'effort' ? EffortTab() : null}
        {tab === 'remote' ? <RemoteTab settings={s} onChange={props.onChange} /> : null}
        {tab === 'sync' ? <SyncTab settings={s} onChange={props.onChange} /> : null}
        {tab === 'look' ? LookTab() : null}
      </div>
    </Modal>
  );
}
