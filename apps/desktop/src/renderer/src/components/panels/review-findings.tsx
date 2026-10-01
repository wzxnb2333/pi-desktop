import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type Thread, type UiThread } from '../../../../shared/contracts.ts';
import type { LineComment, ReviewFile, ReviewRun } from '../../../../shared/reviews.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { statusText } from '../../lib/labels.ts';
import '../../styles/review-findings.css';

interface FindingDraft { feedback: string; pending: boolean; error: string; }
interface ReviewControls {
  selected: string; scope: ReviewRun['scope']; ref: string; instructions: string;
  starting: boolean; cancelling?: string; error: string;
  findings: Record<string, FindingDraft>; removing: string[];
}
const emptyFinding: FindingDraft = { feedback: '', pending: false, error: '' };
const emptyControls: ReviewControls = { selected: '', scope: 'uncommitted', ref: '', instructions: '', starting: false, error: '', findings: {}, removing: [] };
// Panel tabs unmount their content. Keep drafts and in-flight actions with the
// originating task/directory for this window session, including hidden panels.
const controls = new Map<string, ReviewControls>();
const listeners = new Set<() => void>();
const controlsFor = (id: string): ReviewControls => controls.get(id) ?? emptyControls;
function updateControls(id: string, patch: Partial<ReviewControls>): void {
  controls.set(id, { ...controlsFor(id), ...patch });
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function updateFinding(scopeId: string, id: string, patch: Partial<FindingDraft>): void {
  const current = controlsFor(scopeId);
  updateControls(scopeId, { findings: { ...current.findings, [id]: { ...emptyFinding, ...current.findings[id], ...patch } } });
}

function Finding({ scopeId, run, finding, stale, locate, snapshot, reading }: { scopeId: string; run: Thread; finding: ReviewRun['findings'][number]; stale: boolean;
  locate(): void; snapshot(): void; reading: boolean }) {
  useLocale();
  const { activeId, updateDraft } = useApp();
  const id = run.id + '/' + finding.id;
  const { feedback, pending, error } = useSyncExternalStore(subscribe, () => controlsFor(scopeId).findings[id] ?? emptyFinding);
  const save = async (ignored?: boolean) => {
    const current = controlsFor(scopeId).findings[id] ?? emptyFinding;
    if (current.pending || ignored === undefined && !current.feedback.trim()) return;
    updateFinding(scopeId, id, { pending: true, error: '' });
    try {
      await window.desktop.invoke({ op: 'review.finding', threadId: run.id, findingId: finding.id, ...(ignored === undefined ? { feedback: current.feedback } : { ignored }) });
      if (ignored === undefined && controlsFor(scopeId).findings[id]?.feedback === current.feedback) updateFinding(scopeId, id, { feedback: '' });
    } catch (error) { updateFinding(scopeId, id, { error: error instanceof Error ? error.message : String(error) }); }
    finally { updateFinding(scopeId, id, { pending: false }); }
  };
  return <article className={'review-finding' + (finding.ignored ? ' ignored' : '')}>
    <header><strong>P{finding.priority} · {finding.title}</strong>{stale && <span className="review-stale">{tr('位置已过期')}</span>}</header>
    <button className="review-location" disabled={stale} onClick={locate}>{finding.path}:{finding.line}–{finding.endLine}</button>
    <p>{finding.body}</p>
    <div className="workbench-actions"><button disabled={reading} onClick={snapshot}>{tr('查看捕获版本')}</button><button disabled={pending} onClick={() => void save(!finding.ignored)}>{finding.ignored ? tr('恢复发现') : tr('忽略发现')}</button><button onClick={() => updateDraft(activeId, draft => ({ ...draft,
      text: [draft.text, tr('请处理审查反馈：') + '\n' + finding.path + ':' + finding.line + '\n' + finding.title + '\n' + finding.body + (feedback ? '\n' + feedback : '')].filter(Boolean).join('\n\n') }))}>{tr('追加到任务草稿')}</button></div>
    {finding.feedback.length > 0 && <ul>{finding.feedback.map((text, index) => <li key={index}>{text}</li>)}</ul>}
    <label>{tr('追加审查反馈')}<textarea value={feedback} maxLength={10000} onChange={event => updateFinding(scopeId, id, { feedback: event.target.value })} /></label>
    <button disabled={pending || !feedback.trim()} onClick={() => void save()}>{pending ? tr('正在保存…') : tr('保存反馈')}</button>{error && <p role="alert">{localizeAppError(error)}</p>}
  </article>;
}

export function ReviewFindings() {
  useLocale();
  const { data, thread, activeId, directoryId, fileScopeId, patchThread, updateDraft } = useApp();
  const runs = data.threads.filter(item => item.review?.parentThreadId === activeId && item.directoryId === directoryId);
  const { selected, scope, ref, instructions, error, starting, cancelling, removing } = useSyncExternalStore(subscribe, () => controlsFor(fileScopeId));
  const run = runs.find(item => item.id === selected) ?? runs[0];
  const setError = (error: string) => updateControls(fileScopeId, { error });
  const [files, setFiles] = useState<Array<ReviewFile & { stale: boolean }>>([]);
  const [comments, setComments] = useState<Array<LineComment & { stale: boolean }>>([]);
  const [captured, setCaptured] = useState<{ runId: string; path: string; content: string }>();
  const [reading, setReading] = useState('');
  const [readError, setReadError] = useState('');
  const snapshotRequest = useRef(0);
  const locationRequest = useRef(0);
  const shownRun = useRef(run?.id); shownRun.current = run?.id;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFiles([]); setComments([]); setReadError('');
    if (run?.review?.files.length) void window.desktop.invoke({ op: 'review.inspect', threadId: run.id }).then(result => { if (!cancelled) setFiles(result as typeof files); }).catch(error => { if (!cancelled) setReadError(String(error)); });
    void window.desktop.invoke({ op: 'comment.list', threadId: activeId }).then(result => { if (!cancelled) setComments((result as typeof comments).filter(comment => comment.directoryId === directoryId)); }).catch(error => { if (!cancelled) setReadError(String(error)); });
    const focus = () => setRefresh(value => value + 1);
    window.addEventListener('focus', focus);
    return () => { cancelled = true; window.removeEventListener('focus', focus); };
  }, [run?.id, run?.review?.phase, thread?.comments, activeId, directoryId, refresh]);
  const busy = !!run?.review && ['capturing', 'running'].includes(run.review.phase);
  const anyBusy = runs.some(item => item.review && ['capturing', 'running'].includes(item.review.phase));
  const locate = (request: { op: 'review.locate'; threadId: string; findingId: string } | { op: 'comment.locate'; threadId: string; commentId: string }) => {
    const ticket = ++locationRequest.current;
    const current = () => mounted.current && locationRequest.current === ticket && (request.op !== 'review.locate' || shownRun.current === request.threadId);
    void window.desktop.invoke(request).then(result => {
      if (!current()) return;
      const location = result as NonNullable<UiThread['fileLocation']> & { directoryId: string };
      patchThread({ directoryId: location.directoryId, selectedPath: location.path, fileLocation: { id: location.id, path: location.path, line: location.line }, reviewTab: 'files' });
    }).catch(error => { if (current()) { setError(String(error)); setRefresh(value => value + 1); } });
  };
  const snapshot = async (runId: string, path: string) => {
    const ticket = ++snapshotRequest.current;
    setReading(runId + '/' + path); setError('');
    const current = () => mounted.current && snapshotRequest.current === ticket && shownRun.current === runId;
    try {
      const result = await window.desktop.invoke({ op: 'review.file', threadId: runId, path }) as { path: string; content: string };
      if (current()) setCaptured({ ...result, runId });
    } catch (error) { if (current()) setError(String(error)); }
    finally { if (current()) setReading(''); }
  };
  return <section className="review-findings" aria-label={tr('只读审查')}>
    <h2>{tr('审查改动')}</h2><p className="hint">{tr('审查按需启动，使用独立只读会话，不修改工作区。')}</p>
    <form aria-busy={starting} onSubmit={event => {
      event.preventDefault(); if (controlsFor(fileScopeId).starting || anyBusy) return;
      updateControls(fileScopeId, { starting: true, error: '' });
      void window.desktop.invoke({ op: 'review.start', threadId: activeId, directoryId, scope, ref, instructions })
        .then(result => { if (controlsFor(fileScopeId).selected === selected) updateControls(fileScopeId, { selected: (result as Thread).id }); })
        .catch(error => setError(String(error))).finally(() => updateControls(fileScopeId, { starting: false }));
    }}>
      <label>{tr('审查范围')}<select value={scope} onChange={event => updateControls(fileScopeId, { scope: event.target.value as typeof scope })}><option value="uncommitted">{tr('未提交改动')}</option><option value="branch">{tr('对比基准分支')}</option><option value="commit">{tr('指定提交')}</option></select></label>
      {scope !== 'uncommitted' && <label>{scope === 'branch' ? tr('基准分支') : tr('提交引用')}<input value={ref} onChange={event => updateControls(fileScopeId, { ref: event.target.value })} required maxLength={3000} /></label>}
      <label>{tr('自定义审查要求')}<textarea value={instructions} maxLength={20000} onChange={event => updateControls(fileScopeId, { instructions: event.target.value })} /></label>
      <button type="submit" disabled={starting || anyBusy || !thread?.projectId || !thread.modelId}>{tr('开始只读审查')}</button>
      {starting && <p role="status">{tr('正在启动审查…')}</p>}
    </form>
    {runs.length > 0 && <label>{tr('审查记录')}<select value={run?.id ?? ''} onChange={event => { snapshotRequest.current++; locationRequest.current++; setReading(''); updateControls(fileScopeId, { selected: event.target.value }); setCaptured(undefined); }}>{runs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.review?.ref || tr('未提交改动')}</option>)}</select></label>}
    {run?.review && <section aria-label={tr('审查结果')}>
      <div className="workbench-actions"><span role="status">{run.review.phase === 'capturing' ? tr('正在捕获审查范围…') : run.review.phase === 'cancelled' ? tr('审查已取消') : run.review.phase === 'complete' ? tr('审查已完成') : statusText[run.status]}</span>
        {busy && <button disabled={cancelling === run.id} onClick={() => {
          if (controlsFor(fileScopeId).cancelling) return;
          updateControls(fileScopeId, { cancelling: run.id, error: '' });
          void window.desktop.invoke({ op: 'review.cancel', threadId: run.id }).catch(error => setError(String(error))).finally(() => updateControls(fileScopeId, { cancelling: undefined }));
        }}>{cancelling === run.id ? tr('正在取消审查…') : tr('取消审查')}</button>}
        <button onClick={() => setRefresh(value => value + 1)}>{tr('检查位置状态')}</button></div>
      {run.error && <p role="alert">{localizeAppError(run.error)}</p>}
      <p>{run.review.summary}</p>
      {run.review.phase === 'complete' && !run.review.findings.length && <p>{tr('本次审查没有发现需要修复的问题。')}</p>}
      {run.review.findings.map(finding => <Finding key={run.id + '/' + finding.id} scopeId={fileScopeId} run={run} finding={finding}
        stale={files.find(file => file.path === finding.path)?.stale !== false || !!run.review?.files.find(file => file.path === finding.path)?.deleted}
        locate={() => locate({ op: 'review.locate', threadId: run.id, findingId: finding.id })}
        reading={reading === run.id + '/' + finding.path} snapshot={() => void snapshot(run.id, finding.path)} />)}
      <details><summary>{tr('审查执行过程')}</summary><pre>{run.items.map(item => item.role + (item.toolName ? ' · ' + item.toolName : '') + '\n' + item.text).join('\n\n')}</pre></details>
    </section>}
    {captured?.runId === run?.id && captured && <section className="review-captured"><strong>{captured.path} · {tr('捕获版本')}</strong><button onClick={() => { snapshotRequest.current++; setReading(''); setCaptured(undefined); }}>{tr('关闭')}</button><pre>{captured.content.split('\n').map((line, index) => <div key={index}><span>{index + 1}</span>{line}</div>)}</pre></section>}
    <h3>{tr('行评论')}</h3>
    {!comments.length && <p className="hint">{tr('点击工作区差异的行号添加评论。')}</p>}
    {comments.map(comment => <article className="review-finding" key={comment.id}>
      <button disabled={comment.stale} onClick={() => locate({ op: 'comment.locate', threadId: activeId, commentId: comment.id })}>{comment.path}:{comment.line}–{comment.endLine}</button>
      {comment.stale && <span className="review-stale">{tr('位置已过期')}</span>}<p>{comment.body}</p><pre>{comment.excerpt}</pre>
      <button onClick={() => updateDraft(activeId, draft => ({ ...draft, text: [draft.text, comment.path + ':' + comment.line + '\n' + comment.body].filter(Boolean).join('\n\n') }))}>{tr('追加到任务草稿')}</button>
      <button disabled={removing.includes(comment.id)} onClick={() => {
        if (controlsFor(fileScopeId).removing.includes(comment.id)) return;
        updateControls(fileScopeId, { removing: [...controlsFor(fileScopeId).removing, comment.id], error: '' });
        void window.desktop.invoke({ op: 'comment.remove', threadId: activeId, commentId: comment.id })
          .then(() => { if (mounted.current) setRefresh(value => value + 1); }).catch(error => setError(String(error)))
          .finally(() => updateControls(fileScopeId, { removing: controlsFor(fileScopeId).removing.filter(id => id !== comment.id) }));
      }}>{tr('删除评论')}</button>
    </article>)}
    {error && <p role="alert">{localizeAppError(error)}</p>}
    {readError && <div role="alert"><p>{localizeAppError(readError)}</p><button onClick={() => setRefresh(value => value + 1)}>{tr('检查位置状态')}</button></div>}
  </section>;
}
