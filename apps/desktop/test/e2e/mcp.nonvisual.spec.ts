import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url, { authorizeExternalTools: true }); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); expect(errors).toEqual([]); } });

async function configure(mode = '') {
  const settings = (await fixture.snapshot()).data.settings;
  settings.mcpServers = [{ id: 'm', name: '生命周期 MCP', enabled: true, transport: 'stdio', command: process.execPath, args: [resolve('test/fixtures/mcp-lifecycle-server.mjs'), mode], url: '' }];
  await fixture.invoke({ op: 'settings.save', settings });
  await fixture.invoke({ op: 'thread.resume', id: 't' });
  await fixture.page.keyboard.press('Control+,');
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
}
async function state() { return (await fixture.snapshot()).data.threads[0].mcp?.find(item => item.id === 'm'); }

test('MCP task tools recover after service exit, worker exit and application restart', async () => {
  await configure();
  await expect.poll(async () => (await state())?.state).toBe('connected');
  const tool = (await state())!.tools[0];
  expect(tool.name).toMatch(/^mcp_/);
  expect(tool.label).toBe('生命周期 MCP · echo');
  await fixture.page.locator('.mcp-connection > summary').click();
  await expect(fixture.page.locator('.mcp-tools summary')).toContainText('生命周期 MCP · echo');
  fixture.requestTool(tool.name, { exit: true });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '退出测试服务', attachments: [] });
  await expect.poll(async () => (await state())?.state).toBe('disconnected');
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  await expect(fixture.page.locator('.mcp-connection > summary')).toContainText('未连接');
  await fixture.page.getByRole('button', { name: '重新连接任务工具' }).click();
  await expect.poll(async () => (await state())?.state).toBe('connected');
  await expect(fixture.page.locator('.mcp-connection')).toContainText('任务工具已重新连接');
  const pid = await fixture.app.evaluate(({ app }) => app.getAppMetrics().find(metric => metric.type === 'Utility' && metric.name === 'Pi Agent')?.pid);
  expect(pid).toBeTruthy();
  await fixture.app.evaluate((_electron, value) => process.kill(value!), pid);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('interrupted');
  await expect.poll(async () => (await state())?.state).toBe('disconnected');
  await expect(fixture.page.locator('.mcp-connection')).toContainText('上次加载的工具');
  const reconnect = { op: 'mcp.retry' as const, threadId: 't' };
  await Promise.all([fixture.invoke(reconnect), fixture.invoke(reconnect)]);
  await expect.poll(async () => (await state())?.state).toBe('connected');
  expect(await fixture.app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.type === 'Utility' && metric.name === 'Pi Agent').length)).toBe(1);
  await fixture.restart();
  expect((await state())?.state).toBe('disconnected');
  expect((await state())?.tools[0]).toMatchObject(tool);
  expect(await fixture.app.evaluate(({ app }) => app.getAppMetrics().filter(metric => metric.name === 'Pi Agent').length)).toBe(0);
  await fixture.page.getByRole('button', { name: 'MCP', exact: true }).click();
  await fixture.page.locator('.mcp-connection > summary').click();
  await fixture.page.getByRole('button', { name: '重新连接任务工具' }).click();
  await expect.poll(async () => (await state())?.state).toBe('connected');
  fixture.requestTool(tool.name, {});
  const count = fixture.calls.length;
  await fixture.invoke({ op: 'thread.send', id: 't', text: '恢复后调用工具', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBeGreaterThan(count + 1);
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('ok');
});

test('MCP rejected tool discovery recovers from saved configuration and running guards remain enforced', async () => {
  await configure('cursor');
  await expect.poll(async () => (await state())?.state).toBe('error');
  await fixture.page.locator('.mcp-connection > summary').click();
  await expect(fixture.page.locator('.mcp-connection')).toContainText('重复分页标识');
  await fixture.page.getByRole('button', { name: '重新连接任务工具' }).click();
  await expect(fixture.page.locator('.mcp-connection .form-feedback').last()).toContainText('重复分页标识');
  await fixture.page.locator('#mcp-m-args').fill(resolve('test/fixtures/mcp-lifecycle-server.mjs'));
  await expect(fixture.page.getByRole('button', { name: '重新连接任务工具' })).toBeDisabled();
  await fixture.page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(fixture.page.getByRole('status')).toHaveText('设置已保存');
  await fixture.page.getByRole('button', { name: '重新连接任务工具' }).click();
  await expect.poll(async () => (await state())?.state).toBe('connected');
  await expect(fixture.page.locator('.mcp-connection')).toContainText('任务工具已重新连接');
  const settings = (await fixture.snapshot()).data.settings;
  settings.mcpServers[0].command = '';
  await expect(fixture.invoke({ op: 'settings.save', settings })).rejects.toThrow(/启动命令/);
  fixture.setMode('hold');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '等待服务配置检查', attachments: [] });
  await expect.poll(() => fixture.calls.length).toBe(1);
  await expect(fixture.page.getByRole('button', { name: '重新连接任务工具' })).toBeDisabled();
  await expect(fixture.invoke({ op: 'mcp.retry', threadId: 't' })).rejects.toThrow(/停止/);
  await fixture.invoke({ op: 'thread.stop', id: 't' });
});
