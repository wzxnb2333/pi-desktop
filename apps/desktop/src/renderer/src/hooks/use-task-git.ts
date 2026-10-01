import { useEffect, useRef } from 'react';
import type { GitStatus } from '../../../shared/contracts.ts';
import { useApp } from '../state/app.tsx';
import { useGitQuery } from './use-git-query.ts';

const emptyGit: GitStatus = { branch: '', files: [], available: false };

export function useTaskGit() {
  const { thread, activeId, directoryId } = useApp();
  const query = useGitQuery(activeId && thread?.projectId ? activeId + '/' + directoryId : null, async () => await window.desktop.invoke({ op: 'git.status', threadId: activeId, directoryId }) as GitStatus, thread?.status);
  const refresh = query.reload;
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  const completedTools = thread?.items.filter(item => item.role === 'tool' && item.state !== 'running').length;
  const observed = useRef({ activeId, completedTools });
  useEffect(() => {
    const previous = observed.current;
    observed.current = { activeId, completedTools };
    if (previous.activeId !== activeId || previous.completedTools === completedTools) return;
    const timer = setTimeout(() => void refresh(), 200);
    return () => clearTimeout(timer);
  }, [activeId, refresh, completedTools]);
  return { ...query, git: query.data ?? (query.error ? { ...emptyGit, error: query.error } : emptyGit) };
}
