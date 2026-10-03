import React from 'react';
import { useT } from '../lib/i18n';
import { desktop } from '../lib/transport';
import { formatBytes } from '../lib/format-bytes';
import { mediaCall, uploadFileFromBrowser, type CloudFile, type CloudUsage, type UploadProgress } from '../lib/cloud-media';
import { uploadProgressText } from '../lib/upload-progress';
import './CloudFiles.css';

const ICON: Record<string, string> = { video: '🎬', audio: '🎧', image: '🖼' };
const kindOf = (mime: string) => (mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('image/') && !mime.includes('svg') ? 'image' : 'file');

/** 账号的云文件库：视频、音频和大文件。网页能直接播放和下载；桌面端从文件卡片上传。 */
export default function CloudFiles() {
  const t = useT();
  const [usage, setUsage] = React.useState<CloudUsage | null>(null);
  const [files, setFiles] = React.useState<CloudFile[]>([]);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [progress, setProgress] = React.useState<UploadProgress | null>(null);
  const [uploadNotice, setUploadNotice] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelSlow, setCancelSlow] = React.useState(false);
  const [playing, setPlaying] = React.useState<{ file: CloudFile; url: string } | null>(null);
  const abort = React.useRef<AbortController | null>(null);
  const mounted = React.useRef(false);
  const loadSequence = React.useRef(0);
  const isDesktop = Boolean(desktop());
  React.useEffect(() => {
    setCancelSlow(false);
    if (!cancelling) return;
    const timer = setTimeout(() => setCancelSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [cancelling]);

  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    const current = () => mounted.current && sequence === loadSequence.current;
    setError('');
    try {
      const status = await mediaCall<CloudUsage>('status');
      if (!current()) return;
      setUsage(status);
      if (status.available) {
        const result = await mediaCall<{ files: CloudFile[] }>('list');
        if (current()) setFiles(result.files);
      }
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (current()) setLoading(false); }
  }, []);
  React.useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; loadSequence.current += 1; abort.current?.abort(); };
  }, [load]);

  const play = async (file: CloudFile) => {
    setError('');
    try { setPlaying({ file, url: (await mediaCall<{ url: string }>('downloadUrl', { id: file.id, mode: 'inline' })).url }); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const download = async (file: CloudFile) => {
    setError('');
    try {
      const { url } = await mediaCall<{ url: string }>('downloadUrl', { id: file.id, mode: 'attachment' });
      const link = document.createElement('a'); link.href = url; link.rel = 'noopener'; link.click();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const remove = async (file: CloudFile) => {
    if (!window.confirm(t('删除「{name}」？删除后无法恢复。', { name: file.name }))) return;
    setError('');
    try { await mediaCall('remove', { id: file.id }); if (playing?.file.id === file.id) setPlaying(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const pick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || abort.current) return;
    setError(''); setUploadNotice(''); setCancelling(false); setProgress({ sent: 0, total: file.size, phase: 'hashing' });
    const controller = new AbortController();
    abort.current = controller;
    const current = () => mounted.current && abort.current === controller;
    try {
      await uploadFileFromBrowser(file, value => { if (current() && !controller.signal.aborted) setProgress(value); }, controller.signal);
      if (current() && !controller.signal.aborted) {
        setUploadNotice(t('已上传到云端')); setProgress(null); abort.current = null;
        await load();
      }
      else if (current()) setUploadNotice(t('已取消上传；已发送的数据可能仍在确认，可稍后刷新文件列表。'));
    } catch (e) {
      if (current()) {
        if (controller.signal.aborted || (e as Error)?.name === 'AbortError') setUploadNotice(t('已取消上传；已发送的数据可能仍在确认，可稍后刷新文件列表。'));
        else setError(e instanceof Error ? e.message : String(e));
      }
    } finally { if (current()) { setProgress(null); setCancelling(false); abort.current = null; } }
  };

  if (loading) return <div className="cloud-files-note">{t('正在读取云文件…')}</div>;
  if (usage && !usage.available) return <div className="cloud-files-note">{t('这个服务器还没有开通云文件存储。管理员配置 R2 变量后，这里就能保存和播放视频、音频等大文件。')}</div>;
  const percent = usage && usage.limitBytes ? Math.min(100, Math.round(usage.usedBytes / usage.limitBytes * 100)) : 0;
  return <div className="cloud-files">
    {usage ? <div className="cloud-files-usage">
      <div className={`cloud-files-bar${usage.overLimit ? ' is-full' : percent >= 85 ? ' is-warn' : ''}`} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('云存储已用')}><span style={{ width: `${percent}%` }} /></div>
      <div className="cloud-files-usage-text"><span>{formatBytes(usage.usedBytes)} / {formatBytes(usage.limitBytes)}（{usage.plan === 'paid' ? t('付费套餐') : t('免费套餐')}）</span><span>{t('剩余 {size}', { size: formatBytes(usage.availableBytes) })}</span></div>
      {usage.overLimit ? <div className="cloud-files-error" role="alert">{t('已超出套餐容量：暂时不能上传新文件，已有文件都保留着。请删除一些文件或升级套餐。')}</div> : null}
      {usage.maxFileBytes && usage.maxFileBytes > 0 ? <div className="cloud-files-note">{t('服务器单文件上限：{size}', { size: formatBytes(usage.maxFileBytes) })}</div> : null}
    </div> : null}
    {!isDesktop ? <div>
      <label className="btn sm primary" style={{ cursor: progress || usage?.overLimit ? 'not-allowed' : 'pointer', opacity: progress || usage?.overLimit ? 0.6 : 1 }}>
        {progress ? cancelling ? t('正在停止上传…') : uploadProgressText(progress, t) : t('上传文件')}
        <input type="file" hidden disabled={!!progress || usage?.overLimit} onChange={pick} />
      </label>
      {progress ? <button type="button" className="btn sm" style={{ marginLeft: 8 }} disabled={cancelling} onClick={() => { setCancelling(true); abort.current?.abort(); }}>{t('取消')}</button> : null}
    </div> : <div className="cloud-files-note">{t('在对话的「本轮文件与产物」里点「上传到云端」，文件就会出现在这里，网页端也能播放和下载。')}</div>}
    <div className="cloud-files-note">{t('云存储、预览和模型读取各有限制；上传成功不会自动把文件交给模型。')}</div>
    {cancelling && cancelSlow ? <div className="cloud-files-note" role="status">{t('停止时间比预期长，仍在等待确认；本次上传尚未结束。')}</div> : null}
    {uploadNotice ? <div className="cloud-files-note" role="status">{uploadNotice}</div> : null}
    {error ? <div className="cloud-files-error" role="alert">{error}</div> : null}
    {playing ? <div className="cloud-files-player">
      {kindOf(playing.file.mime) === 'video' ? <video src={playing.url} controls autoPlay playsInline preload="metadata" />
        : kindOf(playing.file.mime) === 'audio' ? <audio src={playing.url} controls autoPlay />
        : kindOf(playing.file.mime) === 'image' ? <img src={playing.url} alt={playing.file.name} /> : null}
      <div className="cloud-files-actions"><button type="button" className="btn sm" onClick={() => setPlaying(null)}>{t('关闭')}</button></div>
    </div> : null}
    {files.length ? <ul className="cloud-files-list">
      {files.map(file => <li key={file.id} className="cloud-files-row">
        <span aria-hidden="true">{ICON[kindOf(file.mime)] ?? '📄'}</span>
        <span><div className="cloud-files-name" title={file.name}>{file.name}</div><div className="cloud-files-meta">{formatBytes(file.size)} · {new Date(file.createdAt).toLocaleString()}</div></span>
        <span className="cloud-files-actions">
          {kindOf(file.mime) !== 'file' ? <button type="button" className="btn sm" onClick={() => void play(file)}>{t('播放')}</button> : null}
          <button type="button" className="btn sm" onClick={() => void download(file)}>{t('下载')}</button>
          <button type="button" className="btn sm" onClick={() => void remove(file)}>{t('删除')}</button>
        </span>
      </li>)}
    </ul> : <div className="cloud-files-note">{t('还没有云端文件。')}</div>}
  </div>;
}
