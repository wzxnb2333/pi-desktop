import { expectAdaptedAppearance } from './fixtures/adapted-appearance.ts';
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser } from '@playwright/test';
import type { Bootstrap } from '../../src/shared/contracts.ts';

let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-reference-states-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/reference-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

for (const risk of ['high', 'uncertain']) for (const theme of ['light', 'dark']) test('independent approval review explanation ' + risk + ' ' + theme, async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url + '?approval=action&risk=' + risk + '&theme=' + theme);
    const review = page.locator('[data-approval-review]');
    await expect(review).toContainText(risk === 'high' ? '独立审查发现风险，需要你批准' : '独立审查无法确认安全，需要你批准');
    await expect(review).toContainText('审查模型：Fixture reviewer');
    await page.evaluate(async () => { const snapshot = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap; await window.desktop.invoke({ op: 'ui.update', ui: { ...snapshot.data.ui, locale: 'en-US' }, frame: { locale: 'en-US' } }); });
    await expect(review).toContainText(risk === 'high' ? 'Independent review found a risk' : 'Independent review could not confirm safety');
    if (risk === 'uncertain') await expect(review).toContainText('Independent review failed or returned an invalid result');
    for (const width of [1000, 1280, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 940 : width === 1280 ? 800 : 700 });
      expect(await review.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    }
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    expect(await page.evaluate(() => window.referenceStates.replies)).toEqual([{ op: 'approval.reply', id: 'reference-approval', approved: false }]);
  } finally { await page.close(); }
});


for (const mode of ['light', 'dark']) for (const cardWidth of [336, 736]) for (const system of [false, true]) test('approval adaptation ' + mode + ' card ' + cardWidth + (system ? ' system' : ''), async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, colorScheme: mode as 'light' | 'dark' });
  try {
    await page.goto(url + '?pinned=1&approval=action&theme=' + (system ? 'system' : mode));
    const card = page.getByRole('region', { name: '待审批操作' });
    await expect(card).toBeVisible();
    await card.evaluate((node, width) => { (node as HTMLElement).style.width = width + 'px'; }, cardWidth);
    await card.scrollIntoViewIfNeeded();
    await expectAdaptedAppearance(page, mode, ['.approval-card', '.approval-actions button.primary', '.approval-actions button:not(.primary)']);
    expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await expect(card.getByRole('button', { name: '允许这一次' })).toBeEnabled();
    await expect(card.getByRole('button', { name: '拒绝' })).toBeEnabled();
  } finally { await page.close(); }
});

for (const kind of ['action', 'confirm', 'input', 'select']) test('approval ' + kind + ' preserves reply data, suppresses duplicate submits and recovers failure', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url + '?pinned=1&approval=' + kind + '&holdReply=1');
    const card = page.getByRole('region', { name: '待审批操作' });
    if (kind === 'input') await card.getByLabel('回复内容').fill('使用中文回复');
    if (kind === 'select') await card.getByLabel('选择回复').selectOption('使用工作区配置');
    if (kind === 'input') await card.getByLabel('回复内容').press('Enter');
    else await card.getByRole('button', { name: '允许这一次' }).click();
    await expect(card).toHaveAttribute('aria-busy', 'true');
    await expect(card.getByRole('button', { name: '允许这一次' })).toBeDisabled();
    await expect(card.getByRole('button', { name: '拒绝' })).toBeDisabled();
    // Duplicate form events can occur before the IPC response; only one request may leave the card.
    await card.locator('form').evaluate(node => { node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(await page.evaluate(() => window.referenceStates.replies)).toEqual([{ op: 'approval.reply', id: 'reference-approval', approved: true, value: kind === 'input' ? '使用中文回复' : kind === 'select' ? '使用工作区配置' : '' }]);
    await page.evaluate(() => window.referenceStates.releaseReply('审批服务暂不可用'));
    await expect(card).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByText('审批服务暂不可用', { exact: true })).toBeVisible();
    if (kind === 'input') await expect(card.getByLabel('回复内容')).toHaveValue('使用中文回复');
    if (kind === 'select') await expect(card.getByLabel('选择回复')).toHaveValue('使用工作区配置');
    await card.getByRole('button', { name: '拒绝' }).focus();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.referenceStates.replies.at(-1))).toEqual({ op: 'approval.reply', id: 'reference-approval', approved: false });
    await page.evaluate(() => window.referenceStates.releaseReply());
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => window.referenceStates.replies.length)).toBe(2);
    expect(errors).toEqual([]);
  } finally { await page.close(); }
});

test('long approval remains readable and keyboard-scrollable in a compact window', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url + '?pinned=1&approval=input&longapproval=1');
    const description = page.locator('.approval-description');
    await page.getByRole('region', { name: '待审批操作' }).focus();
    await page.keyboard.press('Tab');
    await expect(description).toBeFocused();
    await description.press('End');
    await expect.poll(() => description.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    await expect(description).toContainText('操作 39：');
    expect(await description.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.locator('.timeline').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('回复内容')).toBeFocused();
    await page.getByLabel('回复内容').fill('确认');
    await page.getByLabel('回复内容').press('Enter');
    await expect(page.locator('.approval-card')).toHaveCount(0);
  } finally { await page.close(); }
});

for (const mode of ['light', 'dark'] as const) for (const width of [1000, 1440]) test('loading adaptation ' + mode + ' ' + width + ' remains centered and reaches real workspace', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 }, colorScheme: mode });
  try {
    await page.goto(url + '?loading=1&theme=system');
    await expect(page.getByRole('status')).toHaveText('正在打开工作台…');
    await expect(page.locator('.loading')).toHaveAttribute('aria-busy', 'true');
    await expectAdaptedAppearance(page, mode, ['.loading', '.loading-content', '.loading .pi-logo']);
    await expect(page.locator('.loading-titlebar')).toHaveCSS('height', '46px');
    const frame = (await page.locator('.loading-content').boundingBox())!;
    expect(frame.x + frame.width / 2).toBe(width / 2);
    expect(frame.y + frame.height / 2).toBe((width === 1440 ? 940 : 700) / 2);
    await page.evaluate(() => window.referenceStates.releaseBootstrap());
    await expect(page.locator('.loading')).toHaveCount(0);
    await expect(page.locator('.desktop')).toBeVisible();
  } finally { await page.close(); }
});

test('bootstrap failure exposes its full message without remaining busy or overflowing', async () => {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  try {
    await page.goto(url + '?loading=1');
    await expect(page.getByRole('status')).toBeVisible();
    const failure = '无法打开工作区：' + '中文长路径'.repeat(60);
    await page.evaluate(failure => window.referenceStates.releaseBootstrap(failure), failure);
    await expect(page.getByRole('alert')).toHaveText(failure);
    await expect(page.locator('.loading')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.desktop')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
});
