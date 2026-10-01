import { useState } from 'react';
import { FolderCog } from 'lucide-react';
import { tr } from '../../../../shared/localization.ts';
import { projectDirectories, primaryDirectory } from '../../../../shared/project-directories.ts';
import type { DesktopRequest } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Button } from '../primitives/button.tsx';

export function ProjectDirectories({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?(open: boolean): void } = {}) {
  useLocale();
  const { project, invoke, data, selectDirectory } = useApp();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  if (!project) return null;
  const running = data.threads.some(thread => thread.projectId === project.id && ['running', 'waiting'].includes(thread.status));
  const execute = async (request: DesktopRequest) => {
    if (pending) return;
    setPending(true); setError('');
    try { await invoke(request); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  };
  return <>
    {controlledOpen === undefined && <IconButton label={tr('项目目录')} onClick={() => setOpen(true)}><FolderCog size={17} /></IconButton>}
    {open && <ConfirmDialog title={tr('项目目录')} presentation="panel" confirmLabel={tr('关闭')} onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)}
      description={<div className="command-content project-directory-manager">
        <strong>{project.name}</strong><p className="hint">{tr('新任务使用主目录；现有任务继续使用原来的执行目录。')}</p>
        <div className="command-results">{projectDirectories(project).map(directory => <section key={directory.id} className="project-directory-row">
          <strong>{directory.name}{directory.id === primaryDirectory(project).id && ' · ' + tr('主目录')}</strong><p title={directory.path}>{directory.path}</p>
          <div className="workbench-actions">
            <Button size="xs" disabled={pending} onClick={() => { selectDirectory(directory.id); setOpen(false); }}>{tr('浏览目录与仓库')}</Button>
            {directory.id !== primaryDirectory(project).id && <Button size="xs" disabled={pending} onClick={() => void execute({ op: 'project.directoryUpdate', projectId: project.id, directoryId: directory.id, primary: true })}>{tr('设为主目录')}</Button>}
            <Button size="xs" disabled={pending || running} onClick={() => void execute({ op: 'project.directoryUpdate', projectId: project.id, directoryId: directory.id, trusted: !directory.trusted })}>{directory.trusted ? tr('取消目录信任') : tr('信任此目录')}</Button>
            {directory.id !== project.id && directory.id !== primaryDirectory(project).id && <Button size="xs" disabled={pending || running} onClick={() => void execute({ op: 'project.directoryRemove', projectId: project.id, directoryId: directory.id })}>{tr('移除目录')}</Button>}
          </div>
        </section>)}</div>
        {error && <p role="alert" className="error">{error}</p>}
        <Button disabled={pending} onClick={() => void execute({ op: 'project.directoryAdd', projectId: project.id })}>{tr('添加项目目录')}</Button>
        <Button onClick={() => setOpen(false)}>{tr('关闭')}</Button>
      </div>} />}
  </>;
}
