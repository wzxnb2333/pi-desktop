import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { threadSchema, type McpConfig } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.setTimeout(30000);
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); await expect(stat(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); }
});

test('restoring a session exposes stop, preserves drafts and can be reopened after cancellation', async () => {
  const server = await configure('tools');
  const input = fixture.page.locator('.composer textarea');
  await input.fill('保留未发送草稿');
  const restored = fixture.invoke({ op: 'thread.resume', id: 't' });
  await expect.poll(async () => (await marker())?.stage).toBe('tools');
  const pid = (await marker())!.pid;
  await expect(fixture.page.getByRole('button', { name: '停止任务', exact: true })).toBeVisible();
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: '恢复时不能误入排队', attachments: [], queue: 'followUp' })).rejects.toThrow(/会话正在恢复/);
  await fixture.page.getByRole('button', { name: '停止任务', exact: true }).click();
  const thread = threadSchema.parse(await restored);
  expect(thread.status).toBe('idle'); expect(thread.error).toBeUndefined();
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(input).toHaveValue('保留未发送草稿');
  await expect(fixture.page.locator('.thread-error')).toHaveCount(0);
  expect(fixture.calls).toHaveLength(0);
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [{ ...server, args: [server.args[0], 'ready', server.args[2]] }] } });
  const [first, second] = await Promise.all([fixture.invoke({ op: 'thread.resume', id: 't' }), fixture.invoke({ op: 'thread.resume', id: 't' })]);
  expect(threadSchema.parse(first).status).toBe('idle'); expect(threadSchema.parse(second).status).toBe('idle');
  expect(await fixture.app.evaluate(({ app }) => app.getAppMetrics().filter(item => item.name === 'Pi Agent').length)).toBe(1);
  await expect(input).toHaveValue('保留未发送草稿');
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await expect(fixture.page.locator('.composer textarea')).toHaveValue('保留未发送草稿');
});

test('stopping startup rejects late consent and pending follow-ups without running either prompt', async () => {
  await configure('initialize');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'auto' });
  await fixture.page.locator('.composer textarea').fill('尚待工具授权');
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).approvals.length).toBe(1);
  const approval = (await fixture.snapshot()).approvals[0];
  const queued = fixture.invoke({ op: 'thread.send', id: 't', text: '不能迟到执行', attachments: [], queue: 'followUp' }).then(() => 'unexpected acceptance', error => String(error));
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  // Stop may win the repository reservation; both paths must reject without executing.
  expect(await queued).toMatch(/停止|abort|正在保存本轮快照/i);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect((await fixture.snapshot()).data.threads[0].error).toBeUndefined();
  expect((await fixture.snapshot()).approvals).toEqual([]);
  await expect(fixture.invoke({ op: 'approval.reply', id: approval.id, approved: true })).rejects.toThrow(/已结束/);
  expect(await marker()).toBeUndefined(); expect(fixture.calls).toHaveLength(0);
  await expect(fixture.page.locator('.composer textarea')).toHaveValue('尚待工具授权');
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '用户重新发送', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(JSON.stringify(fixture.calls[0].messages)).not.toContain('不能迟到执行');
});

test('startup cancellation stays scoped to its task and application exit closes the next pending startup', async () => {
  await configure('tools');
  const other = threadSchema.parse(await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }));
  await fixture.invoke({ op: 'thread.update', id: other.id, policy: 'deny' });
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: other.id, text: '其他任务仍在执行', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  const pending = fixture.invoke({ op: 'thread.resume', id: 't' });
  await expect.poll(async () => (await marker())?.stage).toBe('tools');
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await pending;
  expect((await fixture.snapshot()).data.threads.find(item => item.id === other.id)?.status).toBe('running');
  fixture.release();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === other.id)?.status).toBe('idle');
  const lastPid = (await marker())!.pid;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: 't' } });
  await fixture.page.locator('.composer textarea').fill('关闭时尚未执行的输入');
  await fixture.page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(fixture.page.locator('.composer textarea')).toHaveValue('');
  await expect.poll(async () => (await marker())?.pid).not.toBe(lastPid);
  const pid = (await marker())!.pid;
  await fixture.restart();
  expect(() => process.kill(pid, 0)).toThrow();
  const reopened = (await fixture.snapshot()).data.threads.find(item => item.id === 't')!;
  expect(['idle', 'interrupted']).toContain(reopened.status);
  expect(reopened.error).toBeUndefined();
  expect(await fixture.app.evaluate(({ app }) => app.getAppMetrics().filter(item => item.name === 'Pi Agent').length)).toBe(0);
  expect((await fixture.snapshot()).data.settings.theme).toBe('dark');
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toContain('关闭时尚未执行的输入');
  await expect(fixture.page.locator('.composer textarea')).toHaveValue('关闭时尚未执行的输入');
});

async function configure(mode: string): Promise<McpConfig> {
  const config: McpConfig = { id: 'startup', name: '初始化 MCP', enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve('test/fixtures/mcp-wait-server.mjs'), mode, join(fixture.storage, 'startup-marker.json')], url: '' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [config] } });
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'full' });
  return config;
}
async function marker() { try { return JSON.parse(await readFile(join(fixture.storage, 'startup-marker.json'), 'utf8')) as { pid: number; stage: string }; } catch { return undefined; } }

for (const stage of ['initialize', 'tools']) test('stopping the first send cancels MCP ' + stage + ' and permits a clean retry', async () => {
  const server = await configure(stage);
  await fixture.invoke({ op: 'thread.send', id: 't', text: '启动后停止', attachments: [] });
  await expect.poll(async () => (await marker())?.stage).toBe(stage === 'initialize' ? 'started' : 'tools');
  const pid = (await marker())!.pid;
  await fixture.invoke({ op: 'thread.stop', id: 't' });
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, { timeout: 5000 }).toBe(true);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect((await fixture.snapshot()).data.threads[0].error).toBeUndefined();
  expect((await fixture.snapshot()).approvals).toEqual([]);
  expect(fixture.calls).toHaveLength(0);
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [{ ...server, args: [server.args[0], 'ready', server.args[2]] }] } });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '明确重新发送', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(JSON.stringify(fixture.calls[0].messages)).toContain('明确重新发送');
  expect(JSON.stringify(fixture.calls[0].messages)).not.toContain('启动后停止');
});
