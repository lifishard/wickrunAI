import React from 'react';
import { useT } from '../lib/i18n';
import AnchoredPopover from './AnchoredPopover';
import type { RouteOverrides } from '../types';
import { EFFORT_LEVELS, describeEffort, matchMapping, type EffortLevel, type EffortMapping } from '../lib/effort';

/**
 * 思考强度，挂在输入框右下角。
 *
 * 对外只有一档五级刻度，切模型不用重学各家的字段名 ——
 * 翻译交给 src/lib/effort.ts 里那张可编辑的映射表。
 */
export default function EffortPicker(props: {
  level: EffortLevel;
  onLevel: (l: EffortLevel) => void;
  model: string;
  mappings: EffortMapping[];
  route?: RouteOverrides;
  /** thinkingStyle 不是 auto 时，说明用户在配置面板里手动接管了 */
  manual: boolean;
  onOpenMappings: () => void;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const cur = EFFORT_LEVELS.find((l) => l.value === props.level) ?? EFFORT_LEVELS[0];
  const mapping = matchMapping(props.model, props.mappings);
  const routed = props.route?.effortStyle && props.route.effortStyle !== 'mapping';
  const supported = routed ? props.route?.effortStyle !== 'none' : Boolean(mapping && mapping.style !== 'none');
  const describe = (level: EffortLevel) => {
    if (!routed) return describeEffort(props.model,level,props.mappings,t);
    if (level === 'off' || props.route?.effortStyle === 'none') return t('当前路由不下发思考字段');
    const value = props.route?.effortValues?.[level];
    return value ? t('当前路由：{style} → {value}', { style: props.route!.effortStyle ?? '', value }) : t('这一档尚未配置，发送前需要补充');
  };

  return (
    <div className="menu-anchor" ref={anchorRef}>
      <button
        className={`btn sm ghost effort-btn${props.level !== 'off' && supported ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={props.manual ? t('配置面板里手动接管了思考字段，这里不生效') : describe(props.level)}
        onClick={() => setOpen((v) => !v)}
      >
        🧠 {props.manual ? t('手动') : t(cur.label)}
      </button>

      {open ? (
        <AnchoredPopover anchorRef={anchorRef} onClose={() => setOpen(false)} className="popup effort-popup" label={t('思考强度')} align="end">
          <div className="picker-label">{t('思考强度')}</div>

          {props.manual ? (
            <div className="picker-error">
              {t('配置面板里把「思考字段下发方式」改成了手动，这里选什么都不生效。想用这个刻度，把那边改回「自动（按模型映射）」。')}
            </div>
          ) : null}

          {EFFORT_LEVELS.map((l) => (
            <button
              key={l.value}
              className={`popup-item${l.value === props.level ? ' on' : ''}`}
              disabled={props.manual}
              onClick={() => {
                props.onLevel(l.value);
                setOpen(false);
              }}
            >
              <span className="popup-icon">{l.short}</span>
              <span>
                <strong>{t(l.label)}</strong>
                <small>{describe(l.value)}</small>
              </span>
            </button>
          ))}

          <div className="picker-foot" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1 }}>
              {routed ? t('使用当前端点与模型的单独设置') : mapping
                ? t('当前模型匹配「{label}」{note}', { label: mapping.label, note: mapping.unverified ? t('（这条是推的，没实测）') : '' })
                : t('没有匹配到映射规则')}
            </span>
            <button className="btn sm ghost" onClick={props.onOpenMappings}>
              {t('改映射')}
            </button>
          </div>
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
