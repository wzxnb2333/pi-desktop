import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser, page: Page, url = '', errors: string[];
test.setTimeout(25000);
test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-sidechat-recovery-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/sidechat-recovery-harness.tsx', import.meta.url))], outfile: join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(dir, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByLabel('侧聊消息')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('sidechat append deduplicates clicks, localizes retry errors and retains parent draft until success', async () => {
  await page.evaluate(() => { window.sidechatRecovery.hold = ['sidechat.append']; });
  await page.getByRole('button', { name: '追加到主任务草稿', exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.sidechatRecovery.calls.length)).toBe(1); await expect(page.getByLabel('选择侧聊')).toBeDisabled();
  await page.evaluate(() => window.sidechatRecovery.release('sidechat.append', '主任务草稿已变化，请重新追加侧聊回答')); await expect(page.getByTestId('draft')).toHaveText('Parent draft');
  await page.evaluate(() => window.sidechatRecovery.locale('en-US')); await expect(page.getByRole('alert')).toHaveText(translate('en-US', '主任务草稿已变化，请重新追加侧聊回答'));
  await page.getByRole('button', { name: translate('en-US', '追加到主任务草稿'), exact: true }).click(); await page.evaluate(() => window.sidechatRecovery.release('sidechat.append'));
  await expect(page.getByRole('button', { name: 'Added to main task draft', exact: true })).toBeDisabled(); await expect(page.getByTestId('draft')).toHaveText('Parent draft\n\nSide answer t');
  await page.evaluate(() => window.sidechatRecovery.locale('zh-CN')); await expect(page.locator('.sidechat-panel').getByRole('status')).toHaveText('已追加到主任务草稿，尚未发送');
});

test('late sidechat retention never navigates away from or closes another parent panel', async () => {
  await page.evaluate(() => { window.sidechatRecovery.hold = ['sidechat.keep']; }); await page.getByRole('button', { name: '保留为普通聊天', exact: true }).click();
  await page.evaluate(() => window.sidechatRecovery.selectThread('other')); await expect(page.getByLabel('侧聊消息')).toHaveValue('Other draft'); await expect(page.getByRole('button', { name: '发送侧聊', exact: true })).toBeEnabled();
  await page.evaluate(() => window.sidechatRecovery.release('sidechat.keep')); await expect(page.getByTestId('active')).toHaveText('other'); await expect(page.getByLabel('侧聊消息')).toHaveValue('Other draft');
});

test('sidechat send retries one request identity, preserves newer typing and ignores composing Enter', async () => {
  const input = page.getByLabel('侧聊消息'); await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })));
  expect(await page.evaluate(() => window.sidechatRecovery.calls.length)).toBe(0);
  await page.evaluate(() => { window.sidechatRecovery.hold = ['thread.send']; }); await page.getByRole('button', { name: '发送侧聊', exact: true }).click();
  await page.evaluate(() => window.sidechatRecovery.release('thread.send', 'SEND_FAILED')); await expect(input).toHaveValue('Side draft');
  await page.getByRole('button', { name: '发送侧聊', exact: true }).click(); await input.fill('New typing during send');
  const ids = await page.evaluate(() => window.sidechatRecovery.calls.flatMap(item => item.op === 'thread.send' ? [item.requestId] : [])); expect(ids).toHaveLength(2); expect(ids[0]).toBeTruthy(); expect(ids[1]).toBe(ids[0]);
  await page.evaluate(() => window.sidechatRecovery.release('thread.send')); await expect(input).toHaveValue('New typing during send'); await expect(page.getByTestId('draft')).toHaveText('Parent draft');
});

test('sidechat creation failures keep the same request identity for retry', async () => {
  await page.goto(url + '?empty=1'); await page.evaluate(() => { window.sidechatRecovery.hold = ['sidechat.create']; });
  await page.getByRole('button', { name: '创建只读侧聊', exact: true }).click(); await page.evaluate(() => window.sidechatRecovery.release('sidechat.create', 'SAVE_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('SAVE_FAILED'); await page.getByRole('button', { name: '创建只读侧聊', exact: true }).click();
  const ids = await page.evaluate(() => window.sidechatRecovery.calls.flatMap(item => item.op === 'sidechat.create' ? [item.requestId] : [])); expect(ids).toHaveLength(2); expect(ids[0]).toBeTruthy(); expect(ids[1]).toBe(ids[0]);
  await page.evaluate(() => window.sidechatRecovery.release('sidechat.create')); await expect(page.getByLabel('侧聊消息')).toBeVisible();
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' sidechat recovery preserves input through language and window changes', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme); await page.getByLabel(translate(locale, '侧聊消息')).fill('保留侧聊草稿');
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.sidechatRecovery.locale(value), next);
  const panel = page.locator('.sidechat-panel');
  for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
    await page.setViewportSize({ width, height }); expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    const box = await page.getByRole('button', { name: translate(next, '发送侧聊'), exact: true }).boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(height);
  }
  await expect(page.getByLabel(translate(next, '侧聊消息'))).toHaveValue('保留侧聊草稿');
});
