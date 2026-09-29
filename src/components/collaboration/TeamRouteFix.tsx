import React from 'react';
import type { AppSettings } from '../../types';
import type { TeamProject, TeamRun } from '../../lib/collaboration';
import { activeRoute, type RouteFix } from '../../lib/team-route-fix';
import { probeCompatibility } from '../../lib/compatibility-probe';
import { readCompatibility } from '../../lib/compatibility-cache';
import { secretGet } from '../../lib/store';
import { useT } from '../../lib/i18n';

type Route = { profileId: string; model: string };
type Check = { status: 'checking' | 'ready' | 'failed'; note: string; effort: string };
type Row = { memberId: string; name: string; from: Route; effort: string; reason: string; detail?: string; optional: boolean };
const keyOf = (r: Route) => r.profileId + '\n' + r.model;

/**
 * 报错要能落到修法上：指出哪位成员、哪条路由、为什么不行，就地换一个检测过的模型，
 * 再从这一步继续。换路由只追加记录，运行快照不变。
 */
export default function TeamRouteFix({ fix, run, project, settings, onSwitch, onRetry, onEditMember, onSettings }: {
  fix: RouteFix; run: TeamRun; project: TeamProject; settings: AppSettings;
  onSwitch: (memberId: string, route: Route & { effort: string }, updateMember: boolean) => Promise<void>;
  onRetry: (evidence: string) => Promise<void>;
  onEditMember: (memberId: string) => void;
  onSettings: () => void;
}) {
  const tr = useT();
  const members = new Map(run.members.map((m) => [m.id, m]));
  const profiles = settings.keyProfiles.filter((p) => p.hasSecret);
  const profileName = (id: string) => settings.keyProfiles.find((p) => p.id === id)?.name ?? id;
  const models = (id: string) => [...new Map([...(settings.cachedModels[id] ?? []), ...(settings.customModels?.[id] ?? [])].map((m) => [m.id, m])).values()];
  const [picks, setPicks] = React.useState<Record<string, Route>>({});
  const [checks, setChecks] = React.useState<Record<string, Check>>({});
  const [others, setOthers] = React.useState<Record<string, Check>>({});
  const [updateMember, setUpdateMember] = React.useState(true);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [done, setDone] = React.useState('');
  const control = React.useRef(new AbortController());
  React.useEffect(() => () => control.current.abort(), []);

  async function check(route: Route, effort: string, save: (c: Check) => void) {
    const profile = settings.keyProfiles.find((p) => p.id === route.profileId);
    if (!profile || !route.model) return;
    save({ status: 'checking', note: '', effort: 'off' });
    try {
      const key = await secretGet(profile.id);
      if (!key) throw Error(tr('所选接入尚未保存 API Key'));
      const report = await probeCompatibility(profile, route.model, key, { signal: control.current.signal });
      // 新模型不一定接受原来的思考强度：检测过接受才沿用，否则不下发
      const kept = effort !== 'off' && report.requests[effort as keyof typeof report.requests] ? effort : 'off';
      save(report.status === 'ready' ? { status: 'ready', note: '', effort: kept } : { status: 'failed', note: report.note, effort: 'off' });
    } catch (e) {
      if (!control.current.signal.aborted) save({ status: 'failed', note: e instanceof Error ? e.message : String(e), effort: 'off' });
    }
  }

  const rows: Row[] = [
    ...fix.failures.map((f) => ({ memberId: f.memberId, name: f.name, from: { profileId: f.profileId, model: f.model }, effort: f.effort,
      reason: tr(f.info.title, f.info.vars), detail: f.error, optional: false })),
    ...fix.untested.filter((m) => others[m.id]?.status === 'failed').map((m) => {
      const a = activeRoute(run, m);
      return { memberId: m.id, name: m.name, from: { profileId: a.profileId, model: a.model }, effort: a.effort,
        reason: tr('检测未通过：{note}', { note: others[m.id].note }), optional: true };
    }),
  ];
  const state = rows.map((r) => {
    const active = activeRoute(run, members.get(r.memberId)!);
    const switched = active.profileId !== r.from.profileId || active.model !== r.from.model;
    const pick = picks[r.memberId] ?? (switched ? { profileId: active.profileId, model: active.model } : { profileId: r.from.profileId, model: '' });
    const changed = !!pick.model && (pick.profileId !== active.profileId || pick.model !== active.model);
    return { r, active, switched, pick, changed, check: changed ? checks[keyOf(pick)] : undefined };
  });
  const required = state.filter((s) => !s.r.optional);
  const ready = required.every((s) => s.changed || s.switched) && !state.some((s) => s.changed && s.check?.status === 'checking');
  const risky = state.some((s) => s.changed && s.check?.status === 'failed');
  const anyChange = state.some((s) => s.changed);
  const first = fix.failures[0];

  function choose(r: Row, route: Route) {
    setPicks((p) => ({ ...p, [r.memberId]: route }));
    setDone('');
    if (route.model && !checks[keyOf(route)]) void check(route, r.effort, (c) => setChecks((x) => ({ ...x, [keyOf(route)]: c })));
  }
  async function apply(retry: boolean) {
    setBusy(true); setError('');
    try {
      for (const s of state) if (s.changed) await onSwitch(s.r.memberId, { ...s.pick, effort: s.check?.effort ?? 'off' }, updateMember);
      if (retry) await onRetry(tr('上游拒绝了请求，此步骤没有执行任何操作；已为 {names} 换用模型后重试', { names: required.map((s) => s.r.name).join('、') }));
      else setDone(tr('已换用。这一步有执行记录，请在下方核实后继续。'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  // 只有全部出错成员都已换过、这次没有新改动时，才是单纯重试
  const onlyRetry = !anyChange && required.every((s) => s.switched);
  const primary = fix.sideEffectFree
    ? (onlyRetry ? tr('重试此步骤') : risky ? tr('仍然换用并重试') : tr('换用并重试此步骤'))
    : (risky ? tr('仍然换用') : tr('换用新模型'));
  return <section className="team-attention team-route-fix" aria-label={tr('修复出错的成员模型')}>
    <h3>{rows.length === 1 ? rows[0].reason : tr('{n} 位成员的模型无法使用', { n: rows.length })}</h3>
    <p>{tr('「{step}」停在这里。换用可用的模型后，就能继续这一步。', { step: fix.nodeTitle })}</p>
    <ul className="team-route-fixes">{first.info.fixes.map((x) => <li key={x}>{tr(x, first.info.vars)}</li>)}</ul>
    {!profiles.length && <p role="alert">{tr('还没有保存 API Key 的接入，先到接入设置添加。')}</p>}
    <ul className="team-route-rows">{state.map(({ r, active, switched, pick, changed, check: c }) => {
      const list = models(pick.profileId), profile = settings.keyProfiles.find((p) => p.id === pick.profileId);
      return <li className="team-route-row" key={r.memberId}>
        <strong>{r.name}</strong>
        <small>{profileName(r.from.profileId)} · {r.from.model}</small>
        {rows.length > 1 && <p>{r.reason}</p>}
        {switched && !changed && <p className="team-note">{tr('已改用 {model}，重试后生效', { model: active.model })}</p>}
        <div className="team-route-pick">
          <label className="team-field"><span>{tr('换用接入')}</span>
            <select value={pick.profileId} disabled={busy} onChange={(e) => choose(r, { profileId: e.target.value, model: '' })}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          <label className="team-field"><span>{tr('换用模型')}</span>
            {list.length ? <select value={pick.model} disabled={busy} onChange={(e) => choose(r, { profileId: pick.profileId, model: e.target.value })}>
              <option value="">{tr('选择模型')}</option>
              {list.map((m) => <option key={m.id} value={m.id} disabled={pick.profileId === r.from.profileId && m.id === r.from.model}>
                {profile && readCompatibility(profile, m.id)?.status === 'ready' ? tr('{model} · 已验证', { model: m.id }) : m.id}</option>)}
            </select> : <small>{tr('这个接入还没有模型列表，请到接入设置刷新。')}</small>}</label>
        </div>
        {c && <p role="status" className="team-note">{c.status === 'checking' ? tr('正在确认这个模型能用…') : c.status === 'ready' ? tr('已确认可用') : tr('未通过检测：{note}', { note: c.note })}</p>}
        {project.members.some((m) => m.id === r.memberId) && <div className="team-actions"><button className="btn sm" onClick={() => onEditMember(r.memberId)}>{tr('配置成员')}</button></div>}
        {r.detail && <details><summary>{tr('上游原文')}</summary><pre>{r.detail}</pre></details>}
      </li>;
    })}</ul>
    <p className="team-note">{tr('选好模型后会发一条很短的测试请求，确认它在套餐内。')}</p>
    {fix.untested.length > 0 && <div className="team-route-others">
      <p>{tr('另外 {n} 位成员还没轮到，他们的模型也可能不在套餐内。', { n: fix.untested.length })}</p>
      <button className="btn sm" disabled={busy || fix.untested.some((m) => others[m.id]?.status === 'checking')} onClick={() => {
        for (const m of fix.untested) { const a = activeRoute(run, m); void check({ profileId: a.profileId, model: a.model }, a.effort, (c) => setOthers((x) => ({ ...x, [m.id]: c }))); }
      }}>{tr('检测他们的模型')}</button>
      {fix.untested.some((m) => others[m.id]) && <ul>{fix.untested.map((m) => {
        const c = others[m.id];
        return c && <li key={m.id}>{m.name} · {activeRoute(run, m).model} · {c.status === 'checking' ? tr('检测中…') : c.status === 'ready' ? tr('可用') : tr('不可用，已加入上方列表')}</li>;
      })}</ul>}
    </div>}
    <label className="team-check"><input type="checkbox" checked={updateMember} disabled={busy} onChange={(e) => setUpdateMember(e.target.checked)}/>{tr('同时改成员设置，以后的运行也用新模型')}</label>
    {error && <p role="alert">{error}</p>}
    {done && <p role="status">{done}</p>}
    <div className="team-actions">
      {(fix.sideEffectFree || anyChange) && <button className="btn primary" disabled={busy || !ready || (!fix.sideEffectFree && !anyChange)} onClick={() => void apply(fix.sideEffectFree)}>{primary}</button>}
      <button className="btn" onClick={onSettings}>{tr('打开接入设置')}</button>
    </div>
  </section>;
}
