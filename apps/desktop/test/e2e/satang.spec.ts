import { taskAction } from './fixtures/task-actions.ts';
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';

type Measurement = { node: number; rect: { x: number; y: number; w: number; h: number }; css: Record<string, string> };
const palette: { samples: { theme: string; width: number; height: number; measurements: Record<string, Measurement> }[] } = JSON.parse(
  await readFile(new URL('../../../../docs/desktop/satang-palette-reference.json', import.meta.url), 'utf8'),
);
const surfaces: { samples: { surface: string; theme: string; width: number; height: number; measurements: Record<string, Measurement> }[] } = JSON.parse(
  await readFile(new URL('../../../../docs/desktop/satang-surfaces-reference.json', import.meta.url), 'utf8'),
);
const review: typeof palette = JSON.parse(await readFile(new URL('../../../../docs/desktop/satang-review-reference.json', import.meta.url), 'utf8'));
const management: typeof palette = JSON.parse(await readFile(new URL('../../../../docs/desktop/satang-management-reference.json', import.meta.url), 'utf8'));
let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-satang-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/reference-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
});
test.afterAll(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

for (const sample of palette.samples) test('Satang palette ' + sample.theme + ' ' + sample.width + ' captured positioning and styles', async () => {
  const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
  try {
    await page.goto(url + '?pinned=1&theme=' + sample.theme);
    await page.getByRole('button', { name: '命令面板', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '命令面板', exact: true });
    const input = dialog.getByRole('combobox');
    await expect(input).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeCloseTo(sample.measurements.dialog.rect.x, 1);
    expect(bounds!.y).toBeCloseTo(sample.measurements.dialog.rect.y, 1);
    expect(bounds!.width).toBe(sample.measurements.dialog.rect.w);
    for (const [locator, key, properties] of [
      [dialog, 'panel', ['backgroundColor', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxShadow']],
      [input, 'input', ['fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'color']],
      [dialog.getByRole('option').first(), 'row', ['fontSize', 'lineHeight', 'fontWeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderRadius', 'backgroundColor']],
    ] as const) {
      const css = await locator.evaluate((element, keys) => { const css = getComputedStyle(element); return Object.fromEntries(keys.map(key => [key, Reflect.get(css, key)])); }, [...properties]);
      for (const property of properties) expect(css[property], key + ' ' + property).toBe(sample.measurements[key].css[property]);
    }
    expect((await input.boundingBox())!.height).toBe(sample.measurements.input.rect.h);
    expect((await dialog.getByRole('option').first().boundingBox())!.height).toBe(sample.measurements.row.rect.h);
    await input.fill('没有这个命令');
    await expect(dialog.getByText('没有匹配结果')).toBeVisible();
    await input.press('Escape');
    await expect(page.getByRole('button', { name: '命令面板', exact: true })).toBeFocused();
  } finally { await page.close(); }
});

test('palette remains usable in short windows, with composition and keyboard selection', async () => {
  const page = await browser.newPage({ viewport: { width: 620, height: 400 } });
  try {
    await page.goto(url + '?pinned=1&conversation=1&overflow=1');
    await page.getByRole('button', { name: '命令面板', exact: true }).click();
    const input = page.getByRole('combobox', { name: '搜索命令或最近任务' });
    await input.fill('任务1');
    const first = page.getByRole('dialog').getByRole('option').first();
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(input).toBeFocused();
    await input.press('ArrowDown');
    await expect(page.getByRole('dialog').getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    const bounds = await page.getByRole('dialog').boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(12);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(388);
    await expect(first).toBeVisible();
    await input.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '命令面板', exact: true }).click();
    await page.locator('.command-backdrop').click({ position: { x: 1, y: 1 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally { await page.close(); }
});

for (const sample of review.samples) test('Satang Review ' + sample.theme + ' ' + sample.width + ' captured structure with live Pi diff', async () => {
  const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url + '?pinned=1&conversation=1&review=1&theme=' + sample.theme);
    await taskAction(page, '查看变更');
    await page.getByRole('tab', { name: /^变更/ }).click();
    await page.locator('.git-file-row > button:first-child').filter({ hasText: 'src/feature.ts' }).click();
    await expect(page.locator('.diff')).toContainText('+const enabled = true;');
    // The user-requested mixed tab strip replaces the old fixed Review categories.
    await expect(page.locator('.workspace-tab-header')).toHaveCSS('height', '46px');
    for (const [selector, key] of [['.git-review-header', 'header'], ['.git-review-filter', 'filterRow'], ['.git-review-filter label', 'filter'], ['.git-review-primary > .file-toolbar', 'fileHeader']] as const) {
      const element = page.locator(selector);
      expect((await element.boundingBox())!.height, key + ' height').toBe(sample.measurements[key].rect.h);
      for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) expect(await element.evaluate((node, key) => Reflect.get(getComputedStyle(node), key), property), key + ' ' + property).toBe(sample.measurements[key].css[property]);
    }
    const filter = page.locator('.git-review-filter label');
    await expect(filter).toHaveCSS('border-radius', sample.measurements.filter.css.borderRadius);
    await expect(filter).toHaveCSS('background-color', sample.measurements.filter.css.backgroundColor);
    const body = (await page.locator('.git-review-body').boundingBox())!;
    const files = (await page.locator('.git-review-files').boundingBox())!;
    const main = (await page.locator('.git-review-primary').boundingBox())!;
    expect(Math.abs(files.width - Math.min(250, body.width * .6))).toBeLessThanOrEqual(.02);
    expect(main.x + main.width).toBeCloseTo(files.x, 1);
    expect(files.x + files.width).toBeCloseTo(body.x + body.width, 1);
    expect(body.height).toBeGreaterThan(200);
    await page.getByRole('searchbox', { name: '筛选变更文件' }).fill('.test');
    await expect(page.locator('.git-file-row')).toHaveCount(1);
    await page.getByRole('button', { name: '隐藏文件列表', exact: true }).click();
    expect((await page.locator('.git-review-primary').boundingBox())!.width).toBeCloseTo(body.width, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const sample of management.samples) for (const route of ['自动化', '待审阅']) test('Satang management ' + route + ' ' + sample.theme + ' ' + sample.width + ' captured layout with Pi controls', async () => {
  const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url + '?pinned=1&theme=' + sample.theme);
    await page.locator('.sidebar').getByRole('button', { name: route, exact: true }).click();
    const heading = page.locator('.management-page h1');
    await expect(heading).toHaveText(route);
    const bounds = (await heading.boundingBox())!;
    expect(bounds.x).toBeCloseTo(sample.measurements.heading.rect.x, 1);
    expect(bounds.y).toBeCloseTo(sample.measurements.heading.rect.y, 1);
    for (const [selector, key, properties] of [
      ['.management-page h1', 'heading', ['fontSize', 'lineHeight', 'fontWeight']],
      ['.management-page .page-heading > p', 'subtitle', ['fontSize', 'lineHeight']],
      ['.management-search-field', 'searchField', ['backgroundColor', 'borderRadius', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'gap']],
      ['.management-search-field input', 'input', ['fontSize', 'lineHeight']],
      ['.management-filters button[aria-pressed="true"]', 'selectedFilter', ['backgroundColor', 'fontSize', 'lineHeight', 'borderRadius', 'paddingLeft', 'paddingRight']],
      ['.management-empty', 'empty', ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'minHeight']],
      ['.management-empty-content', 'emptyContent', ['maxWidth', 'gap']],
      ['.management-empty h3', 'emptyTitle', ['fontSize', 'lineHeight', 'fontWeight']],
      ['.management-empty p', 'emptyBody', ['fontSize', 'lineHeight']],
    ] as const) {
      const css = await page.locator(selector).evaluate((element, keys) => Object.fromEntries(keys.map(key => [key, Reflect.get(getComputedStyle(element), key)])), [...properties]);
      for (const property of properties) expect(css[property], key + ' ' + property).toBe(sample.measurements[key].css[property]);
    }
    for (const [selector, key] of [['.management-search-row', 'searchRow'], ['.management-search-field', 'searchField'], ['.management-filters button[aria-pressed="true"]', 'selectedFilter'], ['.management-empty', 'empty']] as const) expect((await page.locator(selector).boundingBox())!.height, key).toBe(sample.measurements[key].rect.h);
    expect((await page.locator('.management-search-field').boundingBox())!.width).toBeCloseTo(sample.measurements.searchField.rect.w, 1);
    if (route === '自动化') {
      await page.getByRole('button', { name: '创建第一个自动化' }).click();
      await expect(page.locator('#automation-name')).toBeFocused();
      await page.getByRole('button', { name: '取消创建', exact: true }).click();
      await expect(page.getByRole('button', { name: '新建自动化', exact: true })).toBeFocused();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

for (const sample of surfaces.samples) test('Satang ' + sample.surface + ' ' + sample.theme + ' ' + sample.width + ' captured geometry', async () => {
  const page = await browser.newPage({ viewport: { width: sample.width, height: sample.height } });
  try {
    await page.goto(url + '?pinned=1&conversation=1&theme=' + sample.theme);
    if (sample.surface === 'settings') {
      await expect(page.getByRole('button', { name: '文件菜单', exact: true })).toBeVisible();
      await page.keyboard.press('Control+,');
      const heading = page.locator('.settings-page h1');
      await expect(heading).toBeVisible();
      const bounds = await heading.boundingBox();
      expect(bounds!.y).toBeCloseTo(sample.measurements.heading.rect.y, 1);
      expect(bounds!.width).toBeLessThanOrEqual(sample.measurements.frame.rect.w + 1);
      for (const property of ['fontSize', 'fontWeight', 'lineHeight']) {
        expect(await heading.evaluate((node, key) => Reflect.get(getComputedStyle(node), key), property)).toBe(sample.measurements.heading.css[property]);
      }
      await expect(page.locator('.settings-body .field-stack').first()).toHaveCSS('border-radius', sample.measurements.card.css.borderRadius);
      await expect(page.locator('.settings-body .field-stack').first()).toHaveCSS('background-color', sample.measurements.card.css.backgroundColor);
      await page.getByRole('button', { name: '外观', exact: true }).click();
      await expect(page.getByLabel('主题', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '保存设置', exact: true }).click();
      await expect(page.getByText('设置已保存', { exact: true })).toBeVisible();
    } else {
      await taskAction(page, sample.surface === 'terminal' ? '集成终端' : '浏览器预览');
      const strip = page.locator(sample.surface === 'terminal' ? '.terminal-tabs' : '.workspace-tab-header');
      await expect(strip).toBeVisible();
      expect((await strip.boundingBox())!.height).toBe(sample.measurements.strip.rect.h);
      for (const property of sample.surface === 'terminal' ? ['paddingLeft', 'paddingRight', 'backgroundColor'] : []) {
        expect(await strip.evaluate((node, key) => Reflect.get(getComputedStyle(node), key), property)).toBe(sample.measurements.strip.css[property]);
      }
      if (sample.surface === 'preview') {
        const address = page.getByRole('combobox', { name: '预览地址', exact: true });
        for (const property of ['fontSize', 'lineHeight', 'fontWeight', 'backgroundColor', 'borderRadius']) {
          expect(await address.evaluate((node, key) => Reflect.get(getComputedStyle(node), key), property)).toBe(sample.measurements.address.css[property]);
        }
        expect((await address.boundingBox())!.height).toBe(sample.measurements.address.rect.h);
        await expect(page.locator('.tool-launcher button')).toHaveCount(4);
        await expect(page.locator('.tool-launcher h2')).toHaveCSS('font-size', '12px');
        await address.fill('javascript:alert(1)');
        await address.press('Enter');
        await expect(address).toHaveAttribute('aria-invalid', 'true');
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
});
