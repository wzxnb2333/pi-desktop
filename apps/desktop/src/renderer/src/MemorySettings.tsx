import { useEffect, useRef, useState } from 'react';
import type { DesktopData, DesktopRequest, Settings } from '../../shared/contracts.ts';
import { memoryEntrySchema, memorySnapshotSchema, memoryScopeKey, type MemoryEntry, type MemoryScope, type MemorySnapshot } from '../../shared/memories.ts';
import { localizeAppError, localizeLabel, tr } from '../../shared/localization.ts';
import { useLocale } from './hooks/use-locale.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { ConfirmDialog } from './components/primitives/dialog.tsx';
import { SettingsSection } from './SettingsSection.tsx';

interface Draft { entry?: MemoryEntry; text: string; enabled: boolean; scope: MemoryScope; }
type Removal = { kind: 'all'; revision: number } | { kind: 'entry'; entry: MemoryEntry };
export function MemorySettings({ data, preferences, onChange, invoke, active, onDirty, onBusy }: {
  data: DesktopData; preferences: Settings['memory']; onChange(value: Settings['memory']): void;
  invoke(request: DesktopRequest): Promise<unknown>; active: boolean; onDirty(value: boolean): void; onBusy?(value: boolean): void;
}) {
  useLocale();
  const [snapshot, setSnapshot] = useState<MemorySnapshot>({ revision: 0, entries: [] });
  const [scope, setScope] = useState<MemoryScope>({ kind: 'user' });
  const [draft, setDraft] = useState<Draft>();
  const [query, setQuery] = useState(''), [sourceId, setSourceId] = useState(data.ui.activeThreadId);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>(), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(false), [readError, setReadError] = useState('');
  const [confirm, setConfirm] = useState<Removal>();
  const [reloadDraft, setReloadDraft] = useState(false);
  const request = useRef(invoke); request.current = invoke;
  const pending = useRef(false), readPending = useRef(false), generation = useRef(0), alive = useRef(true);
  const visiblePage = useRef(active); visiblePage.current = active;
  const addButton = useRef<HTMLButtonElement>(null), refreshButton = useRef<HTMLButtonElement>(null), retryButton = useRef<HTMLButtonElement>(null);
  const focusAfterRead = useRef(false), focusAfterWrite = useRef(false);
  const writeTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; readPending.current = false; }; }, []);
  const editing = !!draft && (draft.text !== (draft.entry?.text ?? '') || draft.enabled !== (draft.entry?.enabled ?? true));
  useEffect(() => { onDirty(editing); return () => onDirty(false); }, [editing, onDirty]);
  useEffect(() => () => onBusy?.(false), [onBusy]);
  useEffect(() => {
    if (!readError && focusAfterRead.current) { focusAfterRead.current = false; if (visiblePage.current && document.activeElement === document.body) refreshButton.current?.focus(); }
  }, [readError]);
  useEffect(() => {
    if (!busy && (focusAfterWrite.current || writeTrigger.current)) {
      if (visiblePage.current && document.activeElement === document.body) {
        if (writeTrigger.current?.isConnected) writeTrigger.current.focus();
        else if (focusAfterWrite.current) addButton.current?.focus();
      }
      focusAfterWrite.current = false; writeTrigger.current = null;
    }
  }, [busy, draft]);
  const refresh = async (force = false) => {
    if (!visiblePage.current || pending.current || (readPending.current && !force)) return;
    readPending.current = true; setLoading(true);
    const id = ++generation.current;
    const current = () => alive.current && visiblePage.current && id === generation.current;
    try {
      const result = memorySnapshotSchema.safeParse(await request.current({ op: 'memory.list' }));
      if (!result.success) throw new Error('记忆列表返回的数据格式无效，请重试读取。');
      const next = result.data;
      if (current()) {
        setSnapshot(previous => next.revision >= previous.revision ? next : previous); setLoaded(true);
        focusAfterRead.current = document.activeElement === retryButton.current; setReadError('');
      }
    } catch (error) { if (current()) setReadError(error instanceof Error ? error.message : String(error)); }
    finally { if (current()) { readPending.current = false; setLoading(false); } }
  };
  useEffect(() => {
    if (active) void refresh(true);
    else { generation.current++; readPending.current = false; setLoading(false); }
  }, [active, data.memoryRevision]);
  const perform = async (action: Extract<DesktopRequest, { op: 'memory.save' | 'memory.delete' | 'memory.clear' | 'memory.generate' | 'operation.cancel' }>) => {
    if (pending.current) return;
    pending.current = true; generation.current++; readPending.current = false; setLoading(false); setBusy(true); onBusy?.(true); setFeedback(undefined);
    writeTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusAfterWrite.current = action.op === 'memory.save';
    let acknowledged = false;
    try {
      const value = await request.current(action); acknowledged = true;
      if (!alive.current) return;
      if (action.op === 'memory.save') {
        // A committed write must not become a retryable create when a subsequent list fails.
        setDraft(undefined); setFeedback({ text: '记忆已保存' });
        const entry = memoryEntrySchema.safeParse(value);
        if (entry.success) setSnapshot(previous => ({ ...previous, entries: [...previous.entries.filter(item => item.id !== entry.data.id), entry.data] }));
      } else if (action.op === 'memory.delete' || action.op === 'memory.clear') {
        setSnapshot(previous => ({ ...previous, entries: action.op === 'memory.clear' ? [] : previous.entries.filter(item => item.id !== action.id) }));
        setConfirm(undefined);
      }
    } catch (error) { if (alive.current) setFeedback({ text: error instanceof Error ? error.message : String(error), error: true }); }
    finally {
      pending.current = false;
      if (alive.current) { setBusy(false); onBusy?.(false); if (acknowledged) void refresh(true); }
    }
  };
  const edit = (entry?: MemoryEntry) => {
    if (editing) { setFeedback({ text: '当前编辑尚未保存，请先保存或取消编辑', error: true }); return; }
    setDraft({ entry, text: entry?.text ?? '', enabled: entry?.status === 'candidate' ? true : entry?.enabled ?? true, scope: entry?.scope ?? scope }); setFeedback(undefined);
  };
  const latest = draft?.entry && snapshot.entries.find(entry => entry.id === draft.entry?.id);
  const conflict = loaded && !busy && !!draft?.entry && (!latest || latest.revision !== draft.entry.revision);
  const visible = snapshot.entries.filter(entry => memoryScopeKey(entry.scope) === memoryScopeKey(scope) && entry.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const sources = data.threads.filter(thread => !thread.deletedAt && !thread.review && !thread.sidechat?.temporary && (scope.kind === 'user' || thread.projectId === scope.projectId));
  const operations = data.operations.filter(item => item.kind === 'memory.generate' && item.threadId === sourceId && item.directoryId === memoryScopeKey(scope));
  const operation = operations.findLast(item => item.status === 'running') ?? operations.at(-1);
  return <div className="memory-settings" hidden={!active}>
    <SettingsSection title={tr('记忆偏好')} description={tr('记忆只在本机当前用户保存。生成使用所选聊天的模型；排除附件、工具输出和疑似凭据。')}>
      <FieldRow label={tr('使用已确认的记忆')} htmlFor="memory-enabled"><input id="memory-enabled" type="checkbox" checked={preferences.enabled} onChange={event => onChange({ ...preferences, enabled: event.target.checked })} /></FieldRow>
      <FieldRow label={tr('自动生成记忆候选')} htmlFor="memory-auto" description={tr('默认关闭。仅在普通聊天成功结束后处理用户文字；候选必须确认后才会使用。')}><input id="memory-auto" aria-label={tr('自动生成记忆候选')} type="checkbox" checked={preferences.autoGenerate} onChange={event => onChange({ ...preferences, autoGenerate: event.target.checked })} /></FieldRow>
    </SettingsSection>
    <div className="section-heading"><h2>{tr('记忆库')}</h2></div>
    <FieldRow label={tr('记忆范围')} htmlFor="memory-scope"><select id="memory-scope" value={memoryScopeKey(scope)} disabled={!!draft} onChange={event => { const key = event.target.value; setScope(key === 'user' ? { kind: 'user' } : { kind: 'project', projectId: key.slice(8) }); }}>
      <option value="user">{tr('当前用户 · 所有项目')}</option>{data.projects.map(project => <option key={project.id} value={'project:' + project.id}>{project.name}</option>)}
    </select></FieldRow>
    <div className="memory-toolbar"><input aria-label={tr('搜索记忆')} placeholder={tr('搜索记忆')} value={query} onChange={event => setQuery(event.target.value)} /><Button ref={addButton} disabled={busy || !!draft} onClick={() => edit()}>{tr('新增记忆')}</Button><Button ref={refreshButton} disabled={busy} aria-disabled={loading || undefined} onClick={() => void refresh()}>{tr('刷新')}</Button></div>
    {loading && <p role="status">{tr('正在读取记忆…')}</p>}
    {readError && <div><p role="alert" className="form-feedback" data-error>{localizeAppError(readError)}</p><Button ref={retryButton} disabled={busy} aria-disabled={loading || undefined} onClick={() => void refresh()}>{tr('重试读取记忆')}</Button></div>}
    {snapshot.error && <p role="alert">{localizeAppError(snapshot.error)}</p>}
    {draft && <div className="config-card memory-editor">
      <label htmlFor="memory-text">{tr('记忆内容')}</label><textarea id="memory-text" aria-label={tr('记忆内容')} rows={5} value={draft.text} maxLength={6000} disabled={busy} onChange={event => setDraft({ ...draft, text: event.target.value })} />
      <FieldRow label={tr('启用这条记忆')} htmlFor="memory-entry-enabled"><input id="memory-entry-enabled" type="checkbox" checked={draft.enabled} disabled={busy} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /></FieldRow>
      {conflict && <div><p role="alert">{tr('这条记忆已在其他窗口修改或删除；当前草稿已保留。')}</p>{latest && <Button onClick={() => setReloadDraft(true)}>{tr('加载最新记忆')}</Button>}</div>}
      <div className="row"><Button disabled={busy || conflict || !draft.text.trim()} onClick={() => void perform({ op: 'memory.save', id: draft.entry?.id, revision: draft.entry?.revision, scope: draft.scope, text: draft.text, enabled: draft.enabled })}>{tr('保存并确认记忆')}</Button><Button disabled={busy} onClick={() => { focusAfterWrite.current = true; setDraft(undefined); }}>{tr('取消记忆编辑')}</Button></div>
    </div>}
    <div className="memory-entries">{visible.map(entry => <article className="config-card memory-entry" key={entry.id}>
      <div className="row"><strong>{entry.status === 'candidate' ? tr('待确认候选') : tr('已确认记忆')}</strong><span>{entry.enabled ? tr('已启用') : tr('已暂停')}</span></div><p>{entry.text}</p>
      <details><summary>{tr('查看记忆来源')}</summary><p>{entry.source.kind === 'manual' ? tr('手动创建') : data.threads.find(thread => thread.id === entry.source.threadId && !thread.deletedAt)?.title ?? tr('源聊天已删除')}</p><time>{new Date(entry.source.createdAt).toLocaleString()}</time>{entry.source.providerId && <p>{entry.source.providerId}</p>}{entry.source.messageIds.map(id => <code key={id}>{id}</code>)}</details>
      <div className="row"><Button disabled={busy || !!draft} onClick={() => edit(entry)}>{tr('编辑或确认')}</Button><Button disabled={busy} variant="danger" onClick={() => { setFeedback(undefined); setConfirm({ kind: 'entry', entry }); }}>{tr('删除这条记忆')}</Button></div>
    </article>)}</div>
    {loaded && !loading && !readError && !visible.length && <p className="hint">{tr('没有匹配的记忆')}</p>}
    <div className="config-card memory-generation"><FieldRow label={tr('生成来源聊天')} htmlFor="memory-source"><select id="memory-source" value={sources.some(thread => thread.id === sourceId) ? sourceId : ''} disabled={operation?.status === 'running'} onChange={event => setSourceId(event.target.value)}><option value="">{tr('请选择聊天')}</option>{sources.map(thread => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></FieldRow>
      <Button disabled={busy || operation?.status === 'running' || !sources.some(thread => thread.id === sourceId)} onClick={() => void perform({ op: 'memory.generate', scope, threadId: sourceId, requestId: crypto.randomUUID() })}>{tr('从聊天生成候选')}</Button>
      {operation?.status === 'running' && <><p role="status">{localizeLabel(operation.stage)}</p><Button aria-disabled={busy || undefined} onClick={() => void perform({ op: 'operation.cancel', threadId: sourceId, requestId: operation.id })}>{tr('取消记忆生成')}</Button></>}
      {operation?.error && <p role="alert">{localizeAppError(operation.error)}</p>}
      {operation?.status === 'succeeded' && <p role="status">{tr('生成结果：{p0} 条候选', { p0: operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result) ? String(operation.result.count ?? 0) : 0 })}</p>}
    </div>
    {feedback && !confirm && <p role={feedback.error ? 'alert' : 'status'} className="form-feedback" data-error={feedback.error || undefined}>{localizeAppError(feedback.text)}</p>}<Button disabled={busy || !loaded} variant="danger" onClick={() => { setFeedback(undefined); setConfirm({ kind: 'all', revision: snapshot.revision }); }}>{tr('清除全部记忆')}</Button>
    {reloadDraft && <ConfirmDialog title={tr('加载最新记忆？')} description={tr('当前未保存的草稿会被最新版本替换。')} confirmLabel={tr('加载最新记忆')} initialFocus="cancel" onCancel={() => setReloadDraft(false)} onConfirm={() => {
      if (latest) { setDraft({ entry: latest, text: latest.text, enabled: latest.status === 'candidate' || latest.enabled, scope: latest.scope }); setFeedback(undefined); }
      setReloadDraft(false);
    }} />}
    {confirm && <ConfirmDialog title={confirm.kind === 'all' ? tr('清除所有用户与项目记忆？') : tr('删除这条记忆？')}
      description={<>{confirm.kind === 'all' ? tr('所有已确认记忆和候选都将删除；原始聊天保留。正在生成的候选会取消。') : tr('删除后不再向后续模型轮次提供；原始聊天不会被删除。')}{feedback?.error && <><br /><span role="alert" className="form-feedback" data-error>{localizeAppError(feedback.text)}</span></>}</>}
      confirmLabel={tr('删除')} danger initialFocus="cancel" pending={busy} onCancel={() => { if (!pending.current) { setConfirm(undefined); setFeedback(undefined); } }}
      onConfirm={() => void perform(confirm.kind === 'all' ? { op: 'memory.clear', revision: confirm.revision } : { op: 'memory.delete', id: confirm.entry.id, revision: confirm.entry.revision })} />}
  </div>;
}
