import type * as fileSystem from 'node:fs';
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { Thread } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
interface FileGate { entered: boolean; release?: () => void; }
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (!fixture) return;
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { fileGate?: FileGate }).fileGate?.release?.()).catch(() => {});
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
const waitJob = async (id: string, status: OperationRecord['status'] = 'succeeded') => {
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === id)?.status, { timeout: 45000 }).toBe(status);
};
async function archivedFixture() {
  const migrate = await fixture.invoke({ op: 'worktree.start', threadId: 't', action: 'migrate', destination: 'worktree', startPoint: 'HEAD', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(migrate.id); const record = (await fixture.snapshot()).data.worktrees[0];
  await fixture.page.getByLabel('向 Pi 发送消息').fill('恢复后继续编辑');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('恢复后继续编辑');
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_STAGED'); await gitRun(record.path, ['add', '--', 'README.md']);
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_WORKING'); await writeFile(join(record.path, 'binary.bin'), Buffer.from([0, 255, 128]));
  const local = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: local.id } });
  await expect(fixture.page.locator('.toolbar .breadcrumb strong')).toHaveText(local.title);
  const archive = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'archive', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(archive.id);
  return { record, local, scratch: join(fixture.storage, 'worktree-restore-files', record.id), mainIndex: await readFile(join(fixture.project, '.git/index')) };
}
async function assertRestored(path: string, scratch: string, mainIndex: Buffer) {
  expect(await readFile(join(path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
  expect(await readFile(join(path, 'binary.bin'))).toEqual(Buffer.from([0, 255, 128]));
  expect(await gitRun(path, ['show', ':README.md'])).toBe('ARCHIVE_STAGED');
  expect(await readFile(join(fixture.project, '.git/index'))).toEqual(mainIndex);
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('恢复后继续编辑');
  expect((await fixture.snapshot()).data.worktrees[0].restoreFiles).toBeUndefined();
  await expect(access(scratch)).rejects.toMatchObject({ code: 'ENOENT' });
}

for (const phase of ['partial', 'published'] as const) test('restore files survive process termination with the file ' + phase, async () => {
  const { record, local, scratch, mainIndex } = await archivedFixture();
  await fixture.app.evaluate((_electron, phase) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module'); const write = fs.writeFile, link = fs.link;
    const gate: FileGate = { entered: false }; (globalThis as typeof globalThis & { fileGate: FileGate }).fileGate = gate;
    const wait = async () => { gate.entered = true; await new Promise<void>(resolve => { gate.release = resolve; }); };
    fs.writeFile = async (path, data, options) => {
      if (phase === 'partial' && String(path).includes('worktree-restore-files') && Buffer.isBuffer(data) && data.toString() === 'ARCHIVE_WORKING') {
        fs.writeFile = write; syncBuiltinESMExports(); await write(path, data.subarray(0, 3), options); await wait(); return;
      }
      return write(path, data, options);
    };
    fs.link = async (source, target) => {
      await link(source, target);
      if (phase === 'published' && String(source).includes('worktree-restore-files') && String(target).endsWith('README.md')) {
        fs.link = link; syncBuiltinESMExports(); await wait();
      }
    };
    syncBuiltinESMExports();
  }, phase);
  const pid = await fixture.app.evaluate(() => process.pid);
  await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() });
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { fileGate: FileGate }).fileGate.entered), { timeout: 30000 }).toBe(true);
  process.kill(pid, 'SIGKILL');
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
  const target = join(record.path, 'README.md'), published = phase === 'published' ? await lstat(target, { bigint: true }) : undefined;
  if (phase === 'partial') await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
  else expect(await readFile(target, 'utf8')).toBe('ARCHIVE_WORKING');
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  await taskAction(fixture.page, 'Worktree 管理');
  let manager = fixture.page.getByRole('dialog', { name: 'Worktree 管理', exact: true });
  await expect(manager.getByText('恢复未完成，可重试', { exact: false })).toBeVisible();
  if (phase === 'partial') {
    const partial = join(scratch, (await readdir(scratch))[0]); await writeFile(partial, 'EXTERNAL_KEEP');
    await manager.getByRole('button', { name: '恢复 Worktree', exact: true }).click();
    await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status).toBe('failed');
    expect(await readFile(partial, 'utf8')).toBe('EXTERNAL_KEEP');
    await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
    manager = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
    await expect(manager.getByRole('alert').filter({ hasText: 'The recovery scratch directory contains external changes' })).toBeVisible();
    await writeFile(partial, 'ARC'); // Release only this fixture's external modification.
  }
  await manager.getByRole('button', { name: phase === 'partial' ? 'Restore worktree' : '恢复 Worktree', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status).toBe('succeeded');
  await assertRestored(record.path, scratch, mainIndex);
  if (published) expect((await lstat(target, { bigint: true })).ino).toBe(published.ino);
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].status).toBe('ready');
});

test('restore cleanup failure exposes an in-place action and preserves the restored workspace', async () => {
  const { record, local, scratch, mainIndex } = await archivedFixture();
  await fixture.app.evaluate((_electron, scratch) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module'); const rmdir = fs.rmdir;
    fs.rmdir = async (path, options) => {
      if (String(path) === scratch) { fs.rmdir = rmdir; syncBuiltinESMExports(); throw new Error('RECOVERY_SCRATCH_LOCKED'); }
      return rmdir(path, options);
    };
    syncBuiltinESMExports();
  }, scratch);
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id); expect((await fixture.snapshot()).data.worktrees[0].status).toBe('ready');
  const before = await lstat(join(record.path, 'README.md'), { bigint: true });
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: 't' } });
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('恢复后继续编辑');
  await taskAction(fixture.page, 'Worktree 管理');
  await expect(fixture.page.getByRole('button', { name: '清理恢复临时文件', exact: true })).toBeVisible();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  const manager = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
  await expect(manager.getByRole('alert').filter({ hasText: 'its temporary recovery files could not be cleaned up' })).toBeVisible();
  await manager.getByRole('button', { name: 'Clean up temporary recovery files', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.cleanup').at(-1)?.status).toBe('succeeded');
  await expect(manager.getByRole('button', { name: 'Clean up temporary recovery files', exact: true })).toHaveCount(0);
  expect((await fixture.snapshot()).data.worktrees[0].cleanupError).toBeUndefined();
  expect((await lstat(join(record.path, 'README.md'), { bigint: true })).ino).toBe(before.ino);
  await assertRestored(record.path, scratch, mainIndex);
  const archive = await fixture.invoke({ op: 'worktree.manage', threadId: 't', worktreeId: record.id, action: 'archive', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(archive.id, 'failed');
  expect((await fixture.snapshot()).data.operations.find(item => item.id === archive.id)?.error).toContain('请先切换或关闭');
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('ready');
});
