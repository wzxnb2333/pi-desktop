import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { mcpSchema } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

test('native rich results retain actual images, safe resource reads, extension data and error state across restart', async () => {
  const log = join(fixture.storage, 'resource-reads.txt'); await writeFile(log, '');
  const config = mcpSchema.parse({ id: 'rich', name: '富结果', enabled: true, transport: 'stdio', command: process.execPath, args: [resolve('test/fixtures/mcp-rich-server.mjs'), log] });
  await fixture.invoke({ op: 'settings.patch', patch: { mcpServers: [config] } });
  await fixture.invoke({ op: 'thread.resume', id: 't' });
  const tool = (await fixture.snapshot()).data.threads[0].mcp?.[0].tools.find(item => item.sourceName === 'rich')!;
  expect(tool).toBeTruthy(); fixture.requestTool(tool.name, { fail: true });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '富结果协议验收', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads[0].status).toBe('idle');
  const thread = (await fixture.snapshot()).data.threads[0];
  const item = thread.items.find(item => item.role === 'tool' && item.toolResult)!;
  expect(item.state).toBe('error'); expect(item.toolResult?.result.isError).toBe(true);
  expect(JSON.stringify(fixture.calls.at(-1)?.messages)).toContain('data:image/png;base64,');
  const folds = Object.fromEntries(thread.items.filter(item => item.role === 'user').map(item => ['process:' + item.id, true]));
  folds['tool:' + item.id] = true;
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { folds } });
  await fixture.page.getByRole('button', { name: '1 次工具调用 · 1 个失败', exact: true }).click();
  const result = fixture.page.locator('[data-tool-id="' + item.id + '"] .structured-tool-result').first();
  await expect(result).toBeVisible();
  const image = result.locator('figure img'); await expect(image).toHaveCount(1);
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(result.locator('.tool-unknown')).toHaveCount(2);
  await result.locator('.tool-unknown').first().locator('summary').click();
  await expect(result.locator('.tool-unknown').first()).toContainText('UNKNOWN_BLOCK_RETAINED');
  await result.locator('.tool-structured-data > summary').click(); await expect(result.locator('.tool-structured-data')).toContainText('STRUCTURED_DATA');
  expect(await fixture.page.evaluate(() => Object.hasOwn(window, 'UNSAFE'))).toBe(false);
  const unsafe = result.locator('.tool-resource').filter({ hasText: 'javascript:alert(1)' });
  await expect(unsafe.getByRole('button', { name: '在浏览器中打开' })).toHaveCount(0);
  const report = result.locator(':scope > .tool-resource').filter({ has: fixture.page.locator('code', { hasText: /^fixture:\/\/report$/ }) });
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false }); });
  await report.getByRole('button', { name: '读取资源' }).click(); await expect(report).toContainText('资源连接已取消'); expect(await readFile(log, 'utf8')).toBe('');
  await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await report.getByRole('button', { name: '读取资源' }).click(); await expect(report).toContainText('MCP_RESOURCE_READ_OK');
  expect(await readFile(log, 'utf8')).toBe('fixture://report\n');
  const waiting = result.locator(':scope > .tool-resource').filter({ has: fixture.page.locator('code', { hasText: /^fixture:\/\/wait$/ }) });
  await waiting.getByRole('button', { name: '读取资源' }).click();
  await expect.poll(() => readFile(log, 'utf8')).toContain('fixture://wait');
  await waiting.getByRole('button', { name: '取消', exact: true }).click(); await expect(waiting).toContainText('操作已取消');
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads[0].items.find(entry => entry.id === item.id)?.toolResult).toEqual(item.toolResult);
  const restored = fixture.page.locator('[data-tool-id="' + item.id + '"] .structured-tool-result').first();
  await expect(restored).toContainText('MCP_RESOURCE_READ_OK');
  await expect.poll(() => restored.locator('figure img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(1);
  await fixture.invoke({ op: 'thread.update', id: 't', policy: 'deny' });
  await expect(fixture.invoke({ op: 'mcp.resource', threadId: 't', itemId: item.id, index: 2, requestId: crypto.randomUUID() })).rejects.toThrow(/权限禁止/);
  for (const locale of ['zh-CN', 'en-US'] as const) {
    await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale } });
    for (const theme of ['light', 'dark'] as const) {
      await fixture.invoke({ op: 'settings.patch', patch: { theme } });
      for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
        await fixture.app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]), [width, height]);
        await expect.poll(() => restored.evaluate(root => root.scrollWidth - root.clientWidth)).toBeLessThanOrEqual(1);
      }
    }
  }
});
