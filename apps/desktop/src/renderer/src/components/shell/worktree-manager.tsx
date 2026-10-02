import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Menu } from '../primitives/menu.tsx';
import { IconButton } from '../primitives/icon-button.tsx';

export function WorktreeManager({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?(open: boolean): void } = {}) {
  const locale = useLocale();
  const { project, thread, data, invoke, act, selectThread } = useApp();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [confirmId, setConfirmId] = useState('');
  const [preference, setPreference] = useState<typeof data.settings.worktreeCleanup>();
  useEffect(() => {
    if (preference && JSON.stringify(preference) === JSON.stringify(data.settings.worktreeCleanup)) setPreference(undefined);
  }, [preference, data.settings.worktreeCleanup]);
  if (!project || !thread) return null;
  const records = data.worktrees.filter(item => item.projectId === project.id);
  const creations = (data.worktreeCreationIssues ?? []).filter(item => !item.projectId || item.projectId === project.id);
  const projectThreads = new Set(data.threads.filter(item => item.projectId === project.id).map(item => item.id));
  const operations = data.operations.filter(item => projectThreads.has(item.threadId) && ['worktree.archive', 'worktree.restore', 'worktree.usage', 'worktree.recycle', 'worktree.cleanup', 'worktree.creationRecover'].includes(item.kind)).slice(-15).reverse();
  const running = operations.find(item => item.status === 'running');
  const cleanup = preference ?? data.settings.worktreeCleanup;
  const perform = async (action: 'archive' | 'restore' | 'usage' | 'cleanup', worktreeId: string) => {
    setPending(true); setError(''); setConfirmId('');
    try { await invoke({ op: 'worktree.manage', threadId: thread.id, worktreeId, requestId: crypto.randomUUID(), action }); }
    catch (error) { setError(String(error)); }
    finally { setPending(false); }
  };
  const save = async (next: typeof cleanup) => {
    setPreference(next);
    setPending(true); setError('');
    try { await invoke({ op: 'settings.patch', patch: { worktreeCleanup: next }, base: { worktreeCleanup: cleanup } }); }
    catch (error) { setPreference(undefined); setError(String(error)); }
    finally { setPending(false); }
  };
  const recycle = async () => {
    setPending(true); setError('');
    try { await invoke({ op: 'worktree.recycle', threadId: thread.id, requestId: crypto.randomUUID() }); }
    catch (error) { setError(String(error)); }
    finally { setPending(false); }
  };
  const recoverCreation = async (recoveryId: string, action: 'refresh' | 'open' | 'folder') => {
    setPending(true); setError('');
    try { await invoke({ op: 'worktree.creationRecovery', threadId: thread.id, recoveryId, action, requestId: crypto.randomUUID() }); }
    catch (error) { setError(String(error)); }
    finally { setPending(false); }
  };
  return <>
    {controlledOpen === undefined && <IconButton label={tr('Worktree 管理')} onClick={() => setOpen(true)}><Archive size={17} /></IconButton>}
    {open && <ConfirmDialog title={tr('Worktree 管理')} presentation="panel" confirmLabel={tr('关闭')} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} description={
      <div className="project-actions-editor worktree-manager command-content">
        <p>{project.name}</p><p className="hint">{tr('归档保存提交、暂存和未提交内容后回收目录。活动、已打开、固定或共享的工作区不会自动回收，忽略文件需先自行清理。')}</p>
        <fieldset><legend>{tr('可选自动回收')}</legend>
          <label className="check"><input type="checkbox" checked={cleanup.enabled} disabled={pending} onChange={event => void save({ ...cleanup, enabled: event.target.checked })} />{tr('自动归档闲置 Worktree')}</label>
          <label>{tr('闲置天数')}<Menu label={tr('闲置天数')} value={String(cleanup.days)} disabled={pending} matchTriggerWidth
            options={[...new Set([1, 7, 14, 30, 90, cleanup.days])].sort((a, b) => a - b).map(days => ({ value: String(days), label: String(days) }))}
            onChange={value => void save({ ...cleanup, days: Number(value) })} /></label>
          <p className="hint">{tr('默认关闭。仅在应用运行时检查；恢复证据不完整或清理失败的目录会保留。')}</p>
          <button disabled={pending || !!running} onClick={() => void recycle()}>{tr('回收符合条件的闲置工作区')}</button>
        </fieldset>
        {!records.length && !creations.length && <p>{tr('此项目暂无受管 Worktree')}</p>}
        {!!creations.length && <section>
          <h3>{tr('中断的 Worktree 创建')}</h3>
          <p className="hint">{tr('重新打开保留现有文件和暂存区，不自动执行项目初始化。')}</p>
          <button disabled={pending || !!running} onClick={() => void recoverCreation('', 'refresh')}>{tr('重新检查创建状态')}</button>
          {creations.map(item => <article className="managed-worktree" key={item.id}>
            <h3>{item.branch || tr('创建恢复记录')}</h3><p className="hint path-text">{item.path}</p><p>{localizeAppError(item.message)}</p>
            <div className="workbench-actions">
              <button disabled={pending || !!running || !item.canOpen} onClick={() => void recoverCreation(item.id, 'open')}>{tr('打开保留的 Worktree')}</button>
              {item.projectId && <button disabled={pending} onClick={() => void recoverCreation(item.id, 'folder')}>{tr('查看保留目录')}</button>}
            </div>
          </article>)}
        </section>}
        {records.map(record => {
          const owner = data.threads.find(item => item.id === record.threadId && !item.deletedAt);
          const usage = operations.find(item => item.kind === 'worktree.usage' && item.status === 'succeeded' && item.result && typeof item.result === 'object' && !Array.isArray(item.result) && item.result.worktreeId === record.id)?.result;
          return <article className="managed-worktree" key={record.id}>
            <h3>{owner?.title || record.branch}</h3><p>{record.status === 'archived' ? record.restoreInProgress ? tr('恢复未完成，可重试') : tr('已归档，可恢复') : tr('可用工作区')} · {record.branch}</p>
            {record.status === 'archived' && record.restoreInProgress && <p className="hint">{tr('已恢复的文件会保留；解决错误后，点击恢复继续。外部改动不会被覆盖。')}</p>}
            {record.status === 'ready' && !owner && <p className="hint">{tr('工作区文件已就绪，仍需恢复关联聊天。')}</p>}
            {record.archiveRemoval && <div className="hint">
              <p>{tr('归档数据已保存，旧目录回收尚未完成。可继续回收，或先恢复工作区。外部变更会保留。')}</p>
              <p className="path-text">{record.archiveRemoval.path}</p>
            </div>}
            <p className="hint path-text">{record.path}</p><p className="hint">{tr('最近使用')} · {new Date(record.lastUsedAt).toLocaleString(locale)}</p>
            {usage && typeof usage === 'object' && !Array.isArray(usage) && typeof usage.checkoutBytes === 'number' && typeof usage.snapshotBytes === 'number' && <p>{tr('目录 {p0} MB；任务恢复快照 {p1} MB', { p0: (usage.checkoutBytes / 1048576).toFixed(1), p1: (usage.snapshotBytes / 1048576).toFixed(1) })}</p>}
            {record.archiveRemoval && usage && typeof usage === 'object' && !Array.isArray(usage) && typeof usage.cleanupBytes === 'number' && <p>{tr('待回收目录 {p0} MB', { p0: (usage.cleanupBytes / 1048576).toFixed(1) })}</p>}
            <div className="workbench-actions">
              {record.status === 'archived' ? <button disabled={pending || !!running} onClick={() => void perform('restore', record.id)}>{tr('恢复 Worktree')}</button> : !record.archiveRemoval && <button disabled={pending || !!running} onClick={() => setConfirmId(record.id)}>{tr('归档并回收 Worktree')}</button>}
              {record.status === 'ready' && !owner && <button disabled={pending || !!running} onClick={() => void perform('restore', record.id)}>{tr('恢复关联聊天')}</button>}
              {record.archiveRemoval && <button disabled={pending || !!running} onClick={() => void perform('cleanup', record.id)}>{tr('继续回收旧目录')}</button>}
              {record.status === 'ready' && record.restoreFiles && <button disabled={pending || !!running} onClick={() => void perform('cleanup', record.id)}>{tr('清理恢复临时文件')}</button>}
              <button disabled={pending || !!running} onClick={() => void perform('usage', record.id)}>{tr('计算占用')}</button>
              {owner && <button onClick={() => { selectThread(owner); setOpen(false); }}>{tr('打开关联聊天')}</button>}
            </div>
            {record.cleanupError && <p role="alert">{localizeAppError(record.cleanupError)}</p>}
          </article>;
        })}
        {operations.map(operation => <details key={operation.id} open={operation.status === 'running' || operation.status === 'failed'}>
          <summary>{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[operation.status])}</summary>
          {operation.error && <p role="alert">{localizeAppError(operation.error)}</p>}
          {operation.status === 'running' && <button onClick={() => act({ op: 'operation.cancel', threadId: operation.threadId, requestId: operation.id })}>{tr('取消工作区操作')}</button>}
          {operation.result && typeof operation.result === 'object' && !Array.isArray(operation.result) && Array.isArray(operation.result.worktrees) && operation.result.worktrees.map((item, index) => item && typeof item === 'object' && !Array.isArray(item) && <p key={index}>{typeof item.id === 'string' ? records.find(record => record.id === item.id)?.branch : ''} · {item.status === 'archived' ? tr('已归档，可恢复') : item.status === 'skipped' ? tr('已跳过') : tr('操作失败')} {typeof item.reason === 'string' && localizeAppError(item.reason)}</p>)}
        </details>)}
        {error && <p role="alert">{localizeAppError(error)}</p>}<button onClick={() => setOpen(false)}>{tr('关闭')}</button>
      </div>
    } />}
    {confirmId && <ConfirmDialog title={tr('归档并回收 Worktree')} description={tr('原目录将被移除，恢复数据保留在本机。请先切换到其他工作区或关闭关联窗口。')} confirmLabel={tr('归档并回收')} onConfirm={() => void perform('archive', confirmId)} onCancel={() => setConfirmId('')} />}
  </>;
}
