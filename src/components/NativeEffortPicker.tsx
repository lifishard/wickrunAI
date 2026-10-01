import React from 'react';
import AnchoredPopover from './AnchoredPopover';
import { brainForRoute } from './BrainPicker';
import { CLIENT_LABELS, type ClientSelection } from '../lib/connections';
import { desktop } from '../lib/transport';
import { EFFORT_LEVELS, type EffortLevel } from '../lib/effort';
import type { AppSettings } from '../types';
import { useT } from '../lib/i18n';

const routeLevels = EFFORT_LEVELS.map(level => level.value);

export default function NativeEffortPicker({ selection, settings, onSelect }: {
  selection: ClientSelection;
  settings?: AppSettings;
  onSelect?: (next: ClientSelection) => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [clientLevels, setClientLevels] = React.useState<string[]>([]);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const isRoute = selection.brain?.source === 'route';

  React.useEffect(() => {
    if (isRoute || selection.kind === 'claude-desktop') return;
    let active = true;
    void desktop()?.conversationClientCheck(selection.kind).then(status => {
      if (!active) return;
      const model = status.models.find(item => item.id === selection.model);
      setClientLevels(model?.efforts ?? []);
    }).catch(() => { if (active) setClientLevels([]); });
    return () => { active = false; };
  }, [isRoute, selection.kind, selection.model]);

  const levels = isRoute ? routeLevels : clientLevels;
  const options = [...new Set([...(isRoute ? [] : ['']), ...levels, ...(selection.effort && !levels.includes(selection.effort) ? [selection.effort] : [])])];
  const current = selection.effort || t('官方默认强度');
  const choose = (effort: string) => {
    if (!onSelect) return;
    if (isRoute) {
      const profile = settings?.keyProfiles.find(item => item.id === selection.brain?.profileId);
      if (!profile) return;
      onSelect({ ...selection, effort, brain: brainForRoute(settings!, profile, selection.model === 'default' ? '' : selection.model, effort as EffortLevel) });
    } else {
      onSelect({ ...selection, effort: effort || undefined });
    }
    setOpen(false);
  };

  return <div className="menu-anchor" ref={anchorRef}>
    <button className="btn sm ghost effort-btn" aria-label={t('思考强度：{level}', { level: current })} aria-expanded={open} aria-haspopup="dialog" disabled={!onSelect || selection.kind === 'claude-desktop'} onClick={() => setOpen(value => !value)}>
      🧠 {current}
    </button>
    {open ? <AnchoredPopover anchorRef={anchorRef} onClose={() => setOpen(false)} className="popup effort-popup" label={t('思考强度')} align="end">
      <div className="picker-label">{CLIENT_LABELS[selection.kind]} · {t('思考强度')}</div>
      {options.map(level => <button key={level || 'default'} className={`popup-item${(selection.effort || '') === level ? ' on' : ''}`} onClick={() => choose(level)}>
        <span><strong>{level || t('官方默认强度')}</strong></span>
      </button>)}
      {!levels.length ? <div className="picker-foot">{t('客户端尚未提供可选强度')}</div> : null}
    </AnchoredPopover> : null}
  </div>;
}
