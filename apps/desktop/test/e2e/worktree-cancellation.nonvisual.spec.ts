import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { gitRun } from '../../src/main/git.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.skip(process.platform !== 'win32', 'Uses actual Windows termination failures');
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); });
const job = (id: string) => fixture.snapshot().then(state => state.data.operations.find(item => item.id === id)!);
async function prepare() {
  const slow = await slowGitFixture(fixture.storage), hooks = join(fixture.storage, 'checkout-hooks'); await mkdir(hooks);
  const hook = join(hooks, 'post-checkout'); await writeFile(hook, '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
  await gitRun(fixture.project, ['config', 'core.hooksPath', hooks]); return { slow, hook };
}

test('workspace UI retries a real failed stop and preserves the starting reference and source files', async () => {
  const { slow, hook } = await prepare(); const originalRoot = await fixture.app.evaluate(() => process.env.SystemRoot);
  const index = await readFile(join(fixture.project, '.git', 'index'));
  try {
    await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('tab', { name: /^变更/ }).click();
    await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
    const controls = fixture.page.locator('.worktree-lifecycle');
    await controls.getByLabel('Worktree 起始分支或提交').fill('HEAD~0');
    await controls.getByRole('button', { name: '按起点新建 Worktree 任务' }).click();
    const pids = await slow.ready(), record = (await fixture.snapshot()).data.operations.find(item => item.kind === 'worktree.create')!;
    await fixture.app.evaluate((_electron, root) => { process.env.SystemRoot = root; }, join(fixture.storage, 'missing-system'));
    await controls.getByRole('button', { name: '取消工作区操作' }).click();
    await expect(controls.getByRole('alert')).toContainText('无法结束 Git 进程');
    await expect(controls.getByRole('button', { name: '取消工作区操作' })).toBeEnabled();
    await expect(controls.getByRole('button', { name: '按起点新建 Worktree 任务' })).toBeDisabled();
    expect((await job(record.id)).status).toBe('running'); expect(pids.filter(processAlive)).toEqual(pids);
    const state = await fixture.snapshot(); await fixture.invoke({ op: 'ui.update', ui: { ...state.data.ui, locale: 'en-US' } });
    await expect(controls.getByRole('alert')).toContainText('The Git process could not be stopped.');
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; }, originalRoot);
    await controls.getByRole('button', { name: 'Cancel workspace operation' }).click();
    await expect.poll(async () => (await job(record.id)).status).toBe('cancelled'); expect(pids.filter(processAlive)).toEqual([]);
    await expect(controls.getByLabel('Worktree starting branch or commit')).toHaveValue('HEAD~0');
    expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    expect((await fixture.snapshot()).data.worktrees).toEqual([]);
    expect(await readdir(join(fixture.storage, 'worktrees'))).toEqual([]);
    await writeFile(hook, '#!/bin/sh\nexit 0\n');
    await controls.getByRole('button', { name: 'Create worktree task from reference' }).click();
    await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.create').at(-1)?.status).toBe('succeeded');
    await controls.getByRole('button', { name: 'Open new worktree task' }).click();
    await expect.poll(async () => (await fixture.snapshot()).data.ui.activeThreadId).not.toBe('t');
  } finally {
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; }, originalRoot).catch(() => {});
    await slow.cleanup();
  }
});

interface QuitProbe { calls: { title?: string; buttons?: string[] }[]; respond?: (response: number) => void; }
test('workspace shutdown failure returns to a usable app and retries cleanup before restarting', async () => {
  const { slow } = await prepare(); const originalRoot = await fixture.app.evaluate(() => process.env.SystemRoot);
  const index = await readFile(join(fixture.project, '.git', 'index'));
  await fixture.page.getByLabel('向 Pi 发送消息').fill('退出后保留草稿');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('退出后保留草稿');
  const record = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'create', startPoint: 'HEAD', destination: 'worktree' }) as OperationRecord;
  try {
    const pids = await slow.ready();
    await fixture.app.evaluate(({ dialog }, root) => {
      process.env.SystemRoot = root; const probe: QuitProbe = { calls: [] };
      (globalThis as typeof globalThis & { worktreeQuitProbe: QuitProbe }).worktreeQuitProbe = probe;
      dialog.showMessageBox = (...args: unknown[]) => { const options = args.at(-1) as QuitProbe['calls'][number]; probe.calls.push({ title: options.title, buttons: options.buttons }); return new Promise(resolve => { probe.respond = response => resolve({ response, checkboxChecked: false }); }); };
    }, join(fixture.storage, 'missing-system'));
    const calls = () => fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeQuitProbe: QuitProbe }).worktreeQuitProbe.calls);
    await fixture.invoke({ op: 'window', action: 'close' }); await expect.poll(async () => (await calls()).length).toBe(1);
    expect((await calls())[0]).toMatchObject({ title: '暂时无法退出', buttons: ['重试', '返回应用'] });
    expect(fixture.page.isClosed()).toBe(false); expect(pids.filter(processAlive)).toEqual(pids);
    await fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeQuitProbe: QuitProbe }).worktreeQuitProbe.respond!(1));
    const available = await fixture.invoke({ op: 'worktree.recycle', threadId: 't', requestId: crypto.randomUUID() }) as OperationRecord;
    await expect.poll(async () => (await job(available.id)).status).toBe('succeeded');
    expect(await fixture.invoke({ op: 'git.status', threadId: 't' })).toMatchObject({ available: true });
    await fixture.invoke({ op: 'window', action: 'close' }); await expect.poll(async () => (await calls()).length).toBe(2);
    const exited = fixture.app.waitForEvent('close');
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; (globalThis as typeof globalThis & { worktreeQuitProbe: QuitProbe }).worktreeQuitProbe.respond!(0); }, originalRoot);
    await exited; expect(pids.filter(processAlive)).toEqual([]); expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
    await fixture.restart(); expect((await job(record.id)).status).toBe('cancelled');
    expect((await fixture.snapshot()).data.worktrees).toEqual([]);
    expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('退出后保留草稿');
  } finally {
    await fixture.app.evaluate((_electron, root) => { if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root; (globalThis as typeof globalThis & { worktreeQuitProbe?: QuitProbe }).worktreeQuitProbe?.respond?.(1); }, originalRoot).catch(() => {});
    await slow.cleanup();
  }
});
