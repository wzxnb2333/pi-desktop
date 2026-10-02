import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { type Thread, type UiState, type UiThread, uiThreadSchema } from '../shared/contracts.ts';
import { desktopViewTargetSchema, type DesktopViewTarget } from '../shared/harness-tools.ts';
import { fileSelectionPatch, fileTabId, panelTabs, selectPanelTab } from '../shared/panel-tabs.ts';
import { directoryThreadUi, directoryUiPatch } from '../shared/project-directories.ts';
import { artifactKind } from './artifact-files.ts';
import { safeProjectPath } from './policy.ts';
import { readProjectFile } from './files.ts';

interface ViewContext { windowId: number; thread: Thread; ui: UiState; }
interface ViewRuntime {
  context(): ViewContext | undefined;
  directory(id?: string): { id: string; path: string };
  sidechat(id?: string): string | undefined;
  subtask(id: string): boolean;
  publish(windowId: number, threadPatch: Partial<UiThread>, framePatch: Partial<UiState>): void;
}

/** Display existing product views only; never starts reviews, shells, browsers or external apps. */
export async function openDesktopView(runtime: ViewRuntime, raw: DesktopViewTarget, signal: AbortSignal) {
  const target = desktopViewTargetSchema.parse(raw);
  signal.throwIfAborted();
  const initial = runtime.context();
  if (!initial) return { status: 'not_opened', reason: 'view_inactive' };
  const identity = ({ windowId, thread, ui }: ViewContext) => {
    if (thread.subtaskId || thread.review || thread.sidechat?.temporary || thread.deletedAt || thread.archived) throw new Error('此会话不能打开桌面视图');
    const view = ui.threads[thread.id];
    return JSON.stringify([windowId, thread.id, ui.activeThreadId, ui.view, ui.reviewOpen, ui.summaryOpen, thread.artifacts, view?.reviewTab,
      view?.activePanelTab, view?.activeBrowserTab, view?.browserTabs, view?.panelTabs, view?.sidechatId, view?.directoryId, view?.selectedPath, view?.fileLocation, view?.directoryViews]);
  };
  const before = identity(initial);
  if (initial.ui.view !== 'thread' || initial.ui.activeThreadId !== initial.thread.id) return { status: 'not_opened', reason: 'view_inactive' };
  const directory = target.kind === 'file' || target.kind === 'artifact' || target.kind === 'files' || target.kind === 'changes' || target.kind === 'review' ? runtime.directory(target.directoryId) : undefined;
  const browser = target.kind === 'browser' ? (initial.ui.threads[initial.thread.id]?.browserTabs ?? []).find(tab => tab.id === (target.tabId ?? initial.ui.threads[initial.thread.id]?.activeBrowserTab)) : undefined;
  const sidechatId = target.kind === 'sidechat' ? runtime.sidechat(target.sidechatId) : undefined;
  if (target.kind === 'browser' && !browser) return { status: 'not_opened', reason: 'browser_tab_missing' };
  if (target.kind === 'sidechat' && !sidechatId) return { status: 'not_opened', reason: 'sidechat_missing' };
  if (target.kind === 'subtask' && !runtime.subtask(target.subtaskId)) return { status: 'not_opened', reason: 'subtask_missing' };
  let path: string | undefined;
  if (target.kind === 'file') {
    const absolute = await safeProjectPath(directory!.path, target.path);
    signal.throwIfAborted();
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error('请选择普通文件');
    const pdf = /\.pdf$/i.test(absolute);
    if (info.size > (pdf ? 50 * 1024 * 1024 : 10 * 1024 * 1024)) throw new Error('文件超过内置预览大小限制');
    if (target.line !== undefined && (pdf || (await readProjectFile(directory!.path, absolute)).kind !== 'text')) throw new Error('此文件不支持代码行定位');
    path = relative(directory!.path, absolute).replaceAll('\\', '/');
  }
  if (target.kind === 'artifact') {
    const absolute = await safeProjectPath(directory!.path, target.path);
    signal.throwIfAborted();
    const normalized = relative(directory!.path, absolute).replaceAll('\\', '/');
    const listed = initial.thread.artifacts.some(item => relative(directory!.path, resolve(directory!.path, item)).replaceAll('\\', '/') === normalized);
    if (!listed) throw new Error('只能打开当前任务产物');
    const info = await stat(absolute);
    if (!info.isFile()) throw new Error('请选择有效的任务产物');
    if (info.size > 50 * 1024 * 1024) throw new Error('任务产物超过内置预览大小限制');
    artifactKind(normalized);
    path = normalized;
  }
  signal.throwIfAborted();
  const current = runtime.context();
  if (!current || identity(current) !== before) return { status: 'not_opened', reason: 'navigation_changed' };
  // Recheck directory ownership after async file validation, before publishing anything.
  if (directory) {
    const latest = runtime.directory(directory.id);
    if (latest.path !== directory.path) throw new Error('工作目录已变化，请重新打开视图');
  }
  const ui = current.ui.threads[current.thread.id] ?? uiThreadSchema.parse({});
  let threadPatch: Partial<UiThread> = {}, framePatch: Partial<UiState>;
  if (target.kind === 'summary') framePatch = { summaryOpen: true };
  else if (target.kind === 'browser') {
    const tab = { id: browser!.id, kind: 'browser' as const };
    const tabs = panelTabs(ui);
    threadPatch = { ...selectPanelTab(tab), panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] };
    framePatch = { reviewOpen: true };
  }
  else if (target.kind === 'terminal') {
    const tab = { id: 'tool:terminal', kind: 'terminal' as const };
    const tabs = panelTabs(ui);
    threadPatch = { ...selectPanelTab(tab), panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] };
    framePatch = { reviewOpen: true };
  }
  else if (target.kind === 'subtask') {
    const tab = { id: 'subtask:' + target.subtaskId, kind: 'subtask' as const };
    const tabs = panelTabs(ui);
    threadPatch = { ...selectPanelTab(tab), panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] };
    framePatch = { reviewOpen: true };
  }
  else if (target.kind === 'sidechat') {
    const tab = { id: 'tool:sidechat', kind: 'sidechat' as const };
    const tabs = panelTabs(ui);
    threadPatch = { ...selectPanelTab(tab), sidechatId: sidechatId!, panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] };
    framePatch = { reviewOpen: true };
  }
  else if (target.kind === 'file' || target.kind === 'artifact') {
    const executionId = current.thread.directoryId ?? current.thread.projectId;
    const view = directoryThreadUi(ui, directory!.id, executionId);
    const tabs = panelTabs(ui), tab = { id: fileTabId(path!), kind: 'file' as const };
    threadPatch = {
      ...directoryUiPatch(ui, fileSelectionPatch(view, path!, target.kind === 'file' && target.line !== undefined
        ? { fileLocation: { id: crypto.randomUUID(), path: path!, line: target.line, ...(target.column === undefined ? {} : { column: target.column }) } }
        : { fileLocation: undefined }), directory!.id, executionId),
      directoryId: directory!.id,
      panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab],
    };
    framePatch = { reviewOpen: true };
  }
  else {
    const kind = target.kind;
    const tabs = panelTabs(ui), tab = tabs.find(tab => tab.kind === kind) ?? { id: 'tool:' + kind, kind };
    threadPatch = { ...selectPanelTab(tab), panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] };
    if (directory) threadPatch.directoryId = directory.id;
    framePatch = { reviewOpen: true };
  }
  uiThreadSchema.parse({ ...ui, ...threadPatch });
  runtime.publish(current.windowId, threadPatch, framePatch);
  return { status: 'opened', kind: target.kind, ...(directory ? { directoryId: directory.id } : {}), ...(path ? { path } : {}), ...(sidechatId ? { sidechatId } : {}) };
}
