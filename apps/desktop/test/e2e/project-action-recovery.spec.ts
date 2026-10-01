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
  const directory = await mkdtemp(join(tmpdir(), 'pi-project-action-ui-'));
  await build({ entryPoints: [fileURLToPath(new URL('./fixtures/project-action-recovery-harness.tsx', import.meta.url))], outfile: join(directory, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' });
  await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><link rel="stylesheet" href="app.css"><script src="app.js"></script>');
  url = pathToFileURL(join(directory, 'index.html')).href; browser = await chromium.launch();
});
test.afterAll(async () => { await browser?.close(); await cleanupTemporaryDirectories(); });
test.beforeEach(async () => {
  errors = []; page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(error.message)); await page.goto(url);
});
test.afterEach(async () => { await page?.close(); expect(errors).toEqual([]); });
async function open() {
  await page.getByRole('button', { name: '项目动作', exact: true }).click();
  await page.getByRole('menuitem', { name: '配置环境与动作' }).click();
  return page.getByRole('dialog', { name: '项目环境与动作' });
}

test('environment saves deduplicate and preserve newer edits through acknowledgement, hiding and task navigation', async () => {
  let dialog = await open(); const command = page.getByLabel('动作命令 1'); await command.fill('echo SUBMITTED');
  await page.evaluate(() => { window.projectActionRecovery.hold = ['project.environment']; });
  await dialog.getByRole('button', { name: '保存项目环境', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.projectActionRecovery.calls.filter(item => item.op === 'project.environment').length)).toBe(1);
  await expect(dialog).toHaveAttribute('aria-busy', 'true'); await command.fill('echo NEW_DRAFT'); await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.projectActionRecovery.release('project.environment'));
  await expect(command).toHaveValue('echo NEW_DRAFT'); await expect(dialog.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); dialog = await open(); await expect(command).toHaveValue('echo NEW_DRAFT');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.projectActionRecovery.select('t2')); dialog = await open(); await expect(command).toHaveValue('echo NEW_DRAFT');
  await dialog.getByRole('button', { name: '保存项目环境', exact: true }).click();
  await page.evaluate(() => window.projectActionRecovery.release('project.environment')); await expect(dialog.getByRole('status')).toHaveText('项目环境已保存');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.projectActionRecovery.select('t3')); await open(); await expect(command).toHaveCount(0);
});

test('stale environment errors localize immediately and loading the latest configuration requires replacing the draft', async () => {
  let dialog = await open(); await page.getByLabel('动作命令 1').fill('echo MY_DRAFT');
  await page.evaluate(() => { window.projectActionRecovery.hold = ['project.environment']; });
  await dialog.getByRole('button', { name: '保存项目环境', exact: true }).click();
  await page.evaluate(() => {
    window.projectActionRecovery.environment({ shell: 'cmd', initialization: '', cleanup: '', actions: [{ id: 'check', name: '检查', command: 'echo EXTERNAL' }] });
    window.projectActionRecovery.release('project.environment', '项目环境已在其他窗口修改，请重新打开后保存');
  });
  await expect(dialog.getByRole('alert')).toContainText('其他窗口');
  await page.evaluate(() => window.projectActionRecovery.locale('en-US'));
  dialog = page.getByRole('dialog', { name: 'Project environment and actions' });
  await expect(dialog.getByRole('alert')).toContainText('changed in another window');
  await expect(page.locator('main > [role="alert"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Load latest project configuration' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Save project environment', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Replace draft', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.projectActionRecovery.release('project.environment', '项目环境已在其他窗口修改，请重新打开后保存'));
  await dialog.getByRole('button', { name: 'Load latest project configuration' }).click();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByLabel('Action command 1')).toHaveValue('echo MY_DRAFT');
  await dialog.getByRole('button', { name: 'Load latest project configuration' }).click();
  await dialog.getByRole('button', { name: 'Replace draft', exact: true }).click();
  await expect(dialog.getByLabel('Action command 1')).toHaveValue('echo EXTERNAL'); await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('pending project action failures stay in their source directory without opening a dialog elsewhere', async () => {
  await page.evaluate(() => { window.projectActionRecovery.hold = ['project.action']; });
  await page.getByRole('button', { name: '项目动作', exact: true }).click();
  await page.getByRole('menuitem', { name: '检查', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.projectActionRecovery.calls.filter(item => item.op === 'project.action').length)).toBe(1);
  await page.evaluate(() => window.projectActionRecovery.directory('extra'));
  await page.evaluate(() => window.projectActionRecovery.release('project.action', 'SOURCE_ONLY'));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  let dialog = await open(); await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => window.projectActionRecovery.directory('p')); dialog = await open(); await expect(dialog.getByRole('alert')).toContainText('SOURCE_ONLY');
});

test('late action acknowledgement does not open a terminal in another task', async () => {
  await page.evaluate(() => { window.projectActionRecovery.hold = ['project.action']; });
  await page.getByRole('button', { name: '项目动作', exact: true }).click(); await page.getByRole('menuitem', { name: '检查', exact: true }).click();
  await page.evaluate(() => window.projectActionRecovery.select('t2'));
  await expect(page.locator('.breadcrumb strong')).toHaveText('t2');
  await expect(page.getByRole('complementary', { name: '任务辅助栏' })).toHaveCount(0);
  await page.evaluate(() => window.projectActionRecovery.release('project.action'));
  await expect(page.getByRole('button', { name: '项目动作', exact: true })).toBeEnabled();
  await expect(page.getByRole('complementary', { name: '任务辅助栏' })).toHaveCount(0);
  const dialog = await open(); await expect(dialog.getByRole('region', { name: '项目动作记录' })).toHaveCount(0);
});

test('cancelling a running project action is deduplicated, retryable and stays pending until the operation finishes', async () => {
  await page.evaluate(() => window.projectActionRecovery.records([{ id: crypto.randomUUID(), threadId: 't1', directoryId: 'p', kind: 'environment.action.check', stage: '正在运行项目动作', status: 'running', startedAt: 1 }]));
  await page.getByRole('button', { name: '项目动作', exact: true }).click(); await expect(page.getByRole('menuitem', { name: '检查', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: '配置环境与动作' }).click(); const dialog = page.getByRole('dialog', { name: '项目环境与动作' });
  await page.evaluate(() => { window.projectActionRecovery.hold = ['operation.cancel']; });
  await dialog.getByRole('button', { name: '停止项目动作' }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  expect(await page.evaluate(() => window.projectActionRecovery.calls.filter(item => item.op === 'operation.cancel').length)).toBe(1);
  await page.evaluate(() => window.projectActionRecovery.release('operation.cancel', 'CANCEL_FAILED'));
  await expect(dialog.getByRole('alert')).toContainText('CANCEL_FAILED'); await dialog.getByRole('button', { name: '停止项目动作' }).click();
  await page.evaluate(() => window.projectActionRecovery.release('operation.cancel'));
  await expect(dialog.getByRole('button', { name: '正在取消操作' })).toBeDisabled();
  await page.evaluate(() => window.projectActionRecovery.records([])); await expect(dialog.getByRole('button', { name: '正在取消操作' })).toHaveCount(0);
});

test('older active project actions remain visible alongside the last ten completed records', async () => {
  await page.evaluate(() => window.projectActionRecovery.records(Array.from({ length: 12 }, (_, index) => ({ id: crypto.randomUUID(), threadId: 't1', directoryId: 'p', kind: index === 0 ? 'environment.action.check' : 'environment.action.finished-' + index, stage: index === 0 ? '正在运行项目动作' : '操作完成', status: index === 0 ? 'running' : 'succeeded', startedAt: index }))));
  const dialog = await open(); await expect(dialog.getByRole('button', { name: '停止项目动作' })).toBeEnabled();
  await expect(dialog.locator('article')).toHaveCount(11);
});
