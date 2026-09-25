import React from 'react';
import { useT, type Translate } from '../lib/i18n';
import { desktop } from '../lib/transport';
import { CLIENT_LABELS, type ClientKind, type ClientSelection, type ClientStatus } from '../lib/connections';
import type { AppSettings } from '../types';
import './ClientConnections.css';
import ClaudeRepair from './ClaudeRepair';
import NativeAiPanel from './NativeAiPanel';
import BrainPicker from './BrainPicker';

type CliClientKind = Exclude<ClientKind, 'claude-desktop'>;
const CLIENTS: CliClientKind[] = ['codex', 'claude', 'kimi', 'grok'];
const STATUS_LABEL: Record<ClientStatus['status'], string> = {
  missing: '未安装',
  installed: '已安装',
  login_required: '待登录',
  ready: '已连接',
  error: '连接异常',
  waiting_login: '等待登录',
};

interface RateWindow {
  usedPercent?: number;
  windowDurationMins?: number;
}

interface LocalClientInspection {
  account?: { account?: { planType?: string | null } | null };
  rateLimits?: {
    rateLimits?: { primary?: RateWindow | null; secondary?: RateWindow | null } | null;
    rateLimitsByLimitId?: Record<string, { primary?: RateWindow | null; secondary?: RateWindow | null } | null>;
  } | null;
}

let sessionStatuses: Partial<Record<ClientKind, ClientStatus>> = {};
let sessionInspections: Partial<Record<ClientKind, LocalClientInspection>> = {};
let lastAutoCheckAt = 0;

function windowLabel(window: RateWindow, t: Translate) {
  if (!Number.isFinite(window.usedPercent)) return null;
  const remaining = Math.max(0, Math.min(100, 100 - Number(window.usedPercent)));
  const duration = Number(window.windowDurationMins);
  const durationLabel = Number.isFinite(duration)
    ? duration % 1440 === 0
      ? t('{n} 天窗口', { n: duration / 1440 })
      : duration % 60 === 0
        ? t('{n} 小时窗口', { n: duration / 60 })
        : t('{n} 分钟窗口', { n: duration })
    : t('当前窗口');
  return t('{window}剩余 {percent}%', { window: durationLabel, percent: remaining });
}

function QuotaSummary({ inspection }: { inspection?: LocalClientInspection }) {
  const t = useT();
  if (!inspection) return <p className="quota-note">{t('额度：尚未检测。')}</p>;
  const groups = inspection.rateLimits?.rateLimitsByLimitId ?? {};
  const limits = Object.keys(groups).length > 0 ? groups : inspection.rateLimits?.rateLimits ? { [t('订阅额度')]: inspection.rateLimits.rateLimits } : {};
  const rows = Object.entries(limits).flatMap(([name, limit]) =>
    [limit?.primary, limit?.secondary]
      .map((window) => window && windowLabel(window, t))
      .filter((label): label is string => Boolean(label))
      .map((label) => ({ name, label })),
  );
  const plan = inspection.account?.account?.planType;
  if (rows.length === 0) return <p className="quota-note">{t('额度：官方客户端未提供可读取的剩余额度')}{plan ? `（${plan}）` : ''}。</p>;
  return (
    <div className="quota-summary" aria-label={t('Codex 订阅额度')}>
      {plan ? <span className="quota-plan">{plan}</span> : null}
      {rows.map((row, index) => <span key={`${row.name}-${index}`}>{Object.keys(limits).length > 1 ? `${row.name} · ` : ''}{row.label}</span>)}
    </div>
  );
}

export default function ClientConnections({ selection, onSelect, settings, onSettings }: {
  selection?: ClientSelection;
  onSelect: (value: ClientSelection | undefined) => void;
  settings: AppSettings;
  onSettings: (patch: Partial<AppSettings>) => void;
}) {
  const t = useT();
  const [statuses, setStatusState] = React.useState<Partial<Record<ClientKind, ClientStatus>>>(() => sessionStatuses);
  const [inspections, setInspectionState] = React.useState<Partial<Record<ClientKind, LocalClientInspection>>>(() => sessionInspections);
  const [busy, setBusy] = React.useState<ClientKind | 'all' | 'quota' | null>('all');
  const [error, setError] = React.useState('');

  const setStatuses = React.useCallback((update: (previous: Partial<Record<ClientKind, ClientStatus>>) => Partial<Record<ClientKind, ClientStatus>>) => {
    setStatusState((previous) => {
      const next = update(previous);
      sessionStatuses = next;
      return next;
    });
  }, []);

  const setInspections = React.useCallback((update: (previous: Partial<Record<ClientKind, LocalClientInspection>>) => Partial<Record<ClientKind, LocalClientInspection>>) => {
    setInspectionState((previous) => {
      const next = update(previous);
      sessionInspections = next;
      return next;
    });
  }, []);

  React.useEffect(() => {
    const api = desktop();
    if (!api) {
      setBusy(null);
      return;
    }
    if (CLIENTS.every((kind) => sessionStatuses[kind]) && Date.now() - lastAutoCheckAt < 30_000) {
      setBusy(null);
      return;
    }
    let active = true;
    void Promise.allSettled(CLIENTS.map((kind) => api.conversationClientCheck(kind))).then((results) => {
      if (!active) return;
      setStatuses((previous) => {
        const next = { ...previous };
        results.forEach((result, index) => {
          const kind = CLIENTS[index];
          next[kind] = result.status === 'fulfilled' ? result.value : {
            kind,
            status: 'error',
            models: [],
            message: t('未能完成连接检测，请稍后重试。'),
          };
        });
        return next;
      });
      lastAutoCheckAt = Date.now();
      setBusy(null);
    });
    return () => {
      active = false;
    };
  }, [setStatuses]);

  const act = async (kind: CliClientKind, connect = false) => {
    const api = desktop();
    if (!api) return;
    setBusy(kind);
    setError('');
    try {
      const result = await (connect ? api.conversationClientConnect(kind) : api.conversationClientCheck(kind));
      setStatuses((previous) => ({ ...previous, [kind]: result }));
      if (connect && result.status === 'ready') {
        onSelect({ kind, model: result.models[0]?.id || 'default', effort: result.models[0]?.defaultEffort });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const inspectQuota = async () => {
    const api = desktop();
    if (!api) return;
    setBusy('quota');
    setError('');
    try {
      const result = await api.clientCheck('codex') as LocalClientInspection;
      setInspections((previous) => ({ ...previous, codex: result }));
    } catch (cause) {
      setInspections((previous) => ({ ...previous, codex: {} }));
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (kind: CliClientKind) => {
    const file = await desktop()?.pickClientBinary();
    if (!file) return;
    if (kind === 'claude') {
      onSettings({ tools: { ...settings.tools, claudeBin: file } });
    } else {
      onSettings({ clients: { codexBin: settings.clients?.codexBin || '', ...settings.clients, [`${kind}Bin`]: file } });
    }
    setStatuses((previous) => ({ ...previous, [kind]: undefined }));
    await act(kind);
  };

  if (!desktop()) {
    return <section className="client-connections" aria-label={t('本机 AI')}><p className="picker-empty">{t('本机 AI 连接需要桌面版。')}</p></section>;
  }

  return (
    <section className="client-connections" aria-label={t('本机 AI')}>
      <div className="local-ai-intro">
        <strong>{t('本机 AI')}</strong>
        <span>{t(busy === 'all' ? '正在检测连接…' : '连接官方客户端后，在这里选择模型与思考强度。')}</span>
      </div>

      {CLIENTS.map((kind) => {
        const status = statuses[kind];
        const selected = selection?.kind === kind;
        const state = status?.status === 'ready' ? 'ready' : status?.status === 'error' || status?.status === 'missing' ? 'error' : 'idle';
        const model = status?.models.find((item) => item.id === selection?.model);
        const efforts = model?.efforts ?? (selection?.effort ? [selection.effort] : []);
        return (
          <div key={kind} className={`client-row${selected ? ' selected' : ''}`}>
            <div className="client-heading">
              <strong>{CLIENT_LABELS[kind]}</strong>
              <span className={`connection-state ${state}`}>
                <span aria-hidden="true" />
                {t(status ? STATUS_LABEL[status.status] : '检测中')}
              </span>
            </div>
            <p>{status?.message || t(kind === 'codex' ? '可用 ChatGPT 订阅，或把 wickrunAI 里的任一路由当作 Codex 的大脑。' : kind === 'claude' ? '可用 Claude 订阅、现有配置，或把 wickrunAI 里的任一路由当作 Claude Code 的大脑。' : kind === 'grok' ? '使用官方 Grok 登录与本机 Grok Desktop 订阅模型。' : '通过 Kimi 官方 ACP 接口连接。')}</p>

            {selected && (kind === 'claude' || kind === 'codex') ? (
              <BrainPicker kind={kind} selection={selection} settings={settings} onSelect={onSelect} clientModels={status?.models ?? []} clientEfforts={efforts} />
            ) : selected ? (
              <div className="client-model-fields">
                <label>
                  <span>{t('模型')}</span>
                  <select aria-label={t('{client} 模型', { client: CLIENT_LABELS[kind] })} value={selection.model} onChange={(event) => {
                    const next = status?.models.find((item) => item.id === event.target.value);
                    onSelect({ ...selection, model: event.target.value, effort: next?.defaultEffort });
                  }}>
                    {!status?.models.some((item) => item.id === selection.model) ? <option value={selection.model}>{selection.model === 'default' ? t('官方客户端默认模型') : selection.model}</option> : null}
                    {status?.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('思考强度')}</span>
                  <select aria-label={t('{client} 思考强度', { client: CLIENT_LABELS[kind] })} value={selection.effort || ''} onChange={(event) => onSelect({ ...selection, effort: event.target.value || undefined })}>
                    <option value="">{t('官方默认')}</option>
                    {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                  </select>
                </label>
              </div>
            ) : null}

            <div className="client-actions">
              {status?.status === 'login_required' && (kind === 'codex' || kind === 'grok') ? (
                <button className="btn sm" disabled={busy !== null} onClick={() => void act(kind, true)}>{t(busy === kind ? '正在打开…' : kind === 'grok' ? '登录 Grok' : '登录 ChatGPT')}</button>
              ) : status?.status === 'ready' || ((kind === 'claude' || kind === 'codex') && status?.binary && status.status !== 'missing' && settings.keyProfiles.length > 0) ? (
                <button className="btn sm" disabled={selected} onClick={() => onSelect({ kind, model: status.models[0]?.id || 'default', effort: status.models[0]?.defaultEffort })}>{t(selected ? '正在使用' : '使用此连接')}</button>
              ) : (
                <button className="btn sm" disabled={busy !== null} onClick={() => void act(kind, true)}>{t(busy === kind ? '连接中…' : '一键连接')}</button>
              )}
              <button className="btn sm ghost" disabled={busy !== null} onClick={() => void act(kind)}>{t(busy === kind ? '检测中…' : '重新检测')}</button>
              {status?.status === 'missing' ? <button className="btn sm ghost" disabled={busy !== null} onClick={() => void pick(kind)}>{t('选择程序')}</button> : null}
              {kind === 'codex' ? <button className="btn sm ghost" disabled={busy !== null} onClick={() => void inspectQuota()}>{t(busy === 'quota' ? '检测额度中…' : '检测额度')}</button> : null}
            </div>

            {kind === 'codex' ? <QuotaSummary inspection={inspections.codex} /> : <p className="quota-note">{t('额度：{client} 未提供可读取的剩余额度。', { client: CLIENT_LABELS[kind] })}</p>}
            {kind === 'claude' && status?.status === 'error' ? <ClaudeRepair disabled={busy !== null} onResult={(result) => setStatuses((previous) => ({ ...previous, claude: result }))} /> : null}
          </div>
        );
      })}

      <NativeAiPanel
        selected={selection?.kind === 'claude-desktop'}
        onSelect={() => onSelect({ kind: 'claude-desktop', model: 'desktop' })}
      />
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
    </section>
  );
}
