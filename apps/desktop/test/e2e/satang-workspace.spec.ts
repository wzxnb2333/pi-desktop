import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';

const contract: { samples: { theme: string; measurements: Record<string, { css: Record<string, string> }> }[] } = JSON.parse(await readFile(new URL('../../../../docs/desktop/satang-workspace-reference.json', import.meta.url), 'utf8'));
const management: typeof contract = JSON.parse(await readFile(new URL('../../../../docs/desktop/satang-management-reference.json', import.meta.url), 'utf8'));
let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-satang-workspace-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/reference-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
});
test.afterAll(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

for (const sample of contract.samples) for (const width of [1440, 1000]) for (const system of [false, true]) test('Satang workspace ' + sample.theme + ' ' + width + (system ? ' system' : '') + ' source styles and accessible plans', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 }, colorScheme: sample.theme === 'dark' ? 'dark' : 'light', reducedMotion: 'reduce' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url + '?pinned=1&workspace=1&theme=' + (system ? 'system' : sample.theme));
    await page.locator('[data-disclosure^="process:"] > .disclosure-header > button').click();
    const plan = page.locator('.disclosure-plan');
    const toggle = plan.locator('.disclosure-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const properties = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
    for (const [selector, key, keys] of [
      ['.timeline', 'scroll', ['color', 'paddingTop']],
      ['.user-message-bubble', 'bubble', ['backgroundColor', 'color', 'borderRadius', 'maxWidth', ...properties]],
      ['.user-message-bubble .markdown', 'userMarkdown', ['fontSize', 'lineHeight', 'color', 'whiteSpace']],
      ['.disclosure-plan', 'plan', ['backgroundColor', 'borderRadius', 'borderTopWidth']],
      ['.disclosure-plan > .disclosure-header', 'planHeader', ['height', 'gap', ...properties]],
      ['.disclosure-plan .disclosure-summary', 'planTitle', ['color', 'fontSize', 'lineHeight', 'fontWeight', 'gap']],
      ['.disclosure-plan .disclosure-content', 'planBody', properties],
      ['.timeline .notice', 'notice', ['backgroundColor', 'color', 'fontSize', 'lineHeight', 'borderRadius', 'gap', ...properties]],
    ] as const) {
      const css = await page.locator(selector).evaluate((node, keys) => Object.fromEntries(keys.map(key => [key, Reflect.get(getComputedStyle(node), key)])), [...keys]);
      for (const property of keys) expect(css[property], key + '.' + property).toBe(sample.measurements[key].css[property]);
    }
    expect((await plan.boundingBox())!.height).toBe(Number.parseFloat(sample.measurements.plan.css.maxHeight));
    const scroller = plan.locator('.disclosure-content');
    expect(await scroller.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
    const last = plan.locator('[data-plan-step="17"]');
    const lastBounds = (await last.boundingBox())!;
    const scrollBounds = (await scroller.boundingBox())!;
    expect(lastBounds.y).toBeGreaterThanOrEqual(scrollBounds.y);
    expect(lastBounds.y + lastBounds.height).toBeLessThanOrEqual(scrollBounds.y + scrollBounds.height);
    await toggle.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(plan.locator('[data-plan-step]')).toHaveCount(0);
    await page.getByRole('button', { name: '命令面板', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await page.locator('.timeline').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (system) {
      await page.locator('.sidebar').getByRole('button', { name: '自动化', exact: true }).click();
      const expected = management.samples.find(item => item.theme === sample.theme)!;
      await expect(page.locator('.management-search-field')).toHaveCSS('background-color', expected.measurements.searchField.css.backgroundColor);
    }
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});
