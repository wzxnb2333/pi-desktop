import type * as fileSystem from 'node:fs';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { DesktopData, Thread } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
interface ReclamationGate { entered: boolean; release?: () => void; }
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  if (!fixture) return;
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { reclamationGate?: ReclamationGate }).reclamationGate?.release?.()).catch(() => {});
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
const waitJob = async (id: string, status: OperationRecord['status'] = 'succeeded') => {
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === id)?.status, { timeout: 45000 }).toBe(status);
};
async function startArchive(phase: 'prepared' | 'partial') {
  const move = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' }) as OperationRecord;
  await waitJob(move.id); const record = (await fixture.snapshot()).data.worktrees[0];
  await fixture.page.getByLabel('向 Pi 发送消息').fill('归档后保留草稿');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('归档后保留草稿');
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_STAGE'); await gitRun(record.path, ['add', '--', 'README.md']);
  await writeFile(join(record.path, 'README.md'), 'ARCHIVE_WORKING'); await writeFile(join(record.path, 'z-last.bin'), Buffer.from([0, 128, 255]));
  const index = await readFile(join(fixture.project, '.git/index'));
  const local = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: local.id } });
  await expect(fixture.page.locator('.toolbar .breadcrumb strong')).toHaveText(local.title);
  await fixture.app.evaluate((_electron, input) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module'); const rename = fs.rename, unlink = fs.unlink;
    const gate: ReclamationGate = { entered: false };
    (globalThis as typeof globalThis & { reclamationGate: ReclamationGate }).reclamationGate = gate;
    const wait = async () => { gate.entered = true; await new Promise<void>(resolve => { gate.release = resolve; }); };
    fs.rename = async (source, target) => {
      const candidate = input.phase === 'prepared' && String(target) === input.state &&
        (JSON.parse(await fs.readFile(source, 'utf8')) as DesktopData).worktrees.some(item => item.id === input.id && item.archiveRemoval?.phase === 'prepared');
      await rename(source, target);
      if (candidate) { fs.rename = rename; syncBuiltinESMExports(); await wait(); }
    };
    fs.unlink = async path => {
      await unlink(path);
      if (input.phase === 'partial' && String(path).replaceAll('\\', '/').includes('/worktree-reclamation/') && String(path).endsWith('README.md')) {
        fs.unlink = unlink; syncBuiltinESMExports(); await wait();
      }
    };
    syncBuiltinESMExports();
  }, { phase, state: join(fixture.storage, 'desktop.json'), id: record.id });
  const pid = await fixture.app.evaluate(() => process.pid);
  const operation = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'archive', requestId: crypto.randomUUID() }) as OperationRecord;
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { reclamationGate: ReclamationGate }).reclamationGate.entered), { timeout: 30000 }).toBe(true);
  return { record, local, index, pid, operation };
}
async function kill(pid: number) {
  process.kill(pid, 'SIGKILL');
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
}

test('archive restart before relocation restores the original workspace state without deleting files', async () => {
  const { record, index, pid } = await startArchive('prepared'); await kill(pid); await fixture.restart();
  const restored = (await fixture.snapshot()).data.worktrees[0];
  expect(restored.status).toBe('ready'); expect(restored.archiveRemoval).toBeUndefined();
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
  expect(await gitRun(record.path, ['show', ':README.md'])).toBe('ARCHIVE_STAGE');
  expect(await readFile(join(fixture.project, '.git/index'))).toEqual(index);
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('归档后保留草稿');
});

test('archive restart after partial deletion preserves external files and offers localized restore and cleanup', async () => {
  const { record, index, pid, local } = await startArchive('partial');
  const pending = (await fixture.snapshot()).data.worktrees[0].archiveRemoval!;
  await kill(pid); await fixture.restart();
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  await expect(access(record.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(access(join(pending.path, 'README.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fixture.invoke({ op: 'thread.send', id: 't', text: 'must not run', attachments: [] })).rejects.toThrow('已归档');
  const external = join(pending.path, 'external.txt'); await writeFile(external, 'EXTERNAL_KEEP');
  await taskAction(fixture.page, 'Worktree 管理');
  let manager = fixture.page.getByRole('dialog', { name: 'Worktree 管理', exact: true });
  await manager.getByRole('button', { name: '计算占用', exact: true }).click();
  await expect(manager.getByText(/待回收目录 .* MB/)).toBeVisible();
  await manager.getByRole('button', { name: '继续回收旧目录', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.cleanup').at(-1)?.status).toBe('failed');
  expect(await readFile(external, 'utf8')).toBe('EXTERNAL_KEEP');
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  manager = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
  await expect(manager.getByRole('alert').filter({ hasText: 'The cleanup folder contains external changes' }).first()).toBeVisible();
  await manager.getByRole('button', { name: 'Restore worktree', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status).toBe('succeeded');
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
  expect(await gitRun(record.path, ['show', ':README.md'])).toBe('ARCHIVE_STAGE');
  expect(await readFile(external, 'utf8')).toBe('EXTERNAL_KEEP');
  await rm(external); // Release only the file explicitly created by this external-edit fixture.
  await manager.getByRole('button', { name: 'Resume old folder cleanup', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.cleanup').at(-1)?.status).toBe('succeeded');
  await expect(access(pending.path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('ready');
  expect((await fixture.snapshot()).data.worktrees[0].archiveRemoval).toBeUndefined();
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
  expect(await readFile(join(fixture.project, '.git/index'))).toEqual(index);
  expect((await fixture.snapshot()).data.ui.activeThreadId).toBe(local.id);
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].archiveRemoval).toBeUndefined();
  expect((await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('归档后保留草稿');
});

test('archive cancellation during deletion retains resumable cleanup and the recovery snapshot', async () => {
  const { record, local, operation } = await startArchive('partial');
  const cancel = fixture.invoke({ op: 'operation.cancel', threadId: local.id, requestId: operation.id });
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { reclamationGate: ReclamationGate }).reclamationGate.release?.());
  await cancel; await waitJob(operation.id, 'cancelled');
  const pending = (await fixture.snapshot()).data.worktrees[0].archiveRemoval!; expect(pending).toBeTruthy();
  expect((await fixture.snapshot()).data.worktrees[0].status).toBe('archived');
  const retry = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'cleanup', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(retry.id); await expect(access(pending.path)).rejects.toMatchObject({ code: 'ENOENT' });
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id); expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('ARCHIVE_WORKING');
});
