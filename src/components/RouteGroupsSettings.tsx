import React from 'react';
import { useT } from '../lib/i18n';
import type { AppSettings } from '../types';
import type { RouteRef } from '../lib/failover';
import { failoverFromGroup, type RouteGroup } from '../lib/route-groups';
import { uid } from '../lib/store';
import { Field } from './ui';

/**
 * 设置 → 路由组。
 *
 * 用户把常用的路由组合存成有名字的组：按任务分（写代码、翻译），按额度分（免费），
 * 怎么分都行。组里的顺序就是交接顺序，第一条是选用时切过去的当前路由。
 * 程序不替用户分组、不给组排序，也不判断哪条是付费的。
 */
export default function RouteGroupsSettings({ settings, onChange }: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  const t = useT();
  const groups = settings.routeGroups ?? [];
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, RouteRef>>({});

  const save = (next: RouteGroup[]) => onChange({ routeGroups: next });
  const patch = (id: string, change: Partial<RouteGroup>) =>
    save(groups.map((g) => (g.id === id ? { ...g, ...change } : g)));
  const create = (routes: RouteRef[] = [], name?: string) =>
    save([...groups, { id: uid('rg'), name: name ?? t('路由组 {n}', { n: groups.length + 1 }), routes, createdAt: Date.now() }]);
  const profileName = (id: string) => settings.keyProfiles.find((p) => p.id === id)?.name;
  const modelsOf = (id: string) =>
    [...new Set([...(settings.cachedModels[id] ?? []), ...(settings.customModels[id] ?? [])].map((m) => m.id))];
  const move = (g: RouteGroup, i: number, to: number) => {
    if (to < 0 || to >= g.routes.length) return;
    const next = [...g.routes];
    const [item] = next.splice(i, 1);
    next.splice(to, 0, item);
    patch(g.id, { routes: next });
  };
  const globalFailover = settings.failover;

  return <div>
    <div className="section">
      <div className="section-title">{t('路由组')}</div>
      <p className="hint">
        {t('把常用的路由组合存成一组，比如按任务分「写代码」「翻译」，或者把免费路由放进「免费」。')}
        <br />
        {t('组内顺序就是失灵交接顺序，第一条是选用时切换到的当前路由。')}
        <br />
        {t('选用方式：输入框左下角的模型选择器，或右侧配置面板的「失灵交接名单」。')}
        <br />
        {t('分组和排序完全由你决定，程序不判断哪条路由付费，也不自动调整顺序。')}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => create()}>{t('新建路由组')}</button>
        {globalFailover?.routes?.length && !globalFailover.groupId
          ? <button className="btn sm ghost" onClick={() => create(globalFailover.routes.map((r) => ({ ...r })), t('全局接力名单'))}>
            {t('从应用全局接力名单新建')}
          </button> : null}
      </div>
    </div>

    {!groups.length ? <p className="hint">{t('还没有路由组。')}</p> : null}

    {groups.map((g) => {
      const draft = drafts[g.id] ?? { profileId: '', model: '' };
      const setDraft = (d: RouteRef) => setDrafts((all) => ({ ...all, [g.id]: d }));
      const isGlobal = globalFailover?.groupId === g.id;
      const datalistId = `route-group-models-${g.id}`;
      const canAdd = Boolean(draft.profileId && draft.model.trim())
        && !g.routes.some((r) => r.profileId === draft.profileId && r.model === draft.model.trim());
      return <div className="card route-group-card" key={g.id}>
        <div className="route-group-head">
          <input type="text" aria-label={t('路由组名称')} value={g.name} placeholder={t('例如：免费 / 写代码')}
            onChange={(e) => patch(g.id, { name: e.target.value })} />
          {isGlobal ? <small className="route-group-badge">{t('应用全局正在使用')}</small> : null}
        </div>
        <Field label={t('备注')}>
          <input type="text" aria-label={t('备注')} value={g.note ?? ''} placeholder={t('可选，只给自己看')}
            onChange={(e) => patch(g.id, { note: e.target.value || undefined })} />
        </Field>

        {g.routes.length ? <ol className="failover-list">
          {g.routes.map((r, i) => <li key={`${r.profileId}:${r.model}:${i}`}>
            <span className="failover-route"><code>{r.model}</code>
              <small>{profileName(r.profileId) ?? t('凭据已删除')}</small>
              {i === 0 ? <small className="failover-score">{t('当前路由')}</small> : null}
            </span>
            <span className="failover-actions">
              <button className="btn sm" aria-label={t('上移')} disabled={i === 0} onClick={() => move(g, i, i - 1)}>↑</button>
              <button className="btn sm" aria-label={t('下移')} disabled={i === g.routes.length - 1} onClick={() => move(g, i, i + 1)}>↓</button>
              <button className="btn sm ghost" aria-label={t('移出名单')} onClick={() => patch(g.id, { routes: g.routes.filter((_, x) => x !== i) })}>{t('移除')}</button>
            </span>
          </li>)}
        </ol> : <p className="hint">{t('这一组还没有路由。')}</p>}

        <div className="route-group-add">
          <select aria-label={t('选择模型接入')} value={draft.profileId}
            onChange={(e) => setDraft({ profileId: e.target.value, model: '' })}>
            <option value="">{t('选择模型接入')}</option>
            {settings.keyProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="text" aria-label={t('模型 ID')} list={datalistId} value={draft.model} disabled={!draft.profileId}
            placeholder={t('模型 ID')} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
          <datalist id={datalistId}>{draft.profileId ? modelsOf(draft.profileId).map((m) => <option key={m} value={m} />) : null}</datalist>
          <button className="btn sm" disabled={!canAdd} onClick={() => {
            patch(g.id, { routes: [...g.routes, { profileId: draft.profileId, model: draft.model.trim() }] });
            setDraft({ profileId: draft.profileId, model: '' });
          }}>{t('加入名单')}</button>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button className="btn sm ghost" disabled={!g.routes.length || isGlobal}
            onClick={() => onChange({ failover: failoverFromGroup(g) })}>{t('设为应用全局接力名单')}</button>
          <button className="btn sm ghost" onClick={() => create(g.routes.map((r) => ({ ...r })), t('{name} 副本', { name: g.name }))}>{t('复制')}</button>
          <button className="btn sm ghost" onClick={() => {
            if (confirmDelete !== g.id) { setConfirmDelete(g.id); return; }
            setConfirmDelete(null);
            save(groups.filter((x) => x.id !== g.id));
          }}>{confirmDelete === g.id ? t('再点一次删除') : t('删除')}</button>
        </div>
        {confirmDelete === g.id ? <p className="hint">{t('删除后，已选用这一组的对话和项目会保留选用时的顺序，不会丢失接力名单。')}</p> : null}
      </div>;
    })}
  </div>;
}
