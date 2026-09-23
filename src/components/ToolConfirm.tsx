import React from 'react';
import { useT } from '../lib/i18n';
import type { ToolStep } from '../types';
import { TOOL_BY_NAME } from '../lib/tools/registry';
import { Modal } from './ui';
import { ChangeDiff } from './CodeChanges';

/**
 * 危险工具的确认弹窗。
 * 键盘：Enter 批准，← 或 Esc 拒绝 —— 这类弹窗会连着弹好几次，
 * 每次都去够鼠标很烦。
 */
export default function ToolConfirm(props: {
  step: ToolStep;
  onResolve: (ok: boolean) => void;
}) {
  const t = useT();
  const def = TOOL_BY_NAME[props.step.name];
  const args = (props.step.args ?? {}) as Record<string, unknown>;
  const nativeCommand = props.step.name === 'native_client_operation' && args.requiresExplicitApproval === true
    ? args as { toolCall: { rawInput: { command: string; description?: string; is_background?: boolean; timeout?: number | null } }; execution: { cwd: string } }
    : null;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !props.step.codeChanges?.length) {
        e.preventDefault();
        props.onResolve(true);
      } else if (e.key === 'ArrowLeft' && !props.step.codeChanges?.length) {
        e.preventDefault();
        props.onResolve(false);
      }
      // Esc 由 Modal 自己处理，走 onClose → 拒绝
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  return (
    <Modal
      title={t(props.step.codeChanges?.length ? '审核代码改动' : nativeCommand ? '确认本机命令' : '这一步要动真格的')}
      onClose={() => props.onResolve(false)}
      footer={
        <>
          <button className="btn" autoFocus={Boolean(props.step.codeChanges?.length)} onClick={() => props.onResolve(false)}>
            {t('拒绝')} {!props.step.codeChanges?.length ? <kbd>←</kbd> : null}
          </button>
          <button className="btn primary" autoFocus={!props.step.codeChanges?.length} onClick={() => props.onResolve(true)}>
            {t(props.step.codeChanges?.length ? '批准并应用' : '允许执行')} {!props.step.codeChanges?.length ? <kbd>Enter</kbd> : null}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="confirm-tool">
          {props.step.codeChanges?.length ? <>
            <p>以下改动尚未写入文件。批准后生效；拒绝或关闭窗口保留原文件。</p>
            {props.step.codeChanges.map(change=><ChangeDiff key={change.id} change={change} expanded/>)}
          </> : nativeCommand ? <>
            <div>{t('Grok 请求在本机运行以下命令。')}</div>
            <div className="hint">{t('命令使用你的本机权限运行，可能访问工作目录以外的文件或网络。每条命令都需单独确认。')}</div>
            <div className="field-label">{t('工作目录')}</div>
            <pre>{nativeCommand.execution.cwd}</pre>
            <div className="field-label">{t('命令')}</div>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{nativeCommand.toolCall.rawInput.command}</pre>
            {nativeCommand.toolCall.rawInput.description && <div className="hint">{nativeCommand.toolCall.rawInput.description}</div>}
            {nativeCommand.toolCall.rawInput.timeout != null && <div className="hint">{t('超时参数（毫秒）')}：{nativeCommand.toolCall.rawInput.timeout}</div>}
            {nativeCommand.toolCall.rawInput.is_background && <div className="hint">{t('此命令将在后台运行，可能在本轮对话结束后继续。')}</div>}
            <div className="hint">{t('允许只对本次命令生效。拒绝或关闭窗口会阻止本次执行；已有进度会保留。')}</div>
          </> : <>
          <div>
            {t('模型要调用')} <strong>{def?.label ?? props.step.name}</strong>
            <span className="tool-code"> （{props.step.name}）</span>
          </div>
          <div className="hint">{props.step.summary}</div>
          <div className="field-label">{t('参数')}</div>
          <pre>{JSON.stringify(props.step.args, null, 2)}</pre>
          <div className="hint">
            {t('拒绝不会中断对话。模型会收到「用户拒绝了」并换个办法继续。不想每次都问的话，输入框左下角能把档位调成「自动批准编辑」或「全部放行」。')}
          </div>
          </>}
        </div>
      </div>
    </Modal>
  );
}
