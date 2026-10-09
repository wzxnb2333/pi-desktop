import { tr } from "../../../../shared/localization.ts";
import { appUpdateSchema } from '../../../../shared/contracts.ts';
import { useLocale } from "../../hooks/use-locale.ts";
import { ArrowLeft, ArrowRight, Maximize2, Minus, X } from 'lucide-react';
import { useState } from 'react';
import { useWorkspaceHistory } from '../../hooks/use-workspace-history.ts';
import { dispatchWorkbenchCommand } from '../../lib/workbench-command.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { ReferenceIcon } from '../primitives/reference-icon.tsx';
import { StatusBar } from './status-bar.tsx';

export function Titlebar() {
  useLocale();
  const app = useApp();
  const { act, sidebarOpen, setSidebarOpen } = app;
  const history = useWorkspaceHistory(app);
  const [showInfo, setShowInfo] = useState(false);
  const [update, setUpdate] = useState<{ status: 'checking' } | ReturnType<typeof appUpdateSchema.parse>>();
  const checkUpdate = () => {
    setUpdate({ status: 'checking' });
    void app.invoke({ op: 'app.updateCheck' }).then(value => setUpdate(appUpdateSchema.parse(value))).catch(() => setUpdate({ status: 'unavailable', currentVersion: '', url: 'https://github.com/wzxnb2333/pi-desktop/releases/latest', message: tr('暂时无法检查更新') }));
  };
  return (
    <header className="titlebar">
      <div className="titlebar-navigation">
        <IconButton label={tr("切换侧栏")} active={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
          <ReferenceIcon name="sidebar" size={16} />
        </IconButton>
        <IconButton label={tr("后退")} disabled={!history.canBack} onClick={history.back}><ArrowLeft size={16} /></IconButton>
        <IconButton label={tr("前进")} disabled={!history.canForward} onClick={history.forward}><ArrowRight size={16} /></IconButton>
      </div>
      <nav className="titlebar-menus" aria-label={tr("应用菜单")}>
        <Menu kind="action" label={tr("文件菜单")} placeholder={tr("menu.file")} value="" options={[
          { value: 'new', label: tr("新建任务") }, { value: 'project', label: tr("添加项目") },
          { value: 'reopen', label: tr("重新打开任务"), disabled: !app.ui.closedThreads?.some(id => app.data.threads.some(thread => thread.id === id && !thread.deletedAt)) },
          { value: 'settings', label: tr("设置") }, { value: 'close', label: tr("关闭窗口") },
        ]} onChange={value => {
          if (value === 'new') dispatchWorkbenchCommand('newThread');
          if (value === 'project') void app.addProject().catch(() => {});
          if (value === 'reopen') dispatchWorkbenchCommand('reopen');
          if (value === 'settings') app.setView('settings');
          if (value === 'close') act({ op: 'window', action: 'close' });
        }} />
        <Menu kind="action" label={tr("编辑菜单")} placeholder={tr("编辑")} value="" options={[
          { value: 'find', label: tr("查找当前对话"), disabled: !app.thread?.items.length },
          { value: 'search', label: tr("搜索任务") }, { value: 'input', label: tr("聚焦输入框"), disabled: !app.thread },
        ]} onChange={value => {
          if (value === 'find') dispatchWorkbenchCommand('find');
          if (value === 'search') dispatchWorkbenchCommand('searchThreads');
          if (value === 'input') { app.setView('thread'); requestAnimationFrame(() => app.composerRef.current?.focus()); }
        }} />
        <Menu kind="action" label={tr("视图菜单")} placeholder={tr("视图")} value="" options={[
          { value: 'sidebar', label: sidebarOpen ? tr("隐藏侧栏") : tr("显示侧栏") },
          { value: 'terminal', label: tr("切换集成终端"), disabled: !app.thread },
          { value: 'editor', label: tr("打开编辑器"), disabled: !app.thread },
          { value: 'review', label: tr("查看变更"), disabled: !app.thread },
          { value: 'preview', label: tr("切换浏览器预览"), disabled: !app.thread },
          { value: 'summary', label: tr("任务摘要"), disabled: !app.thread },
        ]} onChange={value => {
          if (value === 'sidebar') setSidebarOpen(!sidebarOpen);
          if (value === 'terminal') dispatchWorkbenchCommand('terminal');
          if (value === 'editor') act({ op: 'file.open', threadId: app.activeId, path: '' });
          if (value === 'summary') dispatchWorkbenchCommand('summary');
          if (value === 'review' || value === 'preview') {
            const tab = value === 'review' ? 'changes' : 'browser';
            app.setView('thread'); app.setReviewTab(tab); app.setReviewOpen(!(app.reviewOpen && app.reviewTab === tab));
          }
        }} />
        <Menu kind="action" label={tr("帮助菜单")} placeholder={tr("帮助")} value="" options={[
          { value: 'commands', label: tr("命令面板") }, { value: 'update', label: tr("检查更新") }, { value: 'info', label: tr("本地运行信息") },
        ]} onChange={value => value === 'commands' ? dispatchWorkbenchCommand('commands') : value === 'update' ? checkUpdate() : setShowInfo(true)} />
      </nav>
      <div className="window-controls">
        <IconButton label={tr("最小化")} onClick={() => act({ op: 'window', action: 'minimize' })}>
          <Minus size={15} />
        </IconButton>
        <IconButton label={tr("最大化")} onClick={() => act({ op: 'window', action: 'maximize' })}>
          <Maximize2 size={13} />
        </IconButton>
        <IconButton label={tr("关闭窗口")} onClick={() => act({ op: 'window', action: 'close' })}>
          <X size={17} />
        </IconButton>
      </div>
      {showInfo && <ConfirmDialog title={tr("本地运行信息")} description={<StatusBar inline />} confirmLabel={tr("关闭")} cancelLabel={tr("返回")}
        onConfirm={() => setShowInfo(false)} onCancel={() => setShowInfo(false)} />}
      {update && <ConfirmDialog title={tr("检查更新")} description={update.status === 'checking' ? tr('正在检查更新') : update.status === 'available' ? tr('发现新版本 {p0}', { p0: update.latestVersion ?? '' }) : update.message ?? tr('当前已是最新版本')} confirmLabel={update.status === 'available' ? tr('打开下载页') : tr('关闭')} cancelLabel={tr('返回')} pending={update.status === 'checking'}
        onConfirm={() => { if (update.status === 'available') void app.invoke({ op: 'app.updateOpen' }); setUpdate(undefined); }} onCancel={() => setUpdate(undefined)} />}
    </header>
  );
}
