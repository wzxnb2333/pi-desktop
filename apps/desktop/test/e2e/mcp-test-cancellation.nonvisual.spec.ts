import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import type { McpConfig } from '../../src/shared/contracts.ts';
import type { BaseWindow, MessageBoxOptions } from 'electron';
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

async function configure(mode: string): Promise<McpConfig> {
  const server: McpConfig = { id: 'm', name: '取消测试 MCP', enabled: true, transport: 'stdio', command: process.execPath,
    args: [resolve('test/fixtures/mcp-wait-server.mjs'), mode, join(fixture.storage, 'server-marker.json')], url: '' };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [server] } }); return server;
}
async function marker() { try { return JSON.parse(await readFile(join(fixture.storage, 'server-marker.json'), 'utf8')) as { pid: number; stage: string }; } catch { return undefined; } }
async function operation(id: string) { return (await fixture.snapshot()).data.operations.find(item => item.id === id); }

test('MCP test approval is cancellable and stale confirmation cannot start a changed target', async () => {
  const server = await configure('initialize');
  await fixture.app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async (first: BaseWindow | MessageBoxOptions, options?: MessageBoxOptions) => {
      const signal = (options ?? ('message' in first ? first : undefined))?.signal;
      if (signal?.aborted) return { response: 0, checkboxChecked: false };
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve(), { once: true }));
      return { response: 1, checkboxChecked: false };
    };
  });
  const firstId = crypto.randomUUID();
  const first = fixture.invoke({ op: 'mcp.test', id: server.id, requestId: firstId, base: server });
  await expect.poll(async () => (await operation(firstId))?.stage).toBe('等待连接测试确认');
  await expect(fixture.invoke({ op: 'mcp.test', id: server.id, requestId: crypto.randomUUID(), base: server })).rejects.toThrow(/正在运行/);
  await fixture.invoke({ op: 'mcp.testCancel', requestId: firstId });
  expect(await first).toBeNull(); expect((await operation(firstId))?.status).toBe('cancelled'); expect(await marker()).toBeUndefined();
  const secondId = crypto.randomUUID();
  const second = fixture.invoke({ op: 'mcp.test', id: server.id, requestId: secondId, base: server });
  await expect.poll(async () => (await operation(secondId))?.stage).toBe('等待连接测试确认');
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [{ ...server, command: 'unapproved-command' }] } });
  expect(await second).toBeNull(); expect(await marker()).toBeUndefined();
  await expect(fixture.invoke({ op: 'mcp.test', id: server.id, requestId: crypto.randomUUID(), base: server })).rejects.toThrow(/配置已变化/);
  await expect(fixture.invoke({ op: 'mcp.testCancel', requestId: crypto.randomUUID() })).rejects.toThrow(/不属于/);
});

test('MCP test cancellation closes a real initializing process and preserves preferences and retry', async () => {
  const server = await configure('initialize');
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await fixture.page.keyboard.press('Control+,'); await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.getByRole('button', { name: '保存并测试', exact: true }).click();
  await expect.poll(async () => (await marker())?.stage).toBe('started');
  const pid = (await marker())!.pid;
  await expect(fixture.page.getByRole('button', { name: '取消连接测试', exact: true })).toBeVisible();
  await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
  expect((await fixture.snapshot()).data.settings.theme).toBe('dark');
  const id = (await fixture.snapshot()).data.operations.find(item => item.kind === 'mcp.test' && item.status === 'running')!.id;
  await fixture.page.getByRole('button', { name: '取消连接测试', exact: true }).click();
  await expect.poll(async () => (await operation(id))?.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(fixture.page.getByRole('button', { name: '保存并测试', exact: true })).toBeFocused();
  const ready = { ...server, args: [server.args[0], 'ready', server.args[2]] };
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [ready] } });
  const next = crypto.randomUUID();
  expect(await fixture.invoke({ op: 'mcp.test', id: ready.id, requestId: next, base: ready })).toEqual([expect.objectContaining({ sourceName: 'probe' })]);
  expect((await operation(next))?.status).toBe('succeeded');
  await fixture.restart(); expect((await operation(id))?.status).toBe('cancelled'); expect((await operation(next))?.status).toBe('succeeded');
});

test('MCP tool discovery remains cancellable after navigation and credential changes retire only its test process', async () => {
  const server = await configure('tools');
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  const id = crypto.randomUUID();
  const pending = fixture.invoke({ op: 'mcp.test', id: server.id, requestId: id, base: server });
  await expect.poll(async () => (await marker())?.stage).toBe('tools');
  await expect.poll(async () => (await operation(id))?.stage).toBe('正在读取 MCP 工具列表');
  const pid = (await marker())!.pid;
  await fixture.page.keyboard.press('Control+,'); await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await expect(fixture.page.getByRole('button', { name: '取消连接测试', exact: true })).toBeVisible();
  await fixture.page.getByRole('button', { name: '通用', exact: true }).click();
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await expect(fixture.page.getByRole('button', { name: '取消连接测试', exact: true })).toBeVisible();
  await fixture.invoke({ op: 'mcp.secret', id: server.id, value: { TOKEN: 'local-only-fixture' }, base: server });
  expect(await pending).toBeNull(); expect((await operation(id))?.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  expect(JSON.stringify((await operation(id)))).not.toContain('local-only-fixture');
});

test('plugin tool discovery cancels on disable and application restart closes a pending test', async () => {
  const source = join(fixture.storage, 'plugin-source'); await mkdir(source);
  await writeFile(join(source, 'pi-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'cancel-plugin', name: '取消测试插件', version: '1.0.0', mcp: [
    { id: 'waiting', name: '等待服务', enabled: true, transport: 'stdio', command: process.execPath,
      args: [resolve('test/fixtures/mcp-wait-server.mjs'), 'tools', join(fixture.storage, 'server-marker.json')] },
  ] }));
  await fixture.app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, source);
  await fixture.invoke({ op: 'plugin.pick', kind: 'directory' });
  const install = crypto.randomUUID();
  await fixture.invoke({ op: 'plugin.start', requestId: install, action: 'install', pluginId: '', source, hash: '' });
  await expect.poll(async () => (await operation(install))?.status).toBe('succeeded');
  const enable = crypto.randomUUID(), plugin = (await fixture.snapshot()).data.plugins[0];
  await fixture.invoke({ op: 'plugin.start', requestId: enable, action: 'enable', pluginId: plugin.id, source: '', hash: plugin.current.hash });
  await expect.poll(async () => (await operation(enable))?.status).toBe('succeeded');
  await fixture.page.getByRole('button', { name: 'Skills 与扩展', exact: true }).click();
  const policies = fixture.page.locator('.mcp-tool-policies'); await policies.locator('summary').click();
  await policies.getByRole('button', { name: '读取工具列表', exact: true }).click();
  await expect.poll(async () => (await marker())?.stage).toBe('tools');
  const pid = (await marker())!.pid;
  await expect(policies.getByRole('button', { name: '取消连接测试', exact: true })).toBeVisible();
  const testId = (await fixture.snapshot()).data.operations.find(item => item.kind === 'mcp.test' && item.status === 'running')!.id;
  const disable = crypto.randomUUID();
  await fixture.invoke({ op: 'plugin.start', requestId: disable, action: 'disable', pluginId: plugin.id, source: '', hash: '' });
  await expect.poll(async () => (await operation(disable))?.status).toBe('succeeded');
  await expect.poll(async () => (await operation(testId))?.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  const server = await configure('initialize'), id = crypto.randomUUID();
  const pending = fixture.invoke({ op: 'mcp.test', id: server.id, requestId: id, base: server }).catch(() => 'window closed');
  await expect.poll(async () => (await marker())?.stage).toBe('started');
  const closingPid = (await marker())!.pid;
  await fixture.restart(); await pending;
  expect((await operation(id))?.status).toBe('cancelled'); expect(() => process.kill(closingPid, 0)).toThrow();
});
