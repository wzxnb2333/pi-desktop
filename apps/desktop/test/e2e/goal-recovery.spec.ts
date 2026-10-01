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
  const dir = await mkdtemp(join(tmpdir(), 'pi-goal-recovery-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/goal-recovery-harness.tsx', import.meta.url))], outfile: join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(dir, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByRole('dialog')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('goal save deduplicates immediate clicks, retains drafts and translates retry errors', async () => {
  await page.getByRole('button', { name: '修改目标', exact: true }).click(); await page.getByLabel('目标说明', { exact: true }).fill('Keep my changes');
  await page.evaluate(() => { window.goalRecovery.hold = ['save']; });
  const save = page.getByRole('button', { name: '保存为暂停', exact: true }); await save.evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.goalRecovery.calls.length)).toBe(1); await expect(page.getByLabel('目标说明', { exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.evaluate(() => window.goalRecovery.release('save', '目标已更新，请重新读取后再操作')); await expect(page.getByRole('alert')).toHaveText('目标已更新，请重新读取后再操作');
  await page.evaluate(() => window.goalRecovery.locale('en-US')); await expect(page.getByRole('alert')).toHaveText(translate('en-US', '目标已更新，请重新读取后再操作'));
  await expect(page.getByLabel('Objective', { exact: true })).toHaveValue('Keep my changes'); await page.getByRole('button', { name: 'Save as paused', exact: true }).click(); await page.evaluate(() => window.goalRecovery.release('save'));
  await expect(page.getByText('Keep my changes', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByTestId('draft')).toHaveText('Chat draft');
});

test('goal clear failures retain confirmation, block duplicate actions and retry the same goal', async () => {
  await page.getByRole('button', { name: '清除目标', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '清除持续目标？', exact: true });
  await page.evaluate(() => { window.goalRecovery.hold = ['clear']; }); await confirm.getByRole('button', { name: '清除目标', exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeDisabled(); expect(await page.evaluate(() => window.goalRecovery.calls.length)).toBe(1);
  await page.evaluate(() => window.goalRecovery.release('clear', 'SAVE_FAILED')); await expect(confirm.getByRole('alert')).toHaveText('SAVE_FAILED');
  await confirm.getByRole('button', { name: '清除目标', exact: true }).click(); await page.evaluate(() => window.goalRecovery.release('clear')); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('goal confirmation cannot clear a replacement and an externally removed goal remains editable', async () => {
  await page.getByRole('button', { name: '清除目标', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '清除持续目标？', exact: true });
  await page.evaluate(() => window.goalRecovery.replaceGoal()); await expect(confirm.getByRole('button', { name: '清除目标', exact: true })).toBeDisabled();
  await expect(confirm.getByRole('alert')).toHaveText('目标已更新，请重新读取后再操作'); expect(await page.evaluate(() => window.goalRecovery.calls.length)).toBe(0);
  await confirm.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByText('Replaced objective', { exact: true })).toBeVisible();
  await page.evaluate(() => window.goalRecovery.replaceGoal(true)); await expect(page.getByLabel('目标说明', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '重新载入目标', exact: true }).click(); await expect(page.getByLabel('目标说明', { exact: true })).toHaveValue('');
});

test('late goal responses cannot overwrite or close another task panel', async () => {
  await page.getByRole('button', { name: '修改目标', exact: true }).click(); await page.getByLabel('目标说明', { exact: true }).fill('First task edit'); await page.evaluate(() => { window.goalRecovery.hold = ['save']; });
  await page.getByRole('button', { name: '保存为暂停', exact: true }).click(); await page.evaluate(() => window.goalRecovery.selectThread('other'));
  await expect(page.getByText('Other objective', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '修改目标', exact: true }).click(); await page.getByLabel('目标说明', { exact: true }).fill('Other draft');
  await page.evaluate(() => window.goalRecovery.release('save')); await expect(page.getByLabel('目标说明', { exact: true })).toHaveValue('Other draft'); await expect(page.getByRole('button', { name: '保存为暂停', exact: true })).toBeEnabled();
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' goal recovery keeps drafts and fits three window sizes', async () => {
  await page.goto(url + '?empty=1&locale=' + locale + '&theme=' + theme); await page.getByLabel(translate(locale, '目标说明'), { exact: true }).fill('Unsaved goal'); await page.getByLabel(translate(locale, '验收条件') + ' 1', { exact: true }).fill('Keep this criterion');
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.goalRecovery.locale(value), next);
  await expect(page.getByLabel(translate(next, '目标说明'), { exact: true })).toHaveValue('Unsaved goal'); await page.getByRole('button', { name: translate(next, '关闭'), exact: true }).click();
  const confirm = page.getByRole('dialog', { name: translate(next, '放弃未保存的目标修改？'), exact: true }); await confirm.getByRole('button', { name: translate(next, '取消'), exact: true }).click();
  const panel = page.getByRole('dialog'); for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) { await page.setViewportSize({ width, height }); expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1); const box = await panel.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height); }
  await expect(page.getByLabel(translate(next, '验收条件') + ' 1', { exact: true })).toHaveValue('Keep this criterion');
});
