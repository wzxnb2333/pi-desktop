import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Filter,
  Folder,
  FolderOpen,
  GitBranch,
  Inbox,
  Layers,
  Plus,
  PanelTopOpen,
  Search,
  SquarePen,
  Zap,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DEFAULT_APP_KEYBINDINGS, DEFAULT_GLOBAL_KEYBINDINGS } from '../../../../shared/shortcuts.ts';
import type { Thread } from '../../../../shared/contracts.ts';
import { statusText } from '../../lib/labels.ts';
import { groupThreadList } from '../../hooks/use-thread-list.ts';
import { useApp } from '../../state/app.tsx';
import { Button, IconButton } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Menu } from '../primitives/menu.tsx';
import { Tooltip } from '../primitives/tooltip.tsx';
import { StatusBar } from '../shell/status-bar.tsx';
import { ThreadActions } from './thread-actions.tsx';

function ThreadIndicator({ thread }: { thread: Thread }) {
  const unread = (thread.readAt ?? 0) < (thread.items.at(-1)?.timestamp ?? thread.createdAt);
  const active = thread.status !== 'idle';
  if (!active && !unread) return null;
  const label = [active ? statusText[thread.status] : '', unread ? tr('未读') : ''].filter(Boolean).join(' · ');
  return <span className={'thread-indicator' + (active ? ' thread-dot ' + thread.status : '') + (unread ? ' unread-marker' : '')} role="img" aria-label={label} title={label} />;
}

export function Sidebar({ width }: { width: number }) {
  useLocale();
  const {
    data,
    activeId,
    view,
    setView,
    selectThread,
    selectProject,
    createThread,
    addProject,
    act,
    showArchived,
    setShowArchived,
    project,
    ui, patchUi,
  } = useApp();
  const collapsed = ui.collapsedProjects ?? [];
  const [showTrash, setShowTrash] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [recentsOpen, setRecentsOpen] = useState(true);
  const [projectFilter, setProjectFilter] = useState('');
  const groups = useMemo(
    () =>
      showTrash ? data.projects.map(project => ({ project, threads: data.threads.filter(thread => !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && thread.projectId === project.id && thread.deletedAt) })) : groupThreadList({
        projects: data.projects,
        threads: data.threads,
        showArchived,
        search: '',
      }),
    [data.projects, data.threads, showArchived, showTrash],
  );

  const recentThreads = groups.filter(group => !projectFilter || group.project.id === projectFilter)
    .flatMap(group => group.threads).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const archivedCount = data.threads.filter((thread) => !!thread.projectId && !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && thread.archived && !thread.deletedAt).length;
  const pendingReview = data.threads.filter((thread) => !thread.subtaskId && thread.automationId && !thread.reviewed).length;
  const toggleProject = (id: string) =>
    patchUi({ collapsedProjects: collapsed.includes(id) ? collapsed.filter(item => item !== id) : [...collapsed, id] });

  return (
    <aside className="sidebar satang-sidebar" style={{ width }}>
      <header className="sidebar-heading">
        <Menu kind="action" label={tr("工作区菜单")} placeholder="Pi Desktop" className="sidebar-brand" value="" options={[
          { value: 'project', label: tr("添加项目") },
          { value: 'commands', label: tr("命令面板") }, { value: 'settings', label: tr("设置") },
        ]} onChange={value => {
          if (value === 'project') void addProject().catch(() => {});
          if (value === 'commands') window.dispatchEvent(new Event('pi:commands'));
          if (value === 'settings') setView('settings');
        }} />
        <IconButton label={tr("命令面板")} onClick={() => window.dispatchEvent(new Event('pi:commands'))}><Search size={16} /></IconButton>
      </header>
      <div className="sidebar-new-task">
      <Button className="nav-row new-thread" aria-label={tr('新建聊天')} title={project ? tr('在 {p0} 中开始项目聊天', { p0: project.name }) : tr('选择项目目录，处理文件与代码')} onClick={() => void (project ? createThread(project.id) : addProject()).catch(() => {})}>
        <SquarePen size={16} />
        <span className="new-thread-label">{tr('新建聊天')}</span><span className="row-hint" aria-hidden="true">{(data.settings.shortcuts?.newThread ?? DEFAULT_APP_KEYBINDINGS.newThread.keys).replaceAll('+', ' ')}</span>
      </Button>
        <Tooltip label={<>{tr('快捷聊天')} <kbd>{data.settings.shortcuts?.quickChat ?? DEFAULT_GLOBAL_KEYBINDINGS.quickChat.keys}</kbd></>}>
          <Button className="sidebar-quick-chat" aria-label={tr('快捷聊天')} onClick={() => act({ op: 'window.open', kind: 'quick' })}><PanelTopOpen size={16} aria-hidden="true" /></Button>
        </Tooltip>
      </div>
      <div className="sidebar-scroll">
      <nav className="primary-nav" aria-label={tr("工作区导航")}>
        <Button
          className={`nav-row ${view === 'inbox' ? 'active' : ''}`}
          aria-current={view === 'inbox' ? 'page' : undefined}
          onClick={() => setView('inbox')}
        >
          <Inbox size={16} />
          {tr("待审阅")} {!!pendingReview && <span className="row-count">{pendingReview}</span>}
        </Button>
        <Button
          className={`nav-row ${view === 'automations' ? 'active' : ''}`}
          aria-current={view === 'automations' ? 'page' : undefined}
          onClick={() => setView('automations')}
        >
          <Zap size={16} />
          {tr("自动化")} {!!data.automations.length && <span className="row-count">{data.automations.length}</span>}
        </Button>
        <Button
          className={`nav-row ${view === 'skills' ? 'active' : ''}`}
          aria-current={view === 'skills' ? 'page' : undefined}
          onClick={() => setView('skills')}
        >
          <Layers size={16} />
          {tr("Skills 与扩展")} </Button>
      </nav>
      {!!recentThreads.length && !showArchived && !showTrash && <section className="sidebar-recents" aria-label={tr('最近任务')}>
        <button className="section-label recents-heading" onClick={() => setRecentsOpen(!recentsOpen)} aria-expanded={recentsOpen}>
          {tr("最近任务")} {recentsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {recentsOpen && <div className="recent-list">{recentThreads.map(thread => <Button key={thread.id}
          className={'recent-thread' + (activeId === thread.id && view === 'thread' ? ' selected' : '')}
          aria-label={tr("最近任务：") + thread.title} title={thread.title} onClick={() => selectThread(thread)}>
          <span className="truncate">{thread.title}</span><ThreadIndicator thread={thread} />
        </Button>)}</div>}
      </section>}
      <section className="sidebar-project-chats" aria-label={showTrash ? tr('回收站') : showArchived ? tr('已归档') : tr('项目聊天')}>
      <div className="section-label">
        <span>{showTrash ? tr("回收站") : showArchived ? tr("已归档") : tr("项目聊天")}</span>
        <span className="project-filter" data-filtered={!!projectFilter || undefined}>
          <Filter size={14} aria-hidden="true" />
          <select aria-label={tr("项目筛选")} title={projectFilter ? data.projects.find(item => item.id === projectFilter)?.name : tr("全部项目")} value={projectFilter} onChange={event => setProjectFilter(event.target.value)}><option value="">{tr("全部项目")}</option>{data.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </span>
        <IconButton label={tr("添加项目")} onClick={() => void addProject()}>
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="project-list">
        {groups.filter(group => !projectFilter || group.project.id === projectFilter).map(({ project: item, threads }) => {
          const isCollapsed = collapsed.includes(item.id);
          return (
            <section key={item.id} className="project-group">
              <div className={`project-row ${project?.id === item.id ? 'current' : ''}`}>
                <IconButton label={`${isCollapsed ? tr("展开") : tr("折叠")} ${item.name}`} onClick={() => toggleProject(item.id)}>
                  <span className="project-folder-icon">{isCollapsed ? <Folder size={16} /> : <FolderOpen size={16} />}</span>
                  <span className="project-collapse-icon">{isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</span>
                </IconButton>
                <Button
                  className="project-name"
                  title={item.path}
                  onClick={() => {
                    if (isCollapsed) toggleProject(item.id);
                    const first = threads[0];
                    if (first) selectThread(first);
                    else selectProject(item.id);
                  }}
                >
                  <span className="truncate">{item.name}</span>
                  {!!threads.length && <span className="row-count">{threads.length}</span>}
                </Button>
                {/* `新建 {项目} 的任务` rather than `在 {项目} 新建任务`: the label must not contain the
                    generic `新建任务`, which the welcome page and the shortcut list already use. */}
                <IconButton label={tr("新建 {p0} 的任务", { p0: item.name })} onClick={() => void createThread(item.id)}>
                  <Plus size={14} />
                </IconButton>
              </div>
              {!isCollapsed &&
                threads.map((thread) => (
                  <div
                    key={thread.id}
                    onContextMenu={event => { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('[data-thread-menu] button')?.click(); }}
                    onKeyDown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('[data-thread-menu] button')?.click(); } }}
                    className={`thread-row ${activeId === thread.id && view === 'thread' ? 'selected' : ''}`}
                  >
                    <Button className="thread-main" title={thread.title} onClick={() => selectThread(thread)}>
                      <span className="truncate">{thread.title}</span>
                      {thread.pinned && <span title={tr("已置顶")}>{tr("置顶")}</span>}
                      {thread.worktreeBranch && <GitBranch size={12} />}
                    </Button>
                    <ThreadIndicator thread={thread} />
                    {/*
                      `归档此任务` / `恢复此任务`, deliberately not `归档任务：{title}`: `getByLabel` matches
                      substrings, so any label containing `归档任务` collides with the Review panel button
                      the app-level spec resolves by that name. A static label also keeps task titles out
                      of the accessible-name surface.
                    */}
                    <IconButton
                      label={thread.archived ? tr("恢复此任务") : tr("归档此任务")}
                      onClick={() => act({ op: 'thread.update', id: thread.id, archived: !thread.archived })}
                    >
                      {thread.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                    </IconButton>
                    <ThreadActions thread={thread} />
                  </div>
                ))}
            </section>
          );
        })}
        {!data.projects.length && (
          <p className="sidebar-empty">
            {tr("添加一个本地文件夹，")} <br />
            {tr("从项目开始工作。")} </p>
        )}
      </div>
      </section>
      </div>
      <footer className="sidebar-footer">
        <Menu kind="action" label={tr("本地工作区操作")} className="sidebar-profile" value="" side="top"
          placeholder={<><span className="sidebar-avatar" aria-hidden="true">π</span>{tr("本地工作区")}</>}
          options={[
            { value: 'settings', label: tr("设置") }, { value: 'project', label: tr("添加项目") },
            { value: 'archive', label: showArchived ? tr("查看活跃任务") : tr("已归档任务 (") + archivedCount + ')' },
            { value: 'trash', label: showTrash ? tr("退出回收站") : tr("回收站 (") + data.threads.filter(thread => !!thread.projectId && !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && thread.deletedAt).length + ')' },
            { value: 'info', label: tr("本地运行信息") },
          ]} onChange={value => {
            if (value === 'settings') setView('settings');
            if (value === 'project') void addProject().catch(() => {});
            if (value === 'archive') { setShowTrash(false); setShowArchived(!showArchived); }
            if (value === 'trash') { setShowTrash(!showTrash); setShowArchived(false); }
            if (value === 'info') setShowInfo(true);
          }} />
        <IconButton label={tr("本地运行信息")} onClick={() => setShowInfo(true)}><CircleHelp size={18} /></IconButton>
      </footer>
      {showInfo && <ConfirmDialog title={tr("本地运行信息")} description={<StatusBar inline />} confirmLabel={tr("关闭")} cancelLabel={tr("返回")}
        onConfirm={() => setShowInfo(false)} onCancel={() => setShowInfo(false)} />}
    </aside>
  );
}
