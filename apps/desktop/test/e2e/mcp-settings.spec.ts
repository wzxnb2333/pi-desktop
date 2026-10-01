import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Browser, type Page, chromium, expect, test } from '@playwright/test';
import type {} from './fixtures/mcp-settings-harness.tsx';

let browser: Browser;
let page: Page;
let directory: string;
let url: string;
let errors: string[];
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-mcp-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/mcp-settings-harness.tsx', import.meta.url))], outfile: join(directory, 'harness.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1000, height: 640 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

test('MCP validates fields before saving and preserves explicit empty argument values', async () => {
  await page.locator('#mcp-m-command').fill('');
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.locator('#mcp-m-command')).toBeFocused();
  await expect(page.locator('#mcp-m-command')).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'settings.patch'))).toHaveLength(0);
  await page.locator('#mcp-m-command').fill('node');
  await page.locator('#mcp-m-secret').fill('{"TOKEN":42}');
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.locator('#mcp-m-secret')).toBeFocused();
  await expect(page.locator('#mcp-m-secret-error')).toContainText('字符串值');
  await page.locator('#mcp-m-secret').fill('');
  await page.locator('#mcp-m-transport').selectOption('http');
  await page.locator('#mcp-m-url').fill('file:///bad');
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect(page.locator('#mcp-m-url')).toBeFocused();
  await expect(page.locator('#mcp-m-url-error')).toHaveText('MCP URL 必须使用 HTTP(S)');
  await page.locator('#mcp-m-transport').selectOption('stdio');
  await page.locator('#mcp-m-args').fill('first\n\nlast');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('设置已保存');
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'settings.patch').at(-1))).toMatchObject({ patch: { mcpServers: [{ args: ['first', '', 'last'] }] } });
  await page.locator('#mcp-m-args').fill('');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('设置已保存');
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'settings.patch').at(-1))).toMatchObject({ patch: { mcpServers: [{ args: [] }] } });
});

test('MCP secret saves bind to the normalized server configuration and preserve a failed draft', async () => {
  await page.locator('#mcp-m-command').fill(' node ');
  await page.locator('#mcp-m-secret').fill('{"TOKEN":"fixture-secret"}');
  await page.evaluate(() => window.__mcp.hold('mcp.secret', true));
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.secret').length)).toBe(1);
  expect(await page.evaluate(() => window.__mcp.pending('mcp.secret')[0].request)).toMatchObject({
    id: 'm', value: { TOKEN: 'fixture-secret' }, base: { id: 'm', command: 'node', args: [], url: '', transport: 'stdio' },
  });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.secret')[0].id, { error: 'SECRET_SAVE_FAILED' }));
  await expect(page.locator('.settings-footer [role=status]')).toHaveText('SECRET_SAVE_FAILED');
  await expect(page.locator('#mcp-m-secret')).toHaveValue('{"TOKEN":"fixture-secret"}');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.secret').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.secret')[0].id));
  await expect(page.locator('.settings-footer [role=status]')).toHaveText('设置已保存');
  await expect(page.locator('#mcp-m-secret')).toHaveValue('');
});

test('MCP saves once, ignores edited configuration results and validates test responses', async () => {
  await page.evaluate(() => { window.__mcp.hold('settings.patch', true); window.__mcp.hold('mcp.test', true); });
  await page.getByRole('button', { name: '保存并测试' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('settings.patch').length)).toBe(1);
  await expect(page.locator('#mcp-m-name')).toBeDisabled();
  await page.getByRole('button', { name: '保存设置', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => window.__mcp.pending('settings.patch').length)).toBe(1);
  await page.evaluate(() => { window.__mcp.hold('settings.patch', false); window.__mcp.complete(window.__mcp.pending('settings.patch')[0].id); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.locator('#mcp-m-name').fill('已修改');
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { error: 'STALE_ERROR' }));
  await expect(page.getByText('STALE_ERROR', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 42 }] }));
  await expect(page.getByRole('region', { name: 'MCP 测试结果 已修改' })).toContainText('数据格式无效');
  await page.getByRole('button', { name: '重试连接', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id));
  const result = page.getByRole('region', { name: 'MCP 测试结果 已修改' });
  await expect(result).toContainText('连接测试成功（测试连接已关闭）');
  await expect(page.getByRole('button', { name: '保存并测试' })).toBeFocused();
  await result.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(result).toContainText('调用标识：mcp_echo');
});

test('MCP cancellation and unmount discard obsolete responses and running tasks disable tests', async () => {
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: null }));
  await expect(page.getByRole('region', { name: 'MCP 测试结果 本地 MCP' })).toHaveText('已取消连接测试');
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '添加', exact: true })).toBeFocused();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { error: 'REMOVED_RESULT' }));
  await expect(page.getByText('REMOVED_RESULT', { exact: false })).toHaveCount(0);
  await page.evaluate(() => window.__mcp.mount(false));
  await expect(page.locator('.settings-page')).toHaveCount(0);
  await page.evaluate(() => { window.__mcp.mount(true); window.__mcp.changeThread({ status: 'running' }); });
  await expect(page.getByRole('button', { name: '保存并测试' })).toBeDisabled();
  await page.locator('.mcp-connection > summary').click();
  await expect(page.getByRole('button', { name: '重新连接任务工具' })).toBeDisabled();
});

test('MCP task reconnect shows failures, retries once and requires saving edited settings', async () => {
  await page.locator('.mcp-connection > summary').click();
  await expect(page.locator('.mcp-connection')).toContainText('当前连接不可用');
  await page.evaluate(() => window.__mcp.hold('mcp.retry', true));
  await page.getByRole('button', { name: '重新连接任务工具' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.retry').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.retry')[0].id, { error: 'RECONNECT_FAILED' }));
  await expect(page.locator('.mcp-connection')).toContainText('RECONNECT_FAILED');
  await page.getByRole('button', { name: '重新连接任务工具' }).click();
  await page.locator('#mcp-m-command').fill('edited-during-reconnect');
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.retry')[0].id, { error: 'OBSOLETE_RECONNECT_ERROR' }));
  await expect(page.getByText('OBSOLETE_RECONNECT_ERROR', { exact: false })).toHaveCount(0);
  await page.locator('#mcp-m-command').fill('node');
  await page.getByRole('button', { name: '重新连接任务工具' }).click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.retry')[0].id));
  await expect(page.locator('.mcp-connection')).toContainText('任务工具已重新连接');
  await expect(page.locator('.mcp-connection > summary')).toHaveText('已有任务 · 已连接');
  await page.locator('#mcp-m-command').fill('updated-node');
  await expect(page.getByRole('button', { name: '重新连接任务工具' })).toBeDisabled();
  await expect(page.locator('.mcp-connection')).toContainText('先保存或撤回');
});

test('MCP task reconnect can cancel without losing edited settings and retry after cancellation', async () => {
  test.setTimeout(15000);
  await page.locator('.mcp-connection > summary').click();
  await page.evaluate(() => window.__mcp.hold('mcp.retry', true));
  await page.getByRole('button', { name: '重新连接任务工具', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.retry').length)).toBe(1);
  const request = await page.evaluate(() => window.__mcp.pending('mcp.retry')[0].request);
  expect(request).toMatchObject({ threadId: 't', requestId: expect.any(String) });
  await page.locator('#mcp-m-command').fill('edited-during-reconnect');
  const cancel = page.getByRole('button', { name: '取消任务工具重连', exact: true });
  await expect(cancel).toBeVisible({ timeout: 2000 });
  await page.evaluate(() => window.__mcp.hold('operation.cancel', true));
  await cancel.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('operation.cancel').length)).toBe(1);
  expect(await page.evaluate(() => window.__mcp.pending('operation.cancel')[0].request)).toMatchObject({ threadId: 't', requestId: request.op === 'mcp.retry' ? request.requestId : undefined });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('operation.cancel')[0].id, { error: 'CANCEL_RECONNECT_FAILED' }));
  await expect(page.locator('.mcp-connection [role=alert]')).toHaveText('CANCEL_RECONNECT_FAILED');
  await cancel.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('operation.cancel')[0].id));
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.retry')[0].id, { value: null }));
  await expect(cancel).toHaveCount(0);
  await expect(page.locator('#mcp-m-command')).toHaveValue('edited-during-reconnect');
  await page.locator('#mcp-m-command').fill('node');
  await page.getByRole('button', { name: '重新连接任务工具', exact: true }).click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.retry')[0].id));
  await expect(page.locator('.mcp-connection')).toContainText('任务工具已重新连接');
});

test('MCP task reconnect reattaches after reopening with live bilingual progress and interrupted recovery', async () => {
  test.setTimeout(15000);
  const id = await page.evaluate(() => {
    const id = crypto.randomUUID();
    window.__mcp.operations([
      { id, threadId: 't', directoryId: '', kind: 'mcp.retry', status: 'running', stage: '正在重新连接任务工具…', startedAt: 1 },
      { id: crypto.randomUUID(), threadId: 't', directoryId: '', kind: 'mcp.retry', status: 'failed', stage: '', startedAt: 2, error: 'DUPLICATE_FAILURE' },
    ]);
    return id;
  });
  await page.evaluate(() => window.__mcp.mount(false));
  await expect(page.locator('.settings-page')).toHaveCount(0);
  await page.evaluate(() => window.__mcp.mount(true));
  await page.locator('.mcp-connection > summary').click();
  const connection = page.locator('.mcp-connection');
  await expect(connection.getByRole('button', { name: '取消任务工具重连', exact: true })).toBeVisible();
  await connection.getByRole('button', { name: '正在重新连接…', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'mcp.retry'))).toHaveLength(0);
  for (const locale of ['zh-CN', 'en-US'] as const) {
    await page.evaluate(value => window.__mcp.locale(value), locale);
    await expect(connection.getByRole('status')).toHaveText(locale === 'zh-CN' ? '正在重新连接任务工具…' : 'Reconnecting task tools…');
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.setViewportSize({ width, height });
      expect(await connection.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }
  }
  await connection.getByRole('button', { name: 'Cancel task tool reconnection', exact: true }).click();
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'operation.cancel').at(-1))).toMatchObject({ threadId: 't', requestId: id });
  await page.evaluate(id => window.__mcp.operations([{ id, threadId: 't', directoryId: '', kind: 'mcp.retry', status: 'interrupted', stage: '', startedAt: 1 }]), id);
  await expect(connection.getByRole('status')).toHaveText('Task tool reconnection was interrupted. You can reconnect.');
  await expect(connection.getByRole('button', { name: 'Cancel task tool reconnection', exact: true })).toHaveCount(0);
});

test('MCP long tool names, errors and endpoints remain contained in supported themes and sizes', async () => {
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  await page.getByRole('button', { name: '保存并测试' }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 'tool'.repeat(60), label: '长名称'.repeat(80), description: '长描述'.repeat(160) }] }));
  await page.getByRole('region', { name: 'MCP 测试结果 本地 MCP' }).locator('summary').click();
  for (const theme of ['light', 'dark', 'system-light', 'system-dark']) {
    await page.emulateMedia({ colorScheme: theme.endsWith('dark') ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.evaluate(value => { document.documentElement.dataset.theme = value.startsWith('system') ? 'system' : value; }, theme);
    for (const [width, height] of [[1000, 640], [1280, 800], [1440, 940]]) {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('.mcp-settings').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
      expect(geometry.scroll - geometry.width).toBeLessThanOrEqual(0.5);
    }
  }
});

test('OAuth status failure can retry a read without saving settings or starting authorization', async () => {
  test.setTimeout(30000);
  await page.goto(url + '?oauth=1&holdStatus=1');
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.oauthStatus').length)).toBe(2);
  await page.evaluate(() => { for (const request of window.__mcp.pending('mcp.oauthStatus')) window.__mcp.complete(request.id, { error: 'STATUS_READ_FAILED' }); });
  const controls = page.locator('.mcp-oauth');
  await expect(controls.getByRole('alert')).toContainText('STATUS_READ_FAILED');
  const retry = controls.getByRole('button', { name: '重试读取授权状态', exact: true });
  await expect(retry).toBeVisible({ timeout: 2000 });
  await retry.focus(); await retry.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.oauthStatus').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.oauthStatus')[0].id, { value: { state: 'connected' } }));
  await expect(controls.getByRole('alert')).toHaveCount(0);
  await expect(controls.getByRole('status')).toContainText('已授权');
  await expect(controls.getByRole('button', { name: '保存并登录', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__mcp.calls().filter(item => ['settings.patch', 'mcp.oauthStart'].includes(item.op)))).toEqual([]);
});

test('tool policy discovery stays pending after repeated clicks and can retry a failed read', async () => {
  test.setTimeout(30000);
  const policies = page.locator('.mcp-tool-policies');
  await policies.locator('summary').click();
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  const discover = policies.getByRole('button', { name: '读取工具列表', exact: true });
  await discover.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await expect(discover).toBeDisabled({ timeout: 2000 });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { error: 'TOOLS_READ_FAILED' }));
  await expect(policies.getByRole('alert')).toContainText('TOOLS_READ_FAILED');
  await expect(discover).toBeEnabled(); await discover.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 'mcp_echo', sourceName: 'echo', description: 'tool' }] }));
  await expect(policies.getByLabel('启用工具 echo', { exact: true })).toBeVisible();
  await expect(policies.getByRole('alert')).toHaveCount(0);
});

test('tool policy discovery discards old tools and late replies after editing a server', async () => {
  test.setTimeout(30000);
  const policies = page.locator('.mcp-tool-policies');
  await policies.locator('summary').click();
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  const discover = policies.getByRole('button', { name: '读取工具列表', exact: true });
  await discover.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 'mcp_old', sourceName: 'old', description: 'old server' }] }));
  await expect(policies.getByLabel('启用工具 old', { exact: true })).toBeVisible();
  await discover.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.locator('#mcp-m-command').fill('updated-node');
  await expect(policies.getByLabel('启用工具 old', { exact: true })).toHaveCount(0, { timeout: 2000 });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { error: 'OBSOLETE_TOOLS_ERROR' }));
  await expect(policies).not.toContainText('OBSOLETE_TOOLS_ERROR');
  await expect(discover).toBeEnabled(); await discover.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.locator('#mcp-m-secret').fill('{"TOKEN":"changed"}');
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 'mcp_late', sourceName: 'late', description: 'old credential' }] }));
  await expect(policies.getByLabel('启用工具 late', { exact: true })).toHaveCount(0);
  await discover.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { error: 'REMOVED_TOOLS_ERROR' }));
  await expect(page.getByText('REMOVED_TOOLS_ERROR', { exact: false })).toHaveCount(0);
});

test('tool policy discovery explains cancellation and invalid results without losing saved rules', async () => {
  test.setTimeout(30000);
  const policies = page.locator('.mcp-tool-policies');
  await policies.locator('summary').click();
  await policies.getByLabel('原始工具名称', { exact: true }).fill('protected');
  await policies.getByRole('button', { name: '添加工具规则', exact: true }).click();
  await policies.getByLabel('工具审批 protected', { exact: true }).selectOption('deny');
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  const discover = policies.getByRole('button', { name: '读取工具列表', exact: true });
  await discover.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: null }));
  await expect(policies.getByRole('status')).toHaveText('已取消连接测试', { timeout: 2000 });
  await expect(policies.getByLabel('工具审批 protected', { exact: true })).toHaveValue('deny');
  await discover.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [{ name: 42 }] }));
  await expect(policies.getByRole('alert')).toHaveText('MCP 测试返回的数据格式无效，请重试连接');
  await expect(policies.getByLabel('工具审批 protected', { exact: true })).toHaveValue('deny');
  await discover.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: [] }));
  await expect(policies.getByRole('alert')).toHaveCount(0);
  await expect(discover).toBeEnabled();
});

test('OAuth repeated login clicks keep one request pending until dispatch finishes', async () => {
  test.setTimeout(30000);
  await page.goto(url + '?oauth=1');
  await expect(page.locator('.mcp-oauth').getByRole('status')).toContainText('未连接');
  await page.evaluate(() => window.__mcp.hold('mcp.oauthStart', true));
  const login = page.getByRole('button', { name: '保存并登录', exact: true });
  await login.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.oauthStart').length)).toBe(1);
  expect(await page.evaluate(() => window.__mcp.pending('mcp.oauthStart')[0].request)).toMatchObject({
    id: 'm', base: { id: 'm', transport: 'http', url: 'http://127.0.0.1:12345/mcp', oauth: { clientId: '', scope: '' } },
  });
  await expect(login).toBeDisabled({ timeout: 2000 });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.oauthStart')[0].id, { error: 'LOGIN_DISPATCH_FAILED' }));
  await expect(page.locator('.mcp-oauth').getByRole('alert')).toContainText('LOGIN_DISPATCH_FAILED');
  await expect(login).toBeEnabled();
  await login.click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.oauthStart').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.oauthStart')[0].id));
  await expect(page.locator('.mcp-oauth').getByRole('alert')).toHaveCount(0);
});

test('OAuth keeps the active operation cancellable when a newer attempt has already failed', async () => {
  test.setTimeout(30000);
  await page.goto(url + '?oauth=1');
  const ids = await page.evaluate(() => {
    const first = crypto.randomUUID(), second = crypto.randomUUID();
    window.__mcp.operations([
      { id: first, threadId: '', directoryId: 'm', kind: 'mcp.oauth.login', status: 'running', stage: '等待浏览器授权', startedAt: 1 },
      { id: second, threadId: '', directoryId: 'm', kind: 'mcp.oauth.login', status: 'failed', stage: '处理 OAuth 授权', startedAt: 2, endedAt: 3, error: '此服务正在等待授权' },
    ]);
    window.__mcp.hold('mcp.oauthCancel', true);
    return { first, second };
  });
  const cancel = page.getByRole('button', { name: '取消授权', exact: true });
  await expect(cancel).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole('button', { name: '保存并登录', exact: true })).toBeDisabled();
  await cancel.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.oauthCancel').length)).toBe(1);
  expect(await page.evaluate(() => window.__mcp.pending('mcp.oauthCancel')[0].request)).toMatchObject({ requestId: ids.first });
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.oauthCancel')[0].id, { error: 'CANCEL_FAILED' }));
  await expect(page.locator('.mcp-oauth').getByRole('alert')).toContainText('CANCEL_FAILED');
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.oauthCancel')[0].id));
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存并登录', exact: true })).toBeEnabled();
});

test('MCP connection testing exposes a cancellable operation while preserving the edited draft', async () => {
  test.setTimeout(15000);
  await page.evaluate(() => window.__mcp.hold('mcp.test', true));
  await page.getByRole('button', { name: '保存并测试', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.test').length)).toBe(1);
  const request = await page.evaluate(() => window.__mcp.pending('mcp.test')[0].request);
  expect(request).toMatchObject({ base: { id: 'm', command: 'node' }, requestId: expect.any(String) });
  const cancel = page.getByRole('button', { name: '取消连接测试', exact: true }).first();
  await expect(cancel).toBeVisible({ timeout: 2000 });
  await page.locator('#mcp-m-command').fill('updated-node');
  await expect(cancel).toBeVisible();
  await page.evaluate(() => window.__mcp.hold('mcp.testCancel', true));
  await cancel.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__mcp.pending('mcp.testCancel').length)).toBe(1);
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.testCancel')[0].id, { error: 'CANCEL_CONNECTION_FAILED' }));
  await expect(page.getByRole('alert')).toContainText('CANCEL_CONNECTION_FAILED');
  await cancel.click();
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.testCancel')[0].id));
  await page.evaluate(() => window.__mcp.complete(window.__mcp.pending('mcp.test')[0].id, { value: null }));
  await expect(page.locator('#mcp-m-command')).toHaveValue('updated-node');
  await expect(page.getByRole('button', { name: '保存并测试', exact: true })).toBeEnabled();
  await expect(cancel).toHaveCount(0);
});

test('MCP test progress reattaches after reopening and keeps the active operation above a failed attempt', async () => {
  test.setTimeout(15000);
  const id = await page.evaluate(() => {
    const id = crypto.randomUUID();
    window.__mcp.operations([
      { id, threadId: '', directoryId: 'm', kind: 'mcp.test', status: 'running', stage: '正在读取 MCP 工具列表', startedAt: 1 },
      { id: crypto.randomUUID(), threadId: '', directoryId: 'm', kind: 'mcp.test', status: 'failed', stage: '等待连接测试确认', startedAt: 2, error: 'OLDER_FAILURE' },
    ]);
    return id;
  });
  await expect(page.locator('.mcp-test-progress [role=status]')).toHaveText('正在读取 MCP 工具列表');
  await page.evaluate(() => window.__mcp.mount(false));
  await expect(page.locator('.settings-page')).toHaveCount(0);
  await page.evaluate(() => window.__mcp.mount(true));
  const cancel = page.getByRole('button', { name: '取消连接测试', exact: true });
  await expect(cancel).toBeVisible();
  await page.getByRole('button', { name: '连接测试中…', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'mcp.test'))).toHaveLength(0);
  await cancel.click();
  expect(await page.evaluate(() => window.__mcp.calls().filter(call => call.op === 'mcp.testCancel').at(-1))).toMatchObject({ requestId: id });
  await page.evaluate(id => window.__mcp.operations([{ id, threadId: '', directoryId: 'm', kind: 'mcp.test', status: 'interrupted', stage: '正在连接 MCP 服务', startedAt: 1 }]), id);
  await expect(page.locator('.mcp-test-progress [role=status]')).toHaveText('连接测试已中断，可以重新测试');
  await expect(cancel).toHaveCount(0);
  await page.evaluate(() => window.__mcp.locale('en-US'));
  await expect(page.locator('.mcp-test-progress [role=status]')).toHaveText('The connection test was interrupted. You can test again.');
  await expect(page.getByRole('button', { name: 'Save and test', exact: true })).toBeEnabled();
});

test('MCP test progress translates live and stays compact in both themes and supported sizes', async () => {
  test.setTimeout(15000);
  await page.evaluate(() => window.__mcp.operations([{ id: crypto.randomUUID(), threadId: '', directoryId: 'm', kind: 'mcp.test', status: 'running', stage: '正在连接 MCP 服务', startedAt: 1 }]));
  for (const locale of ['zh-CN', 'en-US'] as const) {
    await page.evaluate(value => window.__mcp.locale(value), locale);
    await expect(page.locator('.mcp-test-progress [role=status]')).toHaveText(locale === 'zh-CN' ? '正在连接 MCP 服务' : 'Connecting to the MCP server');
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('.mcp-test-progress').evaluate(element => {
        const button = element.querySelector('button')!;
        return { overflow: element.scrollWidth - element.clientWidth, buttonHeight: button.getBoundingClientRect().height, font: parseFloat(getComputedStyle(button).fontSize) };
      });
      expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.buttonHeight).toBeLessThanOrEqual(36); expect(geometry.font).toBeLessThanOrEqual(14);
    }
  }
});
