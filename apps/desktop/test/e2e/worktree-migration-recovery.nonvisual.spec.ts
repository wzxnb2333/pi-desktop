import { access, readFile, writeFile } from 'node:fs/promises';
import type * as fileSystem from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { gitRun } from '../../src/main/git.ts';
import type { DesktopData } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { projectEnvironmentSchema } from '../../src/shared/project-environment.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => {
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
async function move(destination: 'local' | 'worktree', status: OperationRecord['status'] = 'succeeded') {
  const operation = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination, startPoint: 'HEAD' }) as OperationRecord;
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === operation.id)?.status, { timeout: 45000 }).toBe(status);
  return operation.id;
}
async function failWrite(kind: 'association' | 'journal' | 'initialization', target = '') {
  await fixture.app.evaluate((_electron, input) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
    const original = fs.writeFile;
    fs.writeFile = async (path, data, options) => {
      const stateWrite = String(path) === input.statePath && typeof data === 'string';
      const state = stateWrite ? JSON.parse(data as string) as DesktopData : undefined;
      const match = input.kind === 'association' ? state?.threads.some(item => item.id === 't' && item.cwd === input.target) : input.kind === 'initialization'
        ? state?.operations.some(item => item.kind === 'environment.initialization' && item.status === 'running')
        : String(path).includes('worktree-transfers') && String(path).endsWith('.json.tmp') && typeof data === 'string' && JSON.parse(data).state === 'complete';
      if (match) {
        fs.writeFile = original; syncBuiltinESMExports();
        await fs.mkdir(String(path));
        try { return await original(path, data, options); }
        finally { await fs.rmdir(String(path)); }
      }
      return original(path, data, options);
    };
    syncBuiltinESMExports();
  }, { statePath: join(fixture.storage, 'desktop.json.tmp'), target, kind });
}

for (const destination of ['local', 'worktree'] as const) test('migration ' + destination + ' persistence failure restores target files, keeps the source chat and supports retry after restart', async () => {
  await move('worktree');
  if (destination === 'worktree') await move('local');
  const before = await fixture.snapshot(), managed = before.data.worktrees[0], thread = before.data.threads.find(item => item.id === 't')!;
  const target = destination === 'local' ? managed.localPath : managed.path;
  const oldTarget = await readFile(join(target, 'README.md'));
  await writeFile(join(thread.cwd, 'README.md'), 'source changed\r\n');
  await writeFile(join(thread.cwd, 'new.bin'), Buffer.from([0, 255, 128, 1]));
  const targetIndex = resolve(target, (await gitRun(target, ['rev-parse', '--git-path', 'index'])).trim());
  const index = await readFile(targetIndex);
  await fixture.page.getByLabel('向 Pi 发送消息').fill('迁移失败后保留草稿');
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('迁移失败后保留草稿');
  // Fail the real state write only after the file phase has completed, never the operation's initial save.
  await failWrite('association', target);
  const failed = await move(destination, 'failed');
  const after = await fixture.snapshot();
  expect(after.data.threads.find(item => item.id === 't')!.cwd).toBe(thread.cwd);
  expect(after.data.worktrees[0]).toMatchObject({ id: managed.id, localBaseline: managed.localBaseline, worktreeBaseline: managed.worktreeBaseline, status: managed.status });
  expect(await readFile(join(target, 'README.md'))).toEqual(oldTarget);
  await expect(access(join(target, 'new.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(targetIndex)).toEqual(index);
  expect(await readFile(join(thread.cwd, 'README.md'), 'utf8')).toBe('source changed\r\n');
  await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await expect(fixture.page.locator('.worktree-lifecycle').getByRole('alert')).toBeVisible();
  expect(after.data.operations.find(item => item.id === failed)?.error).toMatch(/EISDIR|EPERM|EACCES/);
  await fixture.restart();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(thread.cwd);
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('迁移失败后保留草稿');
  await move(destination);
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(target);
  expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('source changed\r\n');
  expect(await readFile(join(target, 'new.bin'))).toEqual(Buffer.from([0, 255, 128, 1]));
  expect(await readFile(targetIndex)).toEqual(index);
});

test('committed migration remains usable when the final recovery journal write fails and explains it in both languages', async () => {
  await writeFile(join(fixture.project, 'README.md'), 'committed source'); await failWrite('journal');
  const id = await move('worktree'), state = await fixture.snapshot();
  const result = state.data.operations.find(item => item.id === id)!.result as { warning: string; recoveryId: string };
  expect(result.warning).toContain('迁移已完成');
  const target = state.data.threads.find(item => item.id === 't')!.cwd;
  expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('committed source');
  await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  const controls = fixture.page.locator('.worktree-lifecycle'); await expect(controls).toContainText('无需重复迁移');
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  await expect(controls).toContainText('Do not repeat the migration');
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(target);
  expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('committed source');
  expect(JSON.parse(await readFile(join(fixture.storage, 'worktree-transfers', result.recoveryId + '.json'), 'utf8')).state).toBe('complete');
});

test('another migration reconciles the previous committed receipt before replacing it', async () => {
  await writeFile(join(fixture.project, 'README.md'), 'first migration'); await failWrite('journal');
  const first = await move('worktree'), state = await fixture.snapshot();
  const result = state.data.operations.find(item => item.id === first)!.result as { recoveryId: string; warning: string };
  expect(result.warning).toContain('迁移已完成');
  await writeFile(join(state.data.worktrees[0].path, 'README.md'), 'return migration');
  await move('local');
  await fixture.restart();
  expect((await fixture.snapshot()).data.worktreeRecoveryIssues).toEqual([]);
  expect(await readFile(join(fixture.project, 'README.md'), 'utf8')).toBe('return migration');
  expect(JSON.parse(await readFile(join(fixture.storage, 'worktree-transfers', result.recoveryId + '.json'), 'utf8')).state).toBe('complete');
});

test('initialization save failure reports the committed migration and a project action can retry independently', async () => {
  const base = projectEnvironmentSchema.parse({});
  const environment = projectEnvironmentSchema.parse({ initialization: 'Write-Output INITIALIZATION_RETRIED' });
  await fixture.invoke({ op: 'project.environment', projectId: 'p', environment, base });
  await failWrite('initialization');
  const id = await move('worktree'); const state = await fixture.snapshot();
  expect((state.data.operations.find(item => item.id === id)!.result as { initializationError: string }).initializationError).toMatch(/EISDIR|EPERM|EACCES/);
  await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  await expect(fixture.page.locator('.worktree-lifecycle').getByRole('alert')).toContainText('迁移已完成，但初始化未启动');
  const retry = await fixture.invoke({ op: 'project.action', threadId: 't', directoryId: 'p', requestId: crypto.randomUUID(), kind: 'initialization', actionId: '' }) as OperationRecord;
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === retry.id)?.status).toBe('succeeded');
  const after = await fixture.snapshot(); expect(after.data.worktrees).toHaveLength(1);
  expect(after.data.threads.find(item => item.id === 't')!.cwd).toBe(state.data.threads.find(item => item.id === 't')!.cwd);
});

interface CommitGate { entered: boolean; release?: () => void; }
test('cancellation after the task state rename reports the committed migration and retains its files across restart', async () => {
  await writeFile(join(fixture.project, 'README.md'), 'COMMITTED_BEFORE_CANCEL');
  await fixture.app.evaluate((_electron, statePath) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
    const original = fs.rename, gate: CommitGate = { entered: false };
    (globalThis as typeof globalThis & { worktreeCommitGate: CommitGate }).worktreeCommitGate = gate;
    fs.rename = async (source, target) => {
      if (String(target) === statePath) {
        const state = JSON.parse(await fs.readFile(source, 'utf8')) as DesktopData;
        if (state.threads.some(item => item.id === 't' && item.worktreeBranch)) {
          fs.rename = original; syncBuiltinESMExports();
          await original(source, target);
          gate.entered = true;
          await new Promise<void>(resolve => { gate.release = resolve; });
          return;
        }
      }
      return original(source, target);
    };
    syncBuiltinESMExports();
  }, join(fixture.storage, 'desktop.json'));
  try {
    const operation = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' }) as OperationRecord;
    await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeCommitGate: CommitGate }).worktreeCommitGate.entered)).toBe(true);
    const persisted = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as DesktopData;
    const target = persisted.threads.find(item => item.id === 't')!.cwd;
    expect(target).not.toBe(fixture.project);
    await fixture.invoke({ op: 'operation.cancel', threadId: 't', requestId: operation.id });
    await fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeCommitGate: CommitGate }).worktreeCommitGate.release!());
    await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === operation.id)?.status).toBe('succeeded');
    expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('COMMITTED_BEFORE_CANCEL');
    await fixture.restart();
    expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(target);
    expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('COMMITTED_BEFORE_CANCEL');
  } finally {
    await fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeCommitGate?: CommitGate }).worktreeCommitGate?.release?.()).catch(() => {});
  }
});
