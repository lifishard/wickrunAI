import ArtifactImage from './ArtifactImage';
import ArtifactMedia from './ArtifactMedia';
import { formatBytes } from '../lib/format-bytes';
import { uploadToCloud, type UploadProgress } from '../lib/cloud-media';
import { uploadProgressText, uploadCancellationText } from '../lib/upload-progress';
import React from 'react';
import { useT } from '../lib/i18n';
import type { Artifact } from '../types';
import { previewable, toPreviewHtml } from '../lib/artifacts';
import { desktop } from '../lib/transport';
import Markdown from './Markdown';
import './ArtifactStrip.css';
import ArtifactTextEditor from './ArtifactTextEditor';
import CopyablePre from './CopyablePre';
import type { ProposeArtifactEdit } from './ArtifactAiEdit';
import Icon from './Icon';
const ArtifactDocument = React.lazy(() => import('./ArtifactDocument'));
import { requestSharedSource,artifactShareSourceId } from '../lib/shared-resources';

const ICON: Record<string, string> = {
  ics: '🗓',
  html: '🌐',
  svg: '🖼',
  markdown: '📝',
  pdf: '📕',
  docx: '📘',
  xlsx: '📗',
  csv: '📊',
  json: '🧾',
  mermaid: '📐',
  text: '📄',
  code: '📄',
  other: '📄',
  video: '🎬',
  audio: '🎧',
  image: '🖼',
  binary: '📦',
};

const formatArtifactSize = formatBytes;

function artifactStatus(a: Artifact): { compact: string; full: string } {
  if (!a.path) return { compact: '对话内', full: '文件内容在对话中，可保存' };
  if (a.verifiedAt) return { compact: '已核实', full: '已核实文件路径' };
  return { compact: '待核实', full: '历史文件记录，打开时核实' };
}

function FileCard({ artifact: a, onOpen, onSaved }: { artifact: Artifact; onOpen: (a: Artifact) => void; onSaved?: (a: Artifact) => void }) {
  const t = useT();
  const bridge = desktop();
  const [error, setError] = React.useState('');
  const [working, setWorking] = React.useState(false);
  const [upload, setUpload] = React.useState<UploadProgress | null>(null);
  const [uploaded, setUploaded] = React.useState(false);
  const [uploadNotice, setUploadNotice] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelSlow, setCancelSlow] = React.useState(false);
  const uploadController = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    setCancelSlow(false);
    if (!cancelling) return;
    const timer = setTimeout(() => setCancelSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [cancelling]);
  React.useEffect(() => {
    setUploaded(false); setUpload(null); setUploadNotice(''); setCancelling(false); setError('');
    return () => { const controller = uploadController.current; uploadController.current = null; controller?.abort(); };
  }, [a.id, a.path]);
  const sendToCloud = async () => {
    if (!a.path || uploadController.current) return;
    const controller = new AbortController(); uploadController.current = controller;
    const current = () => uploadController.current === controller;
    setError(''); setUploaded(false); setUploadNotice(''); setCancelling(false); setUpload({ sent: 0, total: a.size ?? 0, phase: 'hashing' });
    try {
      await uploadToCloud(a.path, value => { if (current() && !controller.signal.aborted) setUpload(value); }, controller.signal);
      if (current() && !controller.signal.aborted) setUploaded(true);
      else if (current()) setUploadNotice(t('已取消上传；已发送的数据可能仍在确认，可稍后刷新文件列表。'));
    } catch (err) {
      if (current()) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') setUploadNotice(uploadCancellationText(err, t));
        else setError(err instanceof Error ? err.message : String(err));
      }
    } finally { if (current()) { setUpload(null); setCancelling(false); uploadController.current = null; } }
  };
  const action = async (fn: () => Promise<void>) => {
    setError(''); setWorking(true);
    try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setWorking(false); }
  };
  const save = async () => {
    if (bridge?.saveArtifact) {
      const file = await bridge.saveArtifact(a.name, a.text, a.path);
      if (file) onSaved?.({ ...a, id: `saved-${file.path}`, kind: 'file', path: file.path, name: file.name,
        size: file.size, verifiedAt: file.verifiedAt, direction: 'output', createdAt: file.verifiedAt });
    } else if (a.text !== undefined) {
      const url = URL.createObjectURL(new Blob([a.text], { type: a.type === 'ics' ? 'text/calendar;charset=utf-8' : 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = a.name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else throw new Error(t('请在保存该文件的桌面端打开'));
  };
  const status = artifactStatus(a);
  const direction = t(a.direction === 'input' ? '输入文件' : '输出文件');
  const size = formatArtifactSize(a.size);

  return <details className="artifact-file-row">
    <summary className="artifact-file-summary" aria-label={t('展开 {name} 的路径及操作', { name: a.name })}>
      <span className="artifact-file-chevron" aria-hidden="true" />
      <span className="artifact-icon" aria-hidden="true">{ICON[a.type] ?? '📄'}</span>
      <span className="artifact-file-name" title={a.path ?? a.name}>{a.name}</span>
      <span className="artifact-file-meta">
        <span className={`artifact-file-direction artifact-file-direction--${a.direction ?? 'output'}`}>{direction}</span>
        <span className="artifact-file-type">{a.type.toUpperCase()}</span>
        {size ? <span className="artifact-file-size">{size}</span> : null}
        <span className={`artifact-file-verify artifact-file-verify--${a.path ? a.verifiedAt ? 'verified' : 'pending' : 'inline'}`}>{status.compact}</span>
      </span>
    </summary>
    <div className="artifact-file-detail">
      <div className="artifact-file-status">{status.full}</div>
      {a.path ? <code className="artifact-file-path" title={a.path}>{a.path}</code> : null}
      <div className="artifact-file-actions">
        <button type="button" className="btn sm" onClick={() => onOpen(a)}>{t('查看预览')}</button>
        {(a.text!==undefined||a.path)&&<button type="button" className="btn sm" onClick={()=>requestSharedSource('file',artifactShareSourceId(a))}>{t('分享')}</button>}
        {a.path && bridge ? <>
          <button type="button" className="btn sm" disabled={working} onClick={() => void action(async () => { const err = await bridge.openPath(a.path!); if (err) throw new Error(err); })}>{t('打开')}</button>
          <button type="button" className="btn sm" disabled={working} onClick={() => void action(() => bridge.revealPath(a.path!))}>{t('在文件夹中显示')}</button>
        </> : null}
        {(bridge?.saveArtifact || a.text !== undefined) ? <button type="button" className="btn sm" disabled={working} onClick={() => void action(save)}>{a.path ? '另存为' : '保存文件'}</button> : null}
        {a.path && bridge?.cloudMedia && ['video', 'audio', 'image', 'binary', 'pdf', 'docx', 'xlsx', 'other'].includes(a.type) ? <button type="button" className="btn sm" disabled={working || !!upload}
          onClick={() => void sendToCloud()}>
          {upload ? cancelling ? t('正在停止上传…') : uploadProgressText(upload, t) : uploaded ? t('已上传到云端') : t('上传到云端')}</button> : null}
        {upload ? <button type="button" className="btn sm" disabled={cancelling} onClick={() => { setCancelling(true); uploadController.current?.abort(); }}>{t('取消上传')}</button> : null}
      </div>
      {a.path && bridge?.cloudMedia ? <div className="artifact-file-status">{t('云存储、预览和模型读取各有限制；上传成功不会自动把文件交给模型。')}</div> : null}
      {uploadNotice ? <div className="artifact-file-status" role="status">{uploadNotice}</div> : null}
      {cancelling && cancelSlow ? <div className="artifact-file-status" role="status">{t('停止时间比预期长，仍在等待确认；本次上传尚未结束。')}</div> : null}
      {error ? <div className="artifact-file-error" role="alert">{error}</div> : null}
    </div>
  </details>;
}

/** Input and output records are visible without opening the side panel. */
export function ArtifactStrip(props: { artifacts: Artifact[]; onOpen: (a: Artifact) => void; onSaved?: (a: Artifact) => void }) {
  const t = useT();
  if (!props.artifacts.length) return null;
  return <details className="artifact-strip artifact-strip--compact">
    <summary className="artifact-strip-summary">
      <span className="artifact-strip-chevron" aria-hidden="true" />
      <span className="artifact-strip-title">{t('本轮文件与产物')}</span>
      <span className="artifact-strip-count">{props.artifacts.length}</span>
    </summary>
    <div className="artifact-strip-list">
      {props.artifacts.map((a) => <FileCard key={a.id} artifact={a} onOpen={props.onOpen} onSaved={props.onSaved} />)}
    </div>
  </details>;
}

/* ------------------------------------------------------------------ *
 * 右侧预览面板
 * ------------------------------------------------------------------ */

export default function ArtifactPanel(props: { artifact: Artifact; onClose: () => void; busy: boolean; onRequestEdit: (prompt: string) => void; onPropose: ProposeArtifactEdit }) {
  const t = useT();
  const a = props.artifact;
  const bridge = desktop();
  const editable = !!bridge && !!a.path && ['markdown', 'text'].includes(a.type);
  const documentPreview = !!a.path && ['pdf', 'docx', 'xlsx'].includes(a.type);
  const [text, setText] = React.useState<string | null>(a.text ?? null);
  const [err, setErr] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'preview' | 'source'>(
    previewable(a.type) && a.type !== 'code' ? 'preview' : 'source',
  );
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    setText(a.text ?? null);
    setErr(null);
    setMode(previewable(a.type) && a.type !== 'code' ? 'preview' : 'source');

    if (a.kind !== 'file' || !a.path) return;
    if (!bridge) {
      setErr(t('这台设备读不了本地文件'));
      return;
    }
    if (!previewable(a.type) || editable) return;

    void bridge.readArtifact(a.path).then((r) => {
      if (disposed) return;
      if (r.ok) setText(r.text ?? '');
      else setErr(r.error ?? t('读不出来'));
    }).catch(e => { if (!disposed) setErr(String(e)); });
    return () => { disposed = true; };
  }, [a.id, a.kind, a.path, a.type, a.text, bridge, editable]);

  const srcDoc = React.useMemo(() => {
    if (a.type === 'html') return a.kind === 'file' ? (text ?? '') : toPreviewHtml(a);
    if (a.type === 'svg') return toPreviewHtml({ ...a, text: a.text ?? text ?? '' });
    return '';
  }, [a, text]);

  const canPreviewHere = previewable(a.type);
  const binaryLike = ['pdf', 'docx', 'xlsx', 'other', 'binary'].includes(a.type);

  return (
    <aside className="artifact-panel">
      <div className="artifact-panel-head">
        <span className="artifact-icon">{ICON[a.type] ?? '📄'}</span>
        <span className="artifact-panel-name" title={a.path ?? a.name}>
          {a.name}
        </span>
        {!editable && canPreviewHere && (a.type === 'html' || a.type === 'svg' || a.type === 'markdown') ? (
          <div className="seg">
            <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
              {t('预览')}
            </button>
            <button className={mode === 'source' ? 'on' : ''} onClick={() => setMode('source')}>
              {t('源码')}
            </button>
          </div>
        ) : null}
        <button className="icon-btn" onClick={props.onClose} title={t('关掉')} aria-label={t('关掉')}>
          <Icon name="close" size={18}/>
        </button>
      </div>

      <div className="artifact-panel-body">
        {err ? <div className="picker-error">{err}</div> : null}

        {(a.type==='video'||a.type==='audio')&&a.path ? <ArtifactMedia path={a.path} name={a.name} type={a.type}/> : a.size&&a.size>(editable?1024*1024:25*1024*1024)&&a.type!=='image' ? <p>文件已保存（{formatBytes(a.size)}）。较大文件请另存为，或使用默认程序打开。</p> : a.type==='image' && a.path ? <ArtifactImage path={a.path} name={a.name}/> : editable ? <ArtifactTextEditor key={a.path} path={a.path!} markdown={a.type === 'markdown'} busy={props.busy} onRequestEdit={props.onRequestEdit} onPropose={props.onPropose} /> : documentPreview ? <React.Suspense fallback={<div className="empty">正在加载预览…</div>}><ArtifactDocument key={a.path} path={a.path!} type={a.type} busy={props.busy} onPropose={props.onPropose} /></React.Suspense> : binaryLike ? (
          <div className="empty" style={{ lineHeight: 1.9 }}>
            {a.type} {t('不在应用里预览。')}
            <br />
            {t('用下面的「用默认程序打开」，系统会拿 Word / Excel / PDF 阅读器开。')}
          </div>
        ) : mode === 'preview' && (a.type === 'html' || a.type === 'svg') ? (
          // sandbox 不给 allow-same-origin：产物是模型生成的，不该能碰应用自身
          <iframe className="artifact-frame" sandbox="allow-scripts allow-forms" srcDoc={srcDoc} title={a.name} />
        ) : mode === 'preview' && a.type === 'markdown' ? (
          <div className="artifact-md">
            <Markdown text={text ?? ''} />
          </div>
        ) : text !== null ? (
          <CopyablePre className="artifact-source" text={text} />
        ) : (
          <div className="empty">{t('读取中…')}</div>
        )}
      </div>

      <div className="artifact-panel-foot">
        {a.path ? (
          <>
            <code className="artifact-path" title={a.path}>
              {a.path}
            </code>
            <button
              className="btn sm"
              onClick={() => {
                void navigator.clipboard.writeText(a.path!);
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
            >
              {t(copied ? '已复制' : '复制路径')}
            </button>
            {bridge ? (
              <>
                <button className="btn sm" onClick={() => void bridge.revealPath(a.path!).catch((e) => setErr(String(e)))}>
                  {t('在文件夹中显示')}
                </button>
                {bridge.saveArtifact ? <button className="btn sm" onClick={() => void bridge.saveArtifact(a.name, undefined, a.path).catch((e) => setErr(String(e)))}>{t('另存为')}</button> : null}
                <button className="btn sm primary" onClick={() => void bridge.openPath(a.path!).then((e) => { if (e) setErr(e); }).catch((e) => setErr(String(e)))}>
                  {t('用默认程序打开')}
                </button>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span className="hint" style={{ flex: 1 }}>
              {t('这个产物只在答案里，没落盘。想留下来就让模型用 write_file 写出去。')}
            </span>
            <button
              className="btn sm"
              onClick={() => {
                void navigator.clipboard.writeText(a.text ?? '');
                setCopied(true);
                setTimeout(() => setCopied(false), 1400);
              }}
            >
              {t(copied ? '已复制' : '复制内容')}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
