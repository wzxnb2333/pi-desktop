import { expectAdaptedAppearance } from './fixtures/adapted-appearance.ts';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import type { TimelineItem } from '../../src/shared/contracts.ts';

// Existing Pi interaction behavior, not a same-version visual reference.
const motion = { durationMs: 300, easing: [0.19, 1, 0.22, 1] };
const selectors: Record<string, string> = { row: '[data-disclosure="row"]', 'row-header': '.disclosure-header', 'row-toggle': '.disclosure-toggle', 'row-summary': '.disclosure-summary', 'row-label': '.disclosure-label', 'row-chevron': '.disclosure-chevron', 'row-body': '.disclosure-content', group: '[data-disclosure="group"]', 'group-body': '.disclosure-content', 'file-header': '.disclosure-header', 'file-label': '.disclosure-label', 'file-link': '.activity-file-link', diff: '.activity-diff', 'diff-heading': '.activity-diff-heading' };
let browser: Browser;
let directory = '';
let url = '';
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-activity-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/activity-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function open(page: Page, scene: string, mode = 'light') {
  await page.goto(url + '?scene=' + scene + '&theme=' + (mode.startsWith('system') ? 'system' : mode));
  await expect(page.locator('[data-activity-ready]')).toHaveCount(1);
}
async function update(page: Page, items: Partial<TimelineItem>[], status = 'running') {
  await page.evaluate(({ items, status }) => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { items: items.map((item, index) => ({ text: '', timestamp: index, ...item })), status } })), { items, status });
}

test('running and completed defaults respect explicit nested choices and unknown thinking time', async () => {
  const page = await browser.newPage();
  try {
    await open(page, 'behavior');
    const items: Partial<TimelineItem>[] = [{ id: 'u', role: 'user', text: '检查' }, { id: 'a', role: 'assistant', state: 'running', blocks: [{ type: 'thinking', text: '供应商原文' }] }];
    await update(page, items);
    const process = page.locator('[data-disclosure="process:u"] > .disclosure-header > button');
    const thinking = page.locator('[data-disclosure="thinking:a:0"] > .disclosure-header > button');
    await expect(thinking).toHaveAttribute('aria-expanded', 'true');
    await thinking.click();
    items[1].blocks = [{ type: 'thinking', text: '供应商原文继续' }];
    await update(page, items);
    await expect(thinking).toHaveAttribute('aria-expanded', 'false');
    items[1].state = 'done'; items[1].stopReason = 'toolUse';
    items.push({ id: 'c', role: 'tool', toolName: 'mcp_demo', state: 'running', text: '实时输出' });
    await update(page, items);
    await page.locator('[data-disclosure="group:c"] > .disclosure-header > button').click();
    const tool = page.locator('[data-disclosure="tool:c"] > .disclosure-header > button');
    await expect(tool).toHaveAttribute('aria-expanded', 'true');
    await tool.click();
    items[2].text += '继续';
    await update(page, items);
    await expect(tool).toHaveAttribute('aria-expanded', 'false');
    // A deliberate process expansion overrides the completion default.
    await process.click(); await process.click();
    items[2].state = 'done';
    items.push({ id: 'answer', role: 'assistant', state: 'done', text: '完成', stopReason: 'stop' });
    await update(page, items, 'idle');
    await expect(process).toHaveAttribute('aria-expanded', 'true');
    await expect(thinking).toHaveAccessibleName('思考过程');
    await expect(tool).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: '切换任务二' }).click();
    await page.getByRole('button', { name: '切换任务一' }).click();
    await expect(process).toHaveAttribute('aria-expanded', 'true');
    await expect(thinking).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.turn-answer .markdown')).toHaveText('完成');
  } finally { await page.close(); }
});

test('harness calls stay visible as desktop interface activity with exact tool names', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'harness');
    const activity = page.locator('[data-tool-kind="harness"]');
    await expect(activity).toHaveCount(1);
    await expect(activity).toHaveAttribute('data-harness-tool', 'get_harness');
    await expect(activity.locator('.tool-activity-origin')).toHaveText('桌面接口');
    await expect(activity.locator('.disclosure-label')).toContainText('已调用桌面接口 get_harness');
  } finally { await page.close(); }
});

test('completed thinking keeps its measured duration and post-answer notices remain outside the folded process', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    await update(page, [
      { id: 'u', role: 'user', text: '检查' },
      { id: 'a', role: 'assistant', state: 'done', stopReason: 'stop', startedAt: 100, completedAt: 3000, text: '最终回答', blocks: [{ type: 'thinking', text: '供应商思考', startedAt: 200, completedAt: 1600 }, { type: 'text', text: '最终回答' }] },
      { id: 'notice', role: 'notice', text: '扩展通知' },
    ], 'idle');
    const process = page.locator('[data-disclosure="process:u"] > .disclosure-header > button');
    await expect(process).toHaveAccessibleName('已完成过程 · 2 秒');
    await expect(process).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.turn-answer .markdown')).toHaveText('最终回答');
    await expect(page.locator('.turn-notices')).toHaveText('扩展通知');
    await process.click();
    await expect(page.locator('[data-disclosure="thinking:a:0"] > .disclosure-header > button')).toHaveAccessibleName('已思考 1 秒');
  } finally { await page.close(); }
});

test('folding preserves a reader anchor and follows new output only while pinned', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'behavior');
    const items: Partial<TimelineItem>[] = [{ id: 'u', role: 'user', text: '首轮' }, { id: 'c', role: 'tool', toolName: 'bash', state: 'done', args: '{"command":"echo sample"}', text: '命令输出\n'.repeat(80) }, { id: 'u2', role: 'user', text: '第二轮' }, { id: 'a2', role: 'assistant', text: '很长的历史段落。\n\n'.repeat(90), state: 'done', stopReason: 'stop' }];
    await update(page, items, 'idle');
    const scroll = page.locator('.timeline');
    await scroll.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
    const group = page.locator('[data-disclosure="group:c"] > .disclosure-header > button');
    const before = (await group.boundingBox())!.y;
    await group.click();
    await expect(page.locator('[data-disclosure="group:c"]')).toHaveAttribute('data-phase', 'expanded');
    expect(Math.abs((await group.boundingBox())!.y - before)).toBeLessThanOrEqual(.5);
    const tool = page.locator('[data-disclosure="tool:c"] > .disclosure-header > button');
    const toolY = (await tool.boundingBox())!.y;
    await tool.click();
    await expect(page.locator('.tool-output')).toBeVisible();
    expect(Math.abs((await tool.boundingBox())!.y - toolY)).toBeLessThanOrEqual(.5);
    const scrollTop = await scroll.evaluate(node => node.scrollTop);
    items[3].text += '\n\n新增内容。'; await update(page, items, 'idle');
    expect(await scroll.evaluate(node => node.scrollTop)).toBe(scrollTop);
    await page.getByRole('button', { name: '回到最新消息' }).click();
    items[3].text += '\n\n又一段内容。'; await update(page, items, 'idle');
    await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(1);
  } finally { await page.close(); }
});

test('disclosure preserves its transition and removes collapsed interactive content', async () => {
  const page = await browser.newPage();
  try {
    await open(page, 'focus');
    const body = page.locator('.disclosure-motion').first();
    const duration = motion.durationMs / 1000 + 's';
    const easing = 'cubic-bezier(' + motion.easing.join(', ') + ')';
    await expect(body).toHaveCSS('transition-duration', duration + ', ' + duration);
    await expect(body).toHaveCSS('transition-timing-function', easing + ', ' + easing);
    await expect(page.locator('.disclosure-chevron').first()).toHaveAttribute('data-icon-origin', 'pi-adaptation');
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.getByRole('button', { name: '父项', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    await expect(body).toHaveAttribute('inert', '');
    await expect(page.locator('[data-disclosure="focus"]')).toHaveAttribute('data-phase', 'closing');
    await page.clock.runFor(motion.durationMs);
    await expect(page.locator('[data-disclosure="focus"]')).toHaveAttribute('data-phase', 'collapsed');
    await expect(page.getByRole('button', { name: '内部按钮', includeHidden: true })).toHaveCount(0);
  } finally { await page.close(); }
});

// 26.917 exact-style samples are retired. These uncaptured components are Pi adaptations.
for (const mode of ['light', 'dark', 'system-light', 'system-dark']) for (const width of [1000, 1440]) for (const scene of ['row', 'group', 'file', 'diff']) test(mode + ' ' + width + ' ' + scene + ' adapted activity', async () => {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 940 : 700 }, colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
  try {
    await open(page, scene, mode);
    await expectAdaptedAppearance(page, mode, [scene === 'diff' ? '.activity-diff' : '.disclosure']);
  } finally { await page.close(); }
});

test('disclosure keeps independent explicit choices after remount and excludes hidden focus targets', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await open(page, 'focus');
    const parent = page.getByRole('button', { name: '父项', exact: true });
    const child = page.getByRole('button', { name: '子项', exact: true });
    await child.click();
    await expect(child).toHaveAttribute('aria-expanded', 'true');
    await page.getByRole('button', { name: '隐藏按钮', exact: true }).focus();
    await parent.evaluate(node => (node as HTMLButtonElement).click());
    await expect(parent).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '后续按钮' })).toBeFocused();
    await parent.click();
    await expect(page.getByRole('button', { name: '子项', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await page.reload();
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await expect(child).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.disclosure-motion').first()).toHaveCSS('transition-duration', '0s');
  } finally { await page.close(); }
});

test('active summary changes are throttled but completion is immediate', async () => {
  const page = await browser.newPage();
  try {
    await page.clock.install();
    await open(page, 'summary');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { status: 'running' } })));
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '动作 B' } })));
    await page.clock.runFor(1);
    await expect(page.locator('output')).toHaveText('动作 B');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '动作 C' } })));
    await page.clock.runFor(500);
    await expect(page.locator('output')).toHaveText('动作 B');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture:update', { detail: { title: '已完成', status: 'idle' } })));
    await expect(page.locator('output')).toHaveText('已完成');
  } finally { await page.close(); }
});
