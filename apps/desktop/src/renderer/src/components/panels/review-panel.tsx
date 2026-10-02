import { File, FileSearch, Folder, GitBranch, Globe, MessageCircle, Network, Plus, RefreshCw, Terminal, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import type { PanelTab } from '../../../../shared/contracts.ts';
import { fileTabPath } from '../../../../shared/panel-tabs.ts';
import { tr } from '../../../../shared/localization.ts';
import { projectDirectories } from '../../../../shared/project-directories.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import type { PanelActions } from '../../hooks/use-panel-actions.ts';
import { useTaskGit } from '../../hooks/use-task-git.ts';
import { fileBufferDirty, fileBuffers } from '../../lib/file-buffers.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { Tabs } from '../primitives/tabs.tsx';
import { FileNavigatorPanel, FileTabPanel } from './files-panel.tsx';
import { GitPanel } from './git-panel.tsx';
import { PreviewPanel } from './preview-panel.tsx';
import { ReviewFindings } from './review-findings.tsx';
import { SidechatPanel } from './sidechat-panel.tsx';
import { TerminalSection } from './terminal-section.tsx';
import { SubtaskConversation, SubtaskPanel } from './subtask-panel.tsx';

const icons = { browser: Globe, changes: GitBranch, files: Folder, file: File, sidechat: MessageCircle, review: FileSearch, terminal: Terminal, subtasks: Network, subtask: Network };

export function ReviewPanel({ width, actions }: { width: number; actions: PanelActions }) {
  useLocale();
  const { thread, activeId, threadUi, data, directory, fileScopeId, setReviewOpen, project, directoryId, selectDirectory } = useApp();
  const buffers = useSyncExternalStore(fileBuffers.subscribe, fileBuffers.snapshot);
  const { git, reload: refreshGit } = useTaskGit();
  const { visibleTabs, selected, pending, select, close: closeTab, openTool, openBrowser, fileCloseRequest, fileCloseBlocked, confirmFileClose, cancelFileClose } = actions;
  if (!thread) return null;
  const names = { browser: tr('新标签'), changes: tr('变更'), files: tr('文件'), sidechat: tr('侧聊'), review: tr('审查'), terminal: tr('终端'), subtasks: tr('子智能体'), subtask: tr('子智能体会话') };
  const title = (tab: PanelTab) => tab.kind === 'file' ? fileTabPath(tab.id) : tab.kind === 'subtask' ? data.subtasks.find(record => 'subtask:' + record.id === tab.id && record.parentThreadId === activeId)?.definition.title || names.subtask : tab.kind === 'browser'
    ? (threadUi.browserTabs?.find(browser => browser.id === tab.id)?.url ? threadUi.browserTabs.find(browser => browser.id === tab.id)?.title : '') || names.browser : names[tab.kind];
  const launcher = <div className="tool-launcher">
    <h2>{tr('工具')}</h2>
    {(['review', 'terminal', 'sidechat', 'files', 'subtasks'] as const).map(kind => {
      const Icon = icons[kind];
      return <button key={kind} type="button" disabled={pending || (!['sidechat', 'subtasks'].includes(kind) && !project)} onClick={() => openTool(kind)}>
        <Icon size={16} aria-hidden="true" /><span>{names[kind]}</span>
      </button>;
    })}
  </div>;
  const blocked = fileCloseBlocked?.threadId === activeId && fileCloseBlocked.scope === fileScopeId ? fileCloseBlocked : undefined;
  return <aside className="review-pane" style={{ width }} aria-label={tr('任务辅助栏')}>
    <div className="workspace-tab-header panel-strip">
      <Tabs className="workspace-tabs browser-tabs" ariaLabel={tr('辅助栏')} value={selected.id}
        onChange={select}
        onClose={closeTab} items={visibleTabs.map(tab => {
          const Icon = icons[tab.kind]; const label = title(tab);
          const marked = tab.kind === 'file' && (() => { const buffer = buffers.get(fileScopeId + '/' + fileTabPath(tab.id)); return !!buffer?.saving || fileBufferDirty(buffer); })();
          const text = tab.kind === 'file' ? label.split(/[\\/]/).at(-1) + (marked ? ' *' : '') : label;
          return { id: tab.id, label: <><Icon size={14} aria-hidden="true" /><span className="workspace-tab-title" title={label}>{text}</span></>, closeLabel: tab.kind === 'file' ? tr('关闭文件 ') + label : tr('关闭') + ' ' + label };
        })} />
      <div className="workspace-tab-actions">
        <IconButton label={tr('新标签')} size="sm" disabled={pending} onClick={() => void openBrowser()}><Plus size={15} /></IconButton>
        <IconButton label={selected.kind === 'browser' ? tr('隐藏浏览器') : tr('关闭辅助栏')} size="sm" onClick={() => setReviewOpen(false)}><X size={15} /></IconButton>
      </div>
    </div>
    {['changes', 'files', 'file', 'review'].includes(selected.kind) && project && (project.directories?.length ?? 0) > 0 && <Menu label={tr('浏览目录与仓库')} value={directoryId} size="sm"
      options={projectDirectories(project).map(directory => ({ value: directory.id, label: directory.name + ' · ' + directory.path }))} onChange={selectDirectory} />}
    <div className={'review-content review-tool-content' + (selected.kind === 'changes' ? ' review-changes' : '')}>
      {(selected.kind === 'browser' || !!threadUi.browserTabs?.length) && <PreviewPanel key={activeId} active={selected.kind === 'browser'} pending={pending} launcher={launcher} />}
      {selected.kind === 'review' && <ReviewFindings key={fileScopeId} />}
      {(selected.kind === 'files' || selected.kind === 'file') && <FileNavigatorPanel key={fileScopeId} hidden={selected.kind !== 'files'} />}
      {selected.kind === 'file' && <FileTabPanel key={fileScopeId + '/' + selected.id} path={fileTabPath(selected.id)} blockedClose={blocked?.path === fileTabPath(selected.id)} />}
      {selected.kind === 'sidechat' && <SidechatPanel key={activeId} />}
      {selected.kind === 'subtasks' && <SubtaskPanel key={activeId} />}
      {visibleTabs.filter(tab => tab.kind === 'subtask').map(tab => <SubtaskConversation key={activeId + '/' + tab.id} id={tab.id.slice('subtask:'.length)} hidden={selected.id !== tab.id} />)}
      {selected.kind === 'terminal' && <TerminalSection />}
      {selected.kind === 'changes' && <><div className="workspace-tool-actions"><IconButton label={tr('刷新 Git')} size="sm" onClick={() => void refreshGit()}><RefreshCw size={14} /></IconButton></div><GitPanel key={fileScopeId} status={git} refresh={refreshGit} /></>}
      {blocked && !(selected.kind === 'file' && fileTabPath(selected.id) === blocked.path) && <div role="alert" className="file-navigation-error"><p>{tr('正在保存 {p0}，请完成后再关闭或重新加载。', { p0: blocked.path })}</p></div>}
    </div>
    {fileCloseRequest && fileCloseRequest.threadId === activeId && fileCloseRequest.scope === fileScopeId && <ConfirmDialog
      title={tr('放弃未保存的文件修改？')} description={(directory?.name ? directory.name + ' / ' : '') + fileCloseRequest.path}
      confirmLabel={tr('放弃修改')} danger onConfirm={() => void confirmFileClose()} onCancel={cancelFileClose} />}
  </aside>;
}
