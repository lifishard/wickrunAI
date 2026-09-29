import React from 'react';
import type { TeamRun } from '../../lib/collaboration';
import { limitLabel, LIMIT_CAPS, type LimitKind, type LimitStop } from '../../lib/team-limits';
import { useT } from '../../lib/i18n';

type Raise = { kind: LimitKind; target?: string; value: number };
const keyOf = (s: { kind: string; target?: string }) => s.kind + ':' + (s.target ?? '');
const round = (n: number, step: number) => Math.ceil(n / step) * step;
/** 设计里的值比已经用掉的还低时，照搬它会一恢复就再停，所以至少留出能再跑一段的余量。 */
function suggest(s: LimitStop): number {
  const room = s.kind === 'runTokens' ? round(s.used + 100_000, 10_000)
    : s.kind === 'runSteps' ? s.used + 20
    : s.kind === 'runMinutes' ? s.used + 60
    : s.current + 1;
  const v = s.design !== undefined ? Math.max(s.design, room) : s.kind === 'visits' || s.kind === 'traversals' ? s.current + 2
    : s.kind === 'runTokens' ? round(Math.max(s.current * 1.5, room), 10_000)
    : s.kind === 'runSteps' ? Math.max(s.current + Math.max(20, Math.ceil(s.current / 2)), room)
    : s.kind === 'runMinutes' ? Math.max(s.current * 2, room)
    : s.current * 2;
  return Math.min(LIMIT_CAPS[s.kind], Math.max(s.current + 1, Math.round(v)));
}

/**
 * 上限卡住时就地调高并从检查点接着跑。只影响本次运行，追加记录可审计；
 * 流程设计或成员设置里已经改高的值直接带进来，不用新建运行从头跑。
 */
export default function TeamLimitFix({ run, stops, onRaise, onContinue }: {
  run: TeamRun; stops: LimitStop[];
  onRaise: (raises: Raise[]) => Promise<void>;
  onContinue: () => Promise<void>;
}) {
  const tr = useT();
  const [values, setValues] = React.useState<Record<string, number>>(() => Object.fromEntries(stops.map((s) => [keyOf(s), s.kind === 'memberTokens' && s.design === undefined ? s.current : suggest(s)])));
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const raises: Raise[] = stops.map((s) => ({ kind: s.kind, target: s.target, value: Math.floor(values[keyOf(s)] ?? s.current) })).filter((r, i) => r.value > stops[i].current);
  const blocking = stops.filter((s) => s.kind !== 'memberTokens');
  const ready = blocking.every((s) => (values[keyOf(s)] ?? s.current) > s.current);
  async function go() {
    setBusy(true); setError('');
    try { if (raises.length) await onRaise(raises); await onContinue(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="team-attention team-limit-fix" aria-label={tr('调整本次运行的上限')}>
    <h3>{tr(blocking.length ? '上限用完了，调高后从这里接着跑' : '这一段的预算用完了，可以从检查点接着跑')}</h3>
    <p>{tr('只改本次运行，已完成的步骤不会重跑。想让以后的运行也用新上限，请在流程设计器或成员设置里修改。')}</p>
    <ul className="team-route-rows">{stops.map((s) => {
      const k = keyOf(s), value = values[k] ?? s.current;
      return <li className="team-route-row" key={k}>
        <strong>{limitLabel(run, s.kind, s.target)}</strong>
        <small>{s.kind === 'memberTokens' ? tr('当前 {current}', { current: s.current.toLocaleString() }) : tr('已用 {used}，上限 {current}', { used: s.used.toLocaleString(), current: s.current.toLocaleString() })}</small>
        {s.design !== undefined && <p className="team-note">{tr(s.kind === 'memberTokens' ? '成员设置里已改为 {value}' : '流程设计里已改为 {value}', { value: s.design.toLocaleString() })}
          {value !== s.design && <button className="btn sm" disabled={busy} onClick={() => setValues((v) => ({ ...v, [k]: s.design! }))}>{tr('采用这个值')}</button>}</p>}
        <label className="team-field"><span>{tr('本次运行改为')}</span>
          <input type="number" min={s.current} max={LIMIT_CAPS[s.kind]} value={value} disabled={busy} onChange={(e) => setValues((v) => ({ ...v, [k]: Number(e.target.value) }))}/></label>
      </li>;
    })}</ul>
    {error && <p role="alert">{error}</p>}
    <div className="team-actions">
      <button className="btn primary" disabled={busy || !ready} onClick={() => void go()}>{tr(raises.length ? '提高上限并接着跑' : '从检查点接着跑')}</button>
    </div>
  </section>;
}
