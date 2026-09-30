import React from 'react';
import { useT } from '../lib/i18n';
import { writeCodeClipboard } from '../lib/code-clipboard';

export default function CopyablePre({ text, displayText = text, className }: { text: string; displayText?: string; className?: string }) {
  const t = useT();
  const [status, setStatus] = React.useState<'idle' | 'ok' | 'error'>('idle');
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = () => {
    void writeCodeClipboard(text).then(
      () => setStatus('ok'),
      () => setStatus('error'),
    ).finally(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus('idle'), 1400);
    });
  };
  return <div className="copyable-pre">
    <button type="button" className="copy-code" onClick={copy}>{t(status === 'ok' ? '已复制' : status === 'error' ? '复制失败' : '复制')}</button>
    <pre className={className}>{displayText}</pre>
  </div>;
}
