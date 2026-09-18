import { useT } from '../lib/i18n';
import type { Milestone, ToolStep, DeliveryRequirement } from '../types';
export default function MilestonePanel({ items, steps = [], requirements = [] }: { items?: Milestone[]; steps?: ToolStep[]; requirements?: DeliveryRequirement[] }) {
  const t = useT();
  if (!items?.length) return null;
  const complete = items.filter(m => m.status === 'completed').length;
  return <details className="milestone-panel" open={complete < items.length}>
    <summary>{t('任务进度')}<span>{complete} / {items.length}</span></summary>
    <ol>{items.map(m => <li key={m.id} className={`milestone-${m.status}`}>
      <span className="milestone-check" aria-label={t({ completed:'已完成',in_progress:'进行中',pending:'待完成',verifying:'待质检',blocked:'受阻' }[m.status])}>
        {{ completed:'✓',in_progress:'◉',pending:'○',verifying:'◷',blocked:'!' }[m.status]}
      </span>
      <div><span className="milestone-title">{m.title}</span>
        {m.status === 'verifying' ? <small>{t('待质检 · 尚未完成')}</small> : null}
        {m.acceptance ? <small>{t('验收：')}{m.acceptance}</small> : null}
        {m.note ? <small>{m.note}</small> : null}
        {requirements.some(r=>r.milestoneId===m.id) ? <details className="milestone-evidence"><summary>{t('质检记录')}</summary>
          {requirements.filter(r=>r.milestoneId===m.id).map(r=><div key={r.id}><strong>{r.title}</strong>
            {[...(r.verificationHistory??[]),...(r.verification?[r.verification]:[])].slice(-6).map((v,i)=><p key={i}>{t(v.method==='program'?'程序检查':'模型复核')} · {{passed:'通过',failed:'未通过',unverifiable:'无法核验'}[v.status]}：{v.detail}</p>)}
            {!r.verification ? <p>{t('等待检查')}</p> : null}</div>)}
        </details> : null}
        {m.history?.length ? <details className="milestone-evidence"><summary>{t('变更记录')}</summary>{m.history.map((h,i)=><p key={i}>{new Date(h.at).toLocaleString()} · {h.title}：{h.reason}</p>)}</details> : null}
        {m.evidence.length ? <details className="milestone-evidence"><summary>{t('完成证据')}</summary>{m.evidence.map((e,i) => {
          const step = steps.find(s => s.id === e || s.callId === e);
          return <div key={i}><strong>{step?.summary ?? (e.startsWith('text:') ? t('已交付的回答原文') : t('已记录步骤：{id}', { id: e }))}</strong>
            <p>{step?.output?.slice(0,600) ?? (e.startsWith('text:') ? e.slice(5) : '')}</p></div>;
        })}</details> : null}
      </div>
    </li>)}</ol>
  </details>;
}
