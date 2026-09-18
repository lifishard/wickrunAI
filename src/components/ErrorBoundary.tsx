import React from 'react';
import { useT } from '../lib/i18n';

/**
 * 错误边界。
 *
 * 没有它的时候，渲染期抛一个异常 React 会把整棵树卸载掉 —— 界面看着还在
 * （最后一帧的 DOM 还留在那），但所有事件监听都没了，表现就是「突然点不动」，
 * 而且控制台不开就完全不知道发生了什么。
 *
 * 有了它，至少能把错误和栈摆到脸上，还能只重置出问题的那一块而不用重启应用。
 */
interface State {
  error: Error | null;
  info: string;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string; onReset?: () => void },
  State
> {
  state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info: info.componentStack ?? '' });
    console.error('[wickrunAI] 渲染出错：', error, info);
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <CrashCard
        error={error}
        info={info}
        label={this.props.label}
        onRetry={() => {
          this.setState({ error: null, info: '' });
          this.props.onReset?.();
        }}
      />
    );
  }
}

/** 类组件用不了 hooks，界面拆出来当函数组件，翻译才拿得到当前语言。 */
function CrashCard({ error, info, label, onRetry }: {
  error: Error;
  info: string;
  label?: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="crash">
      <div className="crash-title">
        {label ? t('{label}崩了', { label }) : t('这块界面崩了')}
      </div>
      <div className="crash-msg">{error.message || String(error)}</div>
      <details>
        <summary>{t('技术细节（贴给我就能定位）')}</summary>
        <pre>
          {error.stack ?? ''}
          {info ? `\n--- ${t('组件栈')} ---${info}` : ''}
        </pre>
      </details>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn primary" onClick={onRetry}>
          {t('重试')}
        </button>
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(
              `${error.message}\n\n${error.stack ?? ''}\n\n${info}`,
            );
          }}
        >
          {t('复制错误')}
        </button>
      </div>
    </div>
  );
}
