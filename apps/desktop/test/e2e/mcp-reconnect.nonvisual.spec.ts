import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { threadSchema, type McpConfig } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.setTimeout(45000);
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); await expect(stat(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); }
});

async function configure(mode: string, full = true): Promise<McpConfig> {
  const server: McpConfig = { id: 'm', name: '任务重连 MCP', enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve('test/fixtures/mcp-wait-server.mjs'), mode, join(fixture.storage, 'reconnect-marker.json')], url: '' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [server] } });
  if (full) await fixture.invoke({ op: 'thread.update', id: 't', policy: 'full' });
  return server;
}
async function marker() { try { return JSON.parse(await readFile(join(fixture.storage, 'reconnect-marker.json'), 'utf8')) as { pid: number; stage: string }; } catch { return undefined; } }
async function operation(id: string) { return (await fixture.snapshot()).data.operations.find(item => item.id === id); }

for (const stage of ['initialize', 'tools']) test('task reconnect cancels actual ' + stage + ' without blocking another task or preference saves', async () => {
  const server = await configure(stage);
  const id = crypto.randomUUID();
  const pending = fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: id });
  await expect.poll(async () => (await marker())?.stage).toBe(stage === 'initialize' ? 'started' : 'tools');
  const pid = (await marker())!.pid;
  await expect(fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: crypto.randomUUID() })).rejects.toThrow(/正在运行/);
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: '不能采用待取消进程', attachments: [] })).rejects.toThrow(/正在重连/);
  await expect(fixture.invoke({ op: 'thread.update', id: 't', planMode: true })).rejects.toThrow(/正在重连/);
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  expect((await fixture.snapshot()).data.settings.theme).toBe('dark');
  const other = threadSchema.parse(await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }));
  await fixture.invoke({ op: 'thread.update', id: other.id, policy: 'deny' });
  await expect(fixture.invoke({ op: 'operation.cancel', threadId: other.id, requestId: id })).rejects.toThrow(/不属于/);
  await fixture.invoke({ op: 'thread.send', id: other.id, text: '同目录另一个任务继续', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === other.id)?.status).toBe('idle');
  expect(fixture.calls).toHaveLength(1);
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.locator('.mcp-connection > summary').click();
  await fixture.page.getByRole('button', { name: '取消任务工具重连', exact: true }).click();
  expect(await pending).toBeNull();
  expect((await operation(id))?.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.status).toBe('idle');
  const ready = { ...server, args: [server.args[0], 'ready', server.args[2]] };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [ready] } });
  const retryId = crypto.randomUUID();
  expect(await fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: retryId })).toEqual([expect.objectContaining({ state: 'connected', tools: [expect.objectContaining({ sourceName: 'probe' })] })]);
  expect((await operation(retryId))?.status).toBe('succeeded');
});

test('task reconnect approval cancellation clears consent without starting a server and stop also cancels initialization', async () => {
  await configure('initialize', false);
  const id = crypto.randomUUID();
  const pending = fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: id });
  await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1);
  const approval = (await fixture.snapshot()).approvals[0];
  expect(approval.scope).toBe('external-tools');
  await fixture.invoke({ op: 'operation.cancel', threadId: 't', requestId: id });
  expect(await pending).toBeNull();
  expect((await fixture.snapshot()).approvals).toEqual([]);
  expect(await marker()).toBeUndefined();
  await expect(fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true })).rejects.toThrow(/已结束/);
  expect(await marker()).toBeUndefined();
  const retryId = crypto.randomUUID();
  const retried = fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: retryId });
  await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1);
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  expect(await retried).toBeNull(); expect((await operation(retryId))?.status).toBe('cancelled');
  expect((await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(await marker()).toBeUndefined();
});

test('application restart closes task MCP initialization and retains its cancelled record', async () => {
  await configure('tools');
  const id = crypto.randomUUID();
  const pending = fixture.invoke({ op: 'mcp.retry', threadId: 't', requestId: id }).catch(() => 'window closed');
  await expect.poll(async () => (await marker())?.stage).toBe('tools');
  const pid = (await marker())!.pid;
  await fixture.restart(); await pending;
  expect((await operation(id))?.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  expect((await fixture.snapshot()).data.threads[0].status).toBe('idle');
});
