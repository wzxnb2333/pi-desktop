import { access, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Bootstrap, Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

interface ChatWriteGate { waiting: boolean; release(): void; restore(): void }
async function holdChatWrite(threadId: string, projectId: string) {
  await fixture.app.evaluate((_, input) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: ChatWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { chatWriteGate?: ChatWriteGate }).chatWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => {
      await write(...args); if (String(args[0]) !== input.path || gate.waiting) return;
      const data = JSON.parse(String(args[1])) as { threads: { id: string; projectId: string }[] };
      if (data.threads.some(thread => thread.id === input.threadId && thread.projectId === input.projectId)) { gate.waiting = true; await wait; }
    };
    syncBuiltinESMExports();
  }, { path: join(fixture.storage, 'desktop.json.tmp'), threadId, projectId });
}
async function waitForChatWrite() {
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { chatWriteGate?: ChatWriteGate }).chatWriteGate?.waiting)).toBe(true);
}
async function releaseChatWrite() {
  await fixture.app.evaluate(() => { const root = globalThis as typeof globalThis & { chatWriteGate?: ChatWriteGate }; root.chatWriteGate?.release(); root.chatWriteGate?.restore(); delete root.chatWriteGate; });
}

test('failed standalone creation never publishes a ghost chat and leaves no empty workspace', async () => {
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'thread.create', projectId: '', worktree: false })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(0);
    expect(await readdir(join(fixture.storage, 'chat-workspaces'))).toEqual([]);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  const created = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.find(thread => thread.id === created.id)?.projectId).toBe('');
});

test('failed directory binding keeps the standalone permission boundary and allows retry', async () => {
  const chat = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.threadPatch', threadId: chat.id, patch: { draft: { text: 'Keep this draft', attachments: [] } } });
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'thread.bindProject', id: chat.id, projectId: 'p' })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    const after = (await fixture.snapshot()).data.threads.find(thread => thread.id === chat.id)!; expect(after.projectId).toBe(''); expect(after.cwd).toBe(chat.cwd);
    await expect(fixture.invoke({ op: 'file.read', threadId: chat.id, path: 'README.md' })).rejects.toThrow(/绑定项目/);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'thread.bindProject', id: chat.id, projectId: 'p' });
  expect((await fixture.snapshot()).data.ui.threads[chat.id].draft?.text).toBe('Keep this draft'); await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === chat.id)?.cwd).toBe(fixture.project); expect(fixture.calls).toHaveLength(0);
});

test('concurrent standalone creation waits for one durable chat and retry after restart reuses its identity', async () => {
  const requestId = crypto.randomUUID(); await holdChatWrite(requestId, '');
  const creating = fixture.invoke({ op: 'chat.create', requestId }); let retry: Promise<unknown> | undefined, completed = false;
  try {
    await waitForChatWrite(); expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(0);
    retry = fixture.invoke({ op: 'chat.create', requestId }).then(value => { completed = true; return value; });
    await fixture.snapshot(); expect(completed).toBe(false);
  } finally { await releaseChatWrite(); await creating; await retry; }
  expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(1); expect(await readdir(join(fixture.storage, 'chat-workspaces'))).toEqual([requestId]);
  await fixture.restart(); const restored = await fixture.invoke({ op: 'chat.create', requestId }) as Thread; expect(restored.id).toBe(requestId);
  expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
});

test('quick window loading failure keeps one reusable chat across retry and restart', async () => {
  await fixture.app.evaluate(({ BrowserWindow }) => {
    const load = BrowserWindow.prototype.loadURL, mainId = BrowserWindow.getAllWindows()[0].id;
    (globalThis as typeof globalThis & { restoreChatWindowLoad?: () => void }).restoreChatWindowLoad = () => { BrowserWindow.prototype.loadURL = load; };
    BrowserWindow.prototype.loadURL = function(...args: Parameters<typeof load>) { return this.id === mainId ? load.apply(this, args) : Promise.reject(new Error('QUICK_LOAD_FAILURE')); };
  });
  try { await expect(fixture.invoke({ op: 'window.open', kind: 'quick' })).rejects.toThrow('QUICK_LOAD_FAILURE'); }
  finally { await fixture.app.evaluate(() => { (globalThis as typeof globalThis & { restoreChatWindowLoad?: () => void }).restoreChatWindowLoad?.(); }); }
  const snapshot = await fixture.snapshot(), chat = snapshot.data.threads.find(thread => !thread.projectId)!;
  expect(snapshot.data.threads.filter(thread => !thread.projectId)).toHaveLength(1); expect(snapshot.data.windows?.quick.frame.activeThreadId).toBe(chat.id); expect(snapshot.data.windows?.quick.open).toBe(false);
  await fixture.invoke({ op: 'ui.threadPatch', threadId: chat.id, patch: { draft: { text: 'Recover quick draft', attachments: [] } } });
  await fixture.restart(); await fixture.invoke({ op: 'window.open', kind: 'quick' });
  const quick = fixture.app.windows().find(page => page !== fixture.page)!;
  expect((await quick.evaluate(async () => await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap)).data.ui.activeThreadId).toBe(chat.id);
  await expect(quick.getByLabel('向 Pi 发送消息')).toHaveValue('Recover quick draft');
  expect((await fixture.snapshot()).data.threads.filter(thread => !thread.projectId)).toHaveLength(1); expect(await readdir(join(fixture.storage, 'chat-workspaces'))).toEqual([chat.id]); expect(fixture.calls).toHaveLength(0);
});

test('pending binding blocks runtime changes and keeps newer typing through commit and restart', async () => {
  const chat = await fixture.invoke({ op: 'chat.create', requestId: crypto.randomUUID() }) as Thread;
  await holdChatWrite(chat.id, 'p'); const binding = fixture.invoke({ op: 'thread.bindProject', id: chat.id, projectId: 'p' });
  try {
    await waitForChatWrite(); expect((await fixture.snapshot()).data.threads.find(thread => thread.id === chat.id)?.projectId).toBe('');
    await expect(fixture.invoke({ op: 'thread.send', id: chat.id, text: 'Wait for binding', attachments: [] })).rejects.toThrow(/正在绑定/);
    await expect(fixture.invoke({ op: 'thread.resume', id: chat.id })).rejects.toThrow(/正在绑定/);
    await expect(fixture.invoke({ op: 'mcp.retry', threadId: chat.id })).rejects.toThrow(/正在绑定/);
    await expect(fixture.invoke({ op: 'thread.update', id: chat.id, policy: 'auto' })).rejects.toThrow(/正在绑定/);
    await fixture.invoke({ op: 'ui.threadPatch', threadId: chat.id, patch: { draft: { text: 'New typing while binding', attachments: [] } } });
  } finally { await releaseChatWrite(); await binding; }
  await fixture.invoke({ op: 'thread.bindProject', id: chat.id, projectId: 'p' }); await fixture.restart();
  const snapshot = await fixture.snapshot(); expect(snapshot.data.threads.find(thread => thread.id === chat.id)?.cwd).toBe(fixture.project); expect(snapshot.data.ui.threads[chat.id].draft?.text).toBe('New typing while binding'); expect(fixture.calls).toHaveLength(0);
});

for (const operation of ['create', 'bind'] as const) test('shutdown cancels private chat ' + operation + ' and preserves the previous durable state', async () => {
  const id = crypto.randomUUID(); if (operation === 'bind') await fixture.invoke({ op: 'chat.create', requestId: id });
  await holdChatWrite(id, operation === 'bind' ? 'p' : '');
  const pending = fixture.invoke(operation === 'bind' ? { op: 'thread.bindProject', id, projectId: 'p' } : { op: 'chat.create', requestId: id }).then(() => 'unexpected success', error => String(error));
  await waitForChatWrite();
  await fixture.app.evaluate(() => { setTimeout(() => { const gate = (globalThis as typeof globalThis & { chatWriteGate?: ChatWriteGate }).chatWriteGate; gate?.release(); gate?.restore(); }, 100); });
  await fixture.restart(); expect(await pending).not.toBe('unexpected success');
  const saved = (await fixture.snapshot()).data.threads.find(thread => thread.id === id);
  if (operation === 'create') { expect(saved).toBeUndefined(); expect(await readdir(join(fixture.storage, 'chat-workspaces'))).toEqual([]); }
  else { expect(saved?.projectId).toBe(''); expect(saved?.cwd).toBe(join(fixture.storage, 'chat-workspaces', id)); }
  expect(fixture.calls).toHaveLength(0);
});
