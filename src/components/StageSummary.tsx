import React from 'react';
import type { ChatMessage } from '../types';
import { useT } from '../lib/i18n';
import { stageOutcome } from '../lib/stage-outcome';

export default function StageSummary({ answer }: { answer: ChatMessage }) {
  const t = useT();
  const outcome = stageOutcome(answer);
  if (!outcome) return null;
  return <section className="stage-summary" aria-label={t('阶段结论')}>
    <strong>{t(outcome.title)}</strong>
    <p className="hint">{t('根据本轮保存的任务与检查记录整理。')}</p>
    {outcome.completed.length ? <details>
      <summary>{t('已记录完成 {n} 项', { n: outcome.completed.length })}</summary>
      <ul>{outcome.completed.map(title => <li key={title}>{title}</li>)}</ul>
    </details> : <p>{t('尚无已完成的任务项记录。')}</p>}
    <p>{outcome.requirementCount
      ? t('检查记录：程序核验通过 {program} 项；模型判断通过 {model} 项；共 {total} 项条件。', { program: outcome.programChecks, model: outcome.modelChecks, total: outcome.requirementCount })
      : t('尚未登记验收条件，不能据此确认整体任务完成。')}</p>
    {outcome.remaining.length ? <><strong>{t('待完成或待验证')}</strong><ul>{outcome.remaining.map(title => <li key={title}>{title}</li>)}</ul></> : null}
    {outcome.reason ? <p>{t('停止原因：')}{t(outcome.reason)}</p> : null}
    <p><strong>{t('下一步：')}</strong>{t(outcome.next)}</p>
  </section>;
}
