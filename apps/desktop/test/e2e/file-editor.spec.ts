import { taskAction } from './fixtures/task-actions.ts';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser;
let directory = '';
let url = '';
test.setTimeout(30000);
const evidence = fileURLToPath(new URL('../../../../.artifacts/desktop-iteration-03/', import.meta.url));
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-file-editor-'));
  await mkdir(evidence, { recursive: true });
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/file-editor-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });

test('failed confirmed reload preserves the draft and close guard until replacement succeeds', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url);
    const editor = page.getByLabel('文件内容 first.txt', { exact: true });
    await editor.fill('必须保留的未保存内容');
    await page.evaluate(() => { window.fileEditorTest.holdReads = true; });
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.files-workbench > [role=status]')).toBeVisible();
    await page.evaluate(() => window.fileEditorTest.releaseRead('RELOAD_FAILED'));
    await expect(editor).toHaveValue('必须保留的未保存内容', { timeout: 2000 });
    await expect(page.locator('.files-workbench').getByRole('alert')).toContainText('RELOAD_FAILED');
    expect(await page.evaluate(() => window.fileEditorTest.dirty)).toBe(true);
    await page.evaluate(() => { window.fileEditorTest.files['first.txt'] = { ...window.fileEditorTest.files['first.txt'], content: '磁盘上的新版本', version: 'v2' }; });
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await page.evaluate(() => window.fileEditorTest.releaseRead());
    await expect(editor).toHaveValue('磁盘上的新版本');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
  } finally { await page.close(); }
});

for (const content of ['重新加载时继续输入', '原始内容\n']) test('confirmed reload retains later edits: ' + JSON.stringify(content), async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url);
    const editor = page.getByLabel('文件内容 first.txt', { exact: true });
    await editor.fill('已确认放弃的内容');
    await page.evaluate(() => {
      window.fileEditorTest.files['first.txt'] = { ...window.fileEditorTest.files['first.txt'], content: '外部修改', version: 'v2' };
      window.fileEditorTest.holdReads = true;
    });
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.files-workbench > [role=status]')).toBeVisible();
    await editor.fill(content);
    await page.evaluate(() => window.fileEditorTest.releaseRead());
    await expect(editor).toHaveValue(content);
    await expect(page.locator('.files-workbench').getByRole('alert')).toContainText('文件已在外部修改');
    await expect(page.locator('.file-toolbar [role=status]')).toHaveText('有未保存的修改');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(true);
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.writes.length)).toBe(1);
    expect(await page.evaluate(() => window.fileEditorTest.writes[0].version)).toBe('v1');
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect(page.locator('.files-workbench').getByRole('alert')).toContainText('文件已在外部修改');
    expect(await page.evaluate(() => window.fileEditorTest.files['first.txt'].content)).toBe('外部修改');
    await page.getByRole('tab', { name: /^first\.txt/ }).hover();
    await page.getByRole('button', { name: '关闭文件 first.txt', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
    await expect(editor).toHaveValue(content);
  } finally { await page.close(); }
});

for (const target of ['directory', 'task']) test('discard confirmation cannot follow a changed ' + target, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url + '?directories=1');
    await page.getByLabel('文件内容 first.txt', { exact: true }).fill('原上下文的草稿');
    await page.getByRole('tab', { name: /^first\.txt/ }).hover();
    await page.getByRole('button', { name: '关闭文件 first.txt', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('文件编辑测试 / first.txt');
    await page.evaluate(target => window.fileEditorTest.selectContext(target === 'task' ? 't2' : 't1', target === 'directory' ? 'extra' : 'p'), target);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.file-editor')).toHaveValue(target === 'directory' ? '附加目录原文' : '第二个文件\n');
    await page.evaluate(() => window.fileEditorTest.selectContext('t1', 'p'));
    await expect(page.getByLabel('文件内容 first.txt', { exact: true })).toHaveValue('原上下文的草稿');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(true);
  } finally { await page.close(); }
});

test('pending reads and writes stay with their originating directory', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await page.goto(url + '?directories=1');
    const editor = page.getByLabel('文件内容 first.txt', { exact: true });
    await editor.fill('主目录保存');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await page.evaluate(() => window.fileEditorTest.selectContext('t1', 'extra'));
    await expect(editor).toHaveValue('附加目录原文');
    await editor.fill('附加目录草稿');
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.files['first.txt'].content)).toBe('主目录保存');
    await expect(editor).toHaveValue('附加目录草稿');
    expect(await page.evaluate(() => window.fileEditorTest.writes[0].directoryId)).toBe('p');
    await page.evaluate(() => {
      window.fileEditorTest.directoryFiles['first.txt'] = { ...window.fileEditorTest.directoryFiles['first.txt'], content: '附加目录外部更新', version: 'v2' };
      window.fileEditorTest.holdReads = true;
    });
    await page.getByRole('button', { name: '重新加载', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('.files-workbench > [role=status]')).toBeVisible();
    await page.evaluate(() => { window.fileEditorTest.holdReads = false; window.fileEditorTest.selectContext('t1', 'p'); });
    await expect(editor).toHaveValue('主目录保存');
    await page.evaluate(() => window.fileEditorTest.releaseRead());
    await expect(editor).toHaveValue('主目录保存');
    await page.evaluate(() => window.fileEditorTest.selectContext('t1', 'extra'));
    await expect(editor).toHaveValue('附加目录外部更新');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
  } finally { await page.close(); }
});

test('startup reconciles the native close guard with the current renderer buffers', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(url + '?staleDirty=1');
    await expect(page.locator('.file-editor')).toHaveValue('原始内容\n');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
    await page.locator('.file-editor').fill('尚未保存的输入');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(true);
    await page.locator('.file-editor').fill('原始内容\n');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
  } finally { await page.close(); }
});

test('late save acknowledgements preserve edits that return to the old disk content', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  try {
    await page.goto(url);
    const editor = page.getByLabel('文件内容 first.txt', { exact: true });
    await expect(editor).toHaveValue('原始内容\n');
    await editor.fill('提交保存的内容\n');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.writes.length)).toBe(1);
    await editor.fill('原始内容\n');
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.files['first.txt'].content)).toBe('提交保存的内容\n');
    await expect(editor).toHaveValue('原始内容\n', { timeout: 2000 });
    await expect(page.getByRole('button', { name: '保存 *', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.files['first.txt'].content)).toBe('原始内容\n');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
  } finally { await page.close(); }
});

test('pending saves reconcile after leaving and reopening the editor', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  try {
    await page.goto(url);
    const editor = page.getByLabel('文件内容 first.txt', { exact: true });
    await editor.fill('首次保存\n');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await editor.fill('保存中的新编辑\n');
    await taskAction(page, '查看变更');
    await page.getByRole('tab', { name: /^first\.txt/ }).click();
    await expect(editor).toHaveValue('保存中的新编辑\n');
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.files['first.txt'].version)).toBe('v2');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.writes.length)).toBe(2);
    expect(await page.evaluate(() => window.fileEditorTest.writes[1].version)).toBe('v2');
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.files['first.txt'].content)).toBe('保存中的新编辑\n');
    await expect(page.locator('.files-workbench').getByRole('alert')).toHaveCount(0);
  } finally { await page.close(); }
});

test('different files save independently and hidden editors release the application close guard when clean', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  try {
    await page.goto(url);
    await page.getByLabel('文件内容 first.txt', { exact: true }).fill('第一份修改');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await page.getByRole('tab', { name: 'second.txt', exact: true }).click();
    const second = page.getByLabel('文件内容 second.txt', { exact: true });
    await second.fill('第二份修改');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.writes.length)).toBe(2);
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect(second).toHaveValue('第二份修改');
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(true);
    await taskAction(page, '查看变更');
    await expect(page.locator('.files-workbench')).toHaveCount(0);
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
    await page.getByRole('tab', { name: /^second\.txt/ }).click();
    await expect(second).toHaveValue('第二份修改');
    await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await page.getByRole('tab', { name: /^first\.txt/ }).click();
    await expect(page.getByLabel('文件内容 first.txt', { exact: true })).toHaveValue('第一份修改');
  } finally { await page.close(); }
});

test('a failed background save keeps its error and draft when the task is reopened', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  try {
    await page.goto(url);
    const first = page.getByLabel('文件内容 first.txt', { exact: true });
    await first.fill('后台保存的草稿');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await page.locator('.thread-main[title="另一个任务"]').click();
    await page.evaluate(() => window.fileEditorTest.releaseWrite('WRITE_DENIED'));
    await expect(page.locator('.files-workbench').getByRole('alert')).toHaveCount(0);
    await page.locator('.thread-main[title="当前任务"]').click();
    await expect(first).toHaveValue('后台保存的草稿');
    await expect(page.locator('.files-workbench').getByRole('alert')).toContainText('WRITE_DENIED');
    await page.getByRole('button', { name: '保存 *', exact: true }).click();
    await page.evaluate(() => window.fileEditorTest.releaseWrite());
    await expect.poll(() => page.evaluate(() => window.fileEditorTest.dirty)).toBe(false);
    await expect(page.locator('.files-workbench').getByRole('alert')).toHaveCount(0);
  } finally { await page.close(); }
});

for (const locale of ['zh-CN', 'en-US'] as const) {
  for (const theme of ['light', 'dark']) test(locale + ' ' + theme + ' save feedback remains readable and guards duplicate writes and close', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
    try {
      await page.goto(url + '?locale=' + locale + '&theme=' + theme);
      const editor = page.locator('.file-editor');
      await editor.fill('检查保存状态');
      await page.getByRole('button', { name: translate(locale, '保存') + ' *', exact: true }).evaluate(button => {
        (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
      });
      const saving = page.getByRole('button', { name: translate(locale, '正在保存…'), exact: true });
      await expect(saving).toBeDisabled();
      await expect(page.getByRole('button', { name: translate(locale, '重新加载'), exact: true })).toBeDisabled();
      expect(await page.evaluate(() => window.fileEditorTest.writes.length)).toBe(1);
      for (const width of [1440, 1280, 1000]) {
        await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
        await expect(saving).toBeVisible();
        for (const toolbar of await page.locator('.files-workbench .file-toolbar').all())
          expect(await toolbar.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
        if (process.env.PI_DESKTOP_CAPTURE === '1') await page.screenshot({ path: join(evidence, 'file-saving-' + locale + '-' + theme + '-' + width + '.png') });
      }
      await page.getByRole('tab', { name: /^first\.txt/ }).hover();
      await page.getByRole('button', { name: translate(locale, '关闭文件 ') + 'first.txt', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(editor).toHaveValue('检查保存状态');
      await expect(page.locator('.files-workbench').getByRole('alert')).toContainText(translate(locale, '正在保存 {p0}，请完成后再关闭或重新加载。', { p0: 'first.txt' }));
      await page.evaluate(() => window.fileEditorTest.releaseWrite());
      await expect(page.locator('.files-workbench').getByRole('alert')).toHaveCount(0);
      await expect(page.locator('.file-toolbar [role=status]')).toHaveText(translate(locale, '已保存到磁盘'));
      await page.getByRole('tab', { name: /^first\.txt/ }).hover();
      await page.getByRole('button', { name: translate(locale, '关闭文件 ') + 'first.txt', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'first.txt', exact: true })).toHaveCount(0);
    } finally { await page.close(); }
  });

  test(locale + ' file read failures expose an inline retry while the pending state is explicit', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(url + '?locale=' + locale);
      await expect(page.locator('.file-editor')).toHaveValue('原始内容\n');
      await page.evaluate(() => { window.fileEditorTest.holdReads = true; });
      await page.getByRole('tab', { name: 'second.txt', exact: true }).click();
      await expect(page.locator('.files-workbench > [role=status]')).toHaveText(translate(locale, '正在读取文件…'));
      await page.evaluate(() => window.fileEditorTest.releaseRead('READ_FAILED'));
      const retry = page.getByRole('button', { name: translate(locale, '重试读取文件'), exact: true });
      await expect(retry).toBeVisible();
      await expect(page.locator('.files-workbench').getByRole('alert')).toContainText('READ_FAILED');
      await retry.click();
      await expect(page.locator('.files-workbench > [role=status]')).toBeVisible();
      await page.evaluate(() => window.fileEditorTest.releaseRead());
      await expect(page.locator('.file-editor')).toHaveValue('第二个文件\n');
      await expect(page.locator('.files-workbench').getByRole('alert')).toHaveCount(0);
    } finally { await page.close(); }
  });
}
