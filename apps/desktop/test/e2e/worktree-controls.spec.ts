import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { mkdtemp, cleanupTemporaryDirectories } from './fixtures/temp-paths.ts';
let browser: Browser; let page: Page; let url = ''; let errors: string[];
test.setTimeout(20000);
test.beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-worktree-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/worktree-controls-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => { errors = []; page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(url); await expect(page.getByRole('heading')).toHaveText('t1/p'); });
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });

test('worktree requests deduplicate, keep reference edits when hidden and localize retryable errors', async () => {
  await page.getByLabel('Worktree 起始分支或提交').fill('feature/ref');
  await page.evaluate(() => { window.worktreeControls.hold = ['worktree.start']; });
  await page.getByRole('button', { name: '按起点新建 Worktree 任务' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.worktreeControls.calls.length)).toBe(1);
  await page.getByLabel('Worktree 起始分支或提交').fill('new-draft');
  await page.getByRole('button', { name: 'Toggle panel' }).click(); await page.getByRole('button', { name: 'Toggle panel' }).click();
  await expect(page.getByLabel('Worktree 起始分支或提交')).toHaveValue('new-draft');
  await expect(page.getByRole('button', { name: '按起点新建 Worktree 任务' })).toBeDisabled();
  await page.evaluate(() => window.worktreeControls.release('worktree.start', 'Worktree 起始引用无效'));
  await expect(page.getByRole('alert')).toContainText('Worktree 起始引用无效');
  await page.evaluate(() => window.worktreeControls.locale('en-US')); await expect(page.getByRole('alert')).toContainText('Invalid worktree starting reference.');
  await expect(page.locator('[data-global-error]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create worktree task from reference' }).click();
  expect(await page.evaluate(() => window.worktreeControls.calls.at(-1))).toMatchObject({ op: 'worktree.start', startPoint: 'new-draft' });
  await page.evaluate(() => window.worktreeControls.release('worktree.start'));
  await expect(page.getByRole('button', { name: 'Cancel workspace operation' })).toBeEnabled();
});

test('worktree drafts, pending errors and records stay isolated by task and directory', async () => {
  await page.getByLabel('Worktree 起始分支或提交').fill('source-draft');
  await page.evaluate(() => { window.worktreeControls.hold = ['worktree.start']; });
  await page.getByRole('button', { name: '按起点新建 Worktree 任务' }).click();
  await page.evaluate(() => window.worktreeControls.directory('extra')); await expect(page.getByRole('heading')).toHaveText('t1/extra');
  await expect(page.getByLabel('Worktree 起始分支或提交')).toHaveValue('HEAD');
  await page.evaluate(() => window.worktreeControls.release('worktree.start', 'SOURCE_ONLY')); await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.worktreeControls.directory('p')); await expect(page.getByRole('alert')).toHaveText('Error: SOURCE_ONLY');
  await expect(page.getByLabel('Worktree 起始分支或提交')).toHaveValue('source-draft');
  await page.evaluate(() => window.worktreeControls.select('t2')); await expect(page.getByRole('heading')).toHaveText('t2/p'); await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Worktree 起始分支或提交')).toHaveValue('HEAD');
});

test('old running worktree operations remain cancellable and failed stops can retry without duplicate requests', async () => {
  await page.evaluate(() => { window.worktreeControls.hold = ['operation.cancel']; window.worktreeControls.records([
    { id: crypto.randomUUID(), threadId: 't1', directoryId: 'p', kind: 'worktree.create', status: 'running', stage: '创建 Worktree', startedAt: 1 },
    { id: crypto.randomUUID(), threadId: 't1', directoryId: 'p', kind: 'worktree.usage', status: 'succeeded', stage: '操作完成', startedAt: 2 },
    { id: crypto.randomUUID(), threadId: 't1', directoryId: 'extra', kind: 'worktree.create', status: 'failed', stage: '操作失败', error: 'OTHER_DIRECTORY', startedAt: 3 },
  ]); });
  await expect(page.getByText('OTHER_DIRECTORY')).toHaveCount(0); await expect(page.getByRole('button', { name: '按起点新建 Worktree 任务' })).toBeDisabled();
  await page.getByRole('button', { name: '取消工作区操作' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.worktreeControls.calls.length)).toBe(1);
  await page.evaluate(() => window.worktreeControls.release('operation.cancel', '无法结束 Git 进程，请检查进程状态'));
  await expect(page.getByRole('alert')).toContainText('无法结束 Git 进程');
  await page.getByRole('button', { name: '取消工作区操作' }).click(); await page.evaluate(() => window.worktreeControls.release('operation.cancel'));
  await expect(page.getByRole('button', { name: '正在取消操作' })).toBeDisabled();
  await page.getByRole('button', { name: 'Toggle panel' }).click(); await page.getByRole('button', { name: 'Toggle panel' }).click();
  await expect(page.getByRole('button', { name: '正在取消操作' })).toBeDisabled();
  await page.evaluate(() => window.worktreeControls.records([]));
  await expect(page.getByRole('button', { name: '正在取消操作' })).toHaveCount(0); await expect(page.getByRole('button', { name: '按起点新建 Worktree 任务' })).toBeEnabled();
});

test('completed migrations distinguish journal and initialization warnings from a failed migration', async () => {
  await page.evaluate(() => window.worktreeControls.records([{ id: crypto.randomUUID(), threadId: 't1', directoryId: 'p', kind: 'worktree.migrate', status: 'succeeded', stage: '保存迁移后的任务关联', startedAt: 1,
    result: { threadId: 't1', warning: '迁移已完成，恢复记录状态暂未更新。无需重复迁移。', recoveryId: 'recovery-id', initializationError: 'EIO' } }]));
  await expect(page.getByRole('alert')).toContainText('迁移已完成，但初始化未启动');
  await expect(page.getByText(/无需重复迁移/)).toContainText('recovery-id');
  await expect(page.getByRole('button', { name: '迁移此聊天到 Worktree', exact: true })).toBeEnabled();
  await page.evaluate(() => window.worktreeControls.locale('en-US'));
  await expect(page.getByRole('alert')).toContainText('Retry initialization from Project actions');
  await expect(page.getByText(/Do not repeat the migration/)).toContainText('recovery-id');
  await expect(page.getByText('Saving the migrated workspace association', { exact: false })).toBeVisible();
});

test('migration recovery exposes evidence and retry, preserves failed requests and switches language without clearing the reference', async () => {
  await page.getByLabel('Worktree 起始分支或提交').fill('keep-this-reference');
  await page.evaluate(() => window.worktreeControls.issues([{ id: 'damaged-record', message: '迁移恢复尚未完成，原文件已保留。', details: 'C:/project/keep.txt: external content' }]));
  await expect(page.getByRole('button', { name: '迁移此聊天到 Worktree', exact: true })).toBeDisabled();
  await page.getByText('迁移恢复详情', { exact: true }).click();
  await expect(page.getByText('C:/project/keep.txt: external content', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开迁移恢复记录', exact: true }).click();
  expect(await page.evaluate(() => window.worktreeControls.calls.at(-1))).toMatchObject({ op: 'worktree.recovery', action: 'open', recoveryId: 'damaged-record', threadId: 't1' });
  await page.evaluate(() => { window.worktreeControls.hold = ['worktree.recovery']; });
  await page.getByRole('button', { name: '重试迁移恢复', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.worktreeControls.calls.length)).toBe(2);
  await page.getByRole('button', { name: 'Toggle panel' }).click(); await page.getByRole('button', { name: 'Toggle panel' }).click();
  await expect(page.getByRole('button', { name: '重试迁移恢复', exact: true })).toBeDisabled();
  await page.evaluate(() => { window.worktreeControls.locale('en-US'); window.worktreeControls.release('worktree.recovery', '迁移恢复尚未完成，原文件已保留。'); });
  await expect(page.getByRole('alert').last()).toContainText('Existing files are preserved');
  await expect(page.getByRole('button', { name: 'Retry migration recovery', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Worktree starting branch or commit')).toHaveValue('keep-this-reference');
  await page.getByRole('button', { name: 'Retry migration recovery', exact: true }).click();
  await page.evaluate(() => { window.worktreeControls.release('worktree.recovery'); window.worktreeControls.issues([]); });
  await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Move this chat to worktree', exact: true })).toBeEnabled();
});
