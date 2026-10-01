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
  const directory = await mkdtemp(join(tmpdir(), 'pi-browser-history-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/browser-history-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByRole('dialog').locator('li')).toHaveCount(50); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('history search hides stale rows, retries failures and ignores late responses', async () => {
  await page.evaluate(() => { window.historyHarness.hold = ['browser.history']; });
  const search = page.getByLabel('搜索浏览历史'); await search.fill('unknown');
  await expect(page.getByText('正在读取浏览历史…', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(0);
  await expect(page.getByText('没有匹配的浏览历史', { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.history' && item.query === 'unknown').length)).toBe(1);
  await search.fill('页面 1');
  await expect.poll(() => page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.history' && item.query === '页面 1').length)).toBe(1);
  await page.evaluate(() => window.historyHarness.release('browser.history', 'OLD_REQUEST_FAILURE'));
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.historyHarness.release('browser.history', '浏览器操作失败'));
  await expect(page.getByRole('alert')).toHaveText('浏览器操作失败');
  await page.getByRole('button', { name: '重试读取浏览历史', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.history' && item.query === '页面 1').length)).toBe(2);
  await page.evaluate(() => window.historyHarness.release('browser.history'));
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(11); await expect(page.getByRole('alert')).toHaveCount(0); await expect(search).toHaveValue('页面 1');
});

test('cleanup scope cannot reuse old counts, clears only once and cancellation is retryable', async () => {
  await expect(page.getByText('3 条历史 · 1 个网站 · 缓存 1.0 MB', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.historyHarness.hold = ['browser.data', 'browser.clear', 'browser.clearCancel']; });
  await page.getByLabel('清理时间范围').selectOption('all');
  await expect(page.getByText('3 条历史 · 1 个网站 · 缓存 1.0 MB', { exact: true })).toHaveCount(0);
  const clear = page.getByRole('button', { name: '清除选定数据', exact: true }); await expect(clear).toBeDisabled();
  await page.evaluate(() => window.historyHarness.release('browser.data', 'SCOPE_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('SCOPE_FAILED'); await expect(clear).toBeDisabled();
  await page.getByRole('button', { name: '重试读取清理范围', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.data' && item.range === 'all').length)).toBe(2);
  await page.evaluate(() => window.historyHarness.release('browser.data'));
  await expect(clear).toBeEnabled();
  await clear.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.clear').length)).toBe(1);
  await page.evaluate(() => window.historyHarness.release('browser.clear'));
  const cancel = page.getByRole('button', { name: '取消', exact: true });
  await cancel.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.clearCancel').length)).toBe(1);
  await page.evaluate(() => window.historyHarness.release('browser.clearCancel', 'CANCEL_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('CANCEL_FAILED'); await cancel.click();
  await page.evaluate(() => { window.historyHarness.hold = []; window.historyHarness.release('browser.clearCancel'); });
  await expect(page.getByText('已取消清理', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(clear).toBeEnabled();
});

test('history opening deduplicates and a late completion cannot close another task dialog', async () => {
  await page.evaluate(() => { window.historyHarness.hold = ['browser.open']; });
  const first = page.getByRole('dialog').locator('li button').first();
  await first.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.open').length)).toBe(1);
  await expect(first).toBeDisabled(); await page.evaluate(() => window.historyHarness.release('browser.open', 'OPEN_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('OPEN_FAILED'); await expect(first).toBeEnabled();
  await first.click(); await page.evaluate(() => window.historyHarness.select('t2'));
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(50);
  await page.evaluate(() => window.historyHarness.release('browser.open'));
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.open').map(item => item.threadId))).toEqual(['t1', 't1']);
});

test('history page recovers when another window removes the last page', async () => {
  await page.evaluate(() => { window.historyHarness.entries = window.historyHarness.entries.slice(0, 3); });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('dialog').locator('li')).toHaveCount(3);
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(page.getByText('3 条记录', { exact: true })).toBeVisible();
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' history errors translate live and the panel fits supported sizes', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  const panel = page.getByRole('dialog'); await expect(panel.locator('li')).toHaveCount(50);
  await page.evaluate(() => { window.historyHarness.hold = ['browser.history']; });
  await page.getByLabel(translate(locale, '搜索浏览历史')).fill('keep-query');
  await expect.poll(() => page.evaluate(() => window.historyHarness.calls.filter(item => item.op === 'browser.history' && item.query === 'keep-query').length)).toBe(1);
  await page.evaluate(() => window.historyHarness.release('browser.history', '浏览器操作失败'));
  await expect(panel.getByRole('alert')).toHaveText(translate(locale, '浏览器操作失败'));
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.historyHarness.locale(value), next);
  await expect(panel.getByRole('alert')).toHaveText(translate(next, '浏览器操作失败'));
  await expect(page.getByLabel(translate(next, '搜索浏览历史'))).toHaveValue('keep-query');
  for (const width of [1440, 1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = await panel.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    const close = page.getByRole('button', { name: translate(next, '关闭'), exact: true }); await close.focus(); await expect(close).toBeFocused();
  }
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
});
