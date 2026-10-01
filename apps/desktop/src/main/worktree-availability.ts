import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Thread } from '../shared/contracts.ts';
import type { ManagedWorktree } from '../shared/worktrees.ts';

export function worktreeContains(record: ManagedWorktree, path: string): boolean {
  const rel = relative(resolve(record.checkoutPath).toLowerCase(), resolve(path).toLowerCase());
  return !rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

export function archiveBlocker(record: ManagedWorktree, threads: Thread[], opened: string[], busy: Set<string>, terminals: Set<string>): string | undefined {
  const occupants = threads.filter(thread => worktreeContains(record, thread.cwd));
  if (occupants.some(thread => busy.has(thread.id) || ['running', 'waiting'].includes(thread.status))) return 'Worktree 仍有活动任务或操作';
  if (occupants.some(thread => terminals.has(thread.id))) return 'Worktree 仍有运行中的终端';
  if (opened.some(path => worktreeContains(record, path))) return '请先切换或关闭使用此 Worktree 的窗口';
  if (occupants.some(thread => thread.pinned)) return '已固定的任务正在使用此 Worktree';
  if (occupants.filter(thread => !thread.deletedAt && !thread.review && !thread.sidechat?.temporary).length > 1) return '多个任务共享此 Worktree，请先迁移其他任务';
  return undefined;
}
