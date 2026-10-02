import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { z } from 'zod';
import { type ContextReference } from '../../../../shared/input-context.ts';
import { contextDetailSchema, draftSnapshotSchema, promptTemplateSchema, referenceKey, type DraftSnapshot, type PromptTemplate } from '../../../../shared/composer.ts';
import { tr, localizeAppError } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Button } from '../primitives/button.tsx';

export function ComposerPanel({ title, close, children }: { title: string; close(): void; children: ReactNode }) {
  return <ConfirmDialog title={title} presentation="panel" confirmLabel="" onConfirm={() => {}} onCancel={close} description={<section className="composer-panel"><header><h2>{title}</h2><IconButton label={tr('关闭')} size="sm" onClick={close}><X size={16} /></IconButton></header>{children}</section>} />;
}
export function DraftHistory({ close }: { close(): void }) {
  useLocale(); const { thread, invoke, patchThread } = useApp();
  const [history, setHistory] = useState<DraftSnapshot[]>(thread?.draftHistory ?? []), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const action = async (action: 'save' | 'restore' | 'clear', snapshot?: DraftSnapshot) => {
    if (!thread || busy) return; setBusy(true); setError('');
    try {
      const result = await invoke({ op: 'composer.history', threadId: thread.id, action, snapshotId: snapshot?.id });
      setHistory(z.array(draftSnapshotSchema).parse(result));
      if (snapshot) { patchThread({ draft: { text: snapshot.text, attachments: snapshot.attachments }, contextReferences: snapshot.context }, thread.id); close(); }
    } catch (reason) { setError(localizeAppError(String(reason instanceof Error ? reason.message : reason))); } finally { setBusy(false); }
  };
  return <ComposerPanel title={tr('草稿历史')} close={close}><p className="hint">{tr('最多保留 20 个版本；恢复时同时恢复附件和引用。')}</p>
    <div className="composer-panel-actions"><Button size="sm" disabled={busy} onClick={() => void action('save')}>{tr('保存草稿版本')}</Button><Button size="sm" disabled={busy || !history.length} onClick={() => void action('clear')}>{tr('清空历史')}</Button></div>
    {error && <p role="alert">{error}</p>}
    {history.map(item => <article key={item.id} className="composer-history-row"><time>{new Date(item.at).toLocaleString()}</time><pre>{item.text.slice(0, 400)}</pre><small>{item.attachments.length} {tr('附件预览')} · {item.context.length} {tr('引用上下文')}</small><Button size="sm" disabled={busy} onClick={() => void action('restore', item)}>{tr('恢复此版本')}</Button></article>)}
  </ComposerPanel>;
}
export function PromptTemplates({ close }: { close(): void }) {
  useLocale(); const { data, invoke, thread, updateDraft, text } = useApp();
  const [templates, setTemplates] = useState(data.settings.promptTemplates), [draft, setDraft] = useState<PromptTemplate>({ id: crypto.randomUUID(), name: '', text });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async (remove = false) => {
    if (busy) return; const parsed = promptTemplateSchema.safeParse(draft);
    if (!remove && !parsed.success) { setError(tr('请输入模板名称与内容')); return; }
    setBusy(true); setError('');
    try { setTemplates(z.array(promptTemplateSchema).parse(await invoke(remove ? { op: 'composer.template', action: 'remove', id: draft.id } : { op: 'composer.template', action: 'save', template: parsed.data! }))); if (remove) setDraft({ id: crypto.randomUUID(), name: '', text: '' }); }
    catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); } finally { setBusy(false); }
  };
  return <ComposerPanel title={tr('提示词模板')} close={close}>
    <div className="composer-template-list">{templates.map(item => <Button size="sm" key={item.id} aria-pressed={draft.id === item.id} onClick={() => setDraft(item)}>{item.name}</Button>)}<Button size="sm" onClick={() => setDraft({ id: crypto.randomUUID(), name: '', text: '' })}>{tr('新建模板')}</Button></div>
    <label>{tr('模板名称')}<input maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>{tr('模板内容')}<textarea rows={7} maxLength={100000} value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} /></label>
    {error && <p role="alert">{error}</p>}<div className="composer-panel-actions"><Button size="sm" disabled={busy} onClick={() => void save()}>{tr('保存模板')}</Button>
      <Button size="sm" disabled={busy || !draft.text.trim()} onClick={() => { if (thread) updateDraft(thread.id, current => ({ ...current, text: [current.text, draft.text].filter(Boolean).join('\n\n') })); close(); }}>{tr('插入草稿')}</Button>
      <Button size="sm" disabled={busy || !templates.some(item => item.id === draft.id)} onClick={() => void save(true)}>{tr('删除模板')}</Button></div>
  </ComposerPanel>;
}
export function ReferenceDetail({ reference, close }: { reference: ContextReference; close(): void }) {
  useLocale(); const { thread, invoke, updateContextReferences, selectDirectory, patchThread, openFileTab, setReviewOpen, focusTimeline } = useApp();
  const [result, setResult] = useState<z.infer<typeof contextDetailSchema>>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [start, setStart] = useState(reference.range?.start ?? 1), [end, setEnd] = useState(reference.range?.end ?? 1);
  const bound = useRef(referenceKey(reference));
  const load = async (next: ContextReference, refresh = false) => {
    if (!thread) return; setBusy(true); setError('');
    try { const detail = contextDetailSchema.parse(await invoke({ op: 'composer.contextDetail', threadId: thread.id, reference: next, refresh })); setResult(detail);
      if (refresh) { const previous = bound.current; updateContextReferences(thread.id, current => current.map(item => referenceKey(item) === previous ? detail.reference : item)); bound.current = referenceKey(detail.reference); }
    } catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); } finally { setBusy(false); }
  };
  useEffect(() => { void load(reference); }, [reference]);
  return <ComposerPanel title={tr('引用详情')} close={close}><p className="composer-source-path">{reference.directoryId && reference.directoryId + ' / '}{reference.id}</p>
    {error && <p role="alert">{error}</p>}{result?.stale && <p role="alert">{tr('引用版本已变化，请查看详情并刷新引用')}</p>}
    <div className="composer-panel-actions"><Button size="sm" disabled={busy} onClick={() => void load(result?.reference ?? reference, true)}>{tr('刷新引用')}</Button>
      {(reference.kind === 'file' || reference.kind === 'quote') && <Button size="sm" onClick={() => { close(); if (reference.kind === 'quote') focusTimeline({ kind: 'message', id: reference.id });
        else { const current = result?.reference ?? reference; if (current.directoryId) selectDirectory(current.directoryId); openFileTab(current.id, { line: current.range?.start ?? 1 }, current.directoryId); setReviewOpen(true); } }}>{tr('打开来源')}</Button>}</div>
    {reference.kind === 'file' && <div className="composer-line-range"><label>{tr('起始行')}<input type="number" min={1} value={start} onChange={event => setStart(Number(event.target.value))} /></label><label>{tr('结束行')}<input type="number" min={start} value={end} onChange={event => setEnd(Number(event.target.value))} /></label><Button size="sm" disabled={busy || start < 1 || end < start} onClick={() => void load({ ...reference, range: { start, end } }, true)}>{tr('应用行范围')}</Button></div>}
    <h3>{tr('实际加入上下文的内容')}</h3><pre className="composer-context-preview">{result?.content ?? (busy ? tr('加载中…') : '')}</pre>
  </ComposerPanel>;
}
