import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Thread } from '../../src/shared/contracts.ts';
import type { MemoryEntry, MemorySnapshot } from '../../src/shared/memories.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
async function memories() { return await fixture.invoke({ op: 'memory.list' }) as MemorySnapshot; }
async function send(text: string, id = 't') { await fixture.invoke({ op: 'thread.send', id, text, attachments: [] }); }
async function idle(id = 't') { await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === id)?.status).toBe('idle'); }
async function panel() { await fixture.page.keyboard.press('Control+,'); await fixture.page.getByRole('button', { name: '跨会话记忆', exact: true }).click(); return fixture.page.locator('.memory-settings'); }
async function generated() { return (await fixture.snapshot()).data.operations.filter(item => item.kind === 'memory.generate'); }
function system(index: number) { return JSON.stringify(fixture.calls[index].messages.filter(item => item.role === 'system' || item.role === 'developer')); }
interface MemoryWriteGate { waiting: boolean; release(): void; restore(): void; }

test('memory settings preserve bilingual drafts and isolate project context across actual model rounds and restart', async () => {
  fixture.setMode('hold'); await send('FIRST_NO_MEMORY'); await expect.poll(() => fixture.calls.length).toBe(1);
  const ui = await panel(); await expect(ui.getByLabel('使用已确认的记忆', { exact: true })).not.toBeChecked(); await expect(ui.getByLabel('自动生成记忆候选', { exact: true })).not.toBeChecked();
  await ui.getByRole('button', { name: '新增记忆', exact: true }).click(); await ui.getByLabel('记忆内容', { exact: true }).fill('GLOBAL_PREFERENCE 简洁表达');
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['dark', 'light'] as const) for (const size of [[1440, 940], [1000, 700], [1280, 800]]) {
    const snapshot = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale } }); await fixture.invoke({ op: 'settings.patch', patch: { theme } });
    await fixture.app.evaluate(({ BrowserWindow }, dimensions) => BrowserWindow.getAllWindows()[0].setContentSize(dimensions[0], dimensions[1]), size);
    await expect.poll(() => ui.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
  }
  await expect(ui.getByLabel('Memory text', { exact: true })).toHaveValue('GLOBAL_PREFERENCE 简洁表达');
  await ui.getByRole('button', { name: 'Save and approve memory', exact: true }).click(); await expect.poll(async () => (await memories()).entries.length).toBe(1);
  await ui.getByLabel('Use approved memories', { exact: true }).check(); await fixture.page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.settings.memory.enabled).toBe(true); expect((await fixture.snapshot()).data.threads[0].status).toBe('running');
  await fixture.invoke({ op: 'memory.save', scope: { kind: 'project', projectId: 'p' }, text: 'PROJECT_ONLY fact', enabled: true });
  fixture.release(); await idle(); await send('NEXT_ROUND'); await idle(); expect(system(0)).not.toContain('GLOBAL_PREFERENCE'); expect(system(1)).toContain('GLOBAL_PREFERENCE'); expect(system(1)).toContain('PROJECT_ONLY');
  const standalone = await fixture.invoke({ op: 'thread.create', projectId: '', worktree: false }) as Thread;
  await send('STANDALONE_SCOPE', standalone.id); await idle(standalone.id); expect(system(2)).toContain('GLOBAL_PREFERENCE'); expect(system(2)).not.toContain('PROJECT_ONLY');
  const global = (await memories()).entries.find(entry => entry.scope.kind === 'user')!; await fixture.invoke({ op: 'memory.delete', id: global.id, revision: global.revision });
  await send('AFTER_DELETION', standalone.id); await idle(standalone.id); expect(system(3)).not.toContain('GLOBAL_PREFERENCE');
  await fixture.invoke({ op: 'settings.patch', patch: { memory: { enabled: false, autoGenerate: false } } }); await send('DISABLED'); await idle(); expect(system(4)).not.toContain('PROJECT_ONLY');
  await fixture.restart(); expect((await memories()).entries.map(entry => entry.text)).toEqual(['PROJECT_ONLY fact']); expect((await fixture.snapshot()).data.settings.memory.enabled).toBe(false);
  expect(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')).not.toContain('GLOBAL_PREFERENCE 简洁表达');
});

test('actual memory inference excludes tools and attachments, preserves sources and requires explicit approval', async () => {
  await fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'private-credential-123' });
  fixture.requestTool('read', { path: 'README.md' }); await send('以后请使用中文\nAPI_KEY=private-credential-123'); await idle();
  const source = (await fixture.snapshot()).data.threads[0].items.find(item => item.role === 'user')!;
  fixture.setReply(JSON.stringify({ memories: [{ text: '用户希望使用简体中文', messageIds: [source.id] }, { text: 'password=must-never-save', messageIds: [source.id] }] }));
  const count = fixture.calls.length, ui = await panel(); await ui.getByRole('button', { name: '从聊天生成候选', exact: true }).click();
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('succeeded'); expect(fixture.calls.length).toBe(count + 1);
  expect(fixture.calls.at(-1)?.tools ?? []).toHaveLength(0); const payload = JSON.stringify(fixture.calls.at(-1)?.messages); expect(payload).not.toContain('private-credential-123'); expect(payload).not.toContain('# Acceptance');
  let entry = (await memories()).entries[0]; expect(entry.status).toBe('candidate'); expect(entry.enabled).toBe(false); expect((await memories()).entries).toHaveLength(1); expect(entry.source.messageIds).toEqual([source.id]);
  await ui.getByRole('button', { name: '编辑或确认', exact: true }).click(); await ui.getByLabel('记忆内容', { exact: true }).fill('用户希望使用中文，保持简洁'); await ui.getByRole('button', { name: '保存并确认记忆', exact: true }).click();
  await expect.poll(async () => (await memories()).entries[0].status).toBe('approved'); entry = (await memories()).entries[0]; expect(entry.source.messageIds).toEqual([source.id]);
  await expect(fixture.invoke({ op: 'memory.save', ...{ id: entry.id, revision: 1, scope: entry.scope, text: 'stale', enabled: true } })).rejects.toThrow(/已被修改/);
  await fixture.restart(); expect((await memories()).entries[0].text).toBe('用户希望使用中文，保持简洁');
  await fixture.invoke({ op: 'memory.delete', id: entry.id, revision: entry.revision }); await fixture.restart(); expect((await memories()).entries).toHaveLength(0);
  expect(await readFile(join(fixture.storage, 'memories.json'), 'utf8')).not.toContain('用户希望使用中文');
});

test('opt-in background generation handles cancellation, invalid responses and restart without interrupting chat', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { memory: { enabled: false, autoGenerate: true } } });
  fixture.setMode('hold'); await send('这个项目使用 PowerShell'); await expect.poll(() => fixture.calls.length).toBe(1);
  const source = (await fixture.snapshot()).data.threads[0].items.find(item => item.role === 'user')!;
  fixture.setReply(JSON.stringify({ memories: [{ text: '项目使用 PowerShell', messageIds: [source.id] }] })); fixture.release(); await idle();
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('succeeded'); expect(fixture.calls).toHaveLength(2); expect((await memories()).entries[0].scope).toEqual({ kind: 'project', projectId: 'p' });
  await fixture.invoke({ op: 'settings.patch', patch: { memory: { enabled: false, autoGenerate: false } } }); fixture.setReply('ordinary reply'); await send('新的长期偏好：简洁输出'); await idle();
  fixture.setMode('hold'); const requestId = crypto.randomUUID(); await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId });
  await expect.poll(() => fixture.calls.length).toBe(4); const current = await memories(); await fixture.invoke({ op: 'memory.clear', revision: current.revision });
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('cancelled'); expect((await memories()).entries).toHaveLength(0); expect((await fixture.snapshot()).data.threads[0].status).toBe('idle');
  fixture.setMode('reply'); fixture.setReply('invalid result'); await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId: crypto.randomUUID() });
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('failed'); expect((await generated()).at(-1)?.error).toContain('有效记忆');
  fixture.setMode('hold'); await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId: crypto.randomUUID() }); await expect.poll(() => fixture.calls.length).toBe(6);
  await fixture.restart(); const calls = fixture.calls.length; expect(['cancelled', 'interrupted']).toContain((await generated()).at(-1)?.status); expect((await memories()).entries).toHaveLength(0); expect(fixture.calls.length).toBe(calls);
});

test('memory cancellation before publication removes staged candidates and permits retry after restart', async () => {
  await send('这个项目只运行本地测试'); await idle(); const source = (await fixture.snapshot()).data.threads[0].items.find(item => item.role === 'user')!;
  fixture.setReply(JSON.stringify({ memories: [{ text: '项目使用本地测试', messageIds: [source.id] }] }));
  await fixture.app.evaluate((_, path) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: MemoryWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }).memoryWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => { await write(...args); if (String(args[0]) === path && !gate.waiting) { gate.waiting = true; await wait; } };
    syncBuiltinESMExports();
  }, join(fixture.storage, 'memories.json.tmp'));
  try {
    const requestId = crypto.randomUUID(); await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId });
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }).memoryWriteGate?.waiting)).toBe(true);
    await fixture.invoke({ op: 'operation.cancel', threadId: 't', requestId });
    await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }).memoryWriteGate; gate?.release(); gate?.restore(); });
    await expect.poll(async () => (await generated()).at(-1)?.status).toBe('cancelled'); expect((await memories()).entries).toHaveLength(0);
    await expect(access(join(fixture.storage, 'memories.json.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await fixture.app.evaluate(() => { const root = globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }; root.memoryWriteGate?.release(); root.memoryWriteGate?.restore(); delete root.memoryWriteGate; }); }
  const calls = fixture.calls.length; await fixture.restart(); expect((await memories()).entries).toHaveLength(0); expect(fixture.calls).toHaveLength(calls);
  await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'project', projectId: 'p' }, requestId: crypto.randomUUID() });
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('succeeded'); expect((await memories()).entries).toHaveLength(1);
  await fixture.restart(); expect((await memories()).entries[0].source.messageIds).toEqual([source.id]);
});

test('memory disk failures keep confirmations retryable and stale clear cannot remove newly saved entries', async () => {
  await fixture.invoke({ op: 'memory.save', scope: { kind: 'user' }, text: '原有记忆', enabled: true }); const ui = await panel();
  await ui.getByRole('button', { name: '清除全部记忆', exact: true }).click(); const dialog = fixture.page.getByRole('dialog', { name: '清除所有用户与项目记忆？', exact: true });
  await fixture.invoke({ op: 'memory.save', scope: { kind: 'user' }, text: '新记忆不能被旧确认删除', enabled: true }); await expect(ui.locator('.memory-entry')).toHaveCount(2);
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('记忆已被修改或删除'); expect((await memories()).entries).toHaveLength(2);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await ui.getByRole('button', { name: '清除全部记忆', exact: true }).click(); const blocked = join(fixture.storage, 'memories.json.tmp'); await mkdir(blocked);
  try { await dialog.getByRole('button', { name: '删除', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('记忆保存失败'); expect((await memories()).entries).toHaveLength(2); }
  finally { await rm(blocked, { recursive: true, force: true }); }
  await dialog.getByRole('button', { name: '删除', exact: true }).click(); await expect(dialog).toHaveCount(0); expect((await memories()).entries).toHaveLength(0);
  await fixture.restart(); expect((await memories()).entries).toHaveLength(0);
  await send('新的偏好是使用中文'); await idle(); const source = (await fixture.snapshot()).data.threads[0].items.find(item => item.role === 'user')!;
  fixture.setReply(JSON.stringify({ memories: [{ text: '请使用中文', messageIds: [source.id] }] })); await mkdir(blocked);
  try {
    await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'user' }, requestId: crypto.randomUUID() });
    await expect.poll(async () => (await generated()).at(-1)?.status).toBe('failed'); expect((await generated()).at(-1)?.error).toContain('记忆保存失败'); expect((await memories()).entries).toHaveLength(0);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.restart(); expect((await memories()).entries).toHaveLength(0);
  await fixture.invoke({ op: 'memory.generate', threadId: 't', scope: { kind: 'user' }, requestId: crypto.randomUUID() });
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('succeeded'); expect((await memories()).entries.map(entry => entry.text)).toEqual(['请使用中文']);
});

test('memory preparation waiting for credentials remains visible and cancellable before inference', async () => {
  await send('项目希望使用简洁输出'); await idle(); const ui = await panel();
  const source = (await fixture.snapshot()).data.threads[0].items.find(item => item.role === 'user')!;
  fixture.setReply(JSON.stringify({ memories: [{ text: '项目希望简洁输出', messageIds: [source.id] }] }));
  await fixture.app.evaluate((_, path) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: MemoryWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }).memoryWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => { if (String(args[0]) === path && !gate.waiting) { gate.waiting = true; await wait; } return write(...args); };
    syncBuiltinESMExports();
  }, join(fixture.storage, 'secrets.json.tmp'));
  const credentialWrite = fixture.invoke({ op: 'provider.key', id: 'local-provider', key: 'fixture-generation-key' }); const count = fixture.calls.length;
  try {
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }).memoryWriteGate?.waiting)).toBe(true);
    await ui.getByRole('button', { name: '从聊天生成候选', exact: true }).click();
    await expect.poll(async () => (await generated()).at(-1)?.status, { timeout: 2500 }).toBe('running');
    await expect(ui.getByText('正在准备记忆来源', { exact: true })).toBeVisible();
    await ui.getByRole('button', { name: '取消记忆生成', exact: true }).click(); expect(fixture.calls).toHaveLength(count);
  } finally {
    await fixture.app.evaluate(() => { const root = globalThis as typeof globalThis & { memoryWriteGate?: MemoryWriteGate }; root.memoryWriteGate?.release(); root.memoryWriteGate?.restore(); delete root.memoryWriteGate; });
    await credentialWrite;
  }
  await expect.poll(async () => (await generated()).at(-1)?.status).toBe('cancelled'); expect(fixture.calls).toHaveLength(count); expect((await memories()).entries).toHaveLength(0);
  await ui.getByRole('button', { name: '从聊天生成候选', exact: true }).click(); await expect.poll(async () => (await generated()).at(-1)?.status).toBe('succeeded');
  expect(fixture.calls).toHaveLength(count + 1); expect((await memories()).entries).toHaveLength(1);
});
