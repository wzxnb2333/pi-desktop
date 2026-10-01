import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { DesktopData } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { processAlive, slowGitFixture } from '../fixtures/git-process.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { creationGate?: CreationGate }).creationGate; gate?.release(); gate?.restore?.(); }).catch(() => {});
  const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
interface CreationGate { entered: boolean; cwd?: string; release(): void; restore?(): void }
const waitJob = (id: string, status: OperationRecord['status'] = 'succeeded') => expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === id)?.status, { timeout: 30000 }).toBe(status);

async function gateTaskSave(mode: 'fail' | 'hold') {
  await fixture.app.evaluate((_, input) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), original = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: CreationGate = { entered: false, release, restore: () => { fs.writeFile = original; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate = gate;
    fs.writeFile = async (...args: Parameters<typeof original>) => {
      if (String(args[0]) === input.path) {
        const candidate = (JSON.parse(String(args[1])) as DesktopData).threads.find(thread => thread.id !== 't');
        if (candidate) { gate.entered = true; gate.cwd = candidate.cwd; if (input.mode === 'fail') throw new Error('CREATION_RECOVERY_SAVE_FAILED'); await original(...args); await wait; return; }
      }
      await original(...args);
    }; syncBuiltinESMExports();
  }, { path: join(fixture.storage, 'desktop.json.tmp'), mode });
}
async function interruptedCheckout() {
  await gateTaskSave('hold');
  const pending = fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId: crypto.randomUUID() }).catch(error => String(error));
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.entered), { timeout: 30000 }).toBe(true);
  const cwd = (await fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.cwd))!;
  await writeFile(join(cwd, 'external.txt'), 'RETAINED_CREATION');
  const pid = await fixture.app.evaluate(() => process.pid); process.kill(pid, 'SIGKILL'); await pending;
  await expect.poll(() => processAlive(pid)).toBe(false); await fixture.restart();
  const issue = (await fixture.snapshot()).data.worktreeCreationIssues![0]; expect(issue.canOpen).toBe(true); return { cwd, id: issue.id };
}

test('hard exit before task registration exposes the retained checkout and restores one usable chat without replaying initialization', async () => {
  await fixture.page.getByLabel('向 Pi 发送消息').fill('KEEP_SOURCE_DRAFT');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('KEEP_SOURCE_DRAFT');
  const index = await readFile(join(fixture.project, '.git/index'));
  await fixture.app.evaluate((_, path) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), original = fs.writeFile;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: CreationGate = { entered: false, release }; (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate = gate;
    fs.writeFile = async (...args: Parameters<typeof original>) => {
      await original(...args);
      if (String(args[0]) !== path) return;
      const candidate = (JSON.parse(String(args[1])) as DesktopData).threads.find(thread => thread.id !== 't');
      if (candidate) { gate.entered = true; gate.cwd = candidate.cwd; await wait; }
    }; syncBuiltinESMExports();
  }, join(fixture.storage, 'desktop.json.tmp'));
  const creating = fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId: crypto.randomUUID() }).catch(error => String(error));
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.entered), { timeout: 30000 }).toBe(true);
  const cwd = (await fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.cwd))!;
  await writeFile(join(cwd, 'external.txt'), 'EXTERNAL_WHILE_REGISTERING');
  const pid = await fixture.app.evaluate(() => process.pid); process.kill(pid, 'SIGKILL'); await creating;
  await expect.poll(() => { try { process.kill(pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
  await taskAction(fixture.page, 'Worktree 管理');
  await expect(fixture.page.getByText('Worktree 创建已中断，保留的文件可以重新打开。', { exact: true })).toBeVisible();
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  const panel = fixture.page.getByRole('dialog', { name: 'Manage worktrees', exact: true });
  await panel.getByRole('button', { name: 'Open retained worktree', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.threads.length).toBe(2);
  await expect(panel.getByRole('button', { name: 'Open retained worktree', exact: true })).toHaveCount(0);
  const data = (await fixture.snapshot()).data, recovered = data.threads.find(thread => thread.id !== 't')!;
  expect(recovered.cwd).toBe(cwd); expect(data.worktrees.find(record => record.threadId === recovered.id)?.path).toBe(cwd);
  expect(await readFile(join(cwd, 'external.txt'), 'utf8')).toBe('EXTERNAL_WHILE_REGISTERING'); expect(await readFile(join(fixture.project, '.git/index'))).toEqual(index);
  expect(data.ui.threads.t.draft?.text).toBe('KEEP_SOURCE_DRAFT'); expect(fixture.calls).toHaveLength(0);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads).toHaveLength(2);
  expect(await readdir(join(fixture.storage, 'worktree-creations'))).toEqual([]);
  fixture.requestTool('read', { path: 'external.txt' }); await fixture.invoke({ op: 'thread.send', id: recovered.id, text: 'READ_RECOVERED_CREATION', attachments: [] });
  await expect.poll(async () => (await fixture.snapshot()).data.threads.find(thread => thread.id === recovered.id)?.status).toBe('idle');
  expect((await fixture.snapshot()).data.threads.find(thread => thread.id === recovered.id)?.items.findLast(item => item.toolName === 'read')?.text).toContain('EXTERNAL_WHILE_REGISTERING');
});

test('a real interrupted Git checkout stays blocked without a completion checkpoint even after its launcher exits', async () => {
  const slow = await slowGitFixture(fixture.storage), hooks = join(fixture.storage, 'creation-hooks'); await mkdir(hooks);
  await writeFile(join(hooks, 'post-checkout'), '#!/bin/sh\nexec ' + slow.command + '\n');
  await gitRun(fixture.project, ['config', 'core.hooksPath', hooks.replaceAll('\\', '/')]);
  const endHelpers = async () => {
    for (const pid of (await slow.pids()).reverse()) if (processAlive(pid)) process.kill(pid, 'SIGKILL');
    await slow.cleanup();
  };
  try {
    const creating = fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId: crypto.randomUUID() }).catch(error => String(error));
    await slow.ready();
    const receiptFile = (await readdir(join(fixture.storage, 'worktree-creations'))).find(file => file.endsWith('.json'))!;
    const receipt = JSON.parse(await readFile(join(fixture.storage, 'worktree-creations', receiptFile), 'utf8')) as { id: string; pid: number; path: string };
    expect(processAlive(receipt.pid)).toBe(true);
    const indexPath = resolve(receipt.path, (await gitRun(receipt.path, ['rev-parse', '--git-path', 'index'])).trim()), index = await readFile(indexPath);
    const pid = await fixture.app.evaluate(() => process.pid); process.kill(pid, 'SIGKILL');
    await expect.poll(() => processAlive(pid)).toBe(false);
    // End only this fixture's recorded hook children before Playwright closes
    // the crashed app transport; inherited pipes otherwise keep close pending.
    await endHelpers(); await creating; await fixture.restart();
    const blocked = (await fixture.snapshot()).data; expect(blocked.threads).toHaveLength(1); expect(blocked.worktreeCreationIssues![0].canOpen).toBe(false);
    expect(blocked.worktreeCreationIssues![0].message).toMatch(/进程仍在运行|创建阶段无法确认/);
    const refused = await fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: receipt.id, requestId: crypto.randomUUID(), action: 'open' }) as OperationRecord;
    await waitJob(refused.id, 'failed'); expect((await fixture.snapshot()).data.threads).toHaveLength(1);
    await expect.poll(() => processAlive(receipt.pid)).toBe(false);
    await writeFile(join(receipt.path, 'external.txt'), 'AFTER_GIT_INTERRUPTION');
    await fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: '', requestId: crypto.randomUUID(), action: 'refresh' });
    expect((await fixture.snapshot()).data.worktreeCreationIssues![0].canOpen).toBe(false);
    expect((await fixture.snapshot()).data.worktreeCreationIssues![0].message).toContain('创建阶段无法确认');
    expect((await fixture.snapshot()).data.threads).toHaveLength(1);
    expect(await readFile(indexPath)).toEqual(index); expect(await readFile(join(receipt.path, 'external.txt'), 'utf8')).toBe('AFTER_GIT_INTERRUPTION'); expect(fixture.calls).toHaveLength(0);
  } finally { await endHelpers(); }
});

test('failed and cancelled recovery commits preserve the receipt and simultaneous retries register exactly one owner', async () => {
  const { cwd, id } = await interruptedCheckout(); await gateTaskSave('fail');
  const failed = await fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: id, requestId: crypto.randomUUID(), action: 'open' }) as OperationRecord;
  await waitJob(failed.id, 'failed');
  await fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.restore!());
  expect((await fixture.snapshot()).data.threads).toHaveLength(1); expect((await fixture.snapshot()).data.worktrees).toHaveLength(0);
  await fixture.restart(); expect((await fixture.snapshot()).data.worktreeCreationIssues![0].canOpen).toBe(true);
  await gateTaskSave('hold');
  const cancelled = await fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: id, requestId: crypto.randomUUID(), action: 'open' }) as OperationRecord;
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.entered), { timeout: 30000 }).toBe(true);
  expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  await fixture.invoke({ op: 'operation.cancel', threadId: 't', requestId: cancelled.id });
  await fixture.app.evaluate(() => { const gate = (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate; gate.restore!(); gate.release(); });
  await waitJob(cancelled.id, 'cancelled'); expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  await writeFile(join(cwd, 'external.txt'), 'AFTER_RECOVERY_CANCEL');
  const attempts = await Promise.allSettled([1, 2].map(() => fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: id, requestId: crypto.randomUUID(), action: 'open' }) as Promise<OperationRecord>));
  const jobs = attempts.filter((item): item is PromiseFulfilledResult<OperationRecord> => item.status === 'fulfilled').map(item => item.value);
  expect(jobs).toHaveLength(1);
  for (const attempt of attempts) if (attempt.status === 'rejected') expect(String(attempt.reason)).toContain('此操作正在运行');
  for (const job of jobs) await waitJob(job.id);
  const recovered = (await fixture.snapshot()).data; expect(recovered.threads).toHaveLength(2); expect(recovered.worktrees).toHaveLength(1);
  for (const job of jobs) expect(recovered.operations.find(item => item.id === job.id)?.result).toMatchObject({ threadId: recovered.worktrees[0].threadId });
  expect(await fixture.invoke({ op: 'worktree.creationRecovery', threadId: 't', recoveryId: id, requestId: crypto.randomUUID(), action: 'open' })).toMatchObject({ threadId: recovered.worktrees[0].threadId });
  expect(await readFile(join(cwd, 'external.txt'), 'utf8')).toBe('AFTER_RECOVERY_CANCEL');
  await fixture.restart(); expect((await fixture.snapshot()).data.threads).toHaveLength(2); expect(await readdir(join(fixture.storage, 'worktree-creations'))).toEqual([]);
});

test('hard exit after task commit cleans its creation receipt without registering a second chat', async () => {
  await fixture.app.evaluate((_, directory) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), original = fs.unlink;
    let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    const gate: CreationGate = { entered: false, release, restore: () => { fs.unlink = original; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate = gate;
    fs.unlink = async (...args: Parameters<typeof original>) => { if (String(args[0]).startsWith(directory) && String(args[0]).endsWith('.json')) { gate.entered = true; await wait; } return original(...args); };
    syncBuiltinESMExports();
  }, join(fixture.storage, 'worktree-creations'));
  const pending = fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId: crypto.randomUUID() }).catch(error => String(error));
  await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { creationGate: CreationGate }).creationGate.entered), { timeout: 30000 }).toBe(true);
  const persisted = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as DesktopData, record = persisted.worktrees[0];
  expect(persisted.threads).toHaveLength(2); await writeFile(join(record.path, 'external.txt'), 'COMMITTED_BEFORE_EXIT');
  const pid = await fixture.app.evaluate(() => process.pid); process.kill(pid, 'SIGKILL'); await pending; await expect.poll(() => processAlive(pid)).toBe(false);
  await fixture.restart(); const resumed = (await fixture.snapshot()).data;
  expect(resumed.threads.map(thread => thread.id)).toEqual(persisted.threads.map(thread => thread.id)); expect(resumed.worktrees[0].threadId).toBe(record.threadId);
  expect(resumed.worktreeCreationIssues).toEqual([]); expect(await readdir(join(fixture.storage, 'worktree-creations'))).toEqual([]);
  expect(await readFile(join(record.path, 'external.txt'), 'utf8')).toBe('COMMITTED_BEFORE_EXIT'); expect(fixture.calls).toHaveLength(0);
});
