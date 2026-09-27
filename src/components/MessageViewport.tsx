import React from 'react';
import { useT } from '../lib/i18n';
import { hasReadingSelection } from '../lib/reading-selection';

export type ReadingPosition = { top: number; following: boolean };

/** Follow intent is captured before content grows, never inferred from the new height. */
export default function MessageViewport({ conversationId, positions, children }: {
  conversationId: string;
  positions: Map<string, ReadingPosition>;
  children: React.ReactNode;
}) {
  const t = useT();
  const viewport = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const jump = React.useRef<() => void>(() => {});
  const [showJump, setShowJump] = React.useState(false);

  React.useLayoutEffect(() => {
    const el = viewport.current!, body = content.current!;
    const saved = positions.get(conversationId);
    let following = saved?.following ?? true;
    let previousTop = saved?.top ?? 0;
    let frame = 0;
    const remember = () => positions.set(conversationId, { top: el.scrollTop, following });
    const update = () => { setShowJump(!following); remember(); };
    const follow = () => {
      if (!following || hasReadingSelection(el)) return;
      el.scrollTop = el.scrollHeight;
      previousTop = el.scrollTop;
      remember();
    };
    const pause = () => { following = false; update(); };
    const onScroll = () => {
      const top = el.scrollTop;
      if (top < previousTop - 1) following = false;
      else if (top > previousTop && el.scrollHeight - top - el.clientHeight <= 24 && !hasReadingSelection(el)) following = true;
      previousTop = top;
      update();
    };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause(); };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause();
    };
    const onSelection = () => { if (hasReadingSelection(el)) pause(); };
    jump.current = () => {
      if (hasReadingSelection(el)) document.getSelection()?.removeAllRanges();
      following = true; follow(); update();
    };
    el.scrollTop = following ? el.scrollHeight : previousTop;
    previousTop = el.scrollTop;
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('keydown', onKey);
    document.addEventListener('selectionchange', onSelection);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(follow);
    });
    observer.observe(body);
    observer.observe(el);
    return () => {
      remember();
      observer.disconnect();
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [conversationId, positions]);

  return <div className="messages-shell">
    <div className="messages" ref={viewport} tabIndex={0}>
      <div className="messages-inner" ref={content}>{children}</div>
    </div>
    {showJump && <button className="btn jump-latest" onClick={() => jump.current()}>{t('回到最新内容')} ↓</button>}
  </div>;
}
