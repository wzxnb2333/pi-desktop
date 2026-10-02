import type { PanelTab, ReviewTab, UiState, UiThread } from './contracts.ts';

const TOOL_KINDS: PanelTab['kind'][] = ['browser', 'changes', 'files', 'file', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask'];

export function isPanelKind(kind: ReviewTab): kind is PanelTab['kind'] {
  return TOOL_KINDS.includes(kind as PanelTab['kind']);
}

export const fileTabId = (path: string): string => 'file:' + path;
export const fileTabPath = (id: string): string => id.slice('file:'.length);

/**
 * Opened files own one panel tab each, derived from `openFiles` the same way browser tabs derive
 * from `browserTabs`; the persisted list is only an ordering cache and is re-derived per directory.
 */
export function panelTabs(ui: UiThread): PanelTab[] {
  const browsers = ui.browserTabs ?? [];
  const files = ui.openFiles ?? [];
  const result = (ui.panelTabs ?? []).filter((tab, index, all) =>
    all.findIndex(item => item.id === tab.id) === index
    && (tab.kind !== 'browser' || browsers.some(browser => browser.id === tab.id))
    && (tab.kind !== 'file' || files.includes(fileTabPath(tab.id))));
  for (const browser of browsers) if (!result.some(tab => tab.id === browser.id)) result.push({ id: browser.id, kind: 'browser' });
  // A file selection implies the navigator: it is the way back to the tree, and the fallback when a
  // directory has no open files of its own.
  if (isPanelKind(ui.reviewTab) && ui.reviewTab !== 'browser' && ui.reviewTab !== 'subtask' && !result.some(tab => tab.kind === (ui.reviewTab === 'file' ? 'files' : ui.reviewTab)))
    result.push(ui.reviewTab === 'file' ? { id: 'tool:files', kind: 'files' } : { id: 'tool:' + ui.reviewTab, kind: ui.reviewTab });
  // New file tabs join the navigator's group instead of landing behind every browser tab.
  const fileGroupEnd = () => {
    for (let index = result.length - 1; index >= 0; index--) {
      if (result[index].kind === 'files' || result[index].kind === 'file') return index + 1;
    }
    return result.length;
  };
  for (const path of files) {
    if (!result.some(tab => tab.id === fileTabId(path))) result.splice(fileGroupEnd(), 0, { id: fileTabId(path), kind: 'file' });
  }
  return result;
}

export function selectPanelTab(tab: PanelTab): Partial<UiThread> {
  return { reviewTab: tab.kind, activePanelTab: tab.id, terminalOpen: tab.kind === 'terminal', ...(tab.kind === 'browser' ? { activeBrowserTab: tab.id } : {}) };
}

/** Select a file as its own panel tab; `openFiles` drives the derived tab list. */
export function fileSelectionPatch(ui: UiThread, path: string, extra: Partial<UiThread> = {}): Partial<UiThread> {
  const openFiles = [...new Set([...(ui.openFiles ?? []), path])].filter(Boolean);
  return { ...selectPanelTab({ id: fileTabId(path), kind: 'file' }), selectedPath: path, openFiles, ...extra };
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
