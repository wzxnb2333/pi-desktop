import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import type * as fileSystem from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { DesktopData } from '../../src/shared/contracts.ts';
import type { OperationRecord } from '../../src/shared/operations.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';
import { taskAction } from './fixtures/task-actions.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>;
let fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await test.step('launch isolated acceptance app', () => acceptanceApp(development.url)); });
test.afterEach(async () => {
  const errors = [...fixture.errors]; await fixture.close();
  await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]);
});
interface CrashGate { entered: boolean; release?: () => void; }
async function interruptMigration(phase: 'file' | 'committed', destination: 'local' | 'worktree' = 'worktree') {
  if (destination === 'local') {
    const initial = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' }) as OperationRecord;
    await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === initial.id)?.status).toBe('succeeded');
  }
  await test.step('save the draft', () => fixture.page.getByLabel('向 Pi 发送消息').fill('崩溃后保留草稿'));
  await expect.poll(async () => (await fixture.snapshot()).data.ui.threads.t.draft?.text).toBe('崩溃后保留草稿');
  const sourcePath = (await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd;
  await writeFile(join(sourcePath, 'README.md'), 'SOURCE_CHANGE'); await writeFile(join(sourcePath, 'zzz-new.bin'), Buffer.from([0, 128, 255]));
  await fixture.app.evaluate((_electron, input) => {
    const fs = (process.getBuiltinModule('node:fs') as typeof fileSystem).promises;
    const { syncBuiltinESMExports } = process.getBuiltinModule('node:module');
    const original = fs.rename, gate: CrashGate = { entered: false };
    (globalThis as typeof globalThis & { worktreeCrashGate: CrashGate }).worktreeCrashGate = gate;
    fs.rename = async (source, target) => {
      const candidate = input.phase === 'file' ? String(source).includes('.pi-transfer-') && String(target).endsWith('README.md')
        : String(target) === input.statePath && (JSON.parse(await fs.readFile(source, 'utf8')) as DesktopData).threads.some(item => item.id === 't' && (input.destination === 'worktree' ? !!item.worktreeBranch : !item.worktreeBranch));
      await original(source, target);
      if (candidate) {
        fs.rename = original; syncBuiltinESMExports(); gate.entered = true;
        await new Promise<void>(resolve => { gate.release = resolve; });
      }
    };
    syncBuiltinESMExports();
  }, { phase, destination, statePath: join(fixture.storage, 'desktop.json') });
  const mainPid = await fixture.app.evaluate(() => process.pid);
  const operation = await test.step('start file migration', () => fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination, startPoint: 'HEAD' })) as OperationRecord;
  try {
    await test.step('reach the durable interruption boundary', async () => {
      await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeCrashGate: CrashGate }).worktreeCrashGate.entered), { timeout: 30000 }).toBe(true);
    });
    const state = JSON.parse(await readFile(join(fixture.storage, 'desktop.json'), 'utf8')) as DesktopData;
    process.kill(mainPid, 'SIGKILL');
    await expect.poll(() => { try { process.kill(mainPid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; throw error; } }).toBe(true);
    return { operation, worktree: state.worktrees[0], sourcePath };
  } catch (error) {
    await fixture.app.evaluate(() => (globalThis as typeof globalThis & { worktreeCrashGate?: CrashGate }).worktreeCrashGate?.release?.()).catch(() => {}); throw error;
  }
}

for (const destination of ['local', 'worktree'] as const) test('startup restores a partially copied migration to ' + destination + ' after the main process is killed and the same chat can retry', async () => {
  const { operation, worktree, sourcePath } = await interruptMigration('file', destination);
  const target = destination === 'local' ? fixture.project : worktree.path;
  expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('SOURCE_CHANGE');
  await test.step('restart the interrupted application', () => fixture.restart());
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')!.cwd).toBe(sourcePath);
  expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('# Acceptance\n');
  await expect(access(join(target, 'zzz-new.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await fixture.snapshot()).data.operations.find(item => item.id === operation.id)?.error).toContain('已还原');
  await expect(fixture.page.getByLabel('向 Pi 发送消息')).toHaveValue('崩溃后保留草稿');
  const retry = await fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination, startPoint: 'HEAD' }) as OperationRecord;
  await expect.poll(async () => (await fixture.snapshot()).data.operations.find(item => item.id === retry.id)?.status, { timeout: 30000 }).toBe('succeeded');
  expect((await fixture.snapshot()).data.worktrees).toHaveLength(1);
});

test('startup recognizes the persisted migration commit without rolling back later external edits', async () => {
  const { operation, worktree } = await interruptMigration('committed');
  await writeFile(join(worktree.path, 'README.md'), 'EXTERNAL_AFTER_COMMIT');
  await fixture.restart();
  const state = await fixture.snapshot(); expect(state.data.threads.find(item => item.id === 't')!.cwd).toBe(worktree.path);
  expect(state.data.operations.find(item => item.id === operation.id)?.status).toBe('succeeded');
  expect(await readFile(join(worktree.path, 'README.md'), 'utf8')).toBe('EXTERNAL_AFTER_COMMIT');
  const records = await readdir(join(fixture.storage, 'worktree-transfers'));
  for (const path of records.filter(path => path.endsWith('.json'))) expect(JSON.parse(await readFile(join(fixture.storage, 'worktree-transfers', path), 'utf8')).state).toBe('complete');
});

test('startup preserves an external edit and provides localized recovery retry before another migration', async () => {
  const { worktree } = await interruptMigration('file');
  await writeFile(join(worktree.path, 'README.md'), 'EXTERNAL_CONFLICT');
  await fixture.restart();
  const state = await fixture.snapshot(), issue = state.data.worktreeRecoveryIssues?.[0];
  expect(issue?.worktreeId).toBe(worktree.id);
  expect(await readFile(join(worktree.path, 'README.md'), 'utf8')).toBe('EXTERNAL_CONFLICT');
  await expect(fixture.invoke({ op: 'worktree.start', threadId: 't', requestId: crypto.randomUUID(), action: 'migrate', destination: 'worktree', startPoint: 'HEAD' })).rejects.toThrow('请先处理迁移恢复记录');
  await taskAction(fixture.page, '查看变更'); await fixture.page.getByRole('button', { name: 'Git 操作', exact: true }).click();
  const controls = fixture.page.locator('.worktree-lifecycle'); await expect(controls.getByRole('button', { name: '重试迁移恢复', exact: true })).toBeVisible();
  await controls.getByText('迁移恢复详情', { exact: true }).click(); await expect(controls.locator('pre')).toContainText('README.md');
  await fixture.invoke({ op: 'ui.update', ui: { ...(await fixture.snapshot()).data.ui, locale: 'en-US' } });
  await expect(controls).toContainText('Existing files are preserved');
  await controls.getByRole('button', { name: 'Retry migration recovery', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.operations.filter(item => item.kind === 'worktree.recover').at(-1)?.status).toBe('failed');
  expect(await readFile(join(worktree.path, 'README.md'), 'utf8')).toBe('EXTERNAL_CONFLICT');
  await writeFile(join(worktree.path, 'README.md'), '# Acceptance\n');
  await controls.getByRole('button', { name: 'Retry migration recovery', exact: true }).click();
  await expect.poll(async () => (await fixture.snapshot()).data.worktreeRecoveryIssues).toEqual([]);
  await expect(controls.getByRole('button', { name: 'Move this chat to worktree', exact: true })).toBeEnabled();
  expect((await fixture.snapshot()).data.threads.find(item => item.id === 't')?.cwd).toBe(fixture.project);
  await fixture.restart(); expect((await fixture.snapshot()).data.worktreeRecoveryIssues).toEqual([]);
  await expect(fixture.page.getByLabel('Message Pi')).toHaveValue('崩溃后保留草稿');
});
