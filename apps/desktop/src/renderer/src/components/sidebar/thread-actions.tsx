import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useState } from 'react';
import type { Thread } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Menu } from '../primitives/menu.tsx';

export function ThreadActions({ thread, entryId }: { thread: Thread; entryId?: string }) {
  useLocale();
  const { act, invoke, selectThread, ui, composerRef } = useApp();
  const [rename, setRename] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const busy = ['running', 'waiting'].includes(thread.status);
  const options = thread.deletedAt ? [
    { value: 'restore', label: tr("从回收站恢复") }, { value: 'purge', label: tr("永久删除"), disabled: busy },
  ] : entryId ? [
    { value: 'sidechat', label: tr('从此消息创建侧聊') },
    { value: 'fork', label: tr("从此消息分叉"), disabled: busy || !thread.sessionFile },
    { value: 'fork-worktree', label: tr("从此消息在新 worktree 分叉"), disabled: busy || !thread.sessionFile || !thread.projectId },
  ] : [
    { value: 'window', label: tr('在独立窗口打开') },
    { value: 'rename', label: tr("重命名") },
    { value: 'pin', label: thread.pinned ? tr("取消置顶") : tr("置顶") },
    { value: 'read', label: (thread.readAt ?? 0) < thread.updatedAt ? tr("标记已读") : tr("标记未读") },
    { value: 'archive', label: thread.archived ? tr("恢复归档任务") : tr("归档"), disabled: busy },
    { value: 'copy', label: tr("复制任务信息") },
    { value: 'markdown', label: tr("导出 Markdown") }, { value: 'html', label: tr("导出 HTML") }, { value: 'json', label: tr("导出 JSON") },
    { value: 'fork', label: tr("分叉会话"), disabled: busy || !thread.sessionFile },
    { value: 'fork-worktree', label: tr("在新 worktree 中分叉"), disabled: busy || !thread.sessionFile || !thread.projectId },
    { value: 'compact', label: tr("压缩上下文"), disabled: busy || !thread.sessionFile },
    { value: busy ? 'stop' : 'resume', label: busy ? tr("停止任务") : tr("继续任务") },
    { value: 'delete', label: tr("移入回收站"), disabled: busy },
  ];
  const choose = async (action: string) => {
    if (action === 'sidechat') await invoke({ op: 'sidechat.create', threadId: thread.id, anchorItemId: entryId });
    if (action === 'window') await invoke({ op: 'window.open', kind: 'task', threadId: thread.id });
    if (action === 'rename') { setTitle(thread.title); setRename(true); }
    if (action === 'pin') act({ op: 'thread.update', id: thread.id, pinned: !thread.pinned });
    if (action === 'read') act({ op: 'thread.update', id: thread.id, readAt: (thread.readAt ?? 0) < thread.updatedAt ? Date.now() : 0 });
    if (action === 'archive') act({ op: 'thread.update', id: thread.id, archived: !thread.archived });
    if (action === 'copy') await navigator.clipboard.writeText(thread.title + '\n' + thread.cwd + '\n' + thread.id);
    if (action === 'markdown' || action === 'html' || action === 'json') act({ op: 'thread.export', id: thread.id, format: action });
    if (action === 'fork' || action === 'fork-worktree') selectThread(await invoke({ op: 'thread.fork', id: thread.id, entryId, worktree: action === 'fork-worktree' }) as Thread);
    if (action === 'compact') act({ op: 'thread.compact', id: thread.id });
    if (action === 'stop') act({ op: 'thread.stop', id: thread.id });
    if (action === 'resume') {
      selectThread(thread);
      const draft = ui.threads[thread.id]?.draft;
      if (!draft?.text && !draft?.attachments.length) act({ op: 'ui.threadPatch', threadId: thread.id, patch: { draft: { text: tr("请继续上次任务"), attachments: [] } } });
      requestAnimationFrame(() => composerRef.current?.focus());
    }
    if (action === 'delete' || action === 'restore') act({ op: 'thread.update', id: thread.id, deletedAt: action === 'restore' ? null : Date.now() });
    if (action === 'purge') act({ op: 'thread.purge', id: thread.id });
  };
  return <span data-thread-menu="true"><Menu kind="action" label={entryId ? tr("消息操作") : tr("任务更多操作")} value="" options={options} placeholder="…" size="sm" align="end" onChange={value => void choose(value).catch(() => {})} />
    {rename && <ConfirmDialog title={tr("重命名任务")} description={<input aria-label={tr("任务名称")} value={title} onChange={event => setTitle(event.target.value)} />} confirmLabel={tr("保存")} onCancel={() => setRename(false)} onConfirm={() => { if (title.trim()) { act({ op: 'thread.update', id: thread.id, title: title.trim() }); setRename(false); } }} />}
  </span>;
}
