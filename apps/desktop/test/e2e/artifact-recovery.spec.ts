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
  const dir = await mkdtemp(join(tmpdir(), 'pi-artifact-recovery-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/artifact-recovery-harness.tsx', import.meta.url))], outfile: join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent', plugins: [{ name: 'controlled-pdf', setup(builder) { builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: fileURLToPath(new URL('./fixtures/artifact-pdf-fake.ts', import.meta.url)) })); } }] });
  await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(dir, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByLabel('标注说明', { exact: true })).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('artifact save failures preserve coordinates and comment, deduplicate and retain a committed screenshot after read failure', async () => {
  await page.getByLabel('标注说明', { exact: true }).fill('Keep my artifact'); await page.getByLabel('水平位置', { exact: true }).fill('35');
  await page.evaluate(() => { window.artifactRecovery.hold = ['artifact.annotationSave']; });
  const save = page.getByRole('button', { name: '保存标注', exact: true }); await save.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.annotationSave').length)).toBe(1);
  await expect(page.getByLabel('水平位置', { exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.artifactRecovery.release('artifact.annotationSave', 'SAVE_FAILED')); await expect(page.getByRole('alert')).toHaveText('SAVE_FAILED');
  await expect(page.getByLabel('标注说明', { exact: true })).toHaveValue('Keep my artifact'); await expect(page.getByLabel('水平位置', { exact: true })).toHaveValue('35');
  await page.evaluate(() => { window.artifactRecovery.failReads = 1; }); await save.click(); await page.evaluate(() => window.artifactRecovery.release('artifact.annotationSave'));
  await expect(page.getByText('标注已保存', { exact: true })).toBeVisible(); await expect(page.getByText('标注已保存，尚未核对当前文件。', { exact: true })).toBeVisible(); await expect(page.getByAltText('产物标注截图')).toBeVisible();
  await page.getByRole('button', { name: '重试读取标注', exact: true }).click(); await expect(page.getByText('标注与当前文件版本一致', { exact: true })).toBeVisible(); await expect(page.locator('.annotation-list li')).toHaveCount(2);
  await page.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(page.getByText('已加入输入草稿', { exact: true })).toBeVisible(); const draft = await page.getByTestId('draft').innerText();
  await page.getByRole('button', { name: '加入输入草稿', exact: true }).click(); await expect(page.getByText('已加入输入草稿', { exact: true })).toBeVisible(); await expect(page.getByTestId('draft')).toHaveText(draft); expect(JSON.parse(draft).attachments).toHaveLength(1);
});

test('artifact deletion retains errors and a retry entry until the committed record is removed', async () => {
  await page.goto(url + '?savedOnly=1'); await page.getByRole('button', { name: '删除标注 Existing artifact', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除此产物标注？', exact: true }); await page.evaluate(() => { window.artifactRecovery.hold = ['remove']; });
  await confirm.getByRole('button', { name: '删除', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(confirm.getByRole('button', { name: '取消', exact: true })).toBeDisabled(); expect(await page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.annotation' && item.action === 'remove').length)).toBe(1);
  await page.evaluate(() => { window.artifactRecovery.markDeleting(); window.artifactRecovery.release('remove', 'REMOVE_FAILED'); }); await expect(confirm.getByRole('alert')).toHaveText('REMOVE_FAILED');
  await confirm.getByRole('button', { name: '取消', exact: true }).click(); await expect(page.getByText('删除尚未完成，可重试。', { exact: true })).toBeVisible(); await expect(page.locator('.annotation-list li > button').first()).toBeDisabled();
  await page.getByRole('button', { name: '重试删除标注 Existing artifact', exact: true }).click(); await confirm.getByRole('button', { name: '删除', exact: true }).click(); await page.evaluate(() => window.artifactRecovery.release('remove'));
  await expect(confirm).toHaveCount(0); await expect(page.getByText('暂无产物标注', { exact: true })).toBeVisible();
});

test('cancelled artifact opens ignore late documents and failed cancellation can retry the same request', async () => {
  await page.goto(url + '?surface=preview&holdOpen=1'); await page.evaluate(() => { window.artifactRecovery.hold.push('artifact.close'); });
  await page.getByRole('button', { name: '取消加载', exact: true }).click(); await page.evaluate(() => window.artifactRecovery.release('artifact.close', 'CANCEL_FAILED'));
  await expect(page.getByRole('alert')).toHaveText('CANCEL_FAILED'); await page.getByRole('button', { name: '取消加载', exact: true }).click(); await page.evaluate(() => window.artifactRecovery.release('artifact.close'));
  await expect(page.getByText('预览已取消', { exact: true })).toBeVisible(); await page.evaluate(() => window.artifactRecovery.release('artifact.open'));
  await expect(page.getByLabel('隔离 HTML 预览', { exact: true })).toHaveCount(0);
  const ids = await page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.close').map(item => 'previewId' in item ? item.previewId : '')); expect(ids).toHaveLength(2); expect(ids[0]).toBeTruthy(); expect(ids[0]).toBe(ids[1]);
  await page.evaluate(() => { window.artifactRecovery.hold = []; }); await page.getByRole('button', { name: '重新加载预览', exact: true }).click(); await expect(page.getByLabel('隔离 HTML 预览', { exact: true })).toBeVisible();
});

test('late artifact captures cannot enter another file and network grants deduplicate and recover', async () => {
  await page.goto(url + '?surface=preview'); const capture = page.getByRole('button', { name: '标注预览区域', exact: true }); await expect(capture).toBeEnabled();
  await page.evaluate(() => { window.artifactRecovery.hold = ['artifact.capture']; }); await capture.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.capture').length)).toBe(1);
  await page.evaluate(() => window.artifactRecovery.selectPath('second.html')); await expect(capture).toBeEnabled(); await page.evaluate(() => window.artifactRecovery.release('artifact.capture'));
  await expect.poll(() => page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.annotationDiscard').length)).toBe(1); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.artifact-network summary').click(); await page.evaluate(() => { window.artifactRecovery.hold = ['artifact.network']; }); const allow = page.getByRole('button', { name: '允许此来源', exact: true });
  await allow.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }); expect(await page.evaluate(() => window.artifactRecovery.calls.filter(item => item.op === 'artifact.network').length)).toBe(1);
  await page.evaluate(() => window.artifactRecovery.release('artifact.network', 'NETWORK_FAILED')); await expect(page.getByRole('alert')).toHaveText('NETWORK_FAILED'); await allow.click(); await page.evaluate(() => window.artifactRecovery.release('artifact.network')); await expect(page.getByRole('button', { name: '撤销授权', exact: true })).toBeEnabled();
});

test('PDF search changes invalidate old results and page capture waits for the matching completed render', async () => {
  await page.goto(url + '?surface=pdf'); const capture = page.getByRole('button', { name: '标注此页', exact: true }); await expect(capture).toBeEnabled();
  await page.evaluate(() => { window.pdfRecovery.holdText = true; }); await page.getByLabel('搜索 PDF', { exact: true }).fill('Alpha'); await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByRole('button', { name: '取消搜索', exact: true })).toBeVisible();
  await page.getByLabel('搜索 PDF', { exact: true }).fill('Beta'); await page.evaluate(() => { window.pdfRecovery.holdText = false; window.pdfRecovery.release('text'); }); await expect(page.getByRole('list', { name: 'PDF 搜索结果' })).toHaveCount(0);
  await page.getByRole('button', { name: '搜索', exact: true }).click(); await expect(page.getByRole('button', { name: /第 2 页 · Beta/ })).toBeVisible();
  await page.evaluate(() => { window.pdfRecovery.holdRender = true; }); await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(capture).toBeDisabled();
  expect(await page.evaluate(() => window.artifactRecovery.pdfCaptures)).toEqual([]);
  await page.evaluate(() => { window.pdfRecovery.holdRender = false; window.pdfRecovery.release('render'); }); await expect(capture).toBeEnabled(); await capture.click(); expect(await page.evaluate(() => window.artifactRecovery.pdfCaptures.map(value => value.page))).toEqual([2]);
  expect(await page.getByLabel('PDF 当前页面', { exact: true }).evaluate((canvas: HTMLCanvasElement) => Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data))).toEqual([0, 0, 255, 255]);
  await page.getByLabel('搜索 PDF', { exact: true }).fill(''); await expect(page.getByRole('list', { name: 'PDF 搜索结果' })).toHaveCount(0);
});

test('PDF worker setup errors stay recoverable and translate when the interface language changes', async () => {
  await page.goto(url + '?surface=pdf&failPdf=1'); await expect(page.getByRole('alert')).toContainText('无法解析 PDF：');
  await page.evaluate(() => window.artifactRecovery.locale('en-US')); await expect(page.getByRole('alert')).toContainText('Unable to parse PDF:'); await expect(page.getByRole('alert')).toContainText('WORKER_SETUP_FAILED');
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' artifact annotations keep drafts and fit three window sizes', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme); await page.getByLabel(translate(locale, '标注说明'), { exact: true }).fill('Keep this draft');
  await page.evaluate(() => { window.artifactRecovery.hold = ['artifact.annotationSave']; }); await page.getByRole('button', { name: translate(locale, '保存标注'), exact: true }).click(); await page.evaluate(() => window.artifactRecovery.release('artifact.annotationSave', "Error invoking remote method 'desktop:invoke': Error: 标注截图已损坏，原始记录仍保留"));
  await expect(page.getByRole('alert')).toHaveText(translate(locale, '标注截图已损坏，原始记录仍保留'));
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.artifactRecovery.locale(value), next); await expect(page.getByRole('alert')).toHaveText(translate(next, '标注截图已损坏，原始记录仍保留')); await expect(page.getByLabel(translate(next, '标注说明'), { exact: true })).toHaveValue('Keep this draft');
  const panel = page.getByRole('dialog'); for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) { await page.setViewportSize({ width, height }); expect(await panel.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1); const box = await panel.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height); }
});
