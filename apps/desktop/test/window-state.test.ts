import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrowserWindow } from 'electron';
import { defaultData, threadSchema } from '../src/shared/contracts.ts';
import { subtaskSchema } from '../src/shared/subtasks.ts';
import { WindowState } from '../src/main/window-state.ts';

test('restored child windows resolve to a parent owner without creating another editor', () => {
  const data = defaultData(), id = crypto.randomUUID();
  data.threads.push(threadSchema.parse({ id: 'child', subtaskId: id, title: 'Child', projectId: '', cwd: 'unused', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' }));
  data.subtasks.push(subtaskSchema.parse({ id, childThreadId: 'child', parentThreadId: 'parent', definition: { title: 'Child', prompt: 'Read', environment: 'local', policy: 'deny' }, context: '', status: 'succeeded', stage: '', createdAt: 1 }));
  const window = (id: number) => ({ id, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {} }) as unknown as BrowserWindow;
  const main = window(1), restored = window(2), state = new WindowState(() => data);
  data.ui.activeThreadId = 'parent'; state.register(main, 'main', 'main');
  state.register(restored, 'task:child', 'task', 'child');
  assert.equal(state.ui(restored).activeThreadId, ''); assert.equal(state.owner('parent')?.window, main);
  assert.equal(state.owner('child'), undefined);
});

test('windows share drafts and locale while retaining independent navigation and exclusive task ownership', () => {
  const data = defaultData();
  data.ui.activeThreadId = 'first';
  data.ui.threads.first = { reviewTab: 'files', selectedPath: 'README.md', terminalOpen: false, folds: {}, draft: { text: '保留', attachments: [] } };
  let focused = 0;
  const window = (id: number) => ({ id, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() { focused = id; } }) as unknown as BrowserWindow;
  const main = window(1); const task = window(2);
  const state = new WindowState(() => data);
  state.register(main, 'main', 'main');
  state.register(task, 'task:second', 'task', 'second');
  state.update(task, { ...state.ui(task), sidebarWidth: 390, locale: 'en-US' });
  assert.equal(state.ui(main).sidebarWidth, 275);
  assert.equal(state.ui(main).locale, 'en-US');
  state.update(main, { ...state.ui(main), activeThreadId: 'second' });
  assert.equal(focused, 2);
  assert.equal(state.ui(main).activeThreadId, 'first');
  assert.throws(() => state.assertEditable(main, 'second'), /另一个窗口/);
  assert.equal(state.ui(task).threads.first.draft?.text, '保留');
  state.release(task);
  state.update(main, { ...state.ui(main), activeThreadId: 'second' });
  assert.equal(state.ui(main).activeThreadId, 'second');
  assert.equal(data.windows?.['task:second'].open, false);
});

test('a transferring task cannot acquire another editor before its destination is registered', () => {
  const data = defaultData(); data.ui.activeThreadId = 'task';
  let shown = 0;
  const window = (id: number) => ({ id, isDestroyed: () => false, isMinimized: () => false, show() { shown++; }, focus() {} }) as unknown as BrowserWindow;
  const main = window(1), target = window(2), state = new WindowState(() => data);
  state.register(main, 'main', 'main'); const release = state.beginTransfer('task'); state.detach(main);
  state.update(main, { ...state.ui(main), activeThreadId: 'task' }); assert.equal(state.ui(main).activeThreadId, '');
  assert.throws(() => state.assertEditable(main, 'task'), /正在打开/); assert.throws(() => state.beginTransfer('task'), /正在打开/);
  state.register(target, 'task:task', 'task', 'task'); state.focus(target); assert.equal(shown, 0);
  state.update(main, { ...state.ui(main), activeThreadId: 'other', sidebarWidth: 321 }); assert.equal(state.ui(main).activeThreadId, 'other');
  release(); state.focus(target); assert.equal(shown, 1); state.assertEditable(target, 'task');
  assert.throws(() => state.assertEditable(main, 'task'), /另一个窗口/); assert.equal(state.ui(main).sidebarWidth, 321);
});

test('failed transfers release ownership without changing another window navigation or shared drafts', () => {
  const data = defaultData(); data.ui.activeThreadId = 'task';
  const window = (id: number) => ({ id, isDestroyed: () => false, isMinimized: () => false, show() {}, focus() {} }) as unknown as BrowserWindow;
  const main = window(1), target = window(2), state = new WindowState(() => data);
  state.register(main, 'main', 'main'); const release = state.beginTransfer('task'); state.detach(main);
  state.register(target, 'task:task', 'task', 'task'); state.update(main, { ...state.ui(main), activeThreadId: 'other', locale: 'en-US' });
  state.release(target); release(); const next = state.beginTransfer('task'); release();
  assert.throws(() => state.assertEditable(main, 'task'), /正在打开/); next(); state.assertEditable(main, 'task');
  assert.equal(state.ui(main).activeThreadId, 'other'); assert.equal(state.ui(main).locale, 'en-US'); assert.equal(state.owner('task'), undefined);
});
