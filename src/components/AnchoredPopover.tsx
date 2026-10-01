import React from 'react';
import { useT } from '../lib/i18n';
import { createPortal } from 'react-dom';

/** Render outside chat scroll containers, then constrain to the visible viewport. */
export default function AnchoredPopover({ anchorRef, onClose, className, label, align = 'start', children }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  className: string;
  label: string;
  align?: 'start' | 'end';
  children: React.ReactNode;
}) {
  const t = useT();
  const panelRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const panel = panelRef.current, anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const viewport = window.visualViewport;
    const measure = () => {
      if (matchMedia('(max-width: 860px)').matches) {
        const height = viewport?.height ?? innerHeight;
        panel.style.maxWidth = ((viewport?.width ?? innerWidth) - 16) + 'px';
        panel.style.width = ((viewport?.width ?? innerWidth) - 16) + 'px';
        panel.style.maxHeight = Math.max(160, height - 32) + 'px';
        panel.style.left = ((viewport?.offsetLeft ?? 0) + 8) + 'px';
        panel.style.top = ((viewport?.offsetTop ?? 0) + Math.max(16, height - panel.getBoundingClientRect().height - 8)) + 'px';
        panel.style.visibility = 'visible'; return;
      }
      panel.style.width = '';
      const r = anchor.getBoundingClientRect();
      const margin = 12, gap = 8;
      const left = (viewport?.offsetLeft ?? 0) + margin;
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - margin;
      const header = anchor.closest('.main')?.querySelector('.topbar')?.getBoundingClientRect();
      const top = Math.max(viewport?.offsetTop ?? 0, header?.bottom ?? 0) + margin;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - margin;
      const above = Math.max(0, r.top - gap - top), below = Math.max(0, bottom - r.bottom - gap);
      const up = above >= below;
      const maxHeight = Math.max(0, Math.min(560, bottom - top, up ? above : below));
      panel.style.maxWidth = `${Math.max(0, right - left)}px`;
      panel.style.maxHeight = `${maxHeight}px`;
      const size = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(left, Math.min(align === 'end' ? r.right - size.width : r.left, right - size.width))}px`;
      panel.style.top = `${Math.max(top, Math.min(up ? r.top - gap - size.height : r.bottom + gap, bottom - size.height))}px`;
      panel.style.visibility = 'visible';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    observer.observe(panel);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    viewport?.addEventListener('resize', measure);
    viewport?.addEventListener('scroll', measure);
    panel.focus({ preventScroll: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      viewport?.removeEventListener('resize', measure);
      viewport?.removeEventListener('scroll', measure);
    };
  }, [anchorRef, align]);

  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
      anchorRef.current?.querySelector<HTMLElement>('button, summary')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [anchorRef, onClose]);

  return createPortal(<div ref={panelRef} className={`${className} anchored-popover`} role="dialog" aria-label={label} tabIndex={-1}>
    <div className="mobile-popover-close"><button className="btn sm ghost" onClick={onClose}>{t('关闭')}</button></div>
    {children}
  </div>, document.body);
}
