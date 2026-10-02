import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { ListChecks, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../state/app.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { ReferenceIcon } from '../primitives/reference-icon.tsx';
import { ProjectDirectories } from './project-directories.tsx';
import { ProjectActions } from './project-actions.tsx';
import { WorktreeManager } from './worktree-manager.tsx';
import { GoalPanel } from '../panels/goal-panel.tsx';
import { useSubtaskNavigation } from '../../hooks/use-subtask-navigation.ts';

export interface ToolbarProps {
  previewOpen: boolean;
  setPreviewOpen(open: boolean): void;
}

const titles: Record<string, string> = {
  get settings() { return tr("设置"); },
  get skills() { return tr("Skills 与扩展"); },
  get inbox() { return tr("待审阅"); },
  get automations() { return tr("自动化"); },
};

export function Toolbar({ setPreviewOpen }: ToolbarProps) {
  useLocale();
  const {
    project,
    thread,
    view,
    setTerminalOpen,
    reviewOpen,
    setReviewOpen,
    act,
    activeId,
    reviewTab, setReviewTab,
    ui, patchUi, data, selectThread,
  } = useApp();
  const [dialog, setDialog] = useState<'directories' | 'worktrees' | 'goal'>();
  const openSubtask = useSubtaskNavigation();
  const isThread = view === 'thread';
  const isHome = isThread && !thread?.items.length;
  const summaryVisible = ui.summaryOpen !== false && (!!thread?.items.length || ui.summaryOpen === true);
  const relation = data.subtasks.find(item => item.childThreadId === thread?.id);
  const parent = data.threads.find(item => item.id === relation?.parentThreadId && !item.deletedAt);
  const canManageTask = !!thread && !thread.review && !thread.sidechat?.temporary;
  return (
    <div className="toolbar" data-home={isHome || undefined}>
      <div className="breadcrumb" aria-hidden={isHome || undefined}>
        {isThread ? (
          <>
            <span title={project?.name || tr("工作台")}>{project?.name || tr("工作台")}</span>
            <ReferenceIcon name="right" size={13} />
            <strong title={thread?.title || tr("新任务")}>{thread?.title || tr("新任务")}</strong>
          </>
        ) : (
          <strong>{titles[view]}</strong>
        )}
      </div>
      {isThread && thread && (
        <div className="toolbar-actions">
          <ProjectActions key={thread.id} />
          <IconButton label={tr('辅助栏')} active={reviewOpen} onClick={() => {
            if (!['changes', 'files', 'browser', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask'].includes(reviewTab)) setReviewTab('browser');
            setReviewOpen(!reviewOpen);
          }}>
            <ReferenceIcon name="review" size={18} />
          </IconButton>
          <IconButton label={tr("任务摘要")} active={summaryVisible} onClick={() => patchUi({ summaryOpen: !summaryVisible })}>
            <ListChecks size={18} />
          </IconButton>
          <Menu kind="action" label={tr('工作台更多操作')} value="" align="end" iconOnly className="task-actions-trigger" placeholder={<MoreHorizontal size={18} />} options={[
            { value: 'window', label: tr('在独立窗口打开') },
            { value: 'editor', label: tr('打开编辑器'), disabled: !project },
            { value: 'directories', label: tr('项目目录'), disabled: !project },
            { value: 'worktrees', label: tr('Worktree 管理'), disabled: !project },
            { value: 'goal', label: thread.goal ? tr('查看持续目标') : tr('设置持续目标'), disabled: !canManageTask },
            { value: 'subtasks', label: tr('查看子智能体'), disabled: !canManageTask },
            ...(parent ? [{ value: 'parent', label: tr('返回父任务') }] : []),
            { value: 'changes', label: tr('查看变更'), disabled: !project },
            { value: 'terminal', label: tr('集成终端'), disabled: !project },
            { value: 'browser', label: tr('浏览器预览') },
            { value: 'sidechat', label: tr('侧聊') },
          ]} onChange={value => {
            if (value === 'window') act({ op: 'window.open', kind: 'task', threadId: thread.id });
            if (value === 'editor') act({ op: 'file.open', threadId: activeId, path: '' });
            if (value === 'directories' || value === 'worktrees' || value === 'goal') setDialog(value);
            if (value === 'subtasks') openSubtask();
            if (value === 'parent' && parent) selectThread(parent);
            if (value === 'terminal') setTerminalOpen(true);
            if (value === 'browser') setPreviewOpen(true);
            if (value === 'changes' || value === 'sidechat') { setReviewTab(value); setReviewOpen(true); }
          }} />
          <ProjectDirectories key={'directories/' + thread.id} open={dialog === 'directories'} onOpenChange={open => setDialog(open ? 'directories' : undefined)} />
          <WorktreeManager key={'worktrees/' + thread.id} open={dialog === 'worktrees'} onOpenChange={open => setDialog(open ? 'worktrees' : undefined)} />
          {dialog === 'goal' && canManageTask && <GoalPanel key={thread.id} close={() => setDialog(undefined)} />}
        </div>
      )}
    </div>
  );
}
