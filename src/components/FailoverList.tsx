import React from 'react';
import { useT } from '../lib/i18n';
import type { GenerationConfig } from '../types';
import type { RouteRef } from '../lib/failover';
import { Switch } from './ui';

export interface RouteOption { profileId: string; profileName: string; models: string[] }

/**
 * 接力名单：用户自己排的顺序。
 *
 * 程序不替用户挑路由 —— 它不知道哪条是付费的、哪条是用户这会儿想用的，也不该知道。
 * 它只负责在这条失灵时按这个顺序往下走，并跳过已知坏掉的。
 */
export default function FailoverList({ config, options, onChange }: {
  config: GenerationConfig;
  options: RouteOption[];
  onChange: (patch: Partial<GenerationConfig>) => void;
}) {
  const t = useT();
  const failover = config.failover ?? { enabled: false, routes: [] };
  const routes = failover.routes ?? [];
  const set = (patch: Partial<NonNullable<GenerationConfig['failover']>>) =>
    onChange({ failover: { ...failover, ...patch } });
  const nameOf = (r: RouteRef) => options.find((o) => o.profileId === r.profileId)?.profileName ?? r.profileId;
  const move = (i: number, to: number) => {
    if (to < 0 || to >= routes.length) return;
    const next = [...routes];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    set({ routes: next });
  };
  return <div className="section">
    <div className="section-title">{t('失灵交接名单')}</div>
    <div className="hint" style={{ marginBottom: 12 }}>
      {t('当前路由失灵时，按你排的顺序往下交接，带着已保存的进度继续，不从头再来。')}
      <br />
      {t('顺序由你定：免费的排前面还是稳的排前面，程序不替你判断，它也不知道哪条是付费的。名单为空就维持现在的行为：失败后停下来等你。')}
    </div>
    <div className="field">
      <Switch checked={failover.enabled} onChange={(v) => set({ enabled: v })} label={t('失灵时自动交接')} />
    </div>
    {routes.length ? <ol className="failover-list">
      {routes.map((r, i) => <li key={`${r.profileId}:${r.model}:${i}`}>
        <span className="failover-route"><code>{r.model}</code><small>{nameOf(r)}</small></span>
        <span className="failover-actions">
          <button className="btn sm" aria-label={t('上移')} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
          <button className="btn sm" aria-label={t('下移')} disabled={i === routes.length - 1} onClick={() => move(i, i + 1)}>↓</button>
          <button className="btn sm ghost" aria-label={t('移出名单')} onClick={() => set({ routes: routes.filter((_, x) => x !== i) })}>{t('移除')}</button>
        </span>
      </li>)}
    </ol> : <p className="hint">{t('名单是空的，现在不会自动交接。')}</p>}
    <div className="field">
      <select aria-label={t('添加一条候选路由')} value="" onChange={(e) => {
        const value = e.target.value;
        if (!value) return;
        const at = value.indexOf('\u0000');
        const profileId = value.slice(0, at), model = value.slice(at + 1);
        if (routes.some((r) => r.profileId === profileId && r.model === model)) return;
        set({ routes: [...routes, { profileId, model }] });
      }}>
        <option value="">{t('添加一条候选路由…')}</option>
        {options.map((o) => <optgroup key={o.profileId} label={o.profileName}>
          {o.models.map((m) => <option key={m} value={`${o.profileId}\u0000${m}`}>{m}</option>)}
        </optgroup>)}
      </select>
    </div>
  </div>;
}
