import { useEffect, useSyncExternalStore } from 'react';
import { Menu } from '../primitives/menu.tsx';
import type { GitInspection } from '../../../../shared/contracts.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';

interface Controls { startPoint: string; error: string; starting: boolean; cancelling: string[]; }
const emptyControls: Controls = { startPoint: 'HEAD', error: '', starting: false, cancelling: [] };
const controls = new Map<string, Controls>();
const listeners = new Set<() => void>();
const controlsFor = (id: string) => controls.get(id) ?? emptyControls;
function updateControls(id: string, patch: Partial<Controls>) {
  controls.set(id, { ...controlsFor(id), ...patch }); for (const listener of listeners) listener();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function WorktreeControls({ inspection }: { inspection?: GitInspection }) {
  useLocale();
  const { thread, data, directoryId, fileScopeId, selectThread } = useApp();
  const { startPoint, error, starting, cancelling } = useSyncExternalStore(subscribe, () => controlsFor(fileScopeId));
  useEffect(() => {
    const previous = controlsFor(fileScopeId).cancelling;
    const remaining = previous.filter(id => data.operations.some(operation => operation.id === id && operation.status === 'running'));
    if (remaining.length !== previous.length) updateControls(fileScopeId, { cancelling: remaining });
  }, [fileScopeId, data.operations]);
  if (!thread) return null;
  const related = data.operations.filter(item => item.threadId === thread.id && item.directoryId === directoryId && item.kind.startsWith('worktree.'));
  const latest = related.at(-1);
  const operations = related.filter(item => item.status === 'running' || item === latest);
  const busy = starting || related.some(item => item.status === 'running') || ['running', 'waiting'].includes(thread.status);
  const issues = (data.worktreeRecoveryIssues ?? []).filter(issue => !issue.worktreeId || data.worktrees.some(item => item.id === issue.worktreeId && item.projectId === thread.projectId));
  const recover = async (recoveryId: string, action: 'retry' | 'open') => {
    if (controlsFor(fileScopeId).starting || (action === 'retry' && busy)) return;
    updateControls(fileScopeId, { starting: true, error: '' });
    try { await window.desktop.invoke({ op: 'worktree.recovery', threadId: thread.id, requestId: crypto.randomUUID(), recoveryId, action }); }
    catch (error) { updateControls(fileScopeId, { error: String(error) }); }
    finally { updateControls(fileScopeId, { starting: false }); }
  };
  const start = async (action: 'create' | 'migrate') => {
    if (controlsFor(fileScopeId).starting || busy) return;
    updateControls(fileScopeId, { starting: true, error: '' });
    try { await window.desktop.invoke({ op: 'worktree.start', threadId: thread.id, directoryId, requestId: crypto.randomUUID(), action, startPoint, destination: thread.worktreeBranch ? 'local' : 'worktree' }); }
    catch (error) { updateControls(fileScopeId, { error: String(error) }); }
    finally { updateControls(fileScopeId, { starting: false }); }
  };
  const cancel = async (id: string) => {
    if (controlsFor(fileScopeId).cancelling.includes(id)) return;
    updateControls(fileScopeId, { cancelling: [...controlsFor(fileScopeId).cancelling, id], error: '' });
    try { await window.desktop.invoke({ op: 'operation.cancel', threadId: thread.id, requestId: id }); }
    catch (error) { updateControls(fileScopeId, { error: String(error), cancelling: controlsFor(fileScopeId).cancelling.filter(item => item !== id) }); }
  };
  const result = latest?.result;
  const destinationId = result && typeof result === 'object' && !Array.isArray(result) && typeof result.threadId === 'string' ? result.threadId : '';
  const destination = data.threads.find(item => item.id === destinationId);
  const details = result && typeof result === 'object' && !Array.isArray(result) ? result : undefined;
  return <section className="worktree-lifecycle" aria-label={tr('Worktree 生命周期')}>
    <p className="hint">{tr('迁移保留聊天和草稿，源文件保留原位。目标有冲突时停止，Git 暂存区保持原状。')}</p>
    <p><strong>{thread.worktreeBranch ? 'Worktree' : tr('本地')}</strong> · {thread.cwd}</p>
    <label className="git-field">{tr('Worktree 起始分支或提交')}<span className="git-input-with-menu"><input value={startPoint} onChange={event => updateControls(fileScopeId, { startPoint: event.target.value })} /><Menu label={tr('起点建议')} placeholder={tr('选择')} kind="action" size="sm" value=""
      options={[
        { value: 'HEAD', label: 'HEAD' },
        ...(inspection?.branches ?? []).map(branch => ({ value: branch, label: branch })),
        ...(inspection?.commits ?? []).map(commit => ({ value: commit.id, label: commit.subject })),
      ]}
      onChange={value => updateControls(fileScopeId, { startPoint: value })} /></span></label>
    
    <div className="workbench-actions"><button disabled={busy || !startPoint.trim()} onClick={() => void start('create')}>{tr('按起点新建 Worktree 任务')}</button><button disabled={busy || issues.length > 0} onClick={() => void start('migrate')}>{thread.worktreeBranch ? tr('迁移此聊天到本地') : tr('迁移此聊天到 Worktree')}</button></div>
    {issues.map(issue => <div key={issue.id} role="alert">
      <p>{localizeLabel(issue.message)}</p><code>{issue.id}</code>
      <details><summary>{tr('迁移恢复详情')}</summary><pre>{localizeAppError(issue.details)}</pre></details>
      <div className="workbench-actions"><button disabled={busy} onClick={() => void recover(issue.id, 'retry')}>{tr('重试迁移恢复')}</button><button disabled={starting} onClick={() => void recover(issue.id, 'open')}>{tr('打开迁移恢复记录')}</button></div>
    </div>)}
    {operations.map(operation => <div key={operation.id} role={operation.status === 'failed' ? 'alert' : 'status'}><p>{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[operation.status])}</p>{operation.error && <p>{localizeAppError(operation.error)}</p>}{operation.status === 'running' && <button disabled={cancelling.includes(operation.id)} onClick={() => void cancel(operation.id)}>{cancelling.includes(operation.id) ? tr('正在取消操作') : tr('取消工作区操作')}</button>}</div>)}
    {destination && destination.id !== thread.id && latest?.status === 'succeeded' && <button onClick={() => selectThread(destination)}>{tr('打开新建的 Worktree 任务')}</button>}
    {latest?.status === 'succeeded' && typeof details?.warning === 'string' && details.warning && <p role="status">{localizeLabel(details.warning)} {typeof details.recoveryId === 'string' && <code>{details.recoveryId}</code>}</p>}
    {latest?.status === 'succeeded' && typeof details?.initializationError === 'string' && details.initializationError && <p role="alert">{tr('迁移已完成，但初始化未启动。可从项目动作重试初始化。')} {localizeAppError(details.initializationError)}</p>}
    {error && <p role="alert">{localizeAppError(error)}</p>}
  </section>;
}
