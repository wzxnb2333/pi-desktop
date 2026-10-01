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
  const directory = await mkdtemp(join(tmpdir(), 'pi-annotations-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/browser-annotations-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByLabel('页面元素', { exact: true })).toBeEnabled(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('annotation capture and save failures keep editable selections and deduplicate same-tick saves', async () => {
  await page.getByLabel('页面元素', { exact: true }).selectOption('0'); await page.getByLabel('标注说明', { exact: true }).fill('Keep this comment');
  await page.evaluate(() => { window.annotationsHarness.hold = ['browser.annotationSave']; });
  const save = page.getByRole('button', { name: '保存标注', exact: true });
  await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotationSave').length)).toBe(1);
  await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: '选择区域', exact: true })).toBeDisabled();
  await page.evaluate(() => window.annotationsHarness.release('browser.annotationSave', 'SAVE_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('SAVE_FAILED'); await expect(page.getByLabel('标注说明', { exact: true })).toHaveValue('Keep this comment'); await expect(page.getByLabel('页面元素', { exact: true })).toHaveValue('0');
  await save.click(); await page.evaluate(() => window.annotationsHarness.release('browser.annotationSave'));
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible(); await expect(page.locator('.annotation-list li')).toHaveCount(2);
});

test('recapture asks about unsaved work and failed replacement preserves the original screenshot and comment', async () => {
  await page.getByLabel('页面元素', { exact: true }).selectOption('0'); await page.getByLabel('标注说明', { exact: true }).fill('Original capture');
  await page.getByRole('button', { name: '截取当前页面', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: '放弃未保存的标注？', exact: true }); await confirm.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotationCapture').length)).toBe(1);
  await page.evaluate(() => { window.annotationsHarness.hold = ['browser.annotationCapture']; });
  await page.getByRole('button', { name: '截取当前页面', exact: true }).click(); confirm = page.getByRole('dialog', { name: '放弃未保存的标注？', exact: true }); await confirm.getByRole('button', { name: '放弃', exact: true }).click();
  await page.evaluate(() => window.annotationsHarness.release('browser.annotationCapture', 'CAPTURE_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('CAPTURE_FAILED'); await expect(page.getByLabel('标注说明', { exact: true })).toHaveValue('Original capture');
  await expect(page.getByLabel('页面元素', { exact: true })).toHaveValue('0'); await page.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
});

test('a saved annotation remains visible when page revalidation fails and draft insertion cannot duplicate text', async () => {
  await page.getByRole('button', { name: '选择区域', exact: true }).click(); await page.getByLabel('标注说明', { exact: true }).fill('Saved but unchecked');
  await page.evaluate(() => { window.annotationsHarness.failReads = 1; }); await page.getByRole('button', { name: '保存标注', exact: true }).click();
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible(); await expect(page.getByText('标注已保存，尚未核对当前页面。', { exact: true })).toBeVisible(); await expect(page.getByRole('alert')).toHaveText('无法读取网页标注信息');
  await expect(page.getByAltText('网页标注截图')).toBeVisible();
  await page.getByRole('button', { name: '重试读取标注', exact: true }).click(); await expect(page.getByText('标注与当前页面一致', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.annotationsHarness.hold = ['attach']; });
  const attach = page.getByRole('button', { name: '加入输入草稿', exact: true }); await attach.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotation' && item.action === 'attach').length)).toBe(1);
  await page.evaluate(() => window.annotationsHarness.release('attach', 'ATTACH_FAILED')); await expect(page.getByTestId('draft')).toContainText('Existing draft');
  await attach.click(); await page.evaluate(() => window.annotationsHarness.release('attach')); await expect(page.getByText('已加入输入草稿', { exact: true })).toBeVisible();
  const draft = await page.getByTestId('draft').innerText(); expect(JSON.parse(draft).attachments).toHaveLength(1); expect(JSON.parse(draft).text).toContain('Existing draft');
  await attach.click(); await page.evaluate(() => window.annotationsHarness.release('attach')); await expect(page.getByText('已加入输入草稿', { exact: true })).toBeVisible(); await expect(page.getByTestId('draft')).toHaveText(draft);
});

test('delete errors retain the confirmation, retry entry and committed annotation until removal succeeds', async () => {
  await page.goto(url + '?create=false'); await expect(page.getByRole('button', { name: '删除标注 Existing annotation', exact: true })).toBeVisible();
  await page.evaluate(() => { window.annotationsHarness.hold = ['remove']; });
  await page.getByRole('button', { name: '删除标注 Existing annotation', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除此网页标注？', exact: true });
  await confirm.getByRole('button', { name: '删除', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotation' && item.action === 'remove').length)).toBe(1);
  await page.evaluate(() => { window.annotationsHarness.markDeleting(); window.annotationsHarness.release('remove', 'DELETE_FAILED'); });
  await expect(confirm.getByRole('alert')).toHaveText('DELETE_FAILED'); await expect(page.locator('.annotation-list li')).toHaveCount(1);
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByText('删除尚未完成，可重试。', { exact: true })).toBeVisible(); await expect(page.locator('.annotation-list li > button').first()).toBeDisabled();
  await page.getByRole('button', { name: '重试删除标注 Existing annotation', exact: true }).click(); await confirm.getByRole('button', { name: '删除', exact: true }).click(); await page.evaluate(() => window.annotationsHarness.release('remove'));
  await expect(confirm).toHaveCount(0); await expect(page.getByText('暂无网页标注', { exact: true })).toBeVisible();
});

test('a late capture from a replaced task is discarded and cannot fill the new task panel', async () => {
  await page.evaluate(() => { window.annotationsHarness.hold = ['browser.annotationCapture']; });
  await page.getByRole('button', { name: '截取当前页面', exact: true }).click();
  await page.evaluate(() => { window.annotationsHarness.hold = []; window.annotationsHarness.selectThread('other'); });
  await expect(page.getByLabel('标注说明', { exact: true })).toBeEnabled(); await page.getByLabel('标注说明', { exact: true }).fill('Other task draft');
  await page.evaluate(() => window.annotationsHarness.release('browser.annotationCapture'));
  await expect.poll(() => page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotationDiscard').length)).toBe(2);
  await expect(page.getByLabel('标注说明', { exact: true })).toHaveValue('Other task draft');
  await page.getByRole('button', { name: '选择区域', exact: true }).click(); await page.getByRole('button', { name: '保存标注', exact: true }).click(); await expect(page.getByText('标注已保存', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.annotationsHarness.calls.filter(item => item.op === 'browser.annotationSave').map(item => 'threadId' in item ? item.threadId : ''))).toEqual(['other']);
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' annotation panel fits three sizes and translates errors without clearing selection', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  await page.getByRole('button', { name: translate(locale, '选择区域'), exact: true }).click(); await page.getByLabel(translate(locale, '标注说明'), { exact: true }).fill('Keep comment on locale switch');
  await page.evaluate(() => { window.annotationsHarness.hold = ['browser.annotationSave']; });
  await page.getByRole('button', { name: translate(locale, '保存标注'), exact: true }).click(); await page.evaluate(() => window.annotationsHarness.release('browser.annotationSave', "Error invoking remote method 'desktop:invoke': Error: 无法读取网页标注信息"));
  await expect(page.getByRole('alert')).toHaveText(translate(locale, '无法读取网页标注信息'));
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.annotationsHarness.locale(value), next);
  await expect(page.getByRole('alert')).toHaveText(translate(next, '无法读取网页标注信息')); await expect(page.getByLabel(translate(next, '标注说明'), { exact: true })).toHaveValue('Keep comment on locale switch');
  const panel = page.getByRole('dialog');
  for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
    await page.setViewportSize({ width, height });
    expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = await panel.boundingBox(); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
  }
});
