import React from 'react';
import { useT } from '../lib/i18n';
import { desktop } from '../lib/transport';
import { CLIENT_LABELS, type BrainGlobalStatus, type ClientBrain, type ClientSelection } from '../lib/connections';
import { EFFORT_LEVELS, effortFields, type EffortLevel } from '../lib/effort';
import { routeKey } from '../lib/adaptive';
import type { AppSettings, KeyProfile } from '../types';

/**
 * Claude Code / Codex 的「大脑」：用哪条路由思考、哪个模型、多大思考强度。
 *
 * 和 API 模型用同一套东西：凭据页登记的路由、模型列表、五级思考强度与映射表。
 * 选了路由，wickrunAI 在本机开一个代理把客户端协议翻成路由的协议，密钥不出 wickrunAI。
 * 路由和模型完全由用户挑；程序不判断哪条付费、哪条更好。
 */

type BrainClient = 'claude' | 'codex';

const WICKRUN_LEVELS = EFFORT_LEVELS.map((l) => l.value);

/** 按当前路由 + 模型 + 强度算出要随请求下发的字段，与 API 对话走的是同一张映射表 */
export function brainForRoute(settings: AppSettings, profile: KeyProfile, model: string, level: EffortLevel): ClientBrain {
  return {
    source: 'route',
    profileId: profile.id,
    extras: effortFields(model, level, settings.effortMappings ?? []),
    outputField: profile.routeProfiles?.[routeKey(profile, model)]?.outputField,
  };
}

function profileModels(settings: AppSettings, id: string): string[] {
  return [...new Set([...(settings.cachedModels[id] ?? []), ...(settings.customModels[id] ?? [])].map((m) => m.id))];
}
const CUSTOM = '__custom__';

export default function BrainPicker({ kind, selection, settings, onSelect, clientModels, clientEfforts, configIssue }: {
  kind: BrainClient;
  selection: ClientSelection;
  settings: AppSettings;
  onSelect: (value: ClientSelection) => void;
  /** 客户端自己报告的模型（订阅 / 配置模式下用） */
  clientModels: { id: string; label: string; efforts: string[]; defaultEffort?: string }[];
  clientEfforts: string[];
  /** Claude Code 自己配置的网关没有响应时的说明；只影响「沿用客户端配置」这个大脑 */
  configIssue?: string;
}) {
  const t = useT();
  const brain = selection.brain ?? { source: 'config' as const };
  const profile = brain.source === 'route' ? settings.keyProfiles.find((p) => p.id === brain.profileId) : undefined;
  const models = profile ? profileModels(settings, profile.id) : [];
  const current = selection.model === 'default' ? '' : selection.model;
  // 下拉列出这条路由的全部模型；列表里没有的模型走「自定义」输入框。
  // 以前用 input + datalist，浏览器只显示和已填内容匹配的项，看起来就像只有一个模型
  const [customOpen, setCustomOpen] = React.useState(false);
  const custom = customOpen || (Boolean(current) && !models.includes(current)) || !models.length;

  const setSource = (value: string) => {
    if (value === 'config' || value === 'subscription') {
      const first = clientModels[0];
      onSelect({ ...selection, brain: { source: value }, model: first?.id || 'default', effort: first?.defaultEffort });
      return;
    }
    const next = settings.keyProfiles.find((p) => p.id === value);
    if (!next) return;
    const model = profileModels(settings, next.id)[0] || '';
    const level = (WICKRUN_LEVELS.includes(selection.effort as EffortLevel) ? selection.effort : 'medium') as EffortLevel;
    onSelect({ ...selection, model: model || 'default', effort: level, brain: brainForRoute(settings, next, model, level) });
  };
  const setRoute = (model: string, level: EffortLevel) => {
    if (!profile) return;
    onSelect({ ...selection, model: model || 'default', effort: level, brain: brainForRoute(settings, profile, model, level) });
  };
  const level = (WICKRUN_LEVELS.includes(selection.effort as EffortLevel) ? selection.effort : 'medium') as EffortLevel;

  return <div className="client-model-fields brain-fields">
    <label>
      <span>{t('大脑')}</span>
      <select aria-label={t('{client} 大脑来源', { client: CLIENT_LABELS[kind] })} value={brain.source === 'route' ? brain.profileId : kind === 'codex' && brain.source === 'config' ? 'subscription' : brain.source} onChange={(e) => setSource(e.target.value)}>
        {kind === 'claude' ? <option value="config">{t('沿用 Claude Code 自己的配置')}</option> : null}
        <option value="subscription">{t(kind === 'claude' ? '本机 Claude 订阅（官方登录）' : '本机 ChatGPT 订阅（官方登录）')}</option>
        {settings.keyProfiles.length ? <optgroup label={t('wickrunAI 路由')}>
          {settings.keyProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </optgroup> : null}
      </select>
    </label>
    {brain.source === 'route' ? <>
      <label>
        <span>{t('模型')}</span>
        {models.length ? <select aria-label={t('{client} 大脑模型', { client: CLIENT_LABELS[kind] })} value={custom ? CUSTOM : current} onChange={(e) => {
          if (e.target.value === CUSTOM) { setCustomOpen(true); return; }
          setCustomOpen(false); setRoute(e.target.value, level);
        }}>
          {!current && !custom ? <option value="">{t('选择模型')}</option> : null}
          {models.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value={CUSTOM}>{t('自定义模型 ID…')}</option>
        </select> : null}
        {custom ? <input type="text" aria-label={t('{client} 自定义大脑模型', { client: CLIENT_LABELS[kind] })} value={current}
          placeholder={t('输入模型 ID')} onChange={(e) => setRoute(e.target.value.trim(), level)} /> : null}
      </label>
      <label>
        <span>{t('思考强度')}</span>
        <select aria-label={t('{client} 思考强度', { client: CLIENT_LABELS[kind] })} value={level} onChange={(e) => setRoute(selection.model === 'default' ? '' : selection.model, e.target.value as EffortLevel)}>
          {EFFORT_LEVELS.map((l) => <option key={l.value} value={l.value}>{t(l.label)}</option>)}
        </select>
      </label>
      <p className="hint">{t('请求经 wickrunAI 本机代理转换后发往「{name}」；密钥留在 wickrunAI，思考强度按映射表下发。', { name: profile?.name ?? '' })}</p>
      {!models.length ? <p className="hint">{t('这条路由还没有模型列表：去设置 → API 凭据刷新模型，或直接输入模型 ID。')}</p> : null}
    </> : <>
      {brain.source === 'config' && configIssue ? <p className="hint brain-warning" role="status">{t('Claude Code 自己配置的本机网关没有响应，这个大脑现在用不了：可以改选本机订阅或 wickrunAI 路由，或点下面的「修复连接」。')}</p> : null}
      <label>
        <span>{t('模型')}</span>
        <select aria-label={t('{client} 模型', { client: CLIENT_LABELS[kind] })} value={selection.model} onChange={(event) => {
          const next = clientModels.find((item) => item.id === event.target.value);
          onSelect({ ...selection, model: event.target.value, effort: next?.defaultEffort });
        }}>
          {!clientModels.some((item) => item.id === selection.model) ? <option value={selection.model}>{selection.model === 'default' ? t('官方客户端默认模型') : selection.model}</option> : null}
          {clientModels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <label>
        <span>{t('思考强度')}</span>
        <select aria-label={t('{client} 思考强度', { client: CLIENT_LABELS[kind] })} value={selection.effort || ''} onChange={(event) => onSelect({ ...selection, effort: event.target.value || undefined })}>
          <option value="">{t('官方默认')}</option>
          {clientEfforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
        </select>
      </label>
    </>}
    <BrainGlobal kind={kind} selection={selection} />
  </div>;
}

/** 把当前大脑写进 Claude Code / Codex 的全局配置，终端里直接用也生效；可一键还原 */
function BrainGlobal({ kind, selection }: { kind: BrainClient; selection: ClientSelection }) {
  const t = useT();
  const [status, setStatus] = React.useState<BrainGlobalStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  React.useEffect(() => { void desktop()?.brainGlobalStatus().then(setStatus).catch(() => {}); }, []);
  const api = desktop();
  if (!api) return null;
  const brain = selection.brain ?? { source: 'config' as const };
  const applied = status?.applied[kind];
  const current = status?.[kind];
  const run = async (mode: 'route' | 'subscription' | 'restore') => {
    setBusy(true); setNote('');
    try {
      const result = await api.brainGlobalApply({ client: kind, mode, ...(mode === 'route' ? { brain: { ...brain, model: selection.model } } : {}) });
      setStatus(result);
      setNote(result.changed ? t('已写入 {file}（首次接管前的原文件另存为 .before-wickrun）。', { file: result.file }) : t(result.message ?? '没有需要还原的内容。'));
    } catch (cause) { setNote(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const canRoute = brain.source === 'route' && selection.model && selection.model !== 'default';
  return <details className="brain-global">
    <summary>{t('终端里的 {client}', { client: CLIENT_LABELS[kind] })}{applied ? ` · ${applied === 'route' && current ? current.model : t(applied === 'subscription' ? '订阅' : '已接管')}` : ''}</summary>
    <p className="hint">{t('默认只在 wickrunAI 启动时临时注入，不改你的配置文件。需要在终端直接使用同一个大脑时再应用到全局。')}</p>
    <div className="client-actions">
      <button className="btn sm" disabled={busy || !canRoute} onClick={() => void run('route')}>{t('把当前大脑应用到全局')}</button>
      <button className="btn sm ghost" disabled={busy} onClick={() => void run('subscription')}>{t('全局改用订阅')}</button>
      <button className="btn sm ghost" disabled={busy || !applied} onClick={() => void run('restore')}>{t('还原接管前的配置')}</button>
    </div>
    {applied === 'route' ? <p className="hint">{t('全局路由经本机代理 127.0.0.1:{port} 转发，需要 wickrunAI 保持运行。', { port: status?.port ?? '' })}</p> : null}
    {note ? <p className="hint" role="status">{note}</p> : null}
  </details>;
}
