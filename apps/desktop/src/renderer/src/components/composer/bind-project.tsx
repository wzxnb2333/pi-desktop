import { useEffect, useRef, useState } from 'react';
import type { Project, Thread } from '../../../../shared/contracts.ts';
import { projectDirectories } from '../../../../shared/project-directories.ts';
import { tr } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { Menu } from '../primitives/menu.tsx';

export function BindProject() {
  const { thread } = useApp();
  return thread && !thread.projectId ? <BindProjectControl key={thread.id} thread={thread} /> : null;
}

function BindProjectControl({ thread }: { thread: Thread }) {
  useLocale();
  const { data, invoke, running } = useApp();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false), current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  const choices = data.projects.flatMap(project => projectDirectories(project).map(directory => ({
    value: project.id + ':' + directory.id, label: project.name + ' · ' + directory.path, projectId: project.id, directoryId: directory.id,
  })));
  return <Menu label={tr('绑定项目目录')} kind="action" value="" placeholder={tr('绑定项目目录')} side="top" size="sm" disabled={running || pending}
    options={[...choices, { value: 'add', label: tr('添加本地项目') }]} onChange={value => {
      if (submitting.current) return;
      submitting.current = true; setPending(true);
      void (async () => {
        const choice = choices.find(item => item.value === value);
        const projectId = choice?.projectId ?? (await invoke({ op: 'project.add' }) as Project | null)?.id;
        if (projectId && current.current) await invoke({ op: 'thread.bindProject', id: thread.id, projectId, directoryId: choice?.directoryId });
      })().catch(() => {}).finally(() => { if (current.current) { submitting.current = false; setPending(false); } });
    }} />;
}
