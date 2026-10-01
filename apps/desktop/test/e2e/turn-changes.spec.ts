import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { timelineSchema, type Bootstrap } from '../../src/shared/contracts.ts';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import type {} from './fixtures/conversation-ui-harness.tsx';

let browser: Browser, page: Page, url: string, errors: string[];
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-turn-changes-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/conversation-ui-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { try { await browser?.close(); } finally { await cleanupTemporaryDirectories(); } });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1440, height: 940 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.locator('.composer-input')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
const patch = '--- src/app.ts\n+++ src/app.ts\n@@ -1,2 +1,3 @@\n const keep = true;\n-old value\n+new value\n+added value\n';
const records = [timelineSchema.parse({ id: 'question', role: 'user', text: '改善界面', timestamp: 1 }), ...Array.from({ length: 5 }, (_, index) => timelineSchema.parse({ id: 'edit-' + index, role: 'tool', text: 'done', toolName: 'edit', args: JSON.stringify({ path: 'src/components/' + (index === 4 ? '很长的文件名'.repeat(20) : 'component-' + index) + '.tsx' }), timestamp: index + 2, state: 'done', details: { diff: '-old value\n+new value', patch } })), timelineSchema.parse({ id: 'answer', role: 'assistant', text: '修改完成', timestamp: 9, stopReason: 'stop' })];

test('turn preview shows actual edits, expands three files and never opens current files', async () => {
  await page.evaluate(items => window.conversationUi.patch('t', { items }), records);
  const card = page.getByRole('region', { name: '本轮编辑预览', exact: true });
  await expect(card).toContainText('已编辑 5 个文件'); await expect(card.locator('.turn-changes-heading .added')).toHaveText('+10');
  await expect(card.locator('.turn-change-row')).toHaveCount(3); await expect(page.locator('.turn-artifact-open')).toHaveCount(0);
  await card.locator('.turn-change-row').first().click(); await expect(card.locator('.diff .addition')).toHaveCount(2);
  await expect(card.locator('.diff .deletion')).toContainText('old value');
  await card.getByRole('button', { name: '再显示 2 个文件', exact: true }).click(); await expect(card.locator('.turn-change-row')).toHaveCount(5);
  await card.getByRole('button', { name: '查看变更', exact: true }).click(); await expect(card.locator('.turn-change-preview')).toHaveCount(5);
  await card.getByRole('button', { name: '收起变更', exact: true }).click(); await expect(card.locator('.turn-change-preview')).toHaveCount(0);
  const calls = await page.evaluate(() => window.conversationUi.calls);
  expect(calls.some(call => ['file.open', 'file.read', 'git.action'].includes(call.op))).toBe(false);
});

test('written content is historical, missing details stay honest and drafts survive navigation', async () => {
  const items = [records[0], timelineSchema.parse({ id: 'write', role: 'tool', text: 'done', toolName: 'write', args: JSON.stringify({ path: 'report.txt', content: 'ORIGINAL_WRITTEN_CONTENT' }), timestamp: 2 }), { ...records[1], id: 'legacy', details: undefined }, records.at(-1)!];
  await page.evaluate(items => window.conversationUi.patch('t', { items }), items);
  await page.locator('.composer-input').fill('KEEP_MY_DRAFT');
  await page.locator('.turn-change-row').first().click(); await expect(page.locator('.turn-written-content')).toHaveText('ORIGINAL_WRITTEN_CONTENT');
  await expect(page.locator('.turn-change-note').last()).toContainText('没有旧版本');
  await expect(page.locator('.turn-changes-heading .added')).toHaveCount(0);
  await page.locator('.turn-change-row').nth(1).click(); await expect(page.getByText('此记录没有保存可预览的内容', { exact: true })).toBeVisible();
  await page.locator('.thread-main').filter({ hasText: '短任务' }).click(); await expect(page.locator('.turn-changes')).toHaveCount(0);
  await page.locator('.thread-main').filter({ hasText: '主对话' }).click(); await expect(page.locator('.composer-input')).toHaveValue('KEEP_MY_DRAFT');
  await page.locator('.turn-change-row').first().click(); await expect(page.locator('.turn-written-content')).toHaveText('ORIGINAL_WRITTEN_CONTENT');
});

test('new chat always uses the project while standalone data remains preserved and quick chat has one compact entry', async () => {
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.getByRole('button', { name: '新建聊天', exact: true })).toHaveCount(1);
  await expect(sidebar.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name: '选择聊天类型', exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole('region', { name: '独立聊天', exact: true })).toHaveCount(0);
  const before = await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.threads.find(thread => thread.id === 'chat'));
  await sidebar.getByRole('button', { name: '新建聊天', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await page.evaluate(async () => await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap)).data.threads.at(-1)?.projectId).toBe('p');
  const quick = sidebar.getByRole('button', { name: '快捷聊天', exact: true });
  await page.evaluate(async () => { await window.desktop.invoke({ op: 'settings.patch', patch: { shortcuts: { quickChat: 'Ctrl+Alt+9' } } }); });
  await expect(quick).toHaveCount(1); await quick.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await page.evaluate(() => window.conversationUi.calls)).filter(call => call.op === 'window.open' && call.kind === 'quick').length).toBe(1);
  const calls = await page.evaluate(() => window.conversationUi.calls);
  expect(calls.filter(call => call.op === 'thread.create')).toHaveLength(1); expect(calls.filter(call => call.op === 'chat.create')).toHaveLength(0);
  expect(await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data.threads.find(thread => thread.id === 'chat'))).toEqual(before);
  await quick.hover(); await expect(page.getByRole('tooltip')).toContainText('Ctrl+Alt+9');
});

test('new chat without a project requests a folder and cancellation or failure never creates standalone records', async () => {
  await page.evaluate(() => window.conversationUi.emptyWorkspace());
  await expect(page.locator('.welcome-start')).toBeVisible();
  await expect(page.locator('.welcome-start-actions button')).toHaveCount(1);
  await page.keyboard.press('Control+n');
  await expect.poll(async () => (await page.evaluate(() => window.conversationUi.calls)).filter(call => call.op === 'project.add').length).toBe(1);
  await expect(page.locator('.welcome-start')).toBeVisible();
  const create = page.locator('.sidebar .new-thread');
  await page.evaluate(() => window.conversationUi.pickProject('error'));
  await create.click(); await expect(page.getByText('TEST_PROJECT_PICK_FAILED', { exact: true })).toBeVisible();
  expect((await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data)).threads).toEqual([]);
  await page.evaluate(() => window.conversationUi.pickProject('project'));
  await create.click(); await expect(page.locator('.composer-input')).toBeVisible();
  await expect.poll(async () => (await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data)).threads.at(-1)?.projectId).toBe('selected');
  expect((await page.evaluate(() => window.conversationUi.calls)).filter(call => call.op === 'chat.create')).toHaveLength(0);
});

test('header search and Ctrl K share the command palette without changing drafts or project collapse state', async () => {
  await page.locator('.composer-input').fill('SEARCH_KEEPS_DRAFT');
  await page.getByLabel('折叠 测试项目', { exact: true }).click();
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true });
  await expect(input).toBeFocused(); await input.fill('短任务');
  await expect(page.getByRole('dialog').getByRole('option')).toHaveCount(1);
  await expect(page.locator('.sidebar-search, [data-search-threads]')).toHaveCount(0);
  await input.press('Escape'); await expect(page.locator('.composer-input')).toHaveValue('SEARCH_KEEPS_DRAFT');
  await page.locator('.sidebar-heading').getByRole('button', { name: '命令面板', exact: true }).click();
  await expect(input).toBeFocused(); await input.fill('短任务'); await input.press('Enter');
  await expect.poll(async () => (await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data)).ui.activeThreadId).toBe('short');
  const state = await page.evaluate(async () => (await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap).data);
  expect(state.ui.threads.t.draft?.text).toBe('SEARCH_KEEPS_DRAFT'); expect(state.ui.collapsedProjects).toEqual(['p']);
});

for (const theme of ['light', 'dark'] as const) test('edit preview and compact chat entry fit both languages and narrow widths ' + theme, async () => {
  await page.evaluate(async theme => { await window.desktop.invoke({ op: 'settings.patch', patch: { theme } }); }, theme);
  await page.evaluate(items => window.conversationUi.patch('t', { items }), records);
  for (const locale of ['zh-CN', 'en-US'] as const) for (const width of [1440, 1000, 620]) {
    await page.setViewportSize({ width, height: width === 1440 ? 940 : 700 });
    await page.evaluate(async locale => { const { data } = await window.desktop.invoke({ op: 'bootstrap' }) as Bootstrap; await window.desktop.invoke({ op: 'ui.update', ui: { ...data.ui, locale } }); }, locale);
    const card = page.locator('.turn-changes'); await expect(card).toBeVisible();
    if (process.env.PI_DESKTOP_CAPTURE === '1' && width === 1440 && locale === 'zh-CN') {
      await mkdir('../../.artifacts/turn-changes', { recursive: true }); await page.screenshot({ path: '../../.artifacts/turn-changes/' + theme + '.png', animations: 'disabled' });
    }
    await card.locator('.turn-changes-heading button').click();
    const bounds = await card.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (process.env.PI_DESKTOP_CAPTURE === '1' && theme === 'dark' && width === 1440 && locale === 'zh-CN') {
      await page.screenshot({ path: '../../.artifacts/turn-changes/dark-expanded.png', animations: 'disabled' });
    }
    const quick = page.locator('.sidebar-quick-chat'); await quick.focus();
    await expect(page.getByRole('tooltip')).toContainText(locale === 'zh-CN' ? '快捷聊天' : 'Quick chat');
    await page.keyboard.press('Escape'); await expect(quick).toBeFocused();
    const label = page.locator('.new-thread-label');
    expect(await label.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    if (process.env.PI_DESKTOP_CAPTURE_SIDEBAR === '1' && width === 1440 && locale === 'zh-CN') {
      await mkdir('../../.artifacts/sidebar-navigation', { recursive: true });
      await page.locator('.sidebar').screenshot({ path: '../../.artifacts/sidebar-navigation/' + theme + '-sidebar.png', animations: 'disabled' });
    }
  }
});
