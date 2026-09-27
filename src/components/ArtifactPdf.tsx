import React from 'react';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, TextLayer, RenderTask } from 'pdfjs-dist';
import 'pdfjs-dist/web/pdf_viewer.css';

export default function ArtifactPdf({ bytes }: { bytes: Uint8Array }) {
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const layer = React.useRef<HTMLDivElement>(null);
  const container = React.useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = React.useState(1);
  const [zoom, setZoom] = React.useState(1);
  const [width, setWidth] = React.useState(500);
  const [size, setSize] = React.useState({ width: 500, height: 650 });
  const [error, setError] = React.useState('');
  const [rendering, setRendering] = React.useState(true);
  const [query, setQuery] = React.useState('');
  const [hits, setHits] = React.useState<number[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [hit, setHit] = React.useState(-1);
  const textCache = React.useRef(new Map<number, string>());
  React.useEffect(() => {
    setPdf(null);setPage(1);setError('');setRendering(true);
    let disposed = false;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    void import('pdfjs-dist').then(async lib => {
      if (disposed) return;
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      task = lib.getDocument({ data: bytes.slice(), isEvalSupported: false });
      const doc = await task.promise;
      if (!disposed) { textCache.current.clear(); setPdf(doc); }
    }).catch(e => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; void task?.destroy().catch(() => {}); };
  }, [bytes]);
  React.useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    if (!pdf) return;
    let disposed = false, task: RenderTask | undefined, textLayer: TextLayer | undefined;
    setRendering(true); setError('');
    void (async () => {
      const [p, lib] = await Promise.all([pdf.getPage(page), import('pdfjs-dist')]);
      if (disposed || !canvas.current || !layer.current) return;
      const viewport = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width * zoom });
      setSize({ width: viewport.width, height: viewport.height });
      const el = canvas.current, ratio = Math.min(devicePixelRatio || 1, 2);
      el.width = Math.ceil(viewport.width * ratio); el.height = Math.ceil(viewport.height * ratio);
      layer.current.replaceChildren();
      layer.current.style.setProperty('--scale-factor', String(viewport.scale));
      task = p.render({ canvasContext: el.getContext('2d')!, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
      textLayer = new lib.TextLayer({ container: layer.current, textContentSource: p.streamTextContent(), viewport });
      await Promise.all([task.promise, textLayer.render()]);
      if (!disposed) setRendering(false);
    })().catch(e => { if (!disposed) { setError(String(e)); setRendering(false); } });
    return () => { disposed = true; task?.cancel(); textLayer?.cancel(); };
  }, [pdf, page, zoom, width]);
  React.useEffect(() => {
    if (!pdf || !query.trim()) { setHits([]); setHit(-1); setSearching(false); return; }
    let disposed = false;
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        const matches: number[] = [], needle = query.trim().toLocaleLowerCase();
        for (let i = 1; i <= pdf.numPages; i++) {
          if (disposed) return;
          let text = textCache.current.get(i);
          if (text === undefined) {
            const content = await (await pdf.getPage(i)).getTextContent();
            text = content.items.map(v => 'str' in v ? v.str : '').join(' ').toLocaleLowerCase();
            textCache.current.set(i, text);
          }
          if (text.includes(needle)) matches.push(i);
        }
        if (!disposed) { setHits(matches); setHit(matches.length ? 0 : -1); if (matches.length) setPage(matches[0]); setSearching(false); }
      })().catch(e => { if (!disposed) { setError(String(e)); setSearching(false); } });
    }, 250);
    return () => { disposed = true; clearTimeout(timer); };
  }, [pdf, query]);
  React.useEffect(() => {
    const needle = query.trim().toLocaleLowerCase();
    layer.current?.querySelectorAll('span').forEach(el => el.classList.toggle('artifact-pdf-match', !!needle && !!el.textContent?.toLocaleLowerCase().includes(needle)));
  }, [query, page, rendering]);
  return <div className="artifact-document">
    <div className="artifact-editor-toolbar">
      <button className="btn sm" disabled={!pdf || page <= 1 || rendering} onClick={() => setPage(n => n - 1)}>上一页</button>
      <span>{pdf ? `${page} / ${pdf.numPages}` : '正在读取 PDF…'}</span>
      <button className="btn sm" disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => setPage(n => n + 1)}>下一页</button>
      <label>缩放 <select aria-label="PDF 缩放" value={zoom} onChange={e => setZoom(Number(e.target.value))}>{[0.75, 1, 1.25, 1.5, 2].map(v => <option value={v} key={v}>{v === 1 ? '适合宽度' : `${v * 100}%`}</option>)}</select></label>
    </div>
    <div className="artifact-editor-toolbar"><input aria-label="搜索 PDF" placeholder="搜索文档文字" value={query} onChange={e => setQuery(e.target.value)} />
      {query.trim() ? <span role="status">{searching ? '搜索中…' : hits.length ? `${hit + 1} / ${hits.length} 个匹配页面` : '没有找到文字'}</span> : null}
      <button className="btn sm" disabled={searching || !hits.length} onClick={() => { const next = (hit + 1) % hits.length; setHit(next); setPage(hits[next]); }}>下一个匹配</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}
    {rendering && !error ? <p role="status">正在绘制页面…</p> : null}
    <div className="artifact-pdf-scroll" ref={container}><div className="artifact-pdf-sheet" style={size}>
      <canvas ref={canvas} style={size} aria-label={`PDF 第 ${page} 页`} />
      <div ref={layer} className="textLayer" aria-label={`第 ${page} 页文字，可选择复制`} />
    </div></div>
    <p className="hint">可选择文字并复制。扫描件需要先识别文字，才能搜索和选取。</p>
  </div>;
}
