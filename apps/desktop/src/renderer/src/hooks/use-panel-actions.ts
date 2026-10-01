import { useEffect, useRef, useState } from 'react';
import type { PanelTab } from '../../../shared/contracts.ts';
import { panelTabs, selectPanelTab } from '../../../shared/panel-tabs.ts';
import { useApp } from '../state/app.tsx';

/** One controller for the toolbar, palette and native webpage keyboard commands. */
export function usePanelActions() {
  const { thread, activeId, threadUi, reviewTab, reviewOpen, view, patchThread, invoke } = useApp();
  const changing = useRef(new Set<string>());
  const [pendingThreads, setPendingThreads] = useState<string[]>([]);
  useEffect(() => {
    if (thread && reviewOpen && view === 'thread' && !threadUi.panelTabs) patchThread({ panelTabs: panelTabs(threadUi) });
  }, [activeId, threadUi, thread, reviewOpen, view, patchThread]);
  const tabs = !threadUi.panelTabs && (!reviewOpen || view !== 'thread') ? [] : panelTabs(threadUi);
  const visibleTabs: PanelTab[] = !tabs.length || (reviewTab === 'browser' && !tabs.some(tab => tab.kind === 'browser'))
    ? [...tabs, { id: 'empty', kind: 'browser' }] : tabs;
  const selected = visibleTabs.find(tab => tab.kind === reviewTab && tab.id === (tab.kind === 'browser' ? threadUi.activeBrowserTab : threadUi.activePanelTab))
    ?? visibleTabs.find(tab => tab.kind === reviewTab) ?? visibleTabs[0];
  const change = async (action: () => Promise<void>) => {
    if (!thread || changing.current.has(activeId)) return false;
    changing.current.add(activeId); setPendingThreads([...changing.current]);
    try { await action(); return true; }
    catch { return false; /* invoke reports the actionable error in the application notice. */ }
    finally { changing.current.delete(activeId); setPendingThreads([...changing.current]); }
  };
  const select = (id: string) => {
    if (!thread || changing.current.has(activeId)) return;
    const tab = visibleTabs.find(item => item.id === id);
    if (tab) patchThread(selectPanelTab(tab), activeId);
  };
  const close = (id: string) => change(async () => {
    const index = visibleTabs.findIndex(tab => tab.id === id);
    if (index < 0) return;
    const closing = visibleTabs[index];
    const remaining = visibleTabs.filter(tab => tab.id !== id && tab.id !== 'empty');
    const next = remaining[Math.min(index, remaining.length - 1)];
    // Keep the visible tab if the native close fails. Closing a tool never kills its service.
    if (closing.kind === 'browser' && id !== 'empty') await invoke({ op: 'browser.tab', threadId: activeId, action: 'close', tabId: id });
    patchThread({ panelTabs: remaining, ...(selected.id === id ? next ? selectPanelTab(next) : { reviewTab: 'browser', terminalOpen: false, activeBrowserTab: '' } : {}) }, activeId);
  });
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
  return { visibleTabs, selected, pending: pendingThreads.includes(activeId), select, close, openTool, openBrowser };
}

export type PanelActions = ReturnType<typeof usePanelActions>;
