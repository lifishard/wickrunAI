import React from 'react';
import { useT } from '../lib/i18n';
import { desktop, type CloudRelayState } from '../lib/transport';
import { clientText } from '../lib/client-text';

const readable = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');

/**
 * 允许网页版使用本机 AI：打开后，用同一云账号登录的网页版可以把对话交给这台电脑上已连接的客户端。
 * 默认关闭；只做对话，不开放文件和命令。
 */
export default function WebRelayToggle() {
  const t = useT();
  const api = desktop();
  const [state, setState] = React.useState<CloudRelayState | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!api?.cloudRelayState) return;
    let live = true;
    const load = () => void api.cloudRelayState!().then(next => { if (live) setState(next); }).catch(() => {});
    load();
    const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [api]);

  if (!api?.cloudRelaySet || !state) return null;
  const toggle = async (enabled: boolean) => {
    setBusy(true); setError('');
    try { setState(await api.cloudRelaySet!(enabled)); } catch (cause) { setError(readable(cause)); } finally { setBusy(false); }
  };
  const status = !state.enabled ? { cls: 'idle', text: t('未开启') }
    : state.error ? { cls: 'error', text: t('需要处理') }
    : state.current ? { cls: 'ready', text: t('正在处理网页任务') }
    : state.online ? { cls: 'ready', text: t('网页版可用') }
    : { cls: 'idle', text: t('正在连接…') };

  return <div className="client-row web-relay">
    <div className="client-heading">
      <strong>{t('允许网页版使用')}</strong>
      <span className={`connection-state ${status.cls}`}><span aria-hidden="true" />{status.text}</span>
    </div>
    <p>{t('打开后，用同一个云账号登录的网页版可以把对话交给这台电脑上已连接的客户端。只做对话，不开放文件和命令。')}</p>
    {!state.signedIn ? <p className="hint">{t('先在左下角登录云账号。')}</p> : null}
    <label className="row">
      <input type="checkbox" checked={state.enabled} disabled={busy || (!state.signedIn && !state.enabled)} onChange={e => void toggle(e.target.checked)} />
      {t('允许网页版使用本机 AI')}
    </label>
    {state.enabled && state.clients.length ? <p className="hint">{t('网页版可见：{list}', { list: state.clients.join('、') })}</p> : null}
    {state.enabled && !state.clients.length && !state.error ? <p className="hint">{t('还没有就绪的客户端。先在上面连接 Claude Code、Codex、Kimi 或 Grok。')}</p> : null}
    {state.current ? <p className="hint">{t('正在处理：{title}', { title: state.current.title })}</p> : null}
    {state.error ? <p className="connection-error" role="alert">{clientText(t, state.error)}</p> : null}
    {error ? <p className="connection-error" role="alert">{clientText(t, error)}</p> : null}
  </div>;
}
