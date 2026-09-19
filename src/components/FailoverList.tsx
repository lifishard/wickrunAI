import React from 'react';
import { useT } from '../lib/i18n';
import type { FailoverConfig, FailoverScope, RouteRef } from '../lib/failover';
import { resolveFailover } from '../lib/failover';
import type { RouteScore } from '../lib/routing-memory';
import { Switch } from './ui';

export interface RouteOption { profileId: string; profileName: string; models: string[] }
export interface FailoverScopes { session?: FailoverConfig; project?: FailoverConfig; app?: FailoverConfig }

/**
 * 接力名单：用户自己排的顺序，分三层。
 *
 * 程序不替用户挑路由 —— 它不知道哪条是付费的、哪条是用户这会儿想用的，也不该知道。
 * 它只负责在这条失灵时按这个顺序往下走，并跳过已知坏掉的。
 *
 * 三层的意义是「设一次管全局，遇到特定任务再改」：全局设好常用顺序，
 * 项目里换一套，某一次对话再临时换。所以每一层都要能表达「我没意见」
 * （继承上层）和「我这层就是要这样」（哪怕是关掉）两种意思。
 */
export default function FailoverList({ scopes, projectName, options, scores, onChange }: {
  scopes: FailoverScopes;
  projectName?: string;
  options: RouteOption[];
  /** 「凭据::模型」→ 这条路由的历史表现。没有就是还没数据 */
  scores?: Record<string, RouteScore>;
  onChange: (scope: FailoverScope, value: FailoverConfig | undefined) => void;
}) {
  const t = useT();
  const [scope, setScope] = React.useState<FailoverScope>('session');
  const effective = resolveFailover(scopes.session, scopes.project, scopes.app);
  const own = scopes[scope];
  const routes = own?.routes ?? [];
  const set = (patch: Partial<FailoverConfig>) =>
    onChange(scope, { enabled: own?.enabled ?? false, routes: own?.routes ?? [], ...patch });
  const nameOf = (r: RouteRef) => options.find((o) => o.profileId === r.profileId)?.profileName ?? r.profileId;
  const move = (i: number, to: number) => {
    if (to < 0 || to >= routes.length) return;
    const next = [...routes];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    set({ routes: next });
  };
  const scopeLabel: Record<FailoverScope | 'none', string> = {
    session: t('本对话'), project: projectName ? t('项目「{name}」', { name: projectName }) : t('项目'),
    app: t('应用全局'), none: t('没有任何一层设置'),
  };
  const tabs: FailoverScope[] = projectName ? ['session', 'project', 'app'] : ['session', 'app'];
  /*
   * 排序建议：只动「样本够、判得出」的那些，样本不足的留在原位。
   * 把没数据的一律挤到后面，等于让「没被用过」变成「不好」—— 那是编造。
   */
  const scoreOf = (r: RouteRef) => scores?.[`${r.profileId}::${r.model}`];
  const rankable = routes.filter((r) => scoreOf(r)?.doneRate != null);
  const suggested = (() => {
    const sorted = [...rankable].sort((a, b) => (scoreOf(b)!.doneRate ?? 0) - (scoreOf(a)!.doneRate ?? 0));
    let i = 0;
    return routes.map((r) => (scoreOf(r)?.doneRate != null ? sorted[i++] : r));
  })();

  return <div className="section">
    <div className="section-title">{t('失灵交接名单')}</div>
    <div className="hint" style={{ marginBottom: 12 }}>
      {t('当前路由失灵时，按你排的顺序往下交接，带着已保存的进度继续，不从头再来。')}
      <br />
      {t('顺序由你定：免费的排前面还是稳的排前面，程序不替你判断，它也不知道哪条是付费的。')}
      <br />
      <strong>{t('优先级：本对话 → 项目 → 应用全局。')}</strong>
      {t('某一层没设置就往上找；设置了就算数，哪怕它是空名单或者明确关掉。')}
    </div>

    <div className="failover-scopes" role="group" aria-label={t('设置哪一层')}>
      {tabs.map((s) => <button key={s} className={`btn sm${scope === s ? '' : ' ghost'}`} onClick={() => setScope(s)}>
        {scopeLabel[s]}{scopes[s] ? ' ●' : ''}
      </button>)}
    </div>
    <p className="hint">
      {t('当前实际生效的是：')}<strong>{scopeLabel[effective.from]}</strong>
      {effective.from !== 'none' ? t('（{state}，{n} 条候选）', {
        state: effective.config.enabled ? t('已开启') : t('已关闭'), n: effective.config.routes.length }) : null}
    </p>

    {own ? <>
      <div className="field">
        <Switch checked={own.enabled} onChange={(v) => set({ enabled: v })} label={t('失灵时自动交接')} />
      </div>
      {routes.length ? <ol className="failover-list">
        {routes.map((r, i) => <li key={`${r.profileId}:${r.model}:${i}`}>
          <span className="failover-route"><code>{r.model}</code><small>{nameOf(r)}</small>
            {(() => {
              const s = scores?.[`${r.profileId}::${r.model}`];
              if (!s) return null;
              return <small className="failover-score">{s.doneRate === null
                ? t('样本不足（{n} 条判得出）', { n: s.done + s.notDone })
                : t('做成率 {rate}%（{n} 条判得出）', { rate: Math.round(s.doneRate * 100), n: s.done + s.notDone })}</small>;
            })()}
          </span>
          <span className="failover-actions">
            <button className="btn sm" aria-label={t('上移')} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
            <button className="btn sm" aria-label={t('下移')} disabled={i === routes.length - 1} onClick={() => move(i, i + 1)}>↓</button>
            <button className="btn sm ghost" aria-label={t('移出名单')} onClick={() => set({ routes: routes.filter((_, x) => x !== i) })}>{t('移除')}</button>
          </span>
        </li>)}
      </ol> : <p className="hint">{t('这一层的名单是空的：会按这一层的设置不做交接，也不再往上继承。')}</p>}
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
      {rankable.length > 1 ? <>
        <button className="btn sm" onClick={() => set({ routes: suggested })}>{t('按历史做成率重排（{n} 条有足够样本）', { n: rankable.length })}</button>
        <p className="hint">{t('这是建议，不是自动执行：顺序仍然由你定。样本不足的保持原位，不会被历史数据挤到后面去。')}</p>
      </> : null}
      <button className="btn sm ghost" onClick={() => onChange(scope, undefined)}>{t('这一层改回继承上层')}</button>
    </> : <>
      <p className="hint">{t('这一层没有设置，继承上层。')}</p>
      <button className="btn sm" onClick={() => onChange(scope, { enabled: false, routes: [] })}>{t('在这一层单独设置')}</button>
    </>}
  </div>;
}
