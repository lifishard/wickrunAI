import React from 'react';
import { useT } from '../lib/i18n';
import { desktop } from '../lib/transport';
import type { NativeAiState } from '../lib/native-ai';
import './NativeAiPanel.css';
import { Modal } from './ui';

const EMPTY_STATE: NativeAiState = { connections: [], tasks: [] };
/** Electron 会在主进程的报错前加一段「Error invoking remote method …: Error:」，界面上只留真正的原因 */
const readable = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '');
/** 给 Claude Desktop 对话或定时任务用：每次只领一个任务，做完交回或报告受阻后停下 */
const CLAIM_PROMPT = '调用 wickrun_claim_task 领取一个灯芯AI 任务并完成。没有任务就回复空闲并停止。完成后用 wickrun_submit_result 交回结果；缺权限、缺信息或能力不够时用 wickrun_report_blocked 说明原因。每次只处理一个任务。';

/** 选用 Claude Desktop 前的说明：模型和思考强度只能在 Claude Desktop 里选，这里的设置对它不生效 */
const MODEL_TIP_KEY = 'wickrun:claude-desktop-model-tip:v1';
const tipDismissed = () => { try { return localStorage.getItem(MODEL_TIP_KEY) === '1'; } catch { return false; } };

export default function NativeAiPanel({ selected = false, onSelect }: { selected?: boolean; onSelect?: () => void }) {
  const t = useT();
  const [modelTip, setModelTip] = React.useState(false);
  const [hideTip, setHideTip] = React.useState(false);
  const choose = () => { if (!onSelect) return; if (tipDismissed()) onSelect(); else setModelTip(true); };
  const confirmTip = () => {
    if (hideTip) { try { localStorage.setItem(MODEL_TIP_KEY, '1'); } catch { /* 下次再提示 */ } }
    setModelTip(false); onSelect?.();
  };
  const [state, setState] = React.useState<NativeAiState>(EMPTY_STATE);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState<'configure' | 'open' | 'check' | 'extension' | null>(null);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [conflict, setConflict] = React.useState<{ message: string; where: string[] } | null>(null);

  const refresh = React.useCallback(async (showMessage = false) => {
    const api = desktop();
    if (!api?.nativeAiState) return;
    setBusy('check');
    setError('');
    try {
      const next = await api.nativeAiState();
      setState(next);
      setLoaded(true);
      if (showMessage) {
        const connection = next.connections.find((item) => item.provider === 'claude-desktop');
        setMessage(t(connection?.connected ? 'Claude Desktop 已连接。' : connection?.configured ? '配置已写入，等待 Claude Desktop 连接。' : '尚未配置 Claude Desktop 连接。'));
      }
    } catch (cause) {
      setLoaded(true);
      setError(readable(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const connection = state.connections.find((item) => item.provider === 'claude-desktop');
  const status = !loaded ? 'checking' : error ? 'error' : connection?.connected ? 'ready' : connection?.configured ? 'waiting' : 'idle';
  const statusLabel = t(status === 'checking' ? '正在检测' : status === 'error' ? '检测失败' : status === 'ready' ? '已连接' : status === 'waiting' ? '等待连接' : '未配置');

  const configure = async (replace = false) => {
    const api = desktop();
    if (!api) return;
    setBusy('configure');
    setError('');
    setMessage('');
    setConflict(null);
    try {
      const result = await api.nativeAiConfigure(replace ? { replace: true } : undefined);
      setState(result.state);
      setLoaded(true);
      if (result.conflicts?.length) {
        // 别的程序写的同名连接：不静默覆盖，让用户看清楚再决定
        setConflict({ message: result.message, where: result.conflicts.map((c) => c.args.find((a) => /\.(?:c?js|mjs|exe|py)$/i.test(a)) || c.command).filter(Boolean) });
        return;
      }
      setMessage(result.message);
      try {
        await api.nativeAiOpen('claude-desktop');
      } catch {
        setMessage(`${result.message} ${t('请手动打开 Claude Desktop。')}`);
      }
    } catch (cause) {
      setError(readable(cause));
    } finally {
      setBusy(null);
    }
  };

  const installExtension = async () => {
    const api = desktop();
    if (!api?.nativeAiExtension) return;
    setBusy('extension');
    setError('');
    setMessage('');
    setConflict(null);
    try {
      const result = await api.nativeAiExtension();
      setState(result.state);
      setLoaded(true);
      setMessage(t(result.opened
        ? '已生成扩展并交给 Claude Desktop。请在弹出的安装界面点「安装」，然后在 Claude 里说「领取灯芯AI 任务」。灯芯AI 需要保持运行。'
        : '已生成扩展文件并在文件夹中显示。把 wickrun-ai.mcpb 拖进 Claude Desktop 窗口，或在「设置 → 扩展 → 高级设置 → 安装扩展」里选择它。'));
    } catch (cause) {
      setError(readable(cause));
    } finally {
      setBusy(null);
    }
  };

  const openClaude = async () => {
    const api = desktop();
    if (!api) return;
    setBusy('open');
    setError('');
    setMessage('');
    try {
      await api.nativeAiOpen('claude-desktop');
      setMessage(t('已打开 Claude Desktop。'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('未能打开 Claude Desktop，请确认已经安装。'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`native-ai-connection${selected ? ' selected' : ''}`} aria-label={t('Claude Desktop 连接')}>
      <div className="client-heading">
        <div>
          <strong>Claude Desktop</strong>
          <p>{t('连接官方桌面应用，让灯芯AI在对话中按需调用。账号登录和工具授权仍在 Claude Desktop 完成。')}</p>
        </div>
        <span className={`connection-state ${status}`} role="status">
          <span aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      {connection?.connected && connection.client ? <p className="connection-detail">{t('当前客户端：')}{connection.client}</p> : null}
      <p className="connection-detail">{t('模型和思考强度只能在 Claude Desktop 里选择和调整，灯芯AI 这里的模型设置对它不生效。')}</p>
      {status === 'waiting' ? <p className="connection-detail">{t('首次配置后请完全退出并重新打开 Claude Desktop。')}</p> : null}
      {connection?.configured ? <p className="connection-detail">{t('从对话发送的任务会排队。Claude 连接在线时，在 Claude 里说「领取灯芯AI 任务」即可领取；也可以把下面的指令设为 Claude Desktop 的定时任务，自动领取。')}</p> : null}

      <div className="client-actions">
        {loaded && connection?.configured && onSelect ? (
          <button className="btn sm" disabled={selected} onClick={choose}>{t(selected ? '正在对话中使用' : '在对话中使用')}</button>
        ) : null}
        {loaded && !connection?.connected ? (
          <button className={`btn sm${connection?.configured ? ' ghost' : ''}`} disabled={busy !== null} onClick={() => void installExtension()}>
            {t(busy === 'extension' ? '正在生成…' : '安装为 Claude 扩展（推荐）')}
          </button>
        ) : null}
        {loaded && !connection?.configured ? (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void configure(false)}>
            {t(busy === 'configure' ? '正在配置…' : '写入配置文件')}
          </button>
        ) : null}
        {loaded && connection?.configured ? (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void openClaude()}>
            {t(busy === 'open' ? '正在打开…' : '打开 Claude Desktop')}
          </button>
        ) : null}
        {loaded && connection?.configured && !connection.connected ? (
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => void configure(false)}>
            {t(busy === 'configure' ? '正在修复…' : '修复连接')}
          </button>
        ) : null}
        <button className="btn sm ghost" disabled={busy !== null} onClick={() => void refresh(true)}>
          {t(busy === 'check' ? '检测中…' : '重新检测')}
        </button>
      </div>
      {loaded && !connection?.connected ? <p className="connection-detail">{t('本机连接不在「连接器 → 添加自定义连接器」里：那里只接受 HTTPS 远程地址。装好扩展后在 Claude 的「设置 → 扩展」可见；写配置文件的方式在「设置 → 开发者」可见。两种方式都要完全退出 Claude（托盘图标 → 退出）再打开。')}</p> : null}

      {connection?.configured ? <button className="btn sm ghost" onClick={() => { void navigator.clipboard?.writeText(t(CLAIM_PROMPT)).then(() => setMessage(t('已复制领取指令。'))).catch(() => setMessage(t(CLAIM_PROMPT))); }}>{t('复制领取指令')}</button> : null}
      <p className="quota-note">{t('额度：Claude Desktop 未提供可读取的剩余额度。')}</p>
      {conflict ? <div className="connection-error" role="alert">
        <p>{conflict.message}</p>
        {conflict.where.map((w) => <code key={w} style={{ display: 'block', overflowWrap: 'anywhere' }}>{w}</code>)}
        <div className="client-actions">
          <button className="btn sm" disabled={busy !== null} onClick={() => void configure(true)}>{t(busy === 'configure' ? '正在替换…' : '替换为本机 wickrunAI')}</button>
          <button className="btn sm ghost" disabled={busy !== null} onClick={() => setConflict(null)}>{t('先不处理')}</button>
        </div>
      </div> : null}
      {message ? <p className="connection-message" role="status" aria-live="polite">{message}</p> : null}
      {error ? <p className="connection-error" role="alert">{error}</p> : null}
      {modelTip ? <Modal title={t('在 Claude Desktop 里选模型')} onClose={() => setModelTip(false)} footer={<>
        <button className="btn" onClick={() => setModelTip(false)}>{t('取消')}</button>
        <button className="btn primary" autoFocus onClick={confirmTip}>{t('知道了，开始使用')}</button>
      </>}>
        <div className="modal-body native-ai-tip">
          <p>{t('交给 Claude Desktop 的任务，由 Claude Desktop 用它当前选中的模型处理。')}</p>
          <ul>
            <li>{t('模型和思考强度只能在 Claude Desktop 的输入框里选择和调整，灯芯AI 的模型、思考强度和路由设置对它不生效。')}</li>
            <li>{t('想在灯芯AI 里直接控制 Claude 的模型和思考强度，请改用「Claude Code」连接：它可以选大脑路由、本机订阅和思考强度。')}</li>
            <li>{t('账号、额度和工具授权也都在 Claude Desktop 里管理。')}</li>
          </ul>
          <label className="row"><input type="checkbox" checked={hideTip} onChange={e => setHideTip(e.target.checked)} />{t('以后不再提示')}</label>
        </div>
      </Modal> : null}
    </div>
  );
}
