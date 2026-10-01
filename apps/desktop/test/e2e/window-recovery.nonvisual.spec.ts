import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { expect, test } from '@playwright/test';
import type { BrowserWindow } from 'electron';
import type { Bootstrap, Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

interface WindowWriteGate { waiting: boolean; release(): void; restore(): void }
async function holdWindowWrite(fail: boolean) {
  await fixture.app.evaluate((_, input) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: WindowWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => {
      await write(...args); if (String(args[0]) !== input.path) return;
      if (gate.waiting) { if (input.fail) throw new Error('WINDOW_STORAGE_FAILURE'); return; }
      const data = JSON.parse(String(args[1])) as { windows?: Record<string, { open?: boolean }> };
      if (data.windows?.['task:t']?.open) { gate.waiting = true; await wait; if (input.fail) throw new Error('WINDOW_STORAGE_FAILURE'); }
    };
    syncBuiltinESMExports();
  }, { path: join(fixture.storage, 'desktop.json.tmp'), fail });
}
async function releaseWindowWrite(restore = true) {
  await fixture.app.evaluate((_, restore) => { const root = globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }; root.windowWriteGate?.release(); if (restore) { root.windowWriteGate?.restore(); delete root.windowWriteGate; } }, restore);
}

test('failed task window save leaves one editable owner and retry preserves draft and running task', async () => {
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'Keep my draft', attachments: [] } } });
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'Keep running', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    await expect.poll(() => fixture.app.windows().length).toBe(1);
    const snapshot = await fixture.snapshot(); expect(snapshot.data.ui.activeThreadId).toBe('t'); expect(snapshot.data.ui.threads.t.draft?.text).toBe('Keep my draft');
    expect(snapshot.data.threads.find(thread => thread.id === 't')?.status).toBe('running');
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const target = fixture.app.windows().find(page => page !== fixture.page)!;
  await expect(target.getByLabel('向 Pi 发送消息')).toHaveValue('Keep my draft');
  expect((await fixture.snapshot()).data.ui.activeThreadId).toBe('');
  fixture.release(); await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === 't')?.status).toBe('idle'); expect(fixture.calls).toHaveLength(1);
});

test('reopening a task whose original window now shows another chat opens the requested task', async () => {
  const other = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const first = fixture.app.windows().find(page => page !== fixture.page)!;
  await first.evaluate(async id => { const boot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap; await window.desktop.invoke({ op: 'ui.update', ui: boot.data.ui, frame: { activeThreadId: id } }); }, other.id);
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const states = await Promise.all(fixture.app.windows().map(page => page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.ui.activeThreadId)));
  expect(states.filter(id => id === 't')).toHaveLength(1); expect(states.filter(id => id === other.id)).toHaveLength(1);
  expect(fixture.calls).toHaveLength(0);
});

test('pending window transfer stays hidden and failure preserves newer source navigation and layout', async () => {
  const other = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.threadPatch', threadId: other.id, patch: { draft: { text: 'Another draft', attachments: [] } } });
  await holdWindowWrite(true); const opening = fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' }).then(() => '', error => String(error));
  try {
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate?.waiting)).toBe(true);
    expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(1);
    await fixture.invoke({ op: 'ui.update', ui: (await fixture.snapshot()).data.ui, frame: { activeThreadId: 't' } });
    expect((await fixture.snapshot()).data.ui.activeThreadId).toBe('');
    await expect(fixture.invoke({ op: 'thread.send', id: 't', text: 'Do not duplicate', attachments: [] })).rejects.toThrow(/另一个窗口|正在打开/);
    await fixture.invoke({ op: 'ui.update', ui: (await fixture.snapshot()).data.ui, frame: { activeThreadId: other.id, sidebarWidth: 333, locale: 'en-US' } });
  } finally { await releaseWindowWrite(false); try { expect(await opening).toContain('WINDOW_STORAGE_FAILURE'); } finally { await releaseWindowWrite(); } }
  await expect.poll(() => fixture.app.windows().length).toBe(1);
  const ui = (await fixture.snapshot()).data.ui; expect(ui.activeThreadId).toBe(other.id); expect(ui.sidebarWidth).toBe(333); expect(ui.locale).toBe('en-US'); expect(ui.threads[other.id].draft?.text).toBe('Another draft');
  expect(fixture.calls).toHaveLength(0); await fixture.restart(); expect((await fixture.snapshot()).data.ui.activeThreadId).toBe(other.id); expect(fixture.app.windows()).toHaveLength(1);
});

test('duplicate window opens await the same commit and leave one editor after restart', async () => {
  await holdWindowWrite(false); const first = fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  let completed = false; let second: Promise<unknown> | undefined;
  try {
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate?.waiting)).toBe(true);
    second = fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' }).then(value => { completed = true; return value; });
    await expect.poll(() => fixture.app.windows().length).toBe(2); expect(completed).toBe(false);
    expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(1);
  } finally { await releaseWindowWrite(); await first; await second; }
  expect(completed).toBe(true); expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(2);
  await fixture.restart(); await expect.poll(() => fixture.app.windows().length).toBe(2);
  const states = await Promise.all(fixture.app.windows().map(page => page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.ui.activeThreadId)));
  expect(states.filter(id => id === 't')).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
});

test('shutdown waits for pending window transfer and does not restore its cancelled destination', async () => {
  await holdWindowWrite(false); const opening = fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' }).then(() => '', error => String(error));
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate?.waiting)).toBe(true);
  await fixture.app.evaluate(() => { setTimeout(() => { const gate = (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate; gate?.release(); gate?.restore(); }, 100); });
  await fixture.restart(); await opening;
  expect((await fixture.snapshot()).data.ui.activeThreadId).toBe('t'); expect((await fixture.snapshot()).data.windows?.['task:t']?.open).not.toBe(true); expect(fixture.app.windows()).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
});

test('renderer loading failure restores the source and a later window request succeeds', async () => {
  await fixture.app.evaluate(({ BrowserWindow }) => {
    const load = BrowserWindow.prototype.loadURL, mainId = BrowserWindow.getAllWindows()[0].id;
    (globalThis as typeof globalThis & { restoreWindowLoad?: () => void }).restoreWindowLoad = () => { BrowserWindow.prototype.loadURL = load; };
    BrowserWindow.prototype.loadURL = function(...args: Parameters<typeof load>) { return this.id === mainId ? load.apply(this, args) : Promise.reject(new Error('WINDOW_LOAD_FAILURE')); };
  });
  try { await expect(fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' })).rejects.toThrow('WINDOW_LOAD_FAILURE'); }
  finally { await fixture.app.evaluate(() => { (globalThis as typeof globalThis & { restoreWindowLoad?: () => void }).restoreWindowLoad?.(); }); }
  expect(fixture.app.windows()).toHaveLength(1); expect((await fixture.snapshot()).data.ui.activeThreadId).toBe('t');
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' }); expect(fixture.app.windows()).toHaveLength(2); expect(fixture.calls).toHaveLength(0);
});

test('restoring a maximized window remains hidden until its save commits', async () => {
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  const original = fixture.app.windows().find(page => page !== fixture.page)!;
  await (await fixture.app.browserWindow(original)).evaluate((window: BrowserWindow) => window.maximize());
  await expect.poll(async () => (await fixture.snapshot()).data.windows?.['task:t'].maximized).toBe(true);
  await (await fixture.app.browserWindow(original)).evaluate((window: BrowserWindow) => window.close());
  await expect.poll(() => fixture.app.windows().length).toBe(1);
  await holdWindowWrite(false); const opening = fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  try {
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { windowWriteGate?: WindowWriteGate }).windowWriteGate?.waiting)).toBe(true);
    expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => window.isVisible()).length)).toBe(1);
  } finally { await releaseWindowWrite(); await opening; }
  const restored = fixture.app.windows().find(page => page !== fixture.page)!;
  expect(await (await fixture.app.browserWindow(restored)).evaluate((window: BrowserWindow) => window.isMaximized())).toBe(true); expect(fixture.calls).toHaveLength(0);
});

test('one failed restored window leaves the main app usable and its task can reopen', async () => {
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'Restart draft', attachments: [] } } });
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' });
  let documents = 0;
  const failSecondDocument = (request: IncomingMessage) => { if (request.url === '/' && ++documents >= 2) request.destroy(); };
  development.server.httpServer!.prependListener('request', failSecondDocument);
  try {
    await fixture.restart();
    await expect.poll(async () => (await fixture.snapshot()).data.windows?.['task:t']?.open).toBe(false);
    expect(fixture.app.windows()).toHaveLength(1); expect((await fixture.snapshot()).data.ui.activeThreadId).toBe('t');
    await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('Restart draft');
    await expect(fixture.page.getByRole('alert')).toContainText('任务窗口未能恢复');
    await fixture.invoke({ op: 'ui.update', ui: (await fixture.snapshot()).data.ui, frame: { locale: 'en-US' } });
    await expect(fixture.page.getByRole('alert')).toContainText('A task window could not be restored');
  } finally { development.server.httpServer!.removeListener('request', failSecondDocument); }
  await fixture.invoke({ op: 'window.open', kind: 'task', threadId: 't' }); expect(fixture.app.windows()).toHaveLength(2); expect(fixture.calls).toHaveLength(0);
});
