import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.skip(process.platform !== 'win32', 'Uses real Windows process termination failure');
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});

async function prepareCommit() {
  const slow = await slowGitFixture(fixture.storage);
  const hooks = join(fixture.storage, 'retry-hooks'); await mkdir(hooks);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
  await gitRun(fixture.project, ['config', 'core.hooksPath', hooks]);
  await writeFile(join(fixture.project, 'README.md'), 'RETRY_OWNED_PROCESS\n');
  await gitRun(fixture.project, ['add', '--', 'README.md']);
  return slow;
}

test('Git stop failure returns through IPC and the same running UI operation can be cancelled again', async () => {
  const slow = await prepareCommit(); const originalRoot = await fixture.app.evaluate(() => process.env.SystemRoot);
  try {
    await taskAction(fixture.page, '查看变更');
    await fixture.page.getByRole('tab', { name: /^变更/ }).click();
    await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
    const page = fixture.page;
    await page.getByRole('checkbox', { name: '提交 README.md', exact: true }).check();
    await page.getByRole('textbox', { name: '提交信息', exact: true }).fill('停止失败后保留草稿');
    await page.getByRole('button', { name: '提交所选暂存文件', exact: true }).click();
    const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
    const index = await readFile(join(fixture.project, '.git', 'index'));
    await fixture.app.evaluate((_electron, root) => { process.env.SystemRoot = root; }, join(fixture.storage, 'missing-system'));
    await page.getByRole('button', { name: '取消 Git 操作', exact: true }).click();
    await expect(page.locator('.git-feedback')).toContainText('无法结束 Git 进程');
    await expect(page.getByRole('button', { name: '取消 Git 操作', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '提交所选暂存文件', exact: true })).toBeDisabled();
    await expect(page.getByRole('textbox', { name: '提交信息', exact: true })).toHaveValue('停止失败后保留草稿');
    expect(ids.filter(processAlive)).toEqual(ids);
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    const { data } = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    await expect(page.locator('.git-feedback')).toContainText('The Git process could not be stopped.');
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; }, originalRoot);
    await page.getByRole('button', { name: 'Cancel Git operation', exact: true }).click();
    await expect(page.locator('.git-feedback')).toContainText('Git operation cancelled.');
    expect(ids.filter(processAlive)).toEqual([]); await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    expect((await gitRun(fixture.project, ['rev-list', '--count', 'HEAD'])).trim()).toBe('1');
    await expect(page.getByRole('textbox', { name: 'Commit message', exact: true })).toHaveValue('停止失败后保留草稿');
  } finally {
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; }, originalRoot);
    await slow.cleanup();
  }
});

interface QuitProbe {
  calls: { title?: string; message: string; detail?: string; buttons?: string[] }[];
  respond?: (response: number) => void;
}

test('Git shutdown failure keeps the last window and services alive, ignores repeated quit and retries on request', async () => {
  const slow = await prepareCommit(); const originalRoot = await fixture.app.evaluate(() => process.env.SystemRoot);
  const { data } = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
  const action = fixture.invoke({ op: 'git.action', threadId: 't', requestId: 'quit-retry', action: 'commitStaged', paths: ['README.md'], value: 'cancel on exit', remote: 'origin', strategy: 'ff-only' }).catch(error => String(error));
  try {
    const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
    const index = await readFile(join(fixture.project, '.git', 'index'));
    await fixture.app.evaluate(({ dialog }, root) => {
      process.env.SystemRoot = root;
      const probe: QuitProbe = { calls: [] };
      (globalThis as typeof globalThis & { gitQuitProbe: QuitProbe }).gitQuitProbe = probe;
      dialog.showMessageBox = (...args: unknown[]) => {
        const options = args.at(-1) as QuitProbe['calls'][number];
        probe.calls.push({ title: options.title, message: options.message, detail: options.detail, buttons: options.buttons });
        return new Promise(resolve => { probe.respond = response => resolve({ response, checkboxChecked: false }); });
      };
    }, join(fixture.storage, 'missing-system'));
    // Closing the only window must retain it until process cleanup succeeds.
    await fixture.invoke({ op: 'window', action: 'close' });
    const calls = () => fixture.app.evaluate(() => (globalThis as typeof globalThis & { gitQuitProbe: QuitProbe }).gitQuitProbe.calls);
    await expect.poll(async () => (await calls()).length).toBe(1);
    expect((await calls())[0]).toMatchObject({ title: 'Unable to quit yet', detail: 'The Git process could not be stopped. Check its process status.', buttons: ['Retry', 'Return to app'] });
    await fixture.app.evaluate(({ app, BrowserWindow }) => { app.quit(); BrowserWindow.getAllWindows()[0].close(); });
    expect((await calls()).length).toBe(1); expect(fixture.page.isClosed()).toBe(false);
    expect(ids.filter(processAlive)).toEqual(ids);
    await fixture.app.evaluate(() => (globalThis as typeof globalThis & { gitQuitProbe: QuitProbe }).gitQuitProbe.respond!(1));
    await fixture.invoke({ op: 'settings.patch', patch: { theme: 'dark' } });
    await expect.poll(async () => (await fixture.snapshot()).data.settings.theme).toBe('dark');
    // A fresh quit attempt offers Retry; repair only the test process environment.
    await fixture.invoke({ op: 'window', action: 'close' });
    await expect.poll(async () => (await calls()).length).toBe(2);
    const exited = fixture.app.waitForEvent('close');
    await fixture.app.evaluate((_electron, root) => {
      if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root;
      (globalThis as typeof globalThis & { gitQuitProbe: QuitProbe }).gitQuitProbe.respond!(0);
    }, originalRoot);
    await exited; await action;
    expect(ids.filter(processAlive)).toEqual([]); await expect(access(temporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    await fixture.restart();
    expect((await fixture.snapshot()).data.settings.theme).toBe('dark');
    expect((await gitRun(fixture.project, ['rev-list', '--count', 'HEAD'])).trim()).toBe('1');
  } finally {
    await fixture.app.evaluate((_electron, root) => {
      if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root;
      (globalThis as typeof globalThis & { gitQuitProbe?: QuitProbe }).gitQuitProbe?.respond?.(1);
    }, originalRoot).catch(() => {});
    await slow.cleanup(); await action;
  }
});
