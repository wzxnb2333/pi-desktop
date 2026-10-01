import type * as fileSystem from 'node:fs';
import { access, lstat, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { DesktopData, Thread } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
interface RestoreGate { entered: boolean; release?: () => void; }
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (!fixture) return;
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { restoreGate?: RestoreGate }).restoreGate?.release?.()).catch(() => {});
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
const waitJob = async (id: string, status: OperationRecord['status'] = 'succeeded') => {
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === id)?.status, { timeout: 45000 }).toBe(status);
};
async function archivedFixture() {
  const operation = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' }) as OperationRecord;
  await waitJob(operation.id);
  const record = (await fixture.snapshot()).data.worktrees[0];
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_STAGED'); await gitRun(record.path, ['add', '--', 'README.md']);
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_WORKING');
  const local = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: local.id } });
  await expect(fixture.page.locator('.toolbar .breadcrumb strong')).toHaveText(local.title);
  const archive = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'archive', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(archive.id);
  return { record, local, localIndex: await readFile(join(fixture.project, '.git/index')) };
}
async function assertRestored(path: string, localIndex: Buffer) {
  expect(await readFile(join(path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
  expect(await gitRun(path, ['show', ':README.md'])).toBe('ARCHIVE_STAGED');
  expect(await readFile(join(fixture.project, '.git/index'))).toEqual(localIndex);
  const index = resolve(path, (await gitRun(path, ['rev-parse', '--git-path', 'index'])).trim());
  expect((await readdir(dirname(index))).filter(name => name.includes('.pi-restore-') || name.includes('.pi-prepare-') || name === 'index.lock')).toEqual([]);
}

test('restore preserves a foreign index lock and offers localized retry after restart', async () => {
  const { record, local, localIndex } = await archivedFixture();
  await fixture.app.evaluate(() => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module'); const original = fs.link;
    fs.link = async (source, target) => {
      if (String(target).endsWith('index.lock') && String(source).includes('.pi-restore-')) {
        fs.link = original; syncBuiltinESMExports(); await fs.writeFile(target, 'EXTERNAL_INDEX_LOCK', { flag: 'wx' });
      }
      return original(source, target);
    };
    syncBuiltinESMExports();
  });
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id, 'failed');
  const index = resolve(record.path, (await gitRun(record.path, ['rev-parse', '--git-path', 'index'])).trim());
  expect(await readFile(index + '.lock', 'utf8')).toBe('EXTERNAL_INDEX_LOCK');
  await taskAction(fixture.page, 'Worktree 管理');
  await expect(fixture.page.getByText('恢复未完成，可重试', { exact: false })).toBeVisible();
  await expect(fixture.page.getByRole('alert').filter({ hasText: '暂存区被其他 Git 操作锁定' })).toBeVisible();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  await expect(fixture.page.getByRole('alert').filter({ hasText: 'Another Git operation holds the index lock' })).toBeVisible();
  await fixture.restart();
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  expect(await readFile(index + '.lock', 'utf8')).toBe('EXTERNAL_INDEX_LOCK');
  await rm(index + '.lock'); // This test owns the external process fixture, not production cleanup.
  await taskAction(fixture.page, 'Manage worktrees');
  const manager = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
  await expect(manager.getByText('Restoration incomplete; retry available', { exact: false })).toBeVisible();
  await manager.getByRole('button', { name: 'Restore worktree', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status).toBe('succeeded');
  await assertRestored(record.path, localIndex);
});

for (const phase of ['preparation', 'preparation-lock', 'locked', 'published'] as const) test('restore resumes after main-process termination with the index ' + phase, async () => {
  const { record, local, localIndex } = await archivedFixture();
  await fixture.app.evaluate((_electron, phase) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
    const originalLink = fs.link, originalRename = fs.rename, originalOpen = fs.open; const gate: RestoreGate = { entered: false };
    (globalThis as typeof globalThis & { restoreGate: RestoreGate }).restoreGate = gate;
    const wait = async () => { gate.entered = true; await new Promise<void>(resolve => { gate.release = resolve; }); };
    fs.open = async (path, flags, mode) => {
      const handle = await originalOpen(path, flags, mode);
      if (phase.startsWith('preparation') && (String(path).includes('.pi-restore-') || String(path).includes('.pi-prepare-'))) {
        if (phase === 'preparation-lock') { await handle.truncate(16); await fs.rename(path, String(path) + '.lock'); }
        fs.open = originalOpen; syncBuiltinESMExports(); await wait();
      }
      return handle;
    };
    fs.link = async (source, target) => {
      await originalLink(source, target);
      if (phase === 'locked' && String(target).endsWith('index.lock') && String(source).includes('.pi-restore-')) {
        fs.link = originalLink; syncBuiltinESMExports(); await wait();
      }
    };
    fs.rename = async (source, target) => {
      await originalRename(source, target);
      if (phase === 'published' && String(source).endsWith('index.lock') && String(target).endsWith('index')) {
        fs.rename = originalRename; syncBuiltinESMExports(); await wait();
      }
    };
    syncBuiltinESMExports();
  }, phase);
  const pid = await fixture.app.evaluate(() => process.pid);
  await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() });
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { restoreGate: RestoreGate }).restoreGate.entered), { timeout: 30000 }).toBe(true);
  process.kill(pid, 'SIGKILL');
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
  const index = resolve(record.path, (await gitRun(record.path, ['rev-parse', '--git-path', 'index'])).trim());
  const published = phase === 'published' ? await lstat(index, { bigint: true }) : undefined;
  if (phase === 'locked') await access(index + '.lock');
  await fixture.restart();
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id);
  await assertRestored(record.path, localIndex);
  if (published) expect((await lstat(index, { bigint: true })).ino).toBe(published.ino);
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].status).toBe('ready');
});

test('restore state-save failure remains retryable without replacing its published index', async () => {
  const { record, local, localIndex } = await archivedFixture();
  await fixture.app.evaluate((_electron, input) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module'); const original = fs.rename;
    fs.rename = async (source, target) => {
      if (String(target) === input.state && (JSON.parse(await fs.readFile(source, 'utf8')) as DesktopData).worktrees.some(item => item.id === input.id && item.status === 'ready')) {
        fs.rename = original; syncBuiltinESMExports(); throw new Error('RESTORE_STATE_DISK_FAILURE');
      }
      return original(source, target);
    };
    syncBuiltinESMExports();
  }, { state: join(fixture.storage, 'desktop.json'), id: record.id });
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id, 'failed');
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  const index = resolve(record.path, (await gitRun(record.path, ['rev-parse', '--git-path', 'index'])).trim());
  await gitRun(record.path, ['update-index', '--index-version', '4']);
  const before = await lstat(index, { bigint: true });
  const refreshed = await readFile(index);
  await fixture.restart();
  const retry = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(retry.id); expect((await lstat(index, { bigint: true })).ino).toBe(before.ino);
  expect(await readFile(index)).toEqual(refreshed);
  await assertRestored(record.path, localIndex);
});
