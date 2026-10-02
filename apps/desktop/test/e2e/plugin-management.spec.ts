import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import type {} from './fixtures/plugin-management-harness.tsx';

let browser: Browser, page: Page, url: string;
let errors: string[];
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-plugin-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/plugin-management-harness.tsx', import.meta.url))], outfile: join(directory, 'harness.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="harness.css"><script src="harness.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.beforeEach(async () => { errors = []; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.locator('.plugin-card')).toBeVisible(); });
test.afterEach(async () => { await page.close(); expect(errors).toEqual([]); });
test.afterAll(async () => { await browser?.close(); });
test.afterAll(cleanupTemporaryDirectories);

test('plugin actions dispatch once and failed requests leave the installed version available for retry', async () => {
  test.setTimeout(30000);
  await page.evaluate(() => window.__plugins.hold('plugin.start', true));
  const update = page.getByRole('button', { name: '检查并准备更新', exact: true });
  await update.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('plugin.start').length), { timeout: 2000 }).toBe(1);
  await expect(update).toBeDisabled();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.start')[0].id, { error: 'UPDATE_DISPATCH_FAILED' }));
  await expect(page.getByRole('alert')).toContainText('UPDATE_DISPATCH_FAILED');
  await expect(page.locator('.plugin-card')).toContainText('1.0.0');
  await expect(update).toBeEnabled(); await update.click();
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('plugin.start').length)).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.start')[0].id));
  await expect(page.getByRole('button', { name: '取消插件操作', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('plugin file picking is serialized and cancellation never starts an installation', async () => {
  test.setTimeout(30000);
  await page.evaluate(() => window.__plugins.hold('plugin.pick', true));
  const install = page.getByRole('button', { name: '从目录安装插件', exact: true });
  await install.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('plugin.pick').length), { timeout: 2000 }).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.pick')[0].id, { value: null }));
  await expect(install).toBeEnabled();
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toEqual([]);
  await install.click();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.pick')[0].id, { value: 'C:/fixture/new-plugin' }));
  await expect(page.getByRole('button', { name: '取消插件操作', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toMatchObject([{ action: 'install', source: 'C:/fixture/new-plugin' }]);
});

test('plugin catalog read failures keep previous entries and retry without installing', async () => {
  test.setTimeout(30000);
  const catalogs = page.locator('.plugin-catalogs');
  await catalogs.locator('summary').click();
  const refresh = catalogs.getByRole('button', { name: '刷新插件目录源', exact: true });
  await refresh.click();
  await expect(catalogs.getByRole('button', { name: '安装此插件', exact: true })).toBeVisible();
  await page.evaluate(() => window.__plugins.hold('plugin.catalog', true));
  await refresh.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('plugin.catalog').length)).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.catalog')[0].id, { error: 'CATALOG_UNAVAILABLE' }));
  await expect(page.getByRole('alert')).toContainText('CATALOG_UNAVAILABLE');
  await expect(catalogs.getByRole('button', { name: '安装此插件', exact: true })).toBeVisible();
  await refresh.focus(); await refresh.press('Enter');
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.catalog')[0].id));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(refresh).toBeEnabled();
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toEqual([]);
});

test('plugin tool policy saves serialize and retain edits when persistence fails', async () => {
  test.setTimeout(30000);
  await page.goto(url + '?policies=1');
  const policies = page.locator('.mcp-tool-policies');
  await policies.locator('summary').click();
  await policies.getByLabel('原始工具名称', { exact: true }).fill('echo');
  await policies.getByRole('button', { name: '添加工具规则', exact: true }).click();
  await policies.getByLabel('工具审批 echo', { exact: true }).click();
  await page.getByRole('menuitemradio', { name: '禁止调用', exact: true }).click();
  await page.evaluate(() => window.__plugins.hold('settings.patch', true));
  const save = policies.getByRole('button', { name: '保存工具策略', exact: true });
  await save.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('settings.patch').length)).toBe(1);
  await expect(policies.getByLabel('工具审批 echo', { exact: true })).toBeDisabled();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('settings.patch')[0].id, { error: 'POLICY_SAVE_FAILED' }));
  await expect(policies.getByRole('alert')).toContainText('POLICY_SAVE_FAILED');
  await expect(policies.getByLabel('工具审批 echo', { exact: true })).toContainText('禁止调用');
  await expect(save).toBeEnabled(); await save.click();
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('settings.patch').length)).toBe(1);
  expect(await page.evaluate(() => window.__plugins.pending('settings.patch')[0].request)).toMatchObject({
    patch: { mcpToolPolicies: { 'plugin:fixture-plugin:tools': { echo: { enabled: true, approval: 'deny', timeoutMs: 120000 } } } },
    base: { mcpToolPolicies: {} },
  });
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('settings.patch')[0].id));
  await expect(policies.getByRole('status')).toHaveText('工具策略已保存，下次任务运行生效');
  await expect(policies.getByRole('alert')).toHaveCount(0);
  await expect(save).toBeDisabled();
});

test('active plugin jobs remain visible and cancellable beyond the recent history limit', async () => {
  test.setTimeout(30000);
  const active = await page.evaluate(() => {
    const id = crypto.randomUUID();
    window.__plugins.operations([
      { id, threadId: '', directoryId: 'fixture-plugin', kind: 'plugin.install', status: 'running', stage: '读取并验证插件', startedAt: 1 },
      ...Array.from({ length: 12 }, (_, index) => ({ id: crypto.randomUUID(), threadId: '', directoryId: 'another', kind: 'plugin.update', status: 'succeeded' as const, stage: '保存插件版本', startedAt: index + 2, endedAt: index + 3 })),
    ]);
    window.__plugins.hold('plugin.cancel', true); return id;
  });
  const cancel = page.getByRole('button', { name: '取消插件操作', exact: true });
  await expect(cancel).toBeVisible({ timeout: 2000 });
  await expect(page.getByRole('button', { name: '检查并准备更新', exact: true })).toBeDisabled();
  await cancel.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('plugin.cancel').length)).toBe(1);
  expect(await page.evaluate(() => window.__plugins.pending('plugin.cancel')[0].request)).toMatchObject({ requestId: active });
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.cancel')[0].id, { error: 'CANCEL_RETRY' }));
  await expect(page.getByRole('alert')).toContainText('CANCEL_RETRY');
  await expect(cancel).toBeEnabled(); await cancel.click();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('plugin.cancel')[0].id));
  await expect(cancel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '检查并准备更新', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('plugin connection credentials can be edited without exposing saved values and retry after a failed save', async () => {
  await page.goto(url + '?policies=1');
  const credentials = page.locator('.mcp-secret-settings');
  await expect(credentials).toBeVisible({ timeout: 2000 });
  await credentials.locator('summary').click();
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('API_TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('fixture-private-token');
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveAttribute('type', 'password');
  await page.evaluate(() => window.__plugins.hold('mcp.secret', true));
  const save = credentials.getByRole('button', { name: '保存连接凭据', exact: true });
  await save.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('mcp.secret').length)).toBe(1);
  expect(await page.evaluate(() => window.__plugins.pending('mcp.secret')[0].request)).toMatchObject({
    id: 'plugin:fixture-plugin:tools', value: { API_TOKEN: 'fixture-private-token' },
    base: { id: 'plugin:fixture-plugin:tools', command: 'node', args: [] },
  });
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await expect(credentials.getByRole('alert')).toContainText('正在保存，请完成后再离开。');
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toHaveLength(0);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secret')[0].id, { error: 'CREDENTIAL_SAVE_FAILED' }));
  await expect(credentials.getByRole('alert')).toContainText('CREDENTIAL_SAVE_FAILED');
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('fixture-private-token');
  await save.click();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secret')[0].id));
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('');
  await expect(credentials.getByRole('status')).toContainText('连接凭据已保存');
  await expect(save).toBeDisabled();
});

test('plugin credential drafts survive filtering and pending status reads, and guard disable and navigation', async () => {
  await page.goto(url + '?policies=1');
  await page.evaluate(() => window.__plugins.hold('mcp.secretStatus', true));
  const credentials = page.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('mcp.secretStatus').length)).toBe(1);
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('API_TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('first-draft');
  await credentials.getByRole('button', { name: '保存连接凭据', exact: true }).click();
  await expect(credentials.getByRole('status')).toHaveText('连接凭据已保存');
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secretStatus')[0].id, { value: { configured: false } }));
  await expect(credentials.locator('.mcp-secret-status')).toContainText('已保存连接凭据');
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('API_TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('unsaved-draft');
  await page.getByRole('searchbox', { name: '搜索插件', exact: true }).fill('不存在的插件');
  await expect(page.locator('.plugin-card')).toBeHidden();
  await page.getByRole('searchbox', { name: '搜索插件', exact: true }).fill('');
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('unsaved-draft');
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '放弃未保存的修改？' })).toBeVisible();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toHaveLength(0);
  await page.getByRole('button', { name: '离开插件页', exact: true }).click();
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('unsaved-draft');
  await page.getByRole('button', { name: '离开插件页', exact: true }).click();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByText('已离开插件页', { exact: true })).toBeVisible();
});

test('plugin credential endpoint changes require explicit review and clearing has confirmation and retry', async () => {
  await page.goto(url + '?policies=1');
  const credentials = page.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('API_TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('retained-draft');
  await page.evaluate(() => window.__plugins.configure({ args: ['{pluginRoot}/server.mjs'] }));
  await expect(credentials.getByRole('alert')).toContainText('连接配置已变化');
  await expect(credentials.getByRole('button', { name: '保存连接凭据', exact: true })).toBeDisabled();
  await credentials.getByRole('button', { name: '使用当前连接配置', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('C:/fixture/installed/content/server.mjs');
  await page.getByRole('dialog').getByRole('button', { name: '使用当前连接配置', exact: true }).click();
  await credentials.getByRole('button', { name: '保存连接凭据', exact: true }).click();
  await expect(credentials.getByRole('status')).toHaveText('连接凭据已保存');
  expect(await page.evaluate(() => window.__plugins.calls().findLast(item => item.op === 'mcp.secret'))).toMatchObject({ base: { args: ['C:/fixture/installed/content/server.mjs'] } });
  await credentials.getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'mcp.secret').length)).toBe(1);
  await page.evaluate(() => window.__plugins.hold('mcp.secret', true));
  await credentials.getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('mcp.secret').length)).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secret')[0].id, { error: 'CLEAR_FAILED' }));
  await expect(credentials.getByRole('alert')).toContainText('CLEAR_FAILED');
  await expect(credentials.locator('.mcp-secret-status')).toContainText('已保存连接凭据');
  await credentials.getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secret')[0].id));
  await expect(credentials.getByRole('status')).toHaveText('连接凭据已清除');
  await expect(credentials.getByRole('button', { name: '清除连接凭据', exact: true })).toBeDisabled();
});

test('plugin credential errors translate immediately and compact controls fit both themes and languages', async () => {
  await page.goto(url + '?policies=1');
  const credentials = page.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('private-value');
  await credentials.getByRole('button', { name: '添加凭据', exact: true }).click();
  await credentials.getByLabel('凭据名称 2', { exact: true }).fill('token');
  await credentials.getByRole('button', { name: '保存连接凭据', exact: true }).click();
  await expect(credentials.getByRole('alert')).toHaveText('凭据名称不能重复');
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'mcp.secret'))).toHaveLength(0);
  for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
    await page.evaluate(({ locale, theme }) => { window.__plugins.locale(locale); document.documentElement.dataset.theme = theme; }, { locale, theme });
    await page.setViewportSize({ width, height });
    await expect(credentials.getByRole('alert')).toHaveText(locale === 'zh-CN' ? '凭据名称不能重复' : 'Credential names must be unique');
    const bounds = await credentials.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { overflow: element.scrollWidth > element.clientWidth + 1, inputs: [...element.querySelectorAll('input')].map(input => ({ height: input.getBoundingClientRect().height, right: input.getBoundingClientRect().right, max: rect.right })) };
    });
    expect(bounds.overflow).toBe(false);
    for (const input of bounds.inputs) { expect(input.height).toBeLessThanOrEqual(36); expect(input.right).toBeLessThanOrEqual(input.max + 1); }
  }
  await expect(credentials.getByLabel('Credential value 1', { exact: true })).toHaveValue('private-value');
});

test('plugin credential status failures can be retried and explicit discard removes the local secret draft', async () => {
  await page.goto(url + '?policies=1');
  await page.evaluate(() => window.__plugins.hold('mcp.secretStatus', true));
  const credentials = page.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('mcp.secretStatus').length)).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secretStatus')[0].id, { error: 'STATUS_READ_FAILED' }));
  await expect(credentials.getByRole('alert')).toHaveText('STATUS_READ_FAILED');
  const retry = credentials.getByRole('button', { name: '刷新凭据状态', exact: true });
  await retry.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => page.evaluate(() => window.__plugins.pending('mcp.secretStatus').length)).toBe(1);
  await page.evaluate(() => window.__plugins.complete(window.__plugins.pending('mcp.secretStatus')[0].id, { value: { configured: true } }));
  await expect(credentials.getByRole('alert')).toHaveCount(0);
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('');
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('discard-this-draft');
  await page.getByRole('button', { name: '停用插件', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(credentials.getByLabel('凭据值 1', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'plugin.start'))).toMatchObject([{ action: 'disable' }]);
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'mcp.secret'))).toHaveLength(0);
});

test('changed plugin endpoints invalidate an open credential-clear confirmation', async () => {
  await page.goto(url + '?policies=1');
  const credentials = page.locator('.mcp-secret-settings'); await credentials.locator('summary').click();
  await credentials.getByLabel('凭据名称 1', { exact: true }).fill('TOKEN');
  await credentials.getByLabel('凭据值 1', { exact: true }).fill('saved-draft');
  await credentials.getByRole('button', { name: '保存连接凭据', exact: true }).click();
  await expect(credentials.getByRole('status')).toHaveText('连接凭据已保存');
  await credentials.getByRole('button', { name: '清除连接凭据', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.__plugins.configure({ args: ['changed-target.mjs'] }));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__plugins.calls().filter(item => item.op === 'mcp.secret'))).toHaveLength(1);
});
