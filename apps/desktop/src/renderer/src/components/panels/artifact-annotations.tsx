import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { ArtifactAnnotation, ArtifactAnnotationView, ArtifactCapture } from '../../../../shared/artifacts.ts';
import type { AnnotationRect } from '../../../../shared/browser-annotations.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

type Props = { threadId: string; directoryId: string; path: string; capture?: ArtifactCapture; onClose(): void };
type SavedView = Omit<ArtifactAnnotationView, 'stale'> & { stale?: boolean };
export function ArtifactAnnotations(props: Props) {
  return <Annotations key={JSON.stringify([props.threadId, props.directoryId, props.path, props.capture?.id])} {...props} />;
}
function Annotations({ threadId, directoryId, path, capture, onClose }: Props) {
  const { data, invoke, updateDraft } = useApp(), api = useRef(invoke); api.current = invoke;
  const [active, setActive] = useState(capture), [view, setView] = useState<SavedView>(), [comment, setComment] = useState('');
  const [rect, setRect] = useState<AnnotationRect>({ x: 0, y: 0, width: Math.min(100, capture?.width ?? 100), height: Math.min(100, capture?.height ?? 100) });
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [feedback, setFeedback] = useState<'saved' | 'attached' | 'deleted'>(), [discard, setDiscard] = useState(false), [remove, setRemove] = useState('');
  const [readRetry, setReadRetry] = useState('');
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const mounted = useRef(false), busy = useRef(false), generation = useRef(Symbol());
  useEffect(() => { mounted.current = true; busy.current = false; generation.current = Symbol(); return () => { mounted.current = false; queueMicrotask(() => { if (!mounted.current && capture) void api.current({ op: 'artifact.annotationDiscard', threadId, captureId: capture.id }).catch(() => {}); }); }; }, [capture?.id, threadId]);
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (busy.current) return;
    busy.current = true; const token = generation.current, current = () => mounted.current && generation.current === token;
    setPending(true); setError(''); setFeedback(undefined); start.current = undefined;
    try { await action(current); }
    catch (reason) { if (current()) setError((reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { if (current()) { busy.current = false; setPending(false); } }
  };
  const show = async (id: string, current: () => boolean) => {
    try { const next = await api.current({ op: 'artifact.annotation', threadId, annotationId: id, action: 'read' }) as ArtifactAnnotationView; if (current()) { setView(next); setActive(undefined); setReadRetry(''); } }
    catch (reason) { if (current()) setReadRetry(id); throw reason; }
  };
  const close = () => { if (busy.current) return; if (active && comment.trim()) setDiscard(true); else onClose(); };
  const size = active ?? view?.item, image = active?.image ?? view?.image, selected = active ? rect : view?.item.rect;
  const items = (data.threads.find(item => item.id === threadId)?.artifactAnnotations ?? []).filter(item => item.directoryId === directoryId && item.path.replaceAll('\\', '/') === path.replaceAll('\\', '/'));
  const viewDeleting = items.some(item => item.id === view?.item.id && item.deleting);
  const point = (event: PointerEvent<HTMLDivElement>) => { const box = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(active!.width - 1, (event.clientX - box.x) / box.width * active!.width)), y: Math.max(0, Math.min(active!.height - 1, (event.clientY - box.y) / box.height * active!.height)) }; };
  return <>
    <ConfirmDialog presentation="panel" pending={pending} title={tr('产物标注')} confirmLabel={tr('关闭')} onCancel={close} onConfirm={close} description={<div className="artifact-annotations" aria-busy={pending}>
      {error && !remove && <p role="alert">{localizeAppError(error)}</p>}{pending ? <p role="status">{tr('正在处理…')}</p> : feedback && <p role="status">{tr(({ saved: '标注已保存', attached: '已加入输入草稿', deleted: '标注已删除' } as const)[feedback])}</p>}
      {readRetry && <Button disabled={pending} onClick={() => void run(current => show(readRetry, current))}>{tr('重试读取标注')}</Button>}
      {active && <><p>{tr('拖动截图选择区域，或输入区域坐标。标注关联保存时的文件版本。')}</p><div className="annotation-coordinates">{(['x', 'y', 'width', 'height'] as const).map(key => <label key={key}>{tr(({ x: '水平位置', y: '垂直位置', width: '区域宽度', height: '区域高度' } as const)[key])}<input type="number" disabled={pending} min={key === 'width' || key === 'height' ? 1 : 0} max={key === 'width' || key === 'x' ? active.width : active.height} value={rect[key]} onChange={event => setRect(current => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div></>}
      {size && image && <div className="annotation-image" style={{ aspectRatio: size.width + '/' + size.height, width: 'min(100%, ' + 42 * size.width / size.height + 'vh)' }} onPointerDown={event => { if (!active || pending) return; event.preventDefault(); start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); setRect({ ...start.current, width: 1, height: 1 }); }} onPointerMove={event => { if (!active || pending || !start.current) return; const value = point(event); setRect({ x: Math.min(start.current.x, value.x), y: Math.min(start.current.y, value.y), width: Math.max(1, Math.abs(value.x - start.current.x)), height: Math.max(1, Math.abs(value.y - start.current.y)) }); }} onPointerUp={() => { start.current = undefined; }} onPointerCancel={() => { start.current = undefined; }}>
        <img src={image} alt={tr('产物标注截图')} draggable={false} />{selected && <span className="annotation-highlight" style={{ left: selected.x / size.width * 100 + '%', top: selected.y / size.height * 100 + '%', width: selected.width / size.width * 100 + '%', height: selected.height / size.height * 100 + '%' }} />}
      </div>}
      {active && <><label>{tr('标注说明')}<textarea disabled={pending} aria-label={tr('标注说明')} maxLength={10000} rows={3} value={comment} onChange={event => setComment(event.target.value)} /></label><Button disabled={pending || !comment.trim() || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || rect.x + rect.width > active.width || rect.y + rect.height > active.height} onClick={() => void run(async current => {
        const item = await api.current({ op: 'artifact.annotationSave', threadId, captureId: active.id, rect, comment }) as ArtifactAnnotation;
        if (!current()) return; setView({ item, image: active.image }); setActive(undefined); setComment(''); setFeedback('saved'); await show(item.id, current);
      })}>{tr('保存标注')}</Button></>}
      {view && <><p>{view.item.comment}</p><p role="status">{viewDeleting ? tr('此标注正在删除，请完成删除后重试') : view.stale === undefined ? tr('标注已保存，尚未核对当前文件。') : view.stale ? tr('文件或依赖资源已变化，此标注已过期；保留原始截图，不定位到新版本。') : tr('标注与当前文件版本一致')}</p><div className="row"><Button disabled={pending || viewDeleting} onClick={() => void run(current => show(view.item.id, current))}>{tr('重新检查标注')}</Button><Button disabled={pending || viewDeleting} onClick={() => void run(async current => {
        const result = await api.current({ op: 'artifact.annotation', threadId, annotationId: view.item.id, action: 'attach' }) as { path: string; item: ArtifactAnnotation; stale: boolean };
        if (!current()) return;
        updateDraft(threadId, draft => { if (draft.attachments.includes(result.path)) return draft; const attachments = [...new Set([...draft.attachments, result.path])]; if (attachments.length > 10) throw new Error(tr('每次最多添加 10 个附件')); const item = result.item; return { text: [draft.text, [tr('产物标注'), item.root + '/' + item.path, tr('第 {p0} 页', { p0: item.page }), item.version, JSON.stringify({ screenshot: { width: item.width, height: item.height }, rect: item.rect, scrollX: item.scrollX, scrollY: item.scrollY }), result.stale ? tr('标注可能过期') : '', item.comment].filter(Boolean).join('\n')].filter(Boolean).join('\n\n'), attachments }; }); setFeedback('attached');
      })}>{tr('加入输入草稿')}</Button></div></>}
      <h3>{tr('已保存的标注')}</h3>{!items.length && <p>{tr('暂无产物标注')}</p>}
      <ul className="annotation-list">{[...items].reverse().map(item => <li key={item.id}><button disabled={pending || item.deleting || !!active && !!comment.trim()} onClick={() => void run(current => show(item.id, current))}><strong>{item.comment}</strong><small>{tr('第 {p0} 页', { p0: item.page })} · {new Date(item.createdAt).toLocaleString(data.ui.locale)}</small>{item.deleting && <small>{tr('删除尚未完成，可重试。')}</small>}</button><Button disabled={pending} aria-label={tr(item.deleting ? '重试删除标注' : '删除标注') + ' ' + item.comment} onClick={() => { setError(''); setRemove(item.id); }}>{tr(item.deleting ? '重试删除' : '删除')}</Button></li>)}</ul>
      <div className="row"><Button disabled={pending} onClick={close}>{tr('关闭')}</Button></div>
    </div>} />
    {discard && <ConfirmDialog title={tr('放弃未保存的标注？')} confirmLabel={tr('放弃')} onCancel={() => setDiscard(false)} onConfirm={onClose} />}
    {remove && <ConfirmDialog title={tr('删除此产物标注？')} pending={pending} description={<>{tr('已加入聊天的截图附件会保留。')}{error && <span role="alert">{localizeAppError(error)}</span>}</>} confirmLabel={tr('删除')} danger onCancel={() => { if (!busy.current) { setRemove(''); setError(''); } }} onConfirm={() => void run(async current => {
      const id = remove; await api.current({ op: 'artifact.annotation', threadId, annotationId: id, action: 'remove' }); if (!current()) return;
      if (view?.item.id === id) setView(undefined); if (readRetry === id) setReadRetry(''); setRemove(''); setFeedback('deleted');
    })} />}
  </>;
}
