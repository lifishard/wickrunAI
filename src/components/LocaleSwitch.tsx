import React from 'react';
import { LOCALES, useLocale, useT, type Locale } from '../lib/i18n';

/** 左下角的胶囊：简 / 繁 / EN。 */
export default function LocaleSwitch({ onChange }: { onChange: (locale: Locale) => void }) {
  const current = useLocale();
  const t = useT();
  return (
    <div className="locale-switch" role="group" aria-label={t('界面语言')}>
      {LOCALES.map((item) => (
        <button
          key={item.value}
          type="button"
          lang={item.lang}
          aria-pressed={item.value === current}
          className={`locale-switch-btn${item.value === current ? ' selected' : ''}`}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
