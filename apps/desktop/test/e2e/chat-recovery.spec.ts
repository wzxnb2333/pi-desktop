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
  const dir = await mkdtemp(join(tmpdir(), 'pi-chat-recovery-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/chat-recovery-harness.tsx', import.meta.url))], outfile: join(dir, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(dir, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByTestId('active')).toHaveText('t'); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('new chat coalesces same-frame clicks and retries the same request while retaining the original draft', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['chat.create']; });
  await page.getByRole('button', { name: 'Create chat', exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.chatRecovery.calls.filter(call => call.op === 'chat.create').length)).toBe(1);
  await page.evaluate(() => window.chatRecovery.release('chat.create', 'SAVE_FAILED')); await expect(page.getByRole('alert')).toHaveText('SAVE_FAILED');
  await expect(page.getByTestId('count')).toHaveText('2'); await expect(page.getByLabel('Draft')).toHaveValue('Original draft');
  await page.getByRole('button', { name: 'Create chat', exact: true }).click();
  const ids = await page.evaluate(() => window.chatRecovery.calls.flatMap(call => call.op === 'chat.create' ? [call.requestId] : [])); expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await page.evaluate(() => window.chatRecovery.release('chat.create')); await expect(page.getByTestId('active')).toHaveText(ids[0]);
  await expect(page.getByTestId('original-draft')).toHaveText('Original draft'); await expect(page.getByTestId('attachments')).toHaveText('["image.png"]');
  await page.getByRole('button', { name: 'Create chat', exact: true }).click();
  expect(await page.evaluate(() => window.chatRecovery.calls.flatMap(call => call.op === 'chat.create' ? [call.requestId] : []).at(-1))).not.toBe(ids[0]);
  await page.evaluate(() => window.chatRecovery.release('chat.create')); await expect(page.getByTestId('count')).toHaveText('4');
});

test('late new chat response never steals navigation even after leaving and returning to the original chat', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['chat.create']; }); await page.getByRole('button', { name: 'Create chat', exact: true }).click();
  await page.getByRole('button', { name: 'Other chat', exact: true }).click(); await expect(page.getByLabel('Draft')).toHaveValue('Other draft');
  await page.getByRole('button', { name: 'Original chat', exact: true }).click(); await page.getByLabel('Draft').fill('Newer typing');
  await page.evaluate(() => window.chatRecovery.release('chat.create')); await expect(page.getByTestId('count')).toHaveText('3');
  await expect(page.getByTestId('active')).toHaveText('t'); await expect(page.getByLabel('Draft')).toHaveValue('Newer typing');
});

test('project creation coalesces retries without mixing local and worktree requests or stealing navigation', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['thread.create']; });
  await page.getByRole('button', { name: 'Create project task', exact: true }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.chatRecovery.calls.filter(call => call.op === 'thread.create').length)).toBe(1);
  await page.evaluate(() => window.chatRecovery.release('thread.create', '项目目录已变化，请重新选择后创建任务'));
  await expect(page.getByLabel('Draft')).toHaveValue('Original draft');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('The project directory changed. Select it again before creating a task.');
  await page.getByRole('button', { name: 'Create project task', exact: true }).click();
  await page.getByRole('button', { name: 'Create worktree task', exact: true }).click();
  const calls = await page.evaluate(() => window.chatRecovery.calls.filter(call => call.op === 'thread.create'));
  expect(calls).toHaveLength(3); expect(calls[0].requestId).toBeTruthy(); expect(calls[1].requestId).toBe(calls[0].requestId); expect(calls[2].requestId).not.toBe(calls[0].requestId);
  await page.getByRole('button', { name: 'Other chat', exact: true }).click(); await page.getByLabel('Draft').fill('Other typing');
  await page.evaluate(() => { window.chatRecovery.release('thread.create'); window.chatRecovery.release('thread.create'); });
  await expect(page.getByTestId('count')).toHaveText('4'); await expect(page.getByTestId('active')).toHaveText('other'); await expect(page.getByLabel('Draft')).toHaveValue('Other typing');
  await expect(page.getByTestId('attachments')).toHaveText('["image.png"]');
});

test('binding coalesces double selection, localizes errors and allows a fresh retry', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['thread.bindProject']; }); await page.getByLabel('绑定项目目录').click();
  await page.getByRole('menuitem', { name: 'Project · C:/project' }).evaluate(node => { (node as HTMLButtonElement).click(); (node as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.chatRecovery.calls.filter(call => call.op === 'thread.bindProject').length)).toBe(1); await expect(page.getByLabel('绑定项目目录')).toBeDisabled();
  await page.evaluate(() => window.chatRecovery.release('thread.bindProject', '项目目录已变化，请重新选择后绑定')); await expect(page.getByLabel('绑定项目目录')).toBeEnabled();
  await page.getByRole('button', { name: 'Language', exact: true }).click(); await expect(page.getByRole('alert')).toHaveText('The project directory changed. Select it again before binding.');
  await page.getByLabel(translate('en-US', '绑定项目目录')).click(); await page.getByRole('menuitem', { name: 'Project · C:/project' }).click();
  await page.getByLabel('Draft').fill('Typing during binding'); await page.evaluate(() => window.chatRecovery.release('thread.bindProject'));
  await expect(page.getByLabel(translate('en-US', '绑定项目目录'))).toHaveCount(0); await expect(page.getByLabel('Draft')).toHaveValue('Typing during binding'); await expect(page.getByTestId('attachments')).toHaveText('["image.png"]');
});

test('a late folder picker result cannot bind the newly selected chat', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['project.add']; }); await page.getByLabel('绑定项目目录').click(); await page.getByRole('menuitem', { name: '添加本地项目', exact: true }).click();
  await page.getByRole('button', { name: 'Other chat', exact: true }).click(); await expect(page.getByLabel('绑定项目目录')).toBeEnabled();
  await page.evaluate(() => window.chatRecovery.release('project.add')); await expect(page.getByLabel('Draft')).toHaveValue('Other draft');
  expect(await page.evaluate(() => window.chatRecovery.calls.filter(call => call.op === 'thread.bindProject'))).toEqual([]);
});

test('a started binding remains attached to its source and does not disable another chat', async () => {
  await page.evaluate(() => { window.chatRecovery.hold = ['thread.bindProject']; }); await page.getByLabel('绑定项目目录').click(); await page.getByRole('menuitem', { name: 'Project · C:/project' }).click();
  await page.getByRole('button', { name: 'Other chat', exact: true }).click(); await expect(page.getByLabel('绑定项目目录')).toBeEnabled();
  await page.evaluate(() => window.chatRecovery.release('thread.bindProject')); await expect(page.getByTestId('active')).toHaveText('other'); await expect(page.getByLabel('Draft')).toHaveValue('Other draft');
  await page.getByRole('button', { name: 'Original chat', exact: true }).click(); await expect(page.getByLabel('绑定项目目录')).toHaveCount(0); await expect(page.getByLabel('Draft')).toHaveValue('Original draft');
});
