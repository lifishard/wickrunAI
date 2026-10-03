import React from 'react';
import { useT } from '../lib/i18n';
import { butlerClock } from '../lib/butler-policy';
import type { ButlerRuntimeController, ButlerProactivePreferences } from '../lib/proactive-butler';
import Icon from './Icon';

const BRIEF_KIND: Record<string, string> = { progress: '进展', finding: '发现', suggestion: '建议', 'needs-approval': '等你决定' };

function useButler(controller: ButlerRuntimeController) {
  return React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

/** The Butler's entry in the top bar, with the number of suggestions waiting for an answer. */
export function ButlerHomeButton({ controller, onOpen }: { controller: ButlerRuntimeController; onOpen: () => void }) {
  const t = useT(), snapshot = useButler(controller);
  const waiting = (snapshot.brain.jobs ?? []).filter(job => job.status === 'proposed').length;
  return <button className="btn sm butler-home-trigger" onClick={onOpen} aria-label={waiting ? `${t('今日管家')} · ${waiting} ${t('条建议等你决定')}` : undefined}>
    {t('今日管家')}{waiting > 0 && <span className="butler-badge" aria-hidden="true">{waiting}</span>}
  </button>;
}

/**
 * The first open of the day: a quiet card in the window instead of a dialog over
 * the user's work. It shows the model-written greeting of today's brief when there
 * is one, and a plain status line until the brief arrives.
 */
export function ButlerGreeting({ controller, prefs, onOpen, onDismiss }: {
  controller: ButlerRuntimeController; prefs: ButlerProactivePreferences; onOpen: () => void; onDismiss: () => void;
}) {
  const t = useT(), snapshot = useButler(controller), now = Date.now();
  const today = butlerClock(now, prefs.timezone).day;
  const brief = [...snapshot.brain.briefs].filter(b => b.greeting && butlerClock(b.createdAt, prefs.timezone).day === today).sort((a, b) => b.createdAt - a.createdAt)[0];
  const waiting = (snapshot.brain.jobs ?? []).filter(job => job.status === 'proposed').length;
  const goals = snapshot.brain.goals.filter(goal => goal.status !== 'dismissed').length;
  const hour = Number(butlerClock(now, prefs.timezone).time.slice(0, 2));
  const hello = t(hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 13 ? '中午好' : hour < 18 ? '下午好' : '晚上好');
  const status = waiting ? `${waiting} ${t('条建议等你决定。')}` : goals ? `${t('管家在跟进')} ${goals} ${t('个目标；今天的简报准备好后会出现在这里。')}` : t('补充一个需求，管家就能开始准备。');
  return <aside className="butler-greeting" aria-label={t('管家的问候')}>
    <div className="butler-greeting-text">
      <strong>{brief?.greeting ?? `${hello}。`}</strong>
      {brief ? <ul>{brief.items.slice(0, 2).map(item => <li key={item.id}><span className="butler-greeting-chip">{t(BRIEF_KIND[item.kind] ?? '建议')}</span>{item.title}</li>)}</ul> : null}
      <small>{brief && waiting ? `${waiting} ${t('条建议等你决定。')}` : brief ? null : status}</small>
    </div>
    <div className="butler-greeting-actions">
      <button className="btn sm primary" onClick={onOpen}>{t('打开今日管家')}</button>
      <button className="btn sm ghost" onClick={onDismiss} title={t('今天不再显示')} aria-label={t('今天不再显示')}><Icon name="close" size={14} /></button>
    </div>
  </aside>;
}
