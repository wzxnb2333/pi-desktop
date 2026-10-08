import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser, page: Page, url = '', errors: string[];
test.setTimeout(20000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-browser-bridge-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/browser-bridge-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1000, height: 700 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByText('Main page', { exact: true })).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
const row = (title: string) => page.locator('.field-row').filter({ has: page.getByText(title, { exact: true }) });

test('Chrome grants display their task owner and disable browser access in plan or deny mode', async () => {
  await expect(row('Main page').getByRole('button', { name: '撤销任务授权' })).toBeEnabled();
  await expect(row('Other page').getByRole('button', { name: '已授权给其他任务' })).toBeDisabled();
  await page.getByRole('button', { name: '当前任务', exact: true }).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);
  await page.getByRole('menuitemradio', { name: 'Other task' }).click();
  await expect(row('Main page').getByRole('button', { name: '已授权给其他任务' })).toBeDisabled();
  await row('Other page').getByRole('button', { name: '撤销任务授权' }).click();
  await expect(row('Other page').getByRole('button', { name: '授权给当前任务' })).toBeEnabled();
  await row('Other page').getByRole('button', { name: '授权给当前任务' }).click();
  await expect(row('Other page').getByRole('button', { name: '撤销任务授权' })).toBeEnabled();
  await page.getByRole('button', { name: '当前任务', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Plan task' }).click();
  await expect(row('Unassigned page').getByRole('button', { name: '授权给当前任务' })).toBeDisabled();
  await expect(row('Plan page').getByRole('button', { name: '撤销任务授权' })).toBeEnabled();
  await row('Plan page').getByRole('button', { name: '撤销任务授权' }).click();
  await expect(row('Plan page').getByRole('button', { name: '授权给当前任务' })).toBeDisabled();
  await expect(page.getByText('当前任务权限禁止浏览器操作', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '当前任务', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Denied task' }).click();
  await expect(row('Unassigned page').getByRole('button', { name: '授权给当前任务' })).toBeDisabled();
  expect(await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.grant'))).toEqual([
    { op: 'browser.bridge.grant', threadId: 'other', tabId: 'session/2', allowed: false },
    { op: 'browser.bridge.grant', threadId: 'other', tabId: 'session/2', allowed: true },
    { op: 'browser.bridge.grant', threadId: 'plan', tabId: 'session/4', allowed: false },
  ]);
});

test('failed grants remain visible across polling and can be retried without duplicate operations', async () => {
  await page.evaluate(() => { window.bridgeHarness.hold = true; });
  const grant = row('Unassigned page').getByRole('button', { name: '授权给当前任务' });
  await grant.click(); await expect(grant).toBeDisabled();
  await expect(page.getByRole('button', { name: '生成配对码' })).toBeDisabled();
  await page.evaluate(() => window.bridgeHarness.release('GRANT_FAILED'));
  await expect(page.getByRole('alert')).toContainText('GRANT_FAILED');
  await page.getByRole('button', { name: '重试读取连接状态' }).click();
  await expect(page.getByRole('alert')).toContainText('GRANT_FAILED');
  await grant.click(); await page.evaluate(() => window.bridgeHarness.release());
  await expect(row('Unassigned page').getByRole('button', { name: '撤销任务授权' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.grant').length)).toBe(2);
});

test('bridge events refresh immediately and late status reads cannot revive disconnected tabs', async () => {
  await page.clock.install();
  const initialReads = await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.status').length);
  await page.evaluate(() => { window.bridgeHarness.holdStatus = true; window.bridgeHarness.emit('tabs'); });
  await expect.poll(() => page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.status').length)).toBe(initialReads + 1);
  await page.evaluate(() => { window.bridgeHarness.holdStatus = false; window.bridgeHarness.disconnect(); });
  await expect(page.getByText('尚未连接 Chrome 扩展。', { exact: true })).toBeVisible();
  await expect(page.getByText('Main page', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.bridgeHarness.releaseStatus());
  await page.clock.runFor(32);
  await expect(page.getByText('Main page', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.status').length)).toBe(initialReads + 2);
});

test('browser panel consumes bridge lifecycle events without stealing chat focus', async () => {
  await page.goto(url + '?mode=panel');
  const tabs = page.getByLabel('Chrome 标签', { exact: true });
  await expect(tabs.getByRole('button', { name: 'Main page Chrome' })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Other page Chrome' })).toHaveCount(0);
  await page.clock.install();
  await page.getByRole('textbox', { name: 'Chat draft' }).focus();
  await page.evaluate(() => { window.bridgeHarness.holdStatus = true; window.bridgeHarness.emit('tabs'); });
  await expect.poll(() => page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.tabs').length)).toBe(2);
  await page.evaluate(() => { window.bridgeHarness.holdStatus = false; window.bridgeHarness.disconnect(); });
  await expect(tabs).toHaveCount(0);
  await page.evaluate(() => window.bridgeHarness.releaseStatus());
  await page.clock.runFor(32);
  await expect(tabs).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Chat draft' })).toBeFocused();
  expect(await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.focus'))).toEqual([]);
});

test('late browser panel reads cannot reveal another tasks granted Chrome tabs', async () => {
  await page.goto(url + '?mode=panel');
  const tabs = page.getByLabel('Chrome 标签', { exact: true });
  await expect(tabs.getByRole('button', { name: 'Main page Chrome' })).toBeVisible();
  await page.clock.install();
  await page.evaluate(() => { window.bridgeHarness.holdStatus = true; window.bridgeHarness.emit('tabs'); });
  await expect.poll(() => page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.tabs').length)).toBe(2);
  await page.evaluate(() => window.bridgeHarness.select('other'));
  await expect(tabs).toHaveCount(0);
  await page.evaluate(() => window.bridgeHarness.releaseStatus());
  await page.clock.runFor(32);
  await expect(tabs).toHaveCount(0);
  await page.evaluate(() => { window.bridgeHarness.holdStatus = false; window.bridgeHarness.emit('tabs'); });
  await expect(tabs.getByRole('button', { name: 'Other page Chrome' })).toBeVisible();
  await page.evaluate(() => window.bridgeHarness.releaseStatus());
  await page.clock.runFor(32);
  await expect(tabs.getByRole('button', { name: 'Main page Chrome' })).toHaveCount(0);
  await tabs.getByRole('button', { name: 'Other page Chrome' }).click();
  expect(await page.evaluate(() => window.bridgeHarness.calls.filter(call => call.op === 'browser.bridge.focus'))).toEqual([
    { op: 'browser.bridge.focus', sessionId: 'session', tabId: 'session/2' },
  ]);
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(`${locale} ${theme} pairing refreshes port and disconnects all sessions`, async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  await page.getByRole('button', { name: translate(locale, '生成配对码') }).click();
  await expect(page.getByText('127.0.0.1:34567', { exact: true })).toBeVisible();
  await expect(page.getByText('ABC123', { exact: true })).toBeVisible();
  await expect(page.getByText(translate(locale, '扩展协议版本 {p0}', { p0: 2 }), { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: translate(locale, '断开全部连接') }).click();
  await expect(page.getByText('Main page', { exact: true })).toHaveCount(0);
  await expect(page.getByText(translate(locale, '尚未连接 Chrome 扩展。'), { exact: true })).toBeVisible();
});
