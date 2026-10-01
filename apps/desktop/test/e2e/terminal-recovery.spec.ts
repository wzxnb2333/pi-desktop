import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
import { translate } from '../../src/shared/localization.ts';

let browser: Browser;
let page: Page;
let url = '';
let errors: string[];
test.setTimeout(20000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-terminal-recovery-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/terminal-recovery-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href;
  browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => {
  errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('tab', { name: '第一个终端 · 后台运行', exact: true }).click();
});
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('terminal creation deduplicates pending clicks and recovers inline after failure', async () => {
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.open']; });
  const create = page.getByRole('button', { name: '新建终端', exact: true });
  await create.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.terminalRecovery.calls.filter(item => item.op === 'terminal.open').length)).toBe(1);
  await expect(create).toBeDisabled();
  await page.evaluate(() => window.terminalRecovery.release('terminal.open', 'SHELL_MISSING'));
  await expect(page.locator('.terminal-panel').getByRole('alert')).toContainText('SHELL_MISSING');
  await expect(create).toBeEnabled();
  await create.click(); await page.evaluate(() => window.terminalRecovery.release('terminal.open'));
  await expect(page.getByRole('tab', { name: 'PowerShell', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveCount(0);
});

test('rename errors keep the draft and retry applies only once to the captured terminal', async () => {
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.rename']; });
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('终端名称', { exact: true }).fill('继续编辑的名称');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.terminalRecovery.calls.filter(item => item.op === 'terminal.rename').length)).toBe(1);
  await expect(page.getByRole('dialog')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog').getByRole('button', { name: '正在保存…', exact: true })).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await page.evaluate(() => window.terminalRecovery.release('terminal.rename', 'RENAME_FAILED'));
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('RENAME_FAILED');
  await expect(page.getByLabel('终端名称', { exact: true })).toHaveValue('继续编辑的名称');
  await expect(page.getByLabel('终端名称', { exact: true })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.release('terminal.rename'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '继续编辑的名称', exact: true })).toBeVisible();
});

test('pending creation survives hiding and stays isolated across task changes', async () => {
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.open']; });
  await page.getByRole('button', { name: '新建终端', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.select('t2'));
  await expect(page.getByRole('button', { name: '新建终端', exact: true })).toBeEnabled();
  await page.getByRole('tab', { name: '第二个终端 · 后台运行', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.release('terminal.open', 'FIRST_TASK_ONLY'));
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '第二个终端', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => window.terminalRecovery.select('t1'));
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveText('FIRST_TASK_ONLY');
  await page.getByRole('button', { name: '新建终端', exact: true }).click();
  await page.getByRole('button', { name: '隐藏终端', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.show(true));
  await expect(page.getByRole('button', { name: '新建终端', exact: true })).toBeDisabled();
  await expect(page.locator('.terminal-panel').getByRole('status')).toHaveText('正在启动终端…');
  await page.evaluate(() => window.terminalRecovery.show(false));
  await page.evaluate(() => window.terminalRecovery.release('terminal.open'));
  await expect.poll(() => page.evaluate(() => window.terminalRecovery.terminals.length)).toBe(3);
  await page.evaluate(() => window.terminalRecovery.show(true));
  await expect(page.getByRole('tab', { name: 'PowerShell', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: '新建终端', exact: true })).toBeEnabled();
});

test('empty rename stays editable and cancellation restores focus without a request', async () => {
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await expect(page.getByLabel('终端名称', { exact: true })).toBeFocused();
  await page.getByLabel('终端名称', { exact: true }).fill('   ');
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '终端操作', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.terminalRecovery.calls)).toEqual([]);
});

test('clipboard failure is local and a successful retry clears its feedback', async () => {
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('CLIPBOARD_DENIED'); } } }));
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '复制选中内容或全部输出', exact: true }).click();
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveText('CLIPBOARD_DENIED');
  await page.evaluate(() => { navigator.clipboard.writeText = async text => { document.documentElement.dataset.copied = text; }; });
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '复制选中内容或全部输出', exact: true }).click();
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-copied', /t1/);
});

test('rename drafts and late failures return only to the originating task', async () => {
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('终端名称', { exact: true }).fill('第一个草稿');
  await page.evaluate(() => window.terminalRecovery.select('t2'));
  await page.getByRole('tab', { name: '第二个终端 · 后台运行', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => window.terminalRecovery.select('t1'));
  await expect(page.getByLabel('终端名称', { exact: true })).toHaveValue('第一个草稿');
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.rename']; });
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.select('t2'));
  await page.getByRole('button', { name: '终端操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('终端名称', { exact: true }).fill('第二个草稿');
  await page.evaluate(() => window.terminalRecovery.release('terminal.rename', 'SOURCE_RENAME_FAILED'));
  await expect(page.getByLabel('终端名称', { exact: true })).toHaveValue('第二个草稿');
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.terminalRecovery.select('t1'));
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText('SOURCE_RENAME_FAILED');
  await expect(page.getByLabel('终端名称', { exact: true })).toHaveValue('第一个草稿');
  await page.getByRole('dialog').getByRole('button', { name: '保存', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.release('terminal.rename'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.terminalRecovery.calls.filter(item => item.op === 'terminal.rename').map(item => item.id))).toEqual(['pty-t1', 'pty-t1']);
  await page.evaluate(() => window.terminalRecovery.select('t2'));
  await expect(page.getByLabel('终端名称', { exact: true })).toHaveValue('第二个草稿');
});

test('failed termination is retryable without closing the screen or killing a different terminal', async () => {
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.close']; });
  const close = page.getByRole('button', { name: '终止终端', exact: true });
  await close.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.terminalRecovery.calls.filter(item => item.op === 'terminal.close').length)).toBe(1);
  await expect(close).toBeDisabled();
  await page.evaluate(() => window.terminalRecovery.release('terminal.close', 'KILL_FAILED'));
  await expect(close).toBeEnabled();
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveText('KILL_FAILED');
  await expect(page.locator('.terminal-panel [data-terminal-id]')).toHaveAttribute('data-terminal-id', 'pty-t1');
  await close.click(); await page.evaluate(() => window.terminalRecovery.release('terminal.close'));
  await expect(close).toBeDisabled();
  await expect(page.getByRole('tab', { name: '第一个终端 · 已退出', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.terminalRecovery.terminals.find(item => item.id === 'pty-t2')?.exited)).toBe(false);
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveCount(0);
});

test('reopening the pane preserves a manual terminal selection after a project action', async () => {
  await page.evaluate(() => window.terminalRecovery.projectAction());
  await expect(page.getByRole('tab', { name: '项目动作', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '第一个终端', exact: true }).click();
  await page.getByRole('button', { name: '隐藏终端', exact: true }).click();
  await page.evaluate(() => window.terminalRecovery.show(true));
  await expect(page.getByRole('tab', { name: '第一个终端', exact: true })).toHaveAttribute('aria-selected', 'true');
});

for (const locale of ['zh-CN', 'en-US'] as const) for (const theme of ['light', 'dark'])
test(locale + ' ' + theme + ' terminal progress and errors fit and translate without losing pending state', async () => {
  await page.goto(url + '?locale=' + locale + '&theme=' + theme);
  await page.evaluate(() => { window.terminalRecovery.hold = ['terminal.open']; });
  const create = page.getByRole('button', { name: translate(locale, '新建终端'), exact: true });
  await create.click();
  await expect(page.locator('.terminal-panel').getByRole('status')).toHaveText(translate(locale, '正在启动终端…'));
  const other = locale === 'zh-CN' ? 'en-US' : 'zh-CN';
  await page.evaluate<void, 'zh-CN' | 'en-US'>(next => window.terminalRecovery.locale(next), other);
  await expect(page.locator('.terminal-panel').getByRole('status')).toHaveText(translate(other, '正在启动终端…'));
  await page.evaluate(() => window.terminalRecovery.release('terminal.open', "Error invoking remote method 'desktop:invoke': Error: 终端不存在"));
  await expect(page.locator('.terminal-panel').getByRole('alert')).toHaveText(other === 'zh-CN' ? '终端不存在' : 'Terminal not found');
  for (const width of [1440, 1280, 1000]) {
    await page.setViewportSize({ width, height: width === 1000 ? 700 : width === 1280 ? 800 : 940 });
    await expect(page.locator('.terminal-panel').getByRole('alert')).toBeVisible();
    expect(await page.locator('.terminal-panel').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});
