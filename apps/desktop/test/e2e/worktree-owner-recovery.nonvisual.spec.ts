import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { DesktopData, Thread } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
interface OwnerGate { entered: boolean; release(): void; restore(): void; }
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) {
  await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { ownerGate?: OwnerGate }).ownerGate; gate?.release(); gate?.restore(); }).catch(() => {});
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
} });
const waitJob = (id: string, status: OperationRecord['status'] = 'succeeded') => expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === id)?.status, { timeout: 45000 }).toBe(status);

async function missingOwner(purge = false) {
  const move = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' }) as OperationRecord;
  await waitJob(move.id); const record = (await fixture.snapshot()).data.worktrees[0];
  await writeFile(join(record.path, 'README.md'), 'STAGED_OWNER_RECOVERY'); await gitRun(record.path, ['add', '--', 'README.md']);
  await writeFile(join(record.path, 'README.md'), 'WORKING_OWNER_RECOVERY');
  const local = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, activeThreadId: local.id } });
  await expect.poll(async () => (await fixture.snapshot()).data.ui.activeThreadId).toBe(local.id);
  const archive = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'archive', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(archive.id);
  await fixture.invoke({ op: 'thread.update', id: 't', deletedAt: Date.now() });
  if (purge) {
    await fixture.app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await fixture.invoke({ op: 'thread.purge', id: 't' });
  }
  await fixture.invoke({ op: 'ui.threadPatch', threadId: local.id, patch: { draft: { text: 'KEEP_LOCAL_DRAFT', attachments: [] } } });
  return { record, local, ids: (await fixture.snapshot()).data.threads.map(item => item.id), localIndex: await readFile(join(fixture.project, '.git/index')) };
}
async function gateOwnerSave(recordId: string, ownerId: string, mode: 'fail' | 'hold') {
  await fixture.app.evaluate((_, input) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), original = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: OwnerGate = { entered: false, release, restore: () => { fs.writeFile = original; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { ownerGate?: OwnerGate }).ownerGate = gate;
    fs.writeFile = async (...args: Parameters<typeof original>) => {
      if (String(args[0]) === input.path) {
        const data = JSON.parse(String(args[1])) as DesktopData;
        if (data.worktrees.find(record => record.id === input.recordId)?.threadId !== input.ownerId) {
          gate.entered = true; if (input.mode === 'fail') throw new Error('OWNER_LINK_SAVE_FAILED');
          await original(...args); await wait; return;
        }
      }
      await original(...args);
    }; syncBuiltinESMExports();
  }, { path: join(fixture.storage, 'desktop.json.tmp'), recordId, ownerId, mode });
}

test('failed restored owner linkage stays atomic and the bilingual manager can retry without replacing external files', async () => {
  const { record, local, ids, localIndex } = await missingOwner();
  await gateOwnerSave(record.id, record.threadId, 'fail');
  const restore = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(restore.id, 'failed');
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { ownerGate: OwnerGate }).ownerGate.restore());
  const state = (await fixture.snapshot()).data;
  expect(state.threads.map(item => item.id)).toEqual(ids); expect(state.worktrees[0].threadId).toBe(record.threadId);
  expect(state.worktrees[0].status).toBe('ready');
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('WORKING_OWNER_RECOVERY');
  const index = resolve(record.path, (await gitRun(record.path, ['rev-parse', '--git-path', 'index'])).trim()), indexBytes = await readFile(index);
  await writeFile(join(record.path, 'README.md'), 'EXTERNAL_AFTER_FILE_RESTORE');
  await fixture.invoke({ op: 'ui.threadPatch', threadId: local.id, patch: { draft: { text: 'KEEP_LOCAL_DRAFT', attachments: [] } } });
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.map(item => item.id)).toEqual(ids);
  await taskAction(fixture.page, 'Worktree 管理');
  await expect(fixture.page.getByRole('button', { name: '恢复关联聊天', exact: true })).toBeVisible();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  const manager = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
  await expect(manager).toContainText('Workspace files are ready; the associated chat still needs to be restored.');
  await manager.getByRole('button', { name: 'Restore associated chat', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status).toBe('succeeded');
  const next = (await fixture.snapshot()).data, managed = next.worktrees[0], owner = next.threads.find(item => item.id === managed.threadId)!;
  expect(owner.cwd).toBe(record.path); expect(owner.worktreeBranch).toBe(managed.branch); expect(owner.baseCommit).toBe(record.baseCommit);
  expect(managed.snapshotThreadId).toBe(record.threadId); expect(next.threads).toHaveLength(ids.length + 1); expect(next.threads.find(item => item.id === 't')?.deletedAt).toBeTruthy();
  expect(next.ui.threads[local.id].draft?.text).toBe('KEEP_LOCAL_DRAFT');
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('EXTERNAL_AFTER_FILE_RESTORE'); expect(await readFile(index)).toEqual(indexBytes); expect(await readFile(join(fixture.project, '.git/index'))).toEqual(localIndex);
  await manager.getByRole('button', { name: 'Open linked chat', exact: true }).click();
  fixture.requestTool('read', { path: 'README.md' }); await fixture.invoke({ op: 'thread.send', id: owner.id, text: 'READ_RESTORED_WORKTREE', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(item => item.id === owner.id)?.status).toBe('idle');
  expect((await fixture.snapshot()).data.threads.find(item => item.id === owner.id)?.items.findLast(item => item.toolName === 'read')?.text).toContain('EXTERNAL_AFTER_FILE_RESTORE');
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].threadId).toBe(owner.id); expect((await fixture.snapshot()).data.threads).toHaveLength(ids.length + 1);
});

test('cancelling owner registration preserves restored files and a permanently deleted task can be replaced once', async () => {
  const { record, local, ids } = await missingOwner(true); expect(ids).not.toContain('t');
  await gateOwnerSave(record.id, record.threadId, 'hold');
  const operation = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { ownerGate: OwnerGate }).ownerGate.entered), { timeout: 30000 }).toBe(true);
  expect((await fixture.snapshot()).data.threads.map(item => item.id)).toEqual(ids);
  await fixture.invoke({ op: 'operation.cancel', threadId: local.id, requestId: operation.id });
  await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { ownerGate: OwnerGate }).ownerGate; gate.restore(); gate.release(); });
  await waitJob(operation.id, 'cancelled'); expect((await fixture.snapshot()).data.threads.map(item => item.id)).toEqual(ids);
  expect((await fixture.snapshot()).data.worktrees[0].threadId).toBe('t');
  await writeFile(join(record.path, 'README.md'), 'AFTER_CANCEL'); await fixture.restart();
  const retry = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(retry.id); const next = (await fixture.snapshot()).data;
  expect(next.threads).toHaveLength(ids.length + 1); expect(next.worktrees[0].snapshotThreadId).toBe('t');
  expect(next.threads.find(item => item.id === next.worktrees[0].threadId)?.cwd).toBe(record.path);
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('AFTER_CANCEL');
  const again = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await waitJob(again.id); expect((await fixture.snapshot()).data.threads).toHaveLength(ids.length + 1);
});

test('hard exit before owner publication leaves no ghost task and explicit retry preserves post-restore edits', async () => {
  const { record, local, ids } = await missingOwner(); await gateOwnerSave(record.id, record.threadId, 'hold');
  const operation = await fixture.invoke({ op: 'worktree.manage', threadId: local.id, worktreeId: record.id, action: 'restore', requestId: crypto.randomUUID() }) as OperationRecord;
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { ownerGate: OwnerGate }).ownerGate.entered), { timeout: 30000 }).toBe(true);
  const disk = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as DesktopData;
  expect(disk.threads.map(item => item.id)).toEqual(ids); expect(disk.worktrees[0].threadId).toBe('t'); expect(disk.worktrees[0].status).toBe('ready');
  const pid = await fixture.app.evaluate(() => process.pid); process.kill(pid, 'SIGKILL');
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
  await writeFile(join(record.path, 'README.md'), 'EXTERNAL_AFTER_CRASH'); await fixture.restart();
  const resumed = (await fixture.snapshot()).data; expect(resumed.threads.map(item => item.id)).toEqual(ids); expect(resumed.worktrees[0].threadId).toBe('t');
  expect(resumed.operations.find(item => item.id === operation.id)?.status).toBe('interrupted'); expect(fixture.calls).toHaveLength(0);
  await taskAction(fixture.page, 'Worktree 管理'); await fixture.page.getByRole('button', { name: '恢复关联聊天', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.restore').at(-1)?.status, { timeout: 30000 }).toBe('succeeded');
  const next = (await fixture.snapshot()).data; expect(next.threads).toHaveLength(ids.length + 1); expect(next.worktrees[0].snapshotThreadId).toBe('t');
  expect(next.threads.find(item => item.id === next.worktrees[0].threadId)?.cwd).toBe(record.path);
  expect(await readFile(join(record.path, 'README.md'), 'utf8')).toBe('EXTERNAL_AFTER_CRASH'); expect(fixture.calls).toHaveLength(0);
});
