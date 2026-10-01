import { useEffect, useRef, useState } from 'react';
import type { ArtifactCapture, ArtifactDocument, ArtifactStatus } from '../../../../shared/artifacts.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { ArtifactAnnotations } from './artifact-annotations.tsx';
import { PdfPreview } from './pdf-preview.tsx';

export function ArtifactPreviewPanel({ path }: { path: string }) {
  const { activeId, directoryId } = useApp();
  return <Preview key={JSON.stringify([activeId, directoryId, path])} path={path} />;
}
function Preview({ path }: { path: string }) {
  const { activeId, directoryId, invoke, approvals } = useApp(); const api = useRef(invoke); api.current = invoke;
  const [document, setDocument] = useState<ArtifactDocument>(), [state, setState] = useState<ArtifactStatus>({ loading: true, allowed: [], blocked: [] });
  const [error, setError] = useState(''), [reload, setReload] = useState(0), [annotation, setAnnotation] = useState<{ capture?: ArtifactCapture }>();
  const [busy, setBusy] = useState(false), [cancelled, setCancelled] = useState(false), [pollError, setPollError] = useState('');
  const operation = useRef<symbol | undefined>(undefined);
  const openCancelled = useRef(false);
  const surface = useRef<HTMLDivElement>(null), request = useRef(''), alive = useRef(true);
  useEffect(() => {
    alive.current = true; openCancelled.current = false; operation.current = undefined; setBusy(false); let active = true; const id = crypto.randomUUID(); request.current = id; setDocument(undefined); setAnnotation(undefined); setError(''); setPollError(''); setCancelled(false); setState({ loading: true, allowed: [], blocked: [] });
    void api.current({ op: 'artifact.open', threadId: activeId, directoryId, path, requestId: id }).then(value => { if (active && request.current === id && !openCancelled.current) setDocument(value as ArtifactDocument); }, reason => { if (active && request.current === id && !openCancelled.current) { setError(reason instanceof Error ? reason.message : String(reason)); setState(previous => ({ ...previous, loading: false })); } });
    return () => { active = false; alive.current = false; void api.current({ op: 'artifact.close', threadId: activeId, previewId: id }).catch(() => {}); };
  }, [activeId, directoryId, path, reload]);
  useEffect(() => {
    if (!document || document.kind !== 'html') return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { try { const value = await api.current({ op: 'artifact.status', threadId: activeId, previewId: document.id }); if (active) { setState(value as ArtifactStatus); setPollError(''); } } catch (reason) { if (active) setPollError(reason instanceof Error ? reason.message : String(reason)); } finally { if (active) timer = setTimeout(() => void poll(), 750); } };
    void poll(); return () => { active = false; clearTimeout(timer); };
  }, [document?.id, activeId]);
  useEffect(() => {
    if (!document || document.kind !== 'html' || !surface.current) return;
    const node = surface.current; let previous = '', active = true;
    const sync = () => {
      const box = node.getBoundingClientRect(), blocked = !!window.document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') || approvals.length > 0;
      const bounds = { x: Math.max(0, Math.round(box.x)), y: Math.max(0, Math.round(box.y)), width: blocked ? 0 : Math.max(0, Math.round(box.width)), height: blocked ? 0 : Math.max(0, Math.round(box.height)) }, key = JSON.stringify(bounds);
      if (key !== previous) { previous = key; void api.current({ op: 'artifact.bounds', threadId: activeId, previewId: document.id, bounds }).catch(reason => { if (active && request.current === document.id) { previous = ''; setError(reason instanceof Error ? reason.message : String(reason)); } }); }
    };
    const resize = new ResizeObserver(sync), mutation = new MutationObserver(sync); resize.observe(node); mutation.observe(window.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'hidden'] });
    window.addEventListener('resize', sync); sync();
    return () => { active = false; resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', sync); };
  }, [document?.id, activeId, approvals.length]);
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (operation.current) return;
    const token = Symbol(); operation.current = token; setBusy(true); setError('');
    const current = () => alive.current && operation.current === token;
    try { await action(current); } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (current()) { operation.current = undefined; setBusy(false); } }
  };
  const capture = (pdf?: { page: number; image: string }) => { if (!document || cancelled || annotation) return; void run(async current => {
    const value = await api.current({ op: 'artifact.capture', threadId: activeId, previewId: document.id, ...(pdf ? { pdf } : {}) }) as ArtifactCapture;
    if (current() && request.current === document.id) setAnnotation({ capture: value }); else await api.current({ op: 'artifact.annotationDiscard', threadId: activeId, captureId: value.id });
  }); };
  const cancel = () => void run(async current => {
    const id = request.current; openCancelled.current = true;
    await api.current(document ? { op: 'artifact.stop', threadId: activeId, previewId: document.id } : { op: 'artifact.close', threadId: activeId, previewId: id });
    if (current()) { setCancelled(true); setState(previous => ({ ...previous, loading: false })); }
  });
  const network = (origin: string, allowed: boolean) => { if (!document) return; void run(async current => {
    await api.current({ op: 'artifact.network', threadId: activeId, previewId: document.id, origin, allowed });
    const state = await api.current({ op: 'artifact.status', threadId: activeId, previewId: document.id }); if (current()) setState(state as ArtifactStatus);
  }); };
  return <section className="artifact-preview" aria-label={tr('产物预览')}>
    <div className="artifact-toolbar"><Button disabled={busy} onClick={() => setReload(value => value + 1)}>{tr('重新加载预览')}</Button><Button disabled={busy} onClick={() => setAnnotation({})}>{tr('产物标注')}</Button>
      {document?.kind === 'html' && <Button disabled={state.loading || busy || cancelled} onClick={() => capture()}>{tr('标注预览区域')}</Button>}
      {!cancelled && state.loading && document?.kind !== 'pdf' && <Button disabled={busy} onClick={cancel}>{tr('取消加载')}</Button>}
      <span role="status">{busy ? tr('正在处理…') : cancelled ? tr('预览已取消') : document?.kind === 'html' && state.loading || !document && state.loading ? tr('正在加载…') : ''}</span>
    </div>
    {(error || pollError) && <p role="alert">{localizeAppError((error || pollError).replace(/^Error invoking remote method '[^']+': Error: /, ''))}</p>}{state.error && <p role="alert">{localizeAppError(state.error)}</p>}
    {document?.kind === 'html' && <>
      <details className="artifact-network"><summary>{tr('外部网络默认阻止')} · {state.blocked.length}</summary><p>{tr('授权仅用于当前产物；关闭预览后清除。')}</p>{state.blocked.map(origin => <div className="row" key={origin}><code>{origin}</code><Button disabled={busy} onClick={() => network(origin, true)}>{tr('允许此来源')}</Button></div>)}{state.allowed.map(origin => <div className="row" key={origin}><code>{origin}</code><Button disabled={busy} onClick={() => network(origin, false)}>{tr('撤销授权')}</Button></div>)}</details>
      <div ref={surface} className="artifact-html-surface" aria-label={tr('隔离 HTML 预览')} />
    </>}
    {document?.kind === 'pdf' && <PdfPreview key={document.id} document={document} identity={activeId + '/' + directoryId + '/' + path} capturing={busy} onCapture={capture} />}
    {annotation && <ArtifactAnnotations threadId={activeId} directoryId={directoryId} path={path} capture={annotation.capture} onClose={() => setAnnotation(undefined)} />}
  </section>;
}
