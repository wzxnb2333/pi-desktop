import { useEffect, useRef, useState } from 'react';
import type { PanelTab } from '../../../shared/contracts.ts';
import { fileTabId, fileTabPath, panelTabs, selectPanelTab } from '../../../shared/panel-tabs.ts';
import { tr } from '../../../shared/localization.ts';
import { fileBufferDirty, fileBuffers } from '../lib/file-buffers.ts';
import { useApp } from '../state/app.tsx';

interface FileCloseRequest { threadId: string; scope: string; path: string; content: string; version?: string; }
interface FileCloseBlocked { threadId: string; scope: string; path: string; }

/** One controller for the toolbar, palette and native webpage keyboard commands. */
export function usePanelActions() {
  const { thread, activeId, threadUi, reviewTab, reviewOpen, view, fileScopeId, patchThread, invoke, setError } = useApp();
  const changing = useRef(new Set<string>());
  const [pendingThreads, setPendingThreads] = useState<string[]>([]);
  const [fileCloseRequest, setFileCloseRequest] = useState<FileCloseRequest>();
  const [fileCloseBlocked, setFileCloseBlocked] = useState<FileCloseBlocked>();
  useEffect(() => {
    if (thread && reviewOpen && view === 'thread' && !threadUi.panelTabs) patchThread({ panelTabs: panelTabs(threadUi) });
  }, [activeId, threadUi, thread, reviewOpen, view, patchThread]);
  // The close guards belong to their originating task/directory; a context switch must not act on a new file.
  useEffect(() => { setFileCloseRequest(undefined); setFileCloseBlocked(undefined); }, [activeId, fileScopeId]);
  useEffect(() => fileBuffers.subscribe(() => {
    setFileCloseBlocked(blocked => blocked && !fileBuffers.snapshot().get(blocked.scope + '/' + blocked.path)?.saving ? undefined : blocked);
  }), []);
  const tabs = !threadUi.panelTabs && (!reviewOpen || view !== 'thread') ? [] : panelTabs(threadUi);
  const visibleTabs: PanelTab[] = !tabs.length || (reviewTab === 'browser' && !tabs.some(tab => tab.kind === 'browser'))
    ? [...tabs, { id: 'empty', kind: 'browser' }] : tabs;
  const selected = visibleTabs.find(tab => tab.kind === reviewTab && tab.id === (tab.kind === 'browser' ? threadUi.activeBrowserTab : threadUi.activePanelTab))
    ?? visibleTabs.find(tab => tab.kind === reviewTab) ?? visibleTabs[0];
  const change = async (action: () => Promise<boolean | void>) => {
    if (!thread || changing.current.has(activeId)) return false;
    changing.current.add(activeId); setPendingThreads([...changing.current]);
    try { return await action() ?? true; }
    catch { return false; /* invoke reports the actionable error in the application notice. */ }
    finally { changing.current.delete(activeId); setPendingThreads([...changing.current]); }
  };
  const select = (id: string) => {
    if (!thread || changing.current.has(activeId)) return;
    const tab = visibleTabs.find(item => item.id === id);
    // selectedPath tracks the file the reader is on: recents, the Git workbench and the harness view read it.
    if (tab) patchThread({ ...selectPanelTab(tab), ...(tab.kind === 'file' ? { selectedPath: fileTabPath(tab.id) } : {}) }, activeId);
  };
  const performClose = async (id: string) => {
    const index = visibleTabs.findIndex(tab => tab.id === id);
    if (index < 0) return false;
    const closing = visibleTabs[index];
    const remaining = visibleTabs.filter(tab => tab.id !== id && tab.id !== 'empty');
    const next = remaining[Math.min(index, remaining.length - 1)];
    // Keep the visible tab if the native close fails. Closing a tool never kills its service.
    if (closing.kind === 'browser' && id !== 'empty') await invoke({ op: 'browser.tab', threadId: activeId, action: 'close', tabId: id });
    const files = closing.kind === 'file' ? (threadUi.openFiles ?? []).filter(path => path !== fileTabPath(id)) : undefined;
    const nextPath = files && threadUi.selectedPath === fileTabPath(id)
      ? next?.kind === 'file' ? fileTabPath(next.id) : files.at(-1) ?? ''
      : undefined;
    patchThread({
      panelTabs: remaining,
      ...(files ? { openFiles: files } : {}),
      ...(nextPath !== undefined ? { selectedPath: nextPath } : {}),
      ...(selected.id === id ? next ? selectPanelTab(next) : { reviewTab: 'browser', terminalOpen: false, activeBrowserTab: '' } : {}),
    }, activeId);
    return true;
  };
  const close = (id: string) => {
    const closing = visibleTabs.find(tab => tab.id === id);
    if (closing?.kind !== 'file') return change(() => performClose(id));
    const path = fileTabPath(id);
    const key = fileScopeId + '/' + path;
    const buffer = fileBuffers.snapshot().get(key);
    if (buffer?.saving) { setFileCloseBlocked({ threadId: activeId, scope: fileScopeId, path }); return Promise.resolve(false); }
    if (fileBufferDirty(buffer)) {
      setFileCloseRequest({ threadId: activeId, scope: fileScopeId, path, content: buffer?.content ?? '', version: buffer?.file?.version });
      return Promise.resolve(false);
    }
    return change(async () => {
      // A dispatched write cannot be cancelled; an in-flight save blocks the discard.
      if (!fileBuffers.discard(key)) { setFileCloseBlocked({ threadId: activeId, scope: fileScopeId, path }); return false; }
      setFileCloseRequest(undefined);
      return performClose(id);
    });
  };
  const confirmFileClose = () => {
    const request = fileCloseRequest;
    if (!request) return Promise.resolve(false);
    return change(async () => {
      const current = fileBuffers.snapshot().get(request.scope + '/' + request.path);
      if (current?.saving) { setFileCloseBlocked({ threadId: activeId, scope: request.scope, path: request.path }); setFileCloseRequest(undefined); return false; }
      if (current?.loading) return false;
      if (current?.content !== request.content || current?.file?.version !== request.version) {
        setError(tr('文件内容已变化，未丢弃修改。请核对后重新操作。'));
        setFileCloseRequest(undefined);
        return false;
      }
      fileBuffers.discard(request.scope + '/' + request.path);
      setFileCloseRequest(undefined);
      return performClose(fileTabId(request.path));
    });
  };
  const cancelFileClose = () => setFileCloseRequest(undefined);
  const openTool = (kind: Exclude<PanelTab['kind'], 'browser' | 'subtask'>) => change(async () => {
    const blank = selected.kind === 'browser' && !threadUi.browserTabs?.find(tab => tab.id === selected.id)?.url;
    const tool = tabs.find(tab => tab.kind === kind) ?? { id: 'tool:' + kind, kind };
    const next = tabs.filter(tab => tab.id !== tool.id && (!blank || tab.id !== selected.id));
    next.splice(blank ? Math.min(visibleTabs.indexOf(selected), next.length) : next.length, 0, tool);
    if (blank && selected.id !== 'empty') await invoke({ op: 'browser.tab', threadId: activeId, action: 'close', tabId: selected.id });
    patchThread({ ...selectPanelTab(tool), panelTabs: next }, activeId);
  });
  const openBrowser = () => change(async () => {
    await invoke({ op: 'browser.tab', threadId: activeId, action: 'new' });
    patchThread({ reviewTab: 'browser', terminalOpen: false }, activeId);
  });
  return { visibleTabs, selected, pending: pendingThreads.includes(activeId), select, close, openTool, openBrowser, fileCloseRequest, fileCloseBlocked, confirmFileClose, cancelFileClose };
}

export type PanelActions = ReturnType<typeof usePanelActions>;
