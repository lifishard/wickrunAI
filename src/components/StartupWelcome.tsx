import React from 'react';
import BrandLogo from './BrandLogo';
import { LOCALES, translate, type Locale } from '../lib/i18n';
import './StartupWelcome.css';

export default function StartupWelcome({ ready, locale, onLocale, onDone }: {
  ready: boolean; locale: Locale; onLocale: (locale: Locale) => void; onDone: () => void;
}) {
  const [arrived, setArrived] = React.useState(false);
  const [reduced, setReduced] = React.useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const doneRef = React.useRef(onDone); doneRef.current = onDone;
  const t = (key: string) => translate(locale, key);
  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  React.useEffect(() => {
    if (!ready) return;
    setArrived(true);
    const timer = window.setTimeout(() => doneRef.current(), reduced ? 1800 : 2800);
    return () => window.clearTimeout(timer);
  }, [ready, reduced, locale]);
  React.useEffect(() => {
    if (!ready) return;
    const skip = (e: KeyboardEvent) => { if (e.key === 'Escape') doneRef.current(); };
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [ready]);
  return <main className={`startup-welcome${arrived ? ' has-arrived' : ''}`} data-startup-phase={arrived ? 'welcome' : 'loading'}>
    <div className="startup-content">
      <div className="startup-logo"><BrandLogo loading={!arrived} size={92} /></div>
      {!arrived ? <p role="status">{t('加载中…')}</p> : <div className="startup-copy" role="status">
        <h1>{t('欢迎来到灯芯：你的创造中心')}</h1>
      </div>}
    </div>
    {ready ? <div className="startup-actions">
      <div className="startup-languages" role="group" aria-label={t('界面语言')}>
        {LOCALES.map(item => <button key={item.value} aria-pressed={locale === item.value} onClick={() => onLocale(item.value)}>{item.label2}</button>)}
      </div>
      <button className="btn ghost" onClick={onDone}>{t('进入应用')} <span aria-hidden="true">→</span></button>
    </div> : null}
  </main>;
}
