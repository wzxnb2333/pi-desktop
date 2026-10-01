import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Quote } from 'lucide-react';
import { threadSchema } from '../../../../shared/contracts.ts';
import { contextDetailSchema } from '../../../../shared/composer.ts';
import { mergeContextReferences, type ContextReference } from '../../../../shared/input-context.ts';
import { getLocale, tr, localizeAppError } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { selectedMessageSource } from '../../lib/markdown-selection.ts';
import { useApp } from '../../state/app.tsx';
import { Menu } from '../primitives/menu.tsx';
import '../../styles/selection-quote.css';

type SelectedQuote = { reference: ContextReference; text: string; left: number; top: number; requestId: string };

/** One toolbar per timeline; quoting starts from selected rendered text. */
export function SelectionQuote() {
  useLocale();
  const { thread, timelineRef, invoke, updateContextReferences, updateDraft, composerRef } = useApp();
  const [selection, setSelection] = useState<SelectedQuote>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const toolbar = useRef<HTMLDivElement>(null), menuOpen = useRef(false), submitting = useRef(false);
  const current = useRef(thread); current.current = thread;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setSelection(undefined); setError('');
    let frame = 0;
    const capture = () => {
      if (menuOpen.current || submitting.current) return;
      const selected = window.getSelection();
      if (!selected?.rangeCount || selected.isCollapsed || !selected.toString().trim()) { setSelection(undefined); return; }
      const range = selected.getRangeAt(0);
      const body = [...(timelineRef.current?.querySelectorAll<HTMLElement>('[data-quote-body]') ?? [])].find(node => node.contains(range.startContainer) && node.contains(range.endContainer));
      const item = current.current?.items.find(item => item.id === body?.closest('[data-message-id]')?.getAttribute('data-message-id'));
      if (!body || !item || item.state === 'running') { setSelection(undefined); return; }
      const quote = selectedMessageSource(body, range, item.role === 'user' ? item.input?.text ?? item.text : item.text);
      if (!quote) { setSelection(undefined); return; }
      const rect = range.getBoundingClientRect(), viewport = timelineRef.current!.getBoundingClientRect();
      if (rect.bottom < viewport.top || rect.top > viewport.bottom) { setSelection(undefined); return; }
      setError('');
      setSelection({ reference: { kind: 'quote', id: item.id, label: tr('引用消息') + ' · ' + new Date(item.timestamp).toLocaleTimeString(getLocale()), quote }, text: selected.toString(),
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 108)), top: Math.max(viewport.top + 4, Math.min(rect.top - 38, window.innerHeight - 42)), requestId: crypto.randomUUID() });
    };
    const inside = (target: EventTarget | null) => target instanceof Element && (!!toolbar.current?.contains(target) || !!target.closest('.selection-quote-menu'));
    const schedule = (event: Event) => {
      if (inside(event.target)) return;
      if (event.type === 'pointerup' && (!(event.target instanceof Node) || !timelineRef.current?.contains(event.target))) return;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(capture);
    };
    const dismiss = (event: Event) => { if (!inside(event.target) && !submitting.current) { menuOpen.current = false; setSelection(undefined); } };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { menuOpen.current = false; setSelection(undefined); }
      else if (event.shiftKey && !event.isComposing) schedule(event);
    };
    const clearCollapsed = () => { if (!menuOpen.current && !submitting.current && window.getSelection()?.isCollapsed && !toolbar.current?.contains(document.activeElement)) setSelection(undefined); };
    document.addEventListener('pointerup', schedule); document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keyup', key); document.addEventListener('selectionchange', clearCollapsed);
    window.addEventListener('scroll', dismiss, true); window.addEventListener('resize', dismiss);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointerup', schedule); document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keyup', key); document.removeEventListener('selectionchange', clearCollapsed);
      window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss);
    };
  }, [thread?.id, timelineRef]);

  const quote = async (destination: string) => {
    if (!selection || !thread || submitting.current) return;
    const threadId = thread.id, selected = selection;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (destination === 'copy') await navigator.clipboard.writeText(selected.text);
      else {
        const detail = contextDetailSchema.parse(await invoke({ op: 'composer.contextDetail', threadId, reference: selected.reference }));
        if (destination === 'main') {
          updateContextReferences(threadId, references => mergeContextReferences(references, [detail.reference]));
          if (mounted.current && current.current?.id === threadId) composerRef.current?.focus();
        } else {
          const chat = threadSchema.parse(await invoke({ op: 'sidechat.create', threadId, anchorItemId: selected.reference.id, requestId: selected.requestId }));
          const quoted = selected.text.split('\n').map(line => '> ' + line).join('\n');
          updateDraft(chat.id, draft => ({ ...draft, text: [draft.text, quoted].filter(Boolean).join('\n\n') + '\n\n' }));
          requestAnimationFrame(() => { if (mounted.current && current.current?.id === threadId) document.querySelector<HTMLTextAreaElement>('.sidechat-composer textarea')?.focus(); });
        }
      }
      if (mounted.current && current.current?.id === threadId) { setSelection(undefined); window.getSelection()?.removeAllRanges(); }
    } catch (reason) { if (mounted.current && current.current?.id === threadId) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  if (!selection || !thread) return null;
  return createPortal(<div ref={toolbar} className="selection-quote" style={{ left: selection.left, top: selection.top, maxWidth: Math.min(300, window.innerWidth - selection.left - 8) }} onMouseDown={event => event.preventDefault()}>
    <Menu label={tr('引用所选文本')} value="" kind="action" size="sm" side="bottom" disabled={busy} listClassName="selection-quote-menu"
      display={<><Quote size={14} />{tr('引用')}</>} onOpenChange={value => { menuOpen.current = value; }}
      options={[
        { value: 'main', label: tr('追加到主任务草稿') },
        { value: 'sidechat', label: tr('从此处侧聊'), disabled: !!thread.deletedAt || !!thread.archived || !!thread.sidechat?.temporary },
        { value: 'copy', label: tr('复制') },
      ]} onChange={value => void quote(value)} />
    {error && <p role="alert">{error}</p>}
  </div>, document.body);
}
