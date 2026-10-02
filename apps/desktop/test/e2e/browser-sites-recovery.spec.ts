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
  const directory = await mkdtemp(join(tmpdir(), 'pi-browser-sites-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/browser-sites-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByRole('dialog')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('website saves deduplicate, retain failed drafts and retry the requested rule', async () => {
  await page.evaluate(() => { window.sitesHarness.hold = true; });
  await page.getByLabel('网站来源', { exact: true }).fill('https://new.example');
  await page.getByLabel('网站规则', { exact: true }).click();
  await page.locator('.menu-item[data-value="deny"]').click();
  const add = page.getByRole('button', { name: '添加网站规则', exact: true });
  await add.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.sitesHarness.calls.length)).toBe(1);
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.sitesHarness.release('SAVE_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('SAVE_FAILED'); await expect(add).toBeEnabled();
  await expect(page.getByLabel('网站来源', { exact: true })).toHaveValue('https://new.example');
  await expect(page.getByLabel('网站规则', { exact: true })).toContainText('始终拒绝此网站');
  await page.getByRole('button', { name: '重试保存网站规则', exact: true }).click(); await page.evaluate(() => window.sitesHarness.release());
  await expect(page.getByLabel('网站规则 https://new.example', { exact: true })).toContainText('始终拒绝此网站');
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('status')).toContainText('https://new.example');
});

test('website origin validation cannot silently turn a path or credentials into a whole-site grant', async () => {
  for (const value of ['https://example.org/private', 'https://example.org/?secret=1', 'https://example.org/#private', 'https://user:secret@example.org', 'file:///C:/private']) {
    await page.getByLabel('网站来源', { exact: true }).fill(value); await page.getByRole('button', { name: '添加网站规则', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible(); expect(await page.evaluate(() => window.sitesHarness.calls)).toEqual([]);
  }
  await page.getByLabel('网站来源', { exact: true }).fill('  https://EXAMPLE.org:443/  ');
  await page.getByLabel('网站来源', { exact: true }).press('Enter');
  await expect(page.getByLabel('网站规则 https://example.org', { exact: true })).toContainText('始终允许此网站');
  expect(await page.evaluate(() => window.sitesHarness.calls)).toEqual([{ op: 'browser.site', origin: 'https://example.org', policy: 'allow' }]);
});

test('the current website preserves its existing deny rule when opening the settings form', async () => {
  await page.goto(url + '?url=' + encodeURIComponent('https://existing.example/private'));
  await expect(page.getByLabel('网站来源', { exact: true })).toHaveValue('https://existing.example');
  await expect(page.getByLabel('网站规则', { exact: true })).toContainText('始终拒绝此网站');
  await expect(page.getByLabel('网站来源', { exact: true })).toBeFocused();
});

test('website removal failure keeps the committed rule and retries that origin', async () => {
  await page.evaluate(() => { window.sitesHarness.hold = true; });
  await page.getByRole('button', { name: '移除网站规则 https://existing.example', exact: true }).click();
  await page.evaluate(() => window.sitesHarness.release('REMOVE_FAILED'));
  await expect(page.getByLabel('网站规则 https://existing.example', { exact: true })).toContainText('始终拒绝此网站');
  await page.getByLabel('网站来源', { exact: true }).fill('https://unrelated.example');
  await page.getByRole('button', { name: '重试保存网站规则', exact: true }).click(); await page.evaluate(() => window.sitesHarness.release());
  await expect(page.getByLabel('网站规则 https://existing.example', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('网站来源', { exact: true })).toHaveValue('https://unrelated.example');
  expect(await page.evaluate(() => window.sitesHarness.calls.map(item => item.op === 'browser.site' ? [item.origin, item.policy] : []))).toEqual([['https://existing.example', 'ask'], ['https://existing.example', 'ask']]);
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' website feedback translates without losing the draft or overflowing', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  const panel = page.getByRole('dialog'); await expect(panel).toBeVisible();
  await page.getByLabel(translate(locale, '网站来源'), { exact: true }).fill('file:///C:/private');
  await page.getByRole('button', { name: translate(locale, '添加网站规则'), exact: true }).click();
  await expect(panel.getByRole('alert')).toHaveText(translate(locale, '请输入不含用户名和密码的 HTTP 或 HTTPS 地址'));
  expect(await page.evaluate(() => window.sitesHarness.calls)).toEqual([]);
  await page.evaluate(() => { window.sitesHarness.hold = true; });
  const origin = 'https://' + 'long-host-'.repeat(5) + 'example.org';
  await page.getByLabel(translate(locale, '网站来源'), { exact: true }).fill(origin);
  await page.getByRole('button', { name: translate(locale, '添加网站规则'), exact: true }).click();
  await page.evaluate(() => window.sitesHarness.release("Error invoking remote method 'desktop:invoke': Error: 浏览器操作失败"));
  await expect(panel.getByRole('alert')).toHaveText(translate(locale, '浏览器操作失败'));
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.sitesHarness.locale(value), next);
  await expect(panel.getByRole('alert')).toHaveText(translate(next, '浏览器操作失败'));
  await expect(page.getByLabel(translate(next, '网站来源'), { exact: true })).toHaveValue(origin);
  for (const width of [1440, 1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = await panel.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  }
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
});
