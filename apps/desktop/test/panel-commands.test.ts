import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopEventSchema } from '../src/shared/contracts.ts';
import { DEFAULT_APP_KEYBINDINGS, panelCommand, shortcutConflicts } from '../src/shared/shortcuts.ts';

const key = { key: 't', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false };

test('panel commands use the reference open shortcuts and configurable scoped bindings', () => {
  assert.equal(DEFAULT_APP_KEYBINDINGS.openBrowser.keys, 'Ctrl+T');
  assert.equal(DEFAULT_APP_KEYBINDINGS.openReview.keys, 'Ctrl+Shift+G');
  assert.equal(panelCommand(key), 'openBrowser');
  assert.equal(panelCommand({ ...key, key: 'g', shiftKey: true }), 'openReview');
  assert.equal(panelCommand({ ...key, key: 'w' }), 'closePanelTab');
  assert.equal(panelCommand({ ...key, key: 'Tab' }), 'nextPanelTab');
  assert.equal(panelCommand({ ...key, key: 'Tab', shiftKey: true }), 'previousPanelTab');
  assert.equal(panelCommand(key, { openBrowser: '' }), undefined);
  assert.equal(panelCommand(key, { openBrowser: 'Alt+B' }), undefined);
  assert.equal(panelCommand({ ...key, key: 'b', ctrlKey: false, altKey: true }, { openBrowser: 'Alt+B' }), 'openBrowser');
  assert.equal(panelCommand({ ...key, key: 'w', ctrlKey: false }), undefined);
});

test('panel shortcuts conflict with overlapping scopes but leave shell bindings independent', () => {
  assert.deepEqual(shortcutConflicts(), []);
  assert.equal(shortcutConflicts({ openBrowser: 'Ctrl+N' }).length, 1);
  assert.equal(shortcutConflicts({ closePanelTab: 'Ctrl+T' }).length, 1);
  assert.equal(shortcutConflicts({ nextPanelTab: 'Enter' }).length, 3);
  assert.deepEqual(shortcutConflicts({ terminalFindNext: 'Ctrl+W' }), []);
});

test('native page commands only carry validated panel actions and ownership', () => {
  const event = { type: 'panel.command', threadId: 'thread', tabId: 'tab', command: 'closePanelTab' };
  assert.deepEqual(desktopEventSchema.parse(event), event);
  assert.equal(desktopEventSchema.safeParse({ ...event, command: 'newThread' }).success, false);
  assert.equal(desktopEventSchema.safeParse({ ...event, threadId: undefined }).success, false);
});
