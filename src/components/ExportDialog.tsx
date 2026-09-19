import React from 'react';
import type { Conversation, FileRecord } from '../types';
import { useT } from '../lib/i18n';
import { desktop } from '../lib/transport';
import { Modal, Field, Switch } from './ui';
import { exportFileName, renderExport, type ExportFormat } from '../lib/conversation-export';
import { APP_VERSION } from '../lib/version';
import { conversationTitle } from '../lib/store';

/**
 * 导出一条对话。
 *
 * 保存完不用 toast 报路径 —— toast 几秒就没了，而路径恰恰是用户接下来要用的
 * 东西（去那个文件夹找它）。所以存完就把完整路径留在这个框里，旁边放两个
 * 按钮：打开所在文件夹、直接打开文件。用户什么时候关掉这个框都行。
 */
export default function ExportDialog(props: { conversation: Conversation; onClose: () => void }) {
  const t = useT();
  const bridge = desktop();
  const conv = props.conversation;
  const [format, setFormat] = React.useState<ExportFormat>('markdown');
  const [includeSteps, setIncludeSteps] = React.useState(false);
  const [includeReasoning, setIncludeReasoning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [saved, setSaved] = React.useState<FileRecord | null>(null);
  const [downloaded, setDownloaded] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');

  const named = conversationTitle(conv.title, t);
  const opts = { includeSteps, includeReasoning, appVersion: APP_VERSION, t };
  const fileName = exportFileName({ ...conv, title: named }, format, opts);
  const turns = (conv.messages ?? []).filter((m) => m.role === 'user' || m.role === 'assistant').length;

  async function run() {
    setError('');
    setBusy(true);
    try {
      const text = renderExport(conv, format, opts);
      if (bridge?.saveArtifact) {
        const file = await bridge.saveArtifact(fileName, text);
        // null = 用户在保存对话框里取消了，不是错误
        if (file) setSaved(file);
      } else {
        const type = format === 'json' ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8';
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setDownloaded(fileName);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('导出对话')}
      onClose={props.onClose}
      footer={
        saved || downloaded ? (
          <button className="btn primary" onClick={props.onClose}>{t('完成')}</button>
        ) : (
          <button className="btn primary" disabled={busy || !turns} onClick={() => void run()}>
            {busy ? t('导出中…') : t('导出')}
          </button>
        )
      }
    >
      <div className="modal-body">
        {saved ? (
          <div className="export-done">
            <p className="export-done-head">{t('已保存到')}</p>
            <code className="export-path mono">{saved.path}</code>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => void bridge?.revealPath(saved.path).catch((e) => setError(String(e)))}>
                {t('打开所在文件夹')}
              </button>
              <button className="btn" onClick={() => void bridge?.openPath(saved.path).then((err) => err && setError(err))}>
                {t('打开文件')}
              </button>
            </div>
          </div>
        ) : downloaded ? (
          <div className="export-done">
            <p className="export-done-head">{t('已下载')}</p>
            <code className="export-path mono">{downloaded}</code>
            <p className="hint">{t('文件在这台设备的「下载」目录里，具体位置取决于系统设置。')}</p>
          </div>
        ) : (
          <>
            <Field label={t('格式')}>
              <div className="row">
                <button
                  type="button"
                  className={`btn ${format === 'markdown' ? 'primary' : ''}`}
                  onClick={() => setFormat('markdown')}
                >
                  {t('Markdown · 给人看')}
                </button>
                <button
                  type="button"
                  className={`btn ${format === 'json' ? 'primary' : ''}`}
                  onClick={() => setFormat('json')}
                >
                  {t('JSON · 完整记录')}
                </button>
              </div>
            </Field>

            <div className="field">
              <Switch checked={includeSteps} onChange={setIncludeSteps} label={t('包含执行步骤')} />
              <Switch checked={includeReasoning} onChange={setIncludeReasoning} label={t('包含思考过程')} />
            </div>

            <Field label={t('文件名')}>
              <code className="export-path mono">{fileName}</code>
            </Field>

            <p className="hint" style={{ lineHeight: 1.8 }}>
              {t('这条对话有 {n} 轮消息。', { n: String(turns) })}
              <br />
              {t('导出的文件里没有 API 密钥。附件只保留名字、类型和大小，正文和图片本体不导出——否则一条带图的对话会有几十兆。')}
              {bridge ? null : <><br />{t('这台设备上会走浏览器下载，不会弹保存位置。')}</>}
            </p>
          </>
        )}
        {error ? <p className="hint" style={{ color: 'var(--danger)' }}>{error}</p> : null}
        {!turns && !saved && !downloaded ? (
          <p className="hint">{t('这条对话还没有内容可以导出。')}</p>
        ) : null}
      </div>
    </Modal>
  );
}
