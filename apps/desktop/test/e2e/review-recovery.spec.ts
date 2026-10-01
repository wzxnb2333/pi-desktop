import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser;
let page: Page;
let url = '';
let errors: string[];
test.setTimeout(20000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-review-recovery-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/review-recovery-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => {
  errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.getByRole('combobox', { name: '审查记录', exact: true })).toBeVisible();
});
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('review comments stay with their own directory', async () => {
  await expect(page.getByText('主目录评论', { exact: true })).toBeVisible();
  await expect(page.getByText('附加目录评论', { exact: true })).toHaveCount(0, { timeout: 1000 });
  await page.evaluate(() => window.reviewRecovery.select('t1', 'extra'));
  await expect(page.getByText('附加目录评论', { exact: true })).toBeVisible();
  await expect(page.getByText('主目录评论', { exact: true })).toHaveCount(0);
});

test('captured versions ignore late results after switching the review or closing the capture', async () => {
  await page.evaluate(() => { window.reviewRecovery.hold = ['review.file']; });
  await page.getByRole('button', { name: '查看捕获版本', exact: true }).click();
  await page.getByRole('combobox', { name: '审查记录', exact: true }).selectOption('r2');
  await page.evaluate(() => window.reviewRecovery.release('review.file'));
  await expect(page.locator('.review-captured')).toHaveCount(0);
  await page.getByRole('button', { name: '查看捕获版本', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('review.file'));
  await expect(page.locator('.review-captured')).toContainText('r2 captured');
  await page.getByRole('button', { name: '查看捕获版本', exact: true }).click();
  await page.locator('.review-captured').getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('review.file'));
  await expect(page.locator('.review-captured')).toHaveCount(0);
});

test('feedback submissions deduplicate and retain newer drafts and retry state across review changes', async () => {
  const input = page.getByRole('textbox', { name: '追加审查反馈', exact: true });
  await input.fill('第一次反馈');
  await page.evaluate(() => { window.reviewRecovery.hold = ['review.finding']; });
  await page.getByRole('button', { name: '保存反馈', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.reviewRecovery.calls.filter(item => item.op === 'review.finding').length)).toBe(1);
  await input.fill('之后输入的新反馈');
  await page.getByRole('combobox', { name: '审查记录', exact: true }).selectOption('r2');
  await expect(input).toHaveValue('');
  await page.evaluate(() => window.reviewRecovery.release('review.finding', 'FEEDBACK_FAILED'));
  await expect(page.locator('.review-findings').getByRole('alert')).toHaveCount(0);
  await page.getByRole('combobox', { name: '审查记录', exact: true }).selectOption('r1');
  await expect(input).toHaveValue('之后输入的新反馈');
  await expect(page.locator('.review-finding').getByRole('alert')).toContainText('FEEDBACK_FAILED');
  await page.getByRole('button', { name: '保存反馈', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('review.finding'));
  await expect(input).toHaveValue('');
  await expect(page.locator('.review-finding').getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.review-finding li')).toHaveText(['之后输入的新反馈']);
});

test('review setup and pending start survive hiding without duplicate requests', async () => {
  await page.getByRole('textbox', { name: '自定义审查要求', exact: true }).fill('仅检查目录边界');
  await page.evaluate(() => { window.reviewRecovery.hold = ['review.start']; });
  await page.getByRole('button', { name: '开始只读审查', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.reviewRecovery.calls.filter(item => item.op === 'review.start').length)).toBe(1);
  await page.evaluate(() => window.reviewRecovery.show(false));
  await page.evaluate(() => window.reviewRecovery.show(true));
  await expect(page.getByRole('textbox', { name: '自定义审查要求', exact: true })).toHaveValue('仅检查目录边界');
  await expect(page.getByRole('button', { name: '开始只读审查', exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewRecovery.release('review.start', 'START_FAILED'));
  await expect(page.locator('.review-findings').getByRole('alert')).toContainText('START_FAILED');
  await page.getByRole('button', { name: '开始只读审查', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('review.start'));
  await expect(page.getByText('正在捕获审查范围…', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '审查记录', exact: true }).selectOption('r1');
  await expect(page.getByRole('button', { name: '开始只读审查', exact: true })).toBeDisabled();
});

test('review cancellation deduplicates, survives hiding and can retry', async () => {
  await page.getByRole('button', { name: '开始只读审查', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消审查', exact: true })).toBeVisible();
  await page.evaluate(() => { window.reviewRecovery.hold = ['review.cancel']; });
  await page.getByRole('button', { name: '取消审查', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.reviewRecovery.calls.filter(item => item.op === 'review.cancel').length)).toBe(1);
  await page.evaluate(() => window.reviewRecovery.show(false));
  await page.evaluate(() => window.reviewRecovery.show(true));
  await expect(page.getByRole('button', { name: '正在取消审查…', exact: true })).toBeDisabled();
  await page.evaluate(() => window.reviewRecovery.release('review.cancel', 'CANCEL_FAILED'));
  await expect(page.locator('.review-findings').getByRole('alert')).toContainText('CANCEL_FAILED');
  await page.getByRole('button', { name: '取消审查', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('review.cancel'));
  await expect(page.getByText('审查已取消', { exact: true })).toBeVisible();
  await expect(page.locator('.review-findings').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始只读审查', exact: true })).toBeEnabled();
});

test('comment removal errors stay with the originating task and retry only once', async () => {
  await page.evaluate(() => { window.reviewRecovery.hold = ['comment.remove']; });
  await page.getByRole('button', { name: '删除评论', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.reviewRecovery.calls.filter(item => item.op === 'comment.remove').length)).toBe(1);
  await page.evaluate(() => window.reviewRecovery.select('t2'));
  await page.evaluate(() => window.reviewRecovery.release('comment.remove', 'REMOVE_FAILED'));
  await expect(page.locator('.review-findings').getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.reviewRecovery.select('t1'));
  await expect(page.locator('.review-findings').getByRole('alert')).toContainText('REMOVE_FAILED');
  await expect(page.getByText('主目录评论', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除评论', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('comment.remove'));
  await expect(page.getByText('主目录评论', { exact: true })).toHaveCount(0);
  await expect(page.locator('.review-findings').getByRole('alert')).toHaveCount(0);
});

test('comment read failure has a retry even when the directory has no reviews', async () => {
  await page.evaluate(() => { window.reviewRecovery.hold = ['comment.list']; window.reviewRecovery.select('t1', 'extra'); });
  await expect.poll(() => page.evaluate(() => window.reviewRecovery.calls.filter(item => item.op === 'comment.list').length)).toBeGreaterThan(1);
  await page.evaluate(() => window.reviewRecovery.release('comment.list', 'READ_FAILED'));
  const alert = page.locator('.review-findings').getByRole('alert');
  await expect(alert).toContainText('READ_FAILED');
  await alert.getByRole('button', { name: '检查位置状态', exact: true }).click();
  await page.evaluate(() => window.reviewRecovery.release('comment.list'));
  await expect(page.getByText('附加目录评论', { exact: true })).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test('late review locations cannot navigate away after task changes', async () => {
  await page.evaluate(() => { window.reviewRecovery.hold = ['review.locate']; });
  await page.locator('.review-location').click();
  await page.evaluate(() => window.reviewRecovery.select('t2'));
  await expect(page.getByRole('combobox', { name: '审查记录', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.reviewRecovery.release('review.locate'));
  await expect(page.locator('.review-findings')).toBeVisible();
  await page.evaluate(() => window.reviewRecovery.select('t1'));
  await expect(page.locator('.review-findings')).toBeVisible();
  expect(await page.evaluate(() => window.reviewRecovery.calls.some(item => item.op === 'ui.threadPatch' && item.patch.reviewTab === 'files'))).toBe(false);
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'] as const)
  test(locale + ' ' + theme + ' review progress retains drafts and fits narrow panels', async () => {
    await page.getByRole('textbox', { name: '自定义审查要求', exact: true }).fill('保留审查要求');
    await page.evaluate(() => { window.reviewRecovery.hold = ['review.start']; });
    await page.getByRole('button', { name: '开始只读审查', exact: true }).click();
    await page.evaluate(({ locale, theme }) => window.reviewRecovery.appearance(locale, theme), { locale, theme });
    await expect(page.getByText(translate(locale, '正在启动审查…'), { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: translate(locale, '自定义审查要求'), exact: true })).toHaveValue('保留审查要求');
    for (const width of [1440, 1280, 1000]) {
      await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
      await expect(page.getByText(translate(locale, '正在启动审查…'), { exact: true })).toBeVisible();
      expect(await page.locator('.review-findings').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.evaluate(() => window.reviewRecovery.release('review.start', '此目录已有审查正在运行'));
    await expect(page.locator('.review-findings').getByRole('alert')).toBeVisible();
    await expect(page.getByRole('textbox', { name: translate(locale, '自定义审查要求'), exact: true })).toHaveValue('保留审查要求');
  });
