import { useEffect, useRef, useState } from 'react';
import { getDocument, PDFWorker, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import type { ArtifactDocument } from '../../../../shared/artifacts.ts';
import { tr } from '../../../../shared/localization.ts';
import { Menu } from '../primitives/menu.tsx';
import { Button } from '../primitives/button.tsx';

const positions = new Map<string, { page: number; zoom: number }>();
export function PdfPreview({ document: source, identity, capturing = false, onCapture }: { document: ArtifactDocument; identity: string; capturing?: boolean; onCapture(value: { page: number; image: string }): void }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>(), [error, setError] = useState<{ kind: 'load' | 'render' | 'search' | 'cancel'; detail: string }>(), [loading, setLoading] = useState(true);
  const [page, setPage] = useState(positions.get(identity)?.page ?? 1), [zoom, setZoom] = useState(positions.get(identity)?.zoom ?? 1);
  const [rendering, setRendering] = useState(false), [pageText, setPageText] = useState('');
  const [password, setPassword] = useState(''), [needsPassword, setNeedsPassword] = useState(false);
  const passwordReply = useRef<((value: string) => void) | undefined>(undefined), cancelLoad = useRef<(() => void) | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null), render = useRef<RenderTask | undefined>(undefined);
  const [rendered, setRendered] = useState<{ page: number; zoom: number }>();
  const [query, setQuery] = useState(''), [results, setResults] = useState<{ page: number; text: string }[]>([]), [searched, setSearched] = useState(0), [searching, setSearching] = useState(false);
  const searchId = useRef(0);
  useEffect(() => { positions.set(identity, { page, zoom }); }, [identity, page, zoom]);
  useEffect(() => {
    const assets = new URL('pdf-assets/', document.baseURI).href;
    let alive = true, destroyed = false;
    let port: Worker | undefined, worker: PDFWorker | undefined, task: ReturnType<typeof getDocument> | undefined;
    const destroy = () => { if (destroyed) return; destroyed = true; searchId.current++; void Promise.resolve(task?.destroy()).catch(() => {}).finally(() => { worker?.destroy(); port?.terminate(); }); };
    cancelLoad.current = () => { destroy(); setLoading(false); setNeedsPassword(false); setError({ kind: 'cancel', detail: '' }); };
    try {
      port = new Worker(assets + 'pdf.worker.mjs', { type: 'module' }); worker = PDFWorker.create({ port });
      task = getDocument({ data: Uint8Array.from(atob(source.data!), value => value.charCodeAt(0)), worker, cMapUrl: assets + 'cmaps/', standardFontDataUrl: assets + 'standard_fonts/', wasmUrl: assets + 'wasm/', iccUrl: assets + 'iccs/', useWorkerFetch: false, enableXfa: false, maxImageSize: 32000000, canvasMaxAreaInBytes: 64000000 });
      task.onPassword = (callback: (password: string) => void) => { if (alive) { passwordReply.current = callback; setNeedsPassword(true); setPassword(''); } };
      void task.promise.then(value => { if (alive && !destroyed) { setPdf(value); setPage(current => Math.min(current, value.numPages)); setLoading(false); setNeedsPassword(false); } }, reason => { if (alive && !destroyed) { setError({ kind: 'load', detail: String(reason) }); setLoading(false); } });
    } catch (reason) { destroy(); setLoading(false); setError({ kind: 'load', detail: String(reason) }); }
    return () => { alive = false; destroy(); render.current?.cancel(); };
  }, [source.id]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let alive = true; const element = canvas.current; setRendering(true); setRendered(undefined); setPageText(''); setError(undefined);
    const previous = render.current; previous?.cancel();
    void (async () => {
      await previous?.promise.catch(() => {}); if (!alive) return;
      const value = await pdf.getPage(page); if (!alive) return;
      const natural = value.getViewport({ scale: zoom });
      const scale = Math.min(devicePixelRatio || 1, Math.sqrt(16000000 / (natural.width * natural.height)), 8192 / natural.width, 8192 / natural.height);
      const viewport = value.getViewport({ scale: zoom * scale });
      element.width = Math.max(1, Math.floor(viewport.width)); element.height = Math.max(1, Math.floor(viewport.height));
      element.style.width = natural.width + 'px'; element.style.height = natural.height + 'px';
      const current = value.render({ canvas: element, viewport }); render.current = current; await current.promise;
      const text = await value.getTextContent(); if (alive) { setPageText(text.items.map(item => 'str' in item ? item.str : '').join(' ')); setRendered({ page, zoom }); setRendering(false); }
    })().catch(reason => { if (alive && reason?.name !== 'RenderingCancelledException') { setError({ kind: 'render', detail: String(reason) }); setRendering(false); } });
    return () => { alive = false; render.current?.cancel(); };
  }, [pdf, page, zoom]);
  const changeQuery = (value: string) => { searchId.current++; setQuery(value); setSearching(false); setResults([]); setSearched(0); setError(current => current?.kind === 'search' ? undefined : current); };
  const search = async () => {
    if (!pdf || !query.trim()) return;
    const id = ++searchId.current, needle = query.trim().toLocaleLowerCase(); setResults([]); setSearched(0); setSearching(true); setError(current => current?.kind === 'search' ? undefined : current);
    const matches: { page: number; text: string }[] = [];
    try {
      for (let number = 1; number <= pdf.numPages; number++) {
        if (searchId.current !== id) return;
        const text = (await (await pdf.getPage(number)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' ');
        if (searchId.current !== id) return;
        const index = text.toLocaleLowerCase().indexOf(needle);
        if (index >= 0) matches.push({ page: number, text: text.slice(Math.max(0, index - 45), index + needle.length + 120) });
        setSearched(number); setResults([...matches]);
      }
    } catch (reason) { if (searchId.current === id) setError({ kind: 'search', detail: String(reason) }); }
    finally { if (searchId.current === id) setSearching(false); }
  };
  return <section className="pdf-preview" aria-label={tr('PDF 预览')} aria-busy={loading || rendering}>
    {loading && <div role="status">{tr('正在读取 PDF…')} <Button onClick={() => cancelLoad.current?.()}>{tr('取消加载')}</Button></div>}
    {needsPassword && <form onSubmit={event => { event.preventDefault(); passwordReply.current?.(password); setPassword(''); setNeedsPassword(false); }}><label>{tr('PDF 密码')}<input type="password" autoComplete="off" value={password} onChange={event => setPassword(event.target.value)} /></label><Button type="submit">{tr('打开')}</Button></form>}
    {pdf && <>
      <div className="artifact-toolbar">
        <Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{tr('上一页')}</Button>
        <label>{tr('页码')} <input aria-label={tr('PDF 页码')} type="number" min={1} max={pdf.numPages} value={page} onChange={event => setPage(Math.max(1, Math.min(pdf.numPages, Number(event.target.value) || 1)))} /></label><span>/ {pdf.numPages}</span>
        <Button disabled={page >= pdf.numPages} onClick={() => setPage(value => value + 1)}>{tr('下一页')}</Button>
        <Menu label={tr('PDF 缩放')} value={String(zoom)} matchTriggerWidth className="artifact-choice"
          options={[.25, .5, .75, 1, 1.25, 1.5, 2, 3].map(value => ({ value: String(value), label: value * 100 + '%' }))}
          onChange={value => setZoom(Number(value))} />
        <Button disabled={capturing || rendering || !!error || rendered?.page !== page || rendered?.zoom !== zoom} onClick={() => { if (canvas.current && rendered?.page === page && rendered.zoom === zoom) onCapture({ page: rendered.page, image: canvas.current.toDataURL('image/png') }); }}>{tr('标注此页')}</Button>
      </div>
      <form className="artifact-toolbar" onSubmit={event => { event.preventDefault(); void search(); }}><input aria-label={tr('搜索 PDF')} value={query} maxLength={500} onChange={event => changeQuery(event.target.value)} /><Button type="submit" disabled={!query.trim() || searching}>{tr('搜索')}</Button>{searching && <Button onClick={() => { searchId.current++; setSearching(false); }}>{tr('取消搜索')}</Button>}<span role="status">{searched > 0 && tr('已搜索 {p0}/{p1} 页，{p2} 页匹配', { p0: searched, p1: pdf.numPages, p2: results.length })}</span></form>
      {!!results.length && <ul className="pdf-search-results" aria-label={tr('PDF 搜索结果')}>{results.map(result => <li key={result.page}><button onClick={() => setPage(result.page)}>{tr('第 {p0} 页', { p0: result.page })} · {result.text}</button></li>)}</ul>}
    </>}
    {error && <p role="alert">{tr(({ load: '无法解析 PDF：', render: 'PDF 页面渲染失败：', search: 'PDF 搜索失败：', cancel: 'PDF 加载已取消，请重新加载' } as const)[error.kind])}{error.detail}</p>}
    <div className="pdf-scroll"><canvas ref={canvas} aria-label={tr('PDF 当前页面')} /></div>
    {pdf && <details className="pdf-page-text"><summary>{tr('当前页文字')}</summary><p>{pageText || tr('本页没有可搜索的文字')}</p></details>}
  </section>;
}
