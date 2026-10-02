import { taskAction } from './fixtures/task-actions.ts';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import type { Thread } from '../../src/shared/contracts.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });
const state = () => fixture.snapshot();
const current = () => state().then(value => value.data.threads.find(item => item.id === 't')!);
const waitJob = async (id: string, status: OperationRecord['status'] = 'succeeded') => { await expect.poll(async () => (await state()).data.operations.find(item => item.id === id)?.status, { timeout: 45000 }).toBe(status); };
const move = async (destination: 'local' | 'worktree') => {
  const job = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination, startPoint: 'HEAD' }) as OperationRecord;
  await waitJob(job.id); return job;
};

test('same chat migration keeps history and draft, reloads real tool cwd, preserves indexes and reuses its checkout after restart', async () => {
  await fixture.invoke({ op: 'thread.send', id: 't', text: '历史消息', attachments: [] }); await expect.poll(async () => (await current()).status).toBe('idle');
  await fixture.page.getByLabel('向 Pi 发送消息').fill('迁移草稿');
  await expect.poll(async () => (await state()).data.ui.threads.t.draft?.text).toBe('迁移草稿');
  const before = await current();
  await writeFile(join(fixture.project, 'README.md'), 'local edit\r\n'); await gitRun(fixture.project, ['add', '--', 'README.md']);
  const index = await readFile(join(fixture.project, '.git', 'index'));
  await taskAction(fixture.page, '查看变更');
  await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await fixture.page.getByRole('button', { name: '迁移此聊天到 Worktree', exact: true }).click();
  await expect.poll(async () => (await current()).worktreeBranch, { timeout: 45000 }).toBeTruthy();
  const job = (await state()).data.operations.find(item => item.kind === 'worktree.migrate')!; await waitJob(job.id);
  const worktree = (await current()).cwd;
  expect(worktree).not.toBe(fixture.project); expect((await current()).items).toEqual(before.items); expect((await current()).sessionFile).toBe(before.sessionFile);
  expect((await state()).data.ui.threads.t.draft?.text).toBe('迁移草稿'); expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('local edit\r\n');
  fixture.requestTool('write', { path: 'only-worktree.txt', content: 'WORKTREE_TOOL_CWD' });
  await fixture.invoke({ op: 'thread.send', id: 't', text: '写入工作区', attachments: [] }); await expect.poll(async () => (await current()).status).toBe('idle');
  expect(await readFile(join(worktree, 'only-worktree.txt'), 'utf8')).toBe('WORKTREE_TOOL_CWD'); await expect(access(join(fixture.project, 'only-worktree.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  await fixture.restart(); expect((await current()).cwd).toBe(worktree);
  await move('local'); expect((await current()).cwd).toBe(fixture.project); expect((await current()).worktreeBranch).toBeUndefined();
  expect(await readFile(join(fixture.project, 'only-worktree.txt'), 'utf8')).toBe('WORKTREE_TOOL_CWD'); expect(await readFile(join(fixture.project, '.git', 'index'))).toEqual(index);
  await move('worktree'); expect((await current()).cwd).toBe(worktree); expect((await state()).data.worktrees).toHaveLength(1);
});

test('migration refuses active runs and conflicting destination edits; starting references create actual separate tasks', async () => {
  fixture.setMode('hold'); await fixture.invoke({ op: 'thread.send', id: 't', text: 'hold', attachments: [] }); await expect.poll(() => fixture.calls.length).toBe(1);
  await expect(fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' })).rejects.toThrow(/空闲/);
  await fixture.invoke({ op: 'thread.stop', id: 't' }); await expect.poll(async () => (await current()).status).toBe('idle');
  await move('worktree'); const worktree = (await current()).cwd;
  await writeFile(join(worktree, 'README.md'), 'worktree edits'); await writeFile(join(fixture.project, 'README.md'), 'external local edits');
  const failed = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'local', startPoint: 'HEAD' }) as OperationRecord;
  await waitJob(failed.id, 'failed'); expect((await state()).data.operations.find(item => item.id === failed.id)?.error).toContain('迁移冲突');
  expect((await current()).cwd).toBe(worktree); expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('external local edits');
  expect(await readFile(join(worktree, 'README.md'), 'utf8')).toBe('worktree edits');
  const reference = (await gitRun(worktree, ['rev-parse', 'HEAD'])).trim();
  await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await fixture.page.getByLabel('Worktree 起始分支或提交').fill(reference); await fixture.page.getByRole('button', { name: '按起点新建 Worktree 任务' }).click();
  await expect.poll(async () => (await state()).data.operations.find(item => item.kind === 'worktree.create')?.status, { timeout: 45000 }).toBe('succeeded');
  await fixture.page.getByRole('button', { name: '打开新建的 Worktree 任务' }).click();
  const selected = (await state()).data.ui.activeThreadId; expect(selected).not.toBe('t'); const created = (await state()).data.threads.find(item => item.id === selected)!;
  expect(created.baseCommit).toBe(reference); expect(await readFile(join(created.cwd, 'README.md'), 'utf8')).toBe('# Acceptance\n');
});

test('managed archive UI preserves dirty and staged contents across restart and refuses open windows', async () => {
  await move('worktree'); const record = (await state()).data.worktrees[0];
  await writeFile(join(record.path, 'README.md'), 'staged\r\n'); await gitRun(record.path, ['add', '--', 'README.md']);
  await writeFile(join(record.path, 'README.md'), 'working\r\n'); await writeFile(join(record.path, 'untracked.bin'), Buffer.from([0, 1, 255]));
  const rejected = await fixture.invoke({ op: 'worktree.manage', threadId: 't', worktreeId: record.id, requestId: crypto.randomUUID(), action: 'archive' }) as OperationRecord;
  await waitJob(rejected.id, 'failed'); expect((await state()).data.operations.find(item => item.id === rejected.id)?.error).toContain('窗口');
  const local = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await state()).data.ui, activeThreadId: local.id } });
  await expect(fixture.page.locator('.toolbar .breadcrumb strong')).toHaveText(local.title);
  await taskAction(fixture.page, 'Worktree 管理');
  let manager = fixture.page.getByRole('dialog', { name: 'Worktree 管理', exact: true });
  await manager.getByRole('button', { name: '计算占用', exact: true }).click();
  await expect(manager.getByText(/目录 .* MB；任务恢复快照 .* MB/)).toBeVisible();
  await manager.getByRole('button', { name: '归档并回收 Worktree', exact: true }).click();
  await fixture.page.getByRole('button', { name: '归档并回收', exact: true }).click();
  await expect.poll(async () => (await state()).data.operations.filter(item => item.kind === 'worktree.archive').at(-1)?.status, { timeout: 45000 }).toBe('succeeded');
  await expect.poll(async () => (await state()).data.worktrees[0].status, { timeout: 45000 }).toBe('archived');
  await expect(access(record.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: 'archived', attachments: [] })).rejects.toThrow(/已归档/);
  await manager.getByLabel('自动归档闲置 Worktree', { exact: true }).check();
  await manager.getByLabel('闲置天数', { exact: true }).click();
  await fixture.page.locator('.menu-item[data-value="7"]').click();
  await expect.poll(async () => (await state()).data.settings.worktreeCleanup).toEqual({ enabled: true, days: 7 });
  await fixture.restart(); expect((await state()).data.worktrees[0].status).toBe('archived'); expect((await state()).data.settings.worktreeCleanup).toEqual({ enabled: true, days: 7 });
  await taskAction(fixture.page, 'Worktree 管理'); manager = fixture.page.getByRole('dialog', { name: 'Worktree 管理', exact: true });
  await manager.getByRole('button', { name: '恢复 Worktree', exact: true }).click();
  await expect.poll(async () => (await state()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status, { timeout: 45000 }).toBe('succeeded');
  await expect.poll(async () => (await state()).data.worktrees[0].status, { timeout: 45000 }).toBe('ready');
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('working\r\n');
  expect(await gitRun(record.path, ['show', ':README.md'])).toBe('staged\r\n');
  expect(await readFile(join(record.path, 'untracked.bin'))).toEqual(Buffer.from([0, 1, 255]));
  await manager.getByRole('button', { name: '打开关联聊天', exact: true }).click();
  await expect.poll(async () => (await state()).data.ui.activeThreadId).toBe('t');
  await fixture.invoke({ op: 'thread.send', id: 't', text: '恢复后继续', attachments: [] }); await expect.poll(async () => (await current()).status).toBe('idle');
});

test('automatic cleanup remains opt-in, resumes after restart and protects an opened workspace', async () => {
  test.setTimeout(150000);
  const idle = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true }) as Thread;
  const open = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await state()).data.ui, activeThreadId: open.id } });
  expect((await state()).data.settings.worktreeCleanup.enabled).toBe(false);
  await fixture.invoke({ op: 'settings.patch', patch: { worktreeCleanup: { enabled: true, days: 1 } } });
  await fixture.restart();
  // Advance the main-process clock, while preserving the real timer and native cleanup service.
  await fixture.app.evaluate(() => { const now = Date.now; Date.now = () => now() + 2 * 86400000; });
  await expect.poll(async () => (await state()).data.worktrees.find(item => item.threadId === idle.id)?.status, { timeout: 80000, intervals: [1000, 1000, 3000] }).toBe('archived');
  expect((await state()).data.worktrees.find(item => item.threadId === open.id)?.status).toBe('ready');
  await expect(access(idle.cwd)).rejects.toMatchObject({ code: 'ENOENT' }); await access(open.cwd);
  expect((await state()).data.operations.some(item => item.kind === 'worktree.recycle' && item.status === 'succeeded')).toBe(true);
});
