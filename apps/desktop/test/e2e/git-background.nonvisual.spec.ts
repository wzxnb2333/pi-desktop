import { access, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { GitProcessProblem } from '../../src/shared/git-processes.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.skip(process.platform !== 'win32', 'Uses real Windows process termination');
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});

interface TimeoutProbe { timer: typeof setTimeout; root?: string; }

test('background Git timeout offers scoped keyboard recovery, preserves the index and stays recoverable after switching directories', async () => {
  const extra = join(fixture.storage, 'extra-git'); await mkdir(extra); await gitRun(extra, ['init', '-b', 'main']);
  await fixture.app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, extra);
  const directory = await fixture.invoke({ op: 'project.directoryAdd', projectId: 'p' }) as { id: string };
  await taskAction(fixture.page, '查看变更');
  const page = fixture.page;
  await page.getByRole('tab', { name: /^变更/ }).click();
  await expect(page.locator('.git-upstream')).toHaveText('未设置上游');
  const index = await readFile(join(fixture.project, '.git', 'index'));
  const head = await gitRun(fixture.project, ['rev-parse', 'HEAD']);
  const slow = await slowGitFixture(fixture.storage);
  await fixture.app.evaluate(() => {
    // Accelerate only this test app's default Git timeout; no product test bypass.
    const probe: TimeoutProbe = { timer: globalThis.setTimeout, root: process.env.SystemRoot };
    (globalThis as typeof globalThis & { backgroundGitProbe: TimeoutProbe }).backgroundGitProbe = probe;
    globalThis.setTimeout = new Proxy(probe.timer, { apply(target, receiver, args: unknown[]) {
      const input = [...args]; if (input[1] === 60000) input[1] = 1500;
      return Reflect.apply(target, receiver, input);
    } });
  });
  try {
    await gitRun(fixture.project, ['config', 'core.fsmonitor', slow.command]);
    await page.getByRole('button', { name: '刷新 Git', exact: true }).click();
    const ids = await slow.ready();
    await fixture.app.evaluate((_electron, root) => { process.env.SystemRoot = root; }, join(fixture.storage, 'missing-system'));
    const recovery = page.locator('.git-process-recovery');
    await expect(recovery).toContainText('Git 操作超时');
    const [problem] = await fixture.invoke({ op: 'git.processProblems', threadId: 't' }) as GitProcessProblem[];
    expect(problem.reason).toContain('Git 操作超时'); expect(ids.filter(processAlive)).toEqual(ids);
    expect(await fixture.invoke({ op: 'git.processProblems', threadId: 't', directoryId: directory.id })).toEqual([]);
    await expect(fixture.invoke({ op: 'git.retryStop', threadId: 't', directoryId: directory.id, processId: problem.id })).rejects.toThrow('不属于此目录');
    await recovery.getByRole('button', { name: /^重试停止进程/ }).click();
    await expect(recovery).toContainText('无法结束 Git 进程');
    await expect(recovery.getByRole('button', { name: /^重试停止进程/ })).toBeEnabled();
    expect(ids.filter(processAlive)).toEqual(ids);
    // New refreshes must not spawn another slow fixture during navigation/recovery.
    await gitRun(fixture.project, ['config', 'core.fsmonitor', 'false']);
    await page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /extra-git/ }).click();
    await expect(recovery).toHaveCount(0); expect(ids.filter(processAlive)).toEqual(ids);
    await page.getByRole('button', { name: '浏览目录与仓库', exact: true }).click();
    await page.getByRole('menuitemradio').filter({ hasNotText: 'extra-git' }).click();
    await expect(recovery.getByRole('button', { name: /^重试停止进程/ })).toBeEnabled();
    const { data } = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...data.ui, locale: 'en-US' } });
    await expect(recovery).toContainText('Git operation timed out');
    await fixture.app.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { backgroundGitProbe: TimeoutProbe }).backgroundGitProbe;
      if (probe.root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = probe.root;
    });
    const retry = recovery.getByRole('button', { name: /^Retry stopping process/ });
    await retry.focus(); await retry.press('Enter');
    await expect(recovery.getByRole('status')).toContainText('The process stopped.');
    await expect(recovery).toBeFocused(); expect(ids.filter(processAlive)).toEqual([]);
    expect(await fixture.invoke({ op: 'git.processProblems', threadId: 't' })).toEqual([]);
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    expect(await gitRun(fixture.project, ['rev-parse', 'HEAD'])).toBe(head);
    await page.getByRole('button', { name: 'Refresh Git', exact: true }).click();
    await expect(page.getByText('Working tree is clean.', { exact: true })).toBeVisible();
  } finally {
    await gitRun(fixture.project, ['config', 'core.fsmonitor', 'false']);
    await fixture.app.evaluate(() => {
      const probe = (globalThis as typeof globalThis & { backgroundGitProbe: TimeoutProbe }).backgroundGitProbe;
      globalThis.setTimeout = probe.timer;
      if (probe.root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = probe.root;
    });
    await slow.cleanup();
  }
});

test('closing the last window stops background Git helpers before exit and preserves the repository across restart', async () => {
  const slow = await slowGitFixture(fixture.storage);
  const index = await readFile(join(fixture.project, '.git', 'index'));
  const head = await gitRun(fixture.project, ['rev-parse', 'HEAD']);
  await gitRun(fixture.project, ['config', 'core.fsmonitor', slow.command]);
  const status = fixture.invoke({ op: 'git.status', threadId: 't' }).catch(error => String(error));
  try {
    const ids = await slow.ready();
    await gitRun(fixture.project, ['config', 'core.fsmonitor', 'false']);
    const closed = fixture.app.waitForEvent('close');
    await fixture.invoke({ op: 'window', action: 'close' }); await closed; await status;
    expect(ids.filter(processAlive)).toEqual([]);
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    await fixture.restart();
    expect(await fixture.invoke({ op: 'git.status', threadId: 't' })).toMatchObject({ available: true, branch: 'main', files: [] });
    expect(await gitRun(fixture.project, ['rev-parse', 'HEAD'])).toBe(head);
  } finally { await gitRun(fixture.project, ['config', 'core.fsmonitor', 'false']); await slow.cleanup(); await status; }
});
