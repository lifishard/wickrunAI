import React from 'react';
import { desktop } from '../lib/transport';
import { formatBytes } from '../lib/format-bytes';

type Loaded = { url: string; kind: 'video' | 'audio' | 'image' | 'file'; size: number };

/**
 * Plays a video or audio file, or shows an image, straight from disk.
 * The file is streamed by the main process with byte ranges, so a long clip
 * starts at once, can be scrubbed, and never has to fit in memory.
 */
export default function ArtifactMedia({ path, name, type }: { path: string; name: string; type: 'video' | 'audio' | 'image' }) {
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [error, setError] = React.useState('');
  const [playbackFailed, setPlaybackFailed] = React.useState(false);

  React.useEffect(() => {
    let disposed = false;
    setLoaded(null); setError(''); setPlaybackFailed(false);
    const bridge = desktop();
    if (!bridge?.mediaUrl) { setError('这台设备读不了本地文件。请在保存该文件的桌面端打开。'); return; }
    void bridge.mediaUrl(path).then(result => { if (!disposed) setLoaded(result); })
      .catch(e => { if (!disposed) setError(`${e instanceof Error ? e.message : String(e)}。可以点「用默认程序打开」或「另存为」。`); });
    return () => { disposed = true; };
  }, [path]);

  if (error) return <p role="alert" className="artifact-file-error">{error}</p>;
  if (!loaded) return <div className="empty">正在准备…</div>;
  const style = { display: 'block', maxWidth: '100%', margin: 'auto' } as const;
  return <div className="artifact-media">
    {type === 'video' ? <video key={loaded.url} src={loaded.url} controls preload="metadata" playsInline style={{ ...style, maxHeight: '70vh', background: '#000' }} onError={() => setPlaybackFailed(true)} />
      : type === 'audio' ? <audio key={loaded.url} src={loaded.url} controls preload="metadata" style={{ ...style, width: '100%' }} onError={() => setPlaybackFailed(true)} />
      : <img src={loaded.url} alt={name} style={{ ...style, height: 'auto' }} onError={() => setPlaybackFailed(true)} />}
    <p className="hint" style={{ textAlign: 'center' }}>{name} · {formatBytes(loaded.size)}</p>
    {playbackFailed ? <p role="alert" className="artifact-file-error">
      这个文件的编码窗口里播放不了（文件本身没有损坏）。请点下方「用默认程序打开」，或「另存为」后用播放器打开。
    </p> : null}
  </div>;
}
