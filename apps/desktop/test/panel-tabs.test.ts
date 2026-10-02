import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSchema, uiSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { fileSelectionPatch, panelSelectionPatch, panelTabs, panelUiState, selectPanelTab } from '../src/shared/panel-tabs.ts';

test('legacy profiles keep browser ownership and add only the selected tool', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'files', browserTabs: [{ id: 'a', url: '', title: '' }] });
  assert.deepEqual(panelTabs(ui), [{ id: 'a', kind: 'browser' }, { id: 'tool:files', kind: 'files' }]);
  assert.equal(ui.panelTabs, undefined);
});

test('mixed order survives hydration, filters closed browsers and deduplicates identities', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'browser', browserTabs: [{ id: 'b', url: '', title: '' }, { id: 'new', url: '', title: '' }],
    panelTabs: [{ id: 'tool:files', kind: 'files' }, { id: 'removed', kind: 'browser' }, { id: 'b', kind: 'browser' }, { id: 'b', kind: 'browser' }] });
  assert.deepEqual(panelTabs(ui), [{ id: 'tool:files', kind: 'files' }, { id: 'b', kind: 'browser' }, { id: 'new', kind: 'browser' }]);
  assert.equal(requestSchema.parse({ op: 'ui.threadPatch', threadId: 't', patch: { panelTabs: panelTabs(ui), reviewTab: 'terminal' } }).op, 'ui.threadPatch');
});

test('tool selection keeps the active browser and leaving terminal clears the legacy open request', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'browser', activeBrowserTab: 'a', browserTabs: [{ id: 'a', url: '', title: '' }] });
  const terminal = panelSelectionPatch(ui, selectPanelTab({ id: 'tool:terminal', kind: 'terminal' }));
  assert.equal(terminal.terminalOpen, true);
  assert.equal(terminal.activeBrowserTab, undefined);
  const browser = panelSelectionPatch({ ...ui, ...terminal }, selectPanelTab({ id: 'a', kind: 'browser' }));
  assert.equal(browser.terminalOpen, false);
  assert.equal(browser.activeBrowserTab, 'a');
  assert.equal(browser.panelTabs?.length, 2);
});

test('main-process terminal requests select a tool without reopening a deliberately hidden pane', () => {
  const ui = uiSchema.parse({ activeThreadId: 't', reviewOpen: false, threads: { t: { reviewTab: 'files', terminalOpen: true }, other: { reviewTab: 'browser' } } });
  const next = panelUiState(ui);
  assert.equal(next.reviewOpen, true);
  assert.equal(next.threads.t.reviewTab, 'terminal');
  assert.equal(next.threads.other, ui.threads.other);
  assert.equal(panelUiState({ ...next, reviewOpen: false }).reviewOpen, false);
  assert.equal(ui.threads.t.reviewTab, 'files');
});

test('main-process sidechat navigation wins over a previous terminal visibility flag', () => {
  const previous = uiSchema.parse({ activeThreadId: 't', reviewOpen: true, threads: { t: { reviewTab: 'terminal', terminalOpen: true } } });
  const next = panelUiState({ ...previous, threads: { t: { ...previous.threads.t, reviewTab: 'sidechat', sidechatId: 'child' } } }, previous);
  assert.equal(next.threads.t.reviewTab, 'sidechat');
  assert.equal(next.threads.t.terminalOpen, false);
});

test('separate child conversation selections persist through validated UI patches', () => {
  const tabs = [{ id: 'subtask:a', kind: 'subtask' }, { id: 'subtask:b', kind: 'subtask' }] as const;
  const first = uiThreadSchema.parse({ panelTabs: tabs, ...selectPanelTab(tabs[0]) });
  const next = panelSelectionPatch(first, selectPanelTab(tabs[1]));
  const request = requestSchema.parse({ op: 'ui.threadPatch', threadId: 'parent', patch: next });
  assert.equal(request.op, 'ui.threadPatch');
  assert.equal(next.activePanelTab, 'subtask:b'); assert.equal(next.panelTabs?.length, 2);
  assert.equal(panelTabs(uiThreadSchema.parse({ reviewTab: 'subtask', panelTabs: [] })).length, 0);
});

test('opened files own one panel tab each, derived from openFiles', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'files', openFiles: ['a.txt', 'b.txt'] });
  assert.deepEqual(panelTabs(ui), [{ id: 'tool:files', kind: 'files' }, { id: 'file:a.txt', kind: 'file' }, { id: 'file:b.txt', kind: 'file' }]);
});

test('persisted file tabs follow openFiles and new files join the navigator group', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'file', activePanelTab: 'file:c.txt', openFiles: ['a.txt', 'c.txt'], browserTabs: [{ id: 'b', url: '', title: '' }],
    panelTabs: [{ id: 'tool:files', kind: 'files' }, { id: 'file:a.txt', kind: 'file' }, { id: 'file:gone.txt', kind: 'file' }, { id: 'b', kind: 'browser' }] });
  assert.deepEqual(panelTabs(ui), [
    { id: 'tool:files', kind: 'files' }, { id: 'file:a.txt', kind: 'file' }, { id: 'file:c.txt', kind: 'file' }, { id: 'b', kind: 'browser' },
  ]);
});

test('selecting a file tab keeps file view state on the thread patch', () => {
  const ui = uiThreadSchema.parse({ reviewTab: 'files', openFiles: ['a.txt'] });
  const patch = fileSelectionPatch(ui, 'b.txt', { fileLocation: undefined });
  assert.equal(patch.reviewTab, 'file');
  assert.equal(patch.activePanelTab, 'file:b.txt');
  assert.deepEqual(patch.openFiles, ['a.txt', 'b.txt']);
  assert.equal(patch.fileLocation, undefined);
  const request = requestSchema.parse({ op: 'ui.threadPatch', threadId: 't', patch: panelSelectionPatch({ ...ui, ...patch }, patch) });
  assert.equal(request.op, 'ui.threadPatch');
});
