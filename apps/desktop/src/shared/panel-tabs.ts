import type { PanelTab, ReviewTab, UiState, UiThread } from './contracts.ts';

export function isPanelKind(kind: ReviewTab): kind is PanelTab['kind'] {
  return ['browser', 'changes', 'files', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask'].includes(kind);
}

/** Old profiles gain only the tool they were displaying; browser ownership stays in the browser service. */
export function panelTabs(ui: UiThread): PanelTab[] {
  const browsers = ui.browserTabs ?? [];
  const result = (ui.panelTabs ?? []).filter((tab, index, all) =>
    all.findIndex(item => item.id === tab.id) === index && (tab.kind !== 'browser' || browsers.some(browser => browser.id === tab.id)));
  for (const browser of browsers) if (!result.some(tab => tab.id === browser.id)) result.push({ id: browser.id, kind: 'browser' });
  if (isPanelKind(ui.reviewTab) && ui.reviewTab !== 'browser' && ui.reviewTab !== 'subtask' && !result.some(tab => tab.kind === ui.reviewTab))
    result.push({ id: 'tool:' + ui.reviewTab, kind: ui.reviewTab });
  return result;
}

export function selectPanelTab(tab: PanelTab): Partial<UiThread> {
  return { reviewTab: tab.kind, activePanelTab: tab.id, terminalOpen: tab.kind === 'terminal', ...(tab.kind === 'browser' ? { activeBrowserTab: tab.id } : {}) };
}

export function panelSelectionPatch(ui: UiThread, patch: Partial<UiThread>): Partial<UiThread> {
  if (!patch.reviewTab || !isPanelKind(patch.reviewTab)) return patch;
  return { ...patch, terminalOpen: patch.reviewTab === 'terminal', panelTabs: panelTabs({ ...ui, ...patch }) };
}

/** Existing main-process project actions request terminal visibility through terminalOpen. */
export function panelUiState(ui: UiState, previous?: UiState): UiState {
  let next = ui;
  for (const [id, thread] of Object.entries(ui.threads)) {
    if (!thread.terminalOpen || thread.reviewTab === 'terminal') continue;
    const navigated = !!previous?.threads[id] && previous.threads[id].reviewTab !== thread.reviewTab;
    const updated: UiThread = { ...thread, reviewTab: navigated ? thread.reviewTab : 'terminal', terminalOpen: !navigated };
    next = { ...next, reviewOpen: next.reviewOpen || (!navigated && id === ui.activeThreadId),
      threads: { ...next.threads, [id]: { ...updated, panelTabs: panelTabs({ ...updated, panelTabs: thread.panelTabs ?? panelTabs(thread) }) } } };
  }
  return next;
}
