import { useEffect, useRef, useState } from 'react';
import type { GitProcessProblem } from '../../../../shared/git-processes.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useGitQuery } from '../../hooks/use-git-query.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';

export function GitProcessRecovery() {
  useLocale();
  const { activeId, directoryId, fileScopeId } = useApp();
  const [feedback, setFeedback] = useState({ scope: fileScopeId, error: '', stopped: false });
  const pending = useRef(new Set<string>());
  const panel = useRef<HTMLElement>(null);
  const current = useRef(fileScopeId); current.current = fileScopeId;
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useGitQuery(fileScopeId, async () => (await window.desktop.invoke({ op: 'git.processProblems', threadId: activeId, directoryId }) ?? []) as GitProcessProblem[]);
  useEffect(() => window.desktop.onEvent(event => { if (event.type === 'gitProcessesChanged') void query.reload(); }), [query.reload]);
  const stop = async (process: GitProcessProblem) => {
    if (pending.current.has(process.id)) return;
    pending.current.add(process.id);
    setFeedback({ scope: fileScopeId, error: '', stopped: false });
    try {
      await window.desktop.invoke({ op: 'git.retryStop', threadId: activeId, directoryId, processId: process.id });
      if (!mounted.current || current.current !== fileScopeId) return;
      setFeedback({ scope: fileScopeId, error: '', stopped: true });
      await query.reload(); panel.current?.focus();
    } catch (error) {
      if (mounted.current && current.current === fileScopeId) {
        setFeedback({ scope: fileScopeId, error: error instanceof Error ? error.message : String(error), stopped: false });
        await query.reload();
      }
    } finally { pending.current.delete(process.id); }
  };
  const problems = query.data ?? [];
  const local = feedback.scope === fileScopeId ? feedback : { error: '', stopped: false };
  if (!problems.length && !query.error && !local.error && !local.stopped) return null;
  return <section ref={panel} className="git-read-error git-process-recovery" aria-label={tr('Git 进程恢复')} tabIndex={-1}>
    {!!problems.length && <p role="alert">{tr('Git 操作尚未结束，先停止进程，再核对仓库状态。')}</p>}
    {problems.map(process => <div key={process.id}><p>{localizeAppError(process.reason)}</p><button type="button" disabled={process.stopping} onClick={() => void stop(process)}>{process.stopping ? tr('正在停止进程 {p0}', { p0: process.pid }) : tr('重试停止进程 {p0}', { p0: process.pid })}</button></div>)}
    {(query.error || local.error) && <p role="alert">{localizeAppError(local.error || query.error)}</p>}
    {query.error && <button type="button" disabled={query.pending} onClick={() => void query.reload()}>{tr('重试')}</button>}
    {local.stopped && <p role="status">{tr('进程已停止，请刷新并核对仓库状态。')}</p>}
  </section>;
}
