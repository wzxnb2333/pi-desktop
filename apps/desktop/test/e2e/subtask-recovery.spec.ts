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
  const dir = await mkdtemp(join(tmpdir(), 'pi-subtask-observer-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/subtask-recovery-harness.tsx', import.meta.url))], outfile: join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(dir, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage({ viewport: { width: 1440, height: 940 } }); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.locator('.summary-subagents')).toBeVisible(); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('parent creation activities open a vertical observer roster and independent right-side child tabs', async () => {
  await expect(page.locator('.sidebar').getByText('Agent A', { exact: true })).toHaveCount(0);
  await expect(page.locator('.turn-subagents .subagent-creation')).toHaveCount(4);
  await expect(page.locator('.summary-subagents strong')).toHaveText('3');
  await page.getByRole('button', { name: '查看子智能体', exact: true }).click();
  const roster = page.locator('.subagent-roster'); await expect(roster.locator('.subagent-list').first().locator('button')).toHaveCount(3);
  const rows = await roster.locator('.subagent-list').first().locator('button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y)); expect(rows[1]).toBeGreaterThan(rows[0]);
  await roster.getByRole('button', { name: /Agent A/ }).click();
  const panel = page.locator('.subagent-conversation:not([hidden])'); await expect(panel).toContainText('Agent A output');
  await expect(panel.getByRole('textbox')).toHaveCount(0); await expect(panel.getByRole('button', { name: /发送|停止|权限|委派/ })).toHaveCount(0);
  await page.getByRole('tab', { name: '子智能体', exact: true }).click(); await roster.getByRole('button', { name: /Agent B/ }).click();
  await expect(panel).toContainText('Agent B output'); await page.getByRole('tab', { name: 'Agent A', exact: true }).click(); await expect(panel).toContainText('Agent A output');
  await page.getByRole('button', { name: '关闭 Agent A', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Agent A', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.subtaskRecovery.snapshot().subtasks[0].status)).toBe('running');
  await expect(page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('Main draft remains');
  expect(await page.evaluate(() => window.subtaskRecovery.calls.filter(request => request.op.startsWith('subtask.') || 'id' in request && String(request.id).startsWith('child')))).toEqual([]);
});

test('subagent creation stays compact and expanded in the work process until all child work completes', async () => {
  const process = page.locator('[data-disclosure="process:u"]');
  const toggle = process.locator(':scope > .disclosure-header > button');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.turn-body > .turn-subagents')).toHaveCount(0);
  const created = process.locator('.subagent-creation');
  await expect(created).toHaveCount(4, { timeout: 2000 });
  await expect(created.first()).toHaveText('已创建 Agent A');
  await expect(process.locator('[data-message-id="create0"] .subagent-creation')).toHaveCount(1);
  await expect(process.locator('.subagent-card')).toHaveCount(0);
  for (const row of await created.all()) {
    expect((await row.boundingBox())!.height).toBeLessThanOrEqual(28);
    const icon = await row.locator('svg').boundingBox(); expect(icon!.width).toBeLessThanOrEqual(14); expect(icon!.height).toBeLessThanOrEqual(14);
  }
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.subtaskRecovery.update(i, 'succeeded'); });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(process.getByRole('button', { name: '已创建 Agent A', exact: true })).toBeHidden();
  await expect(page.locator('.turn-answer')).toContainText('Created the inspection agents.');
  await toggle.click(); await expect(created).toHaveCount(4);
  await process.getByRole('button', { name: '已创建 Agent A', exact: true }).click();
  await expect(page.locator('.subagent-conversation:not([hidden])')).toContainText('Agent A output');
});

test('restored creation records without tool results remain inside the work process', async () => {
  await page.goto(url + '?history=1');
  const process = page.locator('[data-disclosure="process:u"]');
  await expect(process.locator('.subagent-creation')).toHaveCount(4);
  await expect(page.locator('.turn-body > .turn-subagents')).toHaveCount(0);
  await process.getByRole('button', { name: '已创建 Agent B', exact: true }).click();
  await expect(page.locator('.subagent-conversation:not([hidden])')).toContainText('Agent B output');
});

test('streaming, status counts, scroll position and the main draft survive switching child tabs', async () => {
  await page.locator('.turn-subagents').getByRole('button', { name: /Agent A/ }).click();
  await page.evaluate(() => window.subtaskRecovery.update(0, 'running', Array.from({ length: 100 }, (_, i) => 'Line ' + i).join('\n\n')));
  const transcript = page.locator('[data-child-thread="child0"] .subagent-transcript');
  await expect.poll(() => transcript.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await transcript.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  await page.locator('.turn-subagents').getByRole('button', { name: /Agent B/ }).click();
  await page.evaluate(() => window.subtaskRecovery.update(0, 'succeeded', Array.from({ length: 101 }, (_, i) => 'Updated ' + i).join('\n\n')));
  await expect(page.locator('.summary-subagents strong')).toHaveText('2');
  await page.getByRole('tab', { name: 'Agent A', exact: true }).click(); await expect(transcript).toContainText('Updated 100');
  expect(await transcript.evaluate(node => node.scrollTop)).toBe(0);
  await expect(page.getByRole('textbox', { name: '向 Pi 发送消息', exact: true })).toHaveValue('Main draft remains');
});

test('legacy active child sessions route to their parent and are absent from chat search', async () => {
  await page.goto(url + '?legacy=1'); await expect(page.locator('.breadcrumb')).toContainText('Main agent');
  await expect.poll(() => page.evaluate(() => window.subtaskRecovery.snapshot().ui.activeThreadId)).toBe('t');
  await page.getByRole('button', { name: '命令面板', exact: true }).click();
  await page.getByRole('combobox', { name: '搜索命令或最近任务', exact: true }).fill('Agent A'); await expect(page.getByRole('option', { name: /Agent A/ })).toHaveCount(0);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '自动化', exact: true }).click();
  await page.getByRole('button', { name: '新建自动化', exact: true }).click();
  await page.getByLabel('执行位置', { exact: true }).selectOption('thread');
  await expect(page.getByRole('combobox', { name: /^目标聊天/ }).locator('option')).toHaveText(['请选择聊天', 'Main agent · Observer project', 'Other parent · Observer project']);
});

test('parent questions remain read-only, localized and compact in the observer', async () => {
  await page.evaluate(() => window.subtaskRecovery.question(0));
  await page.getByRole('button', { name: '查看子智能体', exact: true }).click();
  await expect(page.locator('.subagent-roster').getByRole('button', { name: /Agent A/ })).toContainText('等待主代理答复');
  await page.locator('.subagent-roster').getByRole('button', { name: /Agent A/ }).click();
  const panel = page.locator('.subagent-conversation:not([hidden])');
  await expect(panel.locator('[data-subtask-question]')).toContainText('Which file should I inspect?');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await page.evaluate(() => window.subtaskRecovery.locale('en-US'));
  await expect(panel.locator('header')).toContainText('Waiting for parent reply');
  await page.evaluate(() => window.subtaskRecovery.question(0, 'Read README.md'));
  const question = panel.locator('[data-subtask-question]');
  await expect(question).not.toHaveAttribute('open', '');
  await question.locator('summary').click(); await expect(question).toContainText('Read README.md');
  expect(await page.evaluate(() => window.subtaskRecovery.snapshot().ui.threads.t.draft?.text)).toBe('Main draft remains');
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect.poll(() => panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' observer panels fit supported sizes and preserve language changes', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  await page.getByRole('button', { name: translate(locale, '查看子智能体'), exact: true }).click();
  await page.locator('.subagent-roster').getByRole('button', { name: /Agent A/ }).click();
  const panel = page.locator('.subagent-conversation:not([hidden])');
  await expect(page.locator('.subagent-creation').first()).toHaveText(translate(locale, '已创建 {p0}', { p0: 'Agent A' }));
  for (const [width, height] of [[1440, 940], [1280, 800], [1000, 700]]) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
    await expect.poll(() => page.locator('.subagent-creation').first().evaluate(node => node.getBoundingClientRect().height <= 28 && node.getBoundingClientRect().width <= node.parentElement!.getBoundingClientRect().width)).toBe(true);
  }
  const next = locale === 'zh-CN' ? 'en-US' : 'zh-CN'; await page.evaluate<void, 'zh-CN' | 'en-US'>(value => window.subtaskRecovery.locale(value), next);
  await expect(panel.locator('header')).toContainText(translate(next, '只读'));
  expect(await page.evaluate(() => window.subtaskRecovery.snapshot().ui.threads.t.draft?.text)).toBe('Main draft remains');
});
