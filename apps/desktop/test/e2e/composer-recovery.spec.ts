import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';

let browser: Browser;
let directory = '';
let url = '';
const evidence = fileURLToPath(new URL('../../../../.artifacts/desktop-iteration-02/', import.meta.url));
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-draft-recovery-'));
  await mkdir(evidence, { recursive: true });
  await build({
    entryPoints: [fileURLToPath(new URL('./fixtures/reference-harness.tsx', import.meta.url))],
    outfile: join(directory, 'app.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent',
  });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

for (const locale of ['zh-CN', 'en-US'] as const) {
  test(locale + ' task suggestions extend the saved draft without sending or losing attachments', async () => {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    try {
      await page.goto(url + '?pinned=1&locale=' + locale + '&theme=' + (locale === 'zh-CN' ? 'dark' : 'light'));
      const input = page.locator('.composer-input');
      await expect(input).toBeVisible();
      const draft = '请保留用户手写内容\n路径 C:/资料/原始文件.md';
      const attachments = ['C:/资料/参考图.png'];
      await page.evaluate(({ text, attachments }) => window.desktop.invoke({ op: 'ui.threadPatch', threadId: 't1', patch: { draft: { text, attachments } } }), { text: draft, attachments });
      await page.locator('.home-options').click();
      await page.getByRole('menuitem', { name: locale === 'zh-CN' ? '了解这个项目' : 'Explore this project', exact: true }).click();
      await expect(input).toBeFocused();
      const prompt = locale === 'zh-CN' ? '请阅读这个项目，说明它的结构、主要功能和启动方式。' : 'Read this project and explain its structure, main features, and how to run it.';
      await expect(input).toHaveValue(draft + '\n\n' + prompt, { timeout: 2000 });
      await expect(page.locator('.attachment-name')).toHaveText('参考图.png');
      await expect.poll(async () => {
        const { data } = await page.evaluate(async () => await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap);
        return { draft: data.ui.threads.t1.draft, status: data.threads[0].status, items: data.threads[0].items };
      }).toEqual({ draft: { text: draft + '\n\n' + prompt, attachments }, status: 'idle', items: [] });
      await page.screenshot({ path: join(evidence, 'suggestion-draft-' + locale + '.png') });
      await page.locator('.thread-main[title="任务2"]').click();
      await expect(input).toHaveValue('');
      await page.locator('.thread-main[title="任务1"]').click();
      await expect(input).toHaveValue(draft + '\n\n' + prompt);
      await expect(page.locator('.attachment-name')).toHaveText('参考图.png');
    } finally { await page.close(); }
  });

  test(locale + ' retry keeps an existing draft and recovers the last prompt only into an empty draft', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(url + '?pinned=1&conversation=1&interrupted=1&locale=' + locale);
      const input = page.locator('.composer-input');
      await expect(input).toBeVisible();
      const draft = '继续之前请先调整实现顺序。';
      const attachments = ['C:/资料/补充说明.md'];
      await page.evaluate(({ text, attachments }) => window.desktop.invoke({ op: 'ui.threadPatch', threadId: 't1', patch: { draft: { text, attachments } } }), { text: draft, attachments });
      const retry = page.getByRole('button', { name: locale === 'zh-CN' ? '继续 / 重试' : 'Continue / Retry', exact: true });
      await retry.click();
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(draft, { timeout: 2000 });
      await expect(page.locator('.attachment-name')).toHaveText('补充说明.md');
      await input.fill('');
      await retry.click();
      await expect(input).toHaveValue('请检查设置保存流程，并说明如何验证。');
      await expect(page.locator('.attachment-name')).toHaveText('补充说明.md');
      await expect.poll(async () => {
        const { data } = await page.evaluate(async () => await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap);
        return { draft: data.ui.threads.t1.draft, status: data.threads[0].status, count: data.threads[0].items.length };
      }).toEqual({ draft: { text: '请检查设置保存流程，并说明如何验证。', attachments }, status: 'interrupted', count: 2 });
    } finally { await page.close(); }
  });
}
