import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { annotationCaptureSchema, type AnnotationCapture, type AnnotationRect, type BrowserAnnotation } from '../../../../shared/browser-annotations.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { Menu } from '../primitives/menu.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

type SavedView = { item: BrowserAnnotation; image: string; stale?: boolean };
type PanelProps = { threadId: string; tabId: string; create: boolean; onClose(): void };
export function BrowserAnnotationsPanel(props: PanelProps) {
  return <AnnotationPanel key={JSON.stringify([props.threadId, props.tabId])} {...props} />;
}
function AnnotationPanel({ threadId, tabId, create, onClose }: PanelProps) {
  useLocale(); const { data, invoke, updateDraft } = useApp();
  const api = useRef(invoke); api.current = invoke;
  const captureId = useRef(''); const [capture, setCapture] = useState<AnnotationCapture>();
  const [mode, setMode] = useState<'element' | 'region'>('element'); const [elementId, setElementId] = useState(-1);
  const [rect, setRect] = useState<AnnotationRect>(); const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const mounted = useRef(true), busy = useRef(false), generation = useRef(Symbol());
  const [comment, setComment] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [feedback, setFeedback] = useState<'saved' | 'attached' | 'deleted'>();
  const [view, setView] = useState<SavedView>(); const [removeId, setRemoveId] = useState(''); const [discard, setDiscard] = useState<'close' | 'capture'>();
  const [readRetry, setReadRetry] = useState('');
  const items = data.threads.find(item => item.id === threadId)?.browserAnnotations ?? [];
  const viewDeleting = items.some(item => item.id === view?.item.id && item.deleting);
  const task = async (action: (current: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; const token = generation.current;
    const current = () => mounted.current && generation.current === token;
    setPending(true); setError(''); setFeedback(undefined); start.current = undefined;
    try { await action(current); }
    catch (reason) { if (current()) setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { if (current()) { busy.current = false; setPending(false); } }
  };
  const newCapture = () => task(async current => {
    const next = annotationCaptureSchema.parse(await api.current({ op: 'browser.annotationCapture', threadId, tabId }));
    if (!current()) { await api.current({ op: 'browser.annotationDiscard', threadId, captureId: next.id }); return; }
    captureId.current = next.id; setCapture(next); setRect(undefined); setElementId(-1); setView(undefined); setComment(''); setReadRetry('');
  });
  useEffect(() => {
    mounted.current = true; busy.current = false; generation.current = Symbol();
    if (create) void newCapture();
    return () => { mounted.current = false; if (captureId.current) void api.current({ op: 'browser.annotationDiscard', threadId, captureId: captureId.current }).catch(() => {}); };
  }, [threadId, tabId]);
  const selected = capture?.page.elements.find(item => item.id === elementId);
  const highlight = capture ? mode === 'element' ? selected?.rect : rect : view?.item.rect;
  const dimensions = capture?.page ?? view?.item.viewport;
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(capture!.page.width, (event.clientX - box.x) / box.width * capture!.page.width)), y: Math.max(0, Math.min(capture!.page.height, (event.clientY - box.y) / box.height * capture!.page.height)) };
  };
  const show = (id: string) => task(async current => {
    try {
      const next = await api.current({ op: 'browser.annotation', action: 'read', threadId, annotationId: id }) as SavedView;
      if (!current()) return;
      if (captureId.current) void api.current({ op: 'browser.annotationDiscard', threadId, captureId: captureId.current }).catch(() => {});
      captureId.current = ''; setView(next); setCapture(undefined); setComment(''); setReadRetry('');
    } catch (reason) { if (current()) setReadRetry(id); throw reason; }
  });
  const close = () => { if (busy.current) return; if (capture && comment.trim()) setDiscard('close'); else onClose(); };
  return <>
    <ConfirmDialog presentation="panel" pending={pending} title={tr('网页标注')} confirmLabel={tr('关闭')} onConfirm={close} onCancel={close} description={<div className="browser-annotations" aria-busy={pending}>
      <div className="row"><Button disabled={pending || !tabId} onClick={() => { if (capture && comment.trim()) setDiscard('capture'); else void newCapture(); }}>{tr('截取当前页面')}</Button><span role="status">{pending ? tr('正在处理…') : feedback ? tr(({ saved: '标注已保存', attached: '已加入输入草稿', deleted: '标注已删除' } as const)[feedback]) : ''}</span></div>
      {error && !removeId && <p role="alert">{localizeAppError(error)}</p>}
      {readRetry && <Button disabled={pending} onClick={() => void show(readRetry)}>{tr('重试读取标注')}</Button>}
      {capture && <>
        <p>{tr('在截图中点选元素，或拖动选择区域。也可以使用下方控件精确选择。')}</p>
        <div className="row" role="group" aria-label={tr('标注方式')}><Button disabled={pending} aria-pressed={mode === 'element'} onClick={() => setMode('element')}>{tr('选择元素')}</Button><Button disabled={pending} aria-pressed={mode === 'region'} onClick={() => { setMode('region'); setRect(current => current ?? { x: 0, y: 0, width: Math.min(100, capture.page.width), height: Math.min(100, capture.page.height) }); }}>{tr('选择区域')}</Button></div>
        {mode === 'element' ? <Menu label={tr('页面元素')} value={String(elementId)} disabled={pending} matchTriggerWidth
          options={[
            { value: '-1', label: tr('请选择元素') },
            ...capture.page.elements.map(item => ({ value: String(item.id), label: item.tag + ' · ' + (item.label || item.selector) })),
          ]}
          onChange={value => setElementId(Number(value))} /> : <div className="annotation-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{tr(({ x: '水平位置', y: '垂直位置', width: '区域宽度', height: '区域高度' } as const)[key])}<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'x' || key === 'width' ? capture.page.width : capture.page.height} value={rect?.[key] ?? 0} disabled={pending} onChange={event => setRect(current => ({ x: 0, y: 0, width: 1, height: 1, ...current, [key]: Number(event.target.value) }))} /></label>)}</div>}
      </>}
      {(capture || view) && dimensions && <>
        <div className="annotation-image" style={{ aspectRatio: dimensions.width + ' / ' + dimensions.height, width: 'min(100%, ' + 46 * dimensions.width / dimensions.height + 'vh)' }}
          onPointerDown={event => {
            if (!capture || pending) return; event.preventDefault(); const value = point(event);
            if (mode === 'element') { const hit = capture.page.elements.filter(item => value.x >= item.rect.x && value.y >= item.rect.y && value.x <= item.rect.x + item.rect.width && value.y <= item.rect.y + item.rect.height).sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0]; setElementId(hit?.id ?? -1); }
            else { start.current = value; event.currentTarget.setPointerCapture(event.pointerId); setRect({ ...value, width: 1, height: 1 }); }
          }} onPointerMove={event => {
            if (!capture || pending || !start.current || mode !== 'region') return; const value = point(event);
            setRect({ x: Math.min(start.current.x, value.x), y: Math.min(start.current.y, value.y), width: Math.max(1, Math.abs(value.x - start.current.x)), height: Math.max(1, Math.abs(value.y - start.current.y)) });
          }} onPointerUp={() => { start.current = undefined; }} onPointerCancel={() => { start.current = undefined; }}>
          <img src={capture?.image ?? view?.image} alt={tr('网页标注截图')} draggable={false} />
          {highlight && <span className="annotation-highlight" style={{ left: highlight.x / dimensions.width * 100 + '%', top: highlight.y / dimensions.height * 100 + '%', width: highlight.width / dimensions.width * 100 + '%', height: highlight.height / dimensions.height * 100 + '%' }} />}
        </div>
        <code>{capture?.page.url ?? view?.item.url}</code>
      </>}
      {capture && <>
        <label>{tr('标注说明')}<textarea aria-label={tr('标注说明')} value={comment} maxLength={10000} rows={3} disabled={pending} onChange={event => setComment(event.target.value)} /></label>
        <Button disabled={pending || !comment.trim() || !highlight} onClick={() => void task(async current => {
          const item = await api.current({ op: 'browser.annotationSave', threadId, captureId: capture.id, selection: { mode, ...(mode === 'element' ? { elementId } : { rect }), comment } }) as BrowserAnnotation;
          if (!current()) return;
          setCapture(undefined); setComment(''); setView({ item, image: capture.image }); setFeedback('saved'); setReadRetry('');
          try { const next = await api.current({ op: 'browser.annotation', action: 'read', threadId, annotationId: item.id }) as SavedView; if (current()) setView(next); }
          catch (reason) { if (current()) setReadRetry(item.id); throw reason; }
        })}>{tr('保存标注')}</Button>
      </>}
      {view && !capture && <section className="annotation-detail">
        <p role="status">{viewDeleting ? tr('此标注正在删除，请完成删除后重试') : view.stale === undefined ? tr('标注已保存，尚未核对当前页面。') : view.stale ? tr('页面已变化或未打开，此标注可能过期；截图仍为保存时的版本。') : tr('标注与当前页面一致')}</p>
        <p>{view.item.comment}</p><div className="row">
          <Button disabled={pending || viewDeleting} onClick={() => void show(view.item.id)}>{tr('重新检查标注')}</Button>
          <Button disabled={pending || viewDeleting} onClick={() => void task(async current => {
            const result = await api.current({ op: 'browser.annotation', action: 'attach', threadId, annotationId: view.item.id }) as { path: string; item: BrowserAnnotation; stale: boolean };
            if (!current()) return;
            const item = result.item; const position = { x: item.rect.x + item.viewport.scrollX, y: item.rect.y + item.viewport.scrollY, width: item.rect.width, height: item.rect.height };
            updateDraft(threadId, draft => {
              if (draft.attachments.includes(result.path)) return draft;
              const attachments = [...new Set([...draft.attachments, result.path])]; if (attachments.length > 10) throw new Error(tr('每次最多添加 10 个附件'));
              const text = [tr('网页标注'), item.url, item.element?.selector, JSON.stringify(position), result.stale ? tr('标注可能过期') : '', item.comment].filter(Boolean).join('\n');
              return { text: [draft.text, text].filter(Boolean).join('\n\n'), attachments };
            }); setFeedback('attached');
          })}>{tr('加入输入草稿')}</Button>
        </div>
      </section>}
      <h3>{tr('已保存的标注')}</h3>
      {!items.length && <p>{tr('暂无网页标注')}</p>}
      <ul className="annotation-list">{[...items].reverse().map(item => <li key={item.id}><button disabled={pending || item.deleting || !!capture && !!comment.trim()} onClick={() => void show(item.id)}><strong>{item.comment}</strong><small>{item.title || item.url} · {new Date(item.createdAt).toLocaleString(data.ui.locale)}</small>{item.deleting && <small>{tr('删除尚未完成，可重试。')}</small>}</button><Button disabled={pending} aria-label={tr(item.deleting ? '重试删除标注' : '删除标注') + ' ' + item.comment} onClick={() => { setError(''); setRemoveId(item.id); }}>{tr(item.deleting ? '重试删除' : '删除')}</Button></li>)}</ul>
      <div className="row"><Button disabled={pending} onClick={close}>{tr('关闭')}</Button></div>
    </div>} />
    {removeId && <ConfirmDialog title={tr('删除此网页标注？')} pending={pending} description={<>{tr('已加入聊天的截图附件会保留。')}{error && <span role="alert">{localizeAppError(error)}</span>}</>} confirmLabel={tr('删除')} danger onCancel={() => { if (!busy.current) { setRemoveId(''); setError(''); } }} onConfirm={() => void task(async current => {
      const id = removeId; await api.current({ op: 'browser.annotation', threadId, annotationId: id, action: 'remove' });
      if (!current()) return; if (view?.item.id === id) setView(undefined); if (readRetry === id) setReadRetry(''); setRemoveId(''); setFeedback('deleted');
    })} />}
    {discard && <ConfirmDialog title={tr('放弃未保存的标注？')} confirmLabel={tr('放弃')} onConfirm={() => { const action = discard; setDiscard(undefined); if (action === 'close') onClose(); else void newCapture(); }} onCancel={() => setDiscard(undefined)} />}
  </>;
}
