import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Automation, AutomationRun, Thread } from '../../src/shared/contracts.ts';
import type { Subtask } from '../../src/shared/subtasks.ts';
import { acceptanceApp } from './fixtures/acceptance-app.ts';
import { startDevelopmentSource } from './fixtures/development-source.ts';

let development: Awaited<ReturnType<typeof startDevelopmentSource>>, fixture: Awaited<ReturnType<typeof acceptanceApp>>;
test.beforeAll(async () => { development = await startDevelopmentSource(); });
test.afterAll(async () => { await development?.server.close(); });
test.beforeEach(async () => { fixture = await acceptanceApp(development.url); });
test.afterEach(async () => { if (fixture) { const errors = [...fixture.errors]; await fixture.close(); await expect(access(fixture.storage)).rejects.toMatchObject({ code: 'ENOENT' }); expect(errors).toEqual([]); } });

interface TaskWriteGate { waiting: boolean; cwd?: string; release(fail: boolean): void; restore(): void }
async function holdTaskWrite() {
  await fixture.app.evaluate((_, path) => {
    const fs = process.getBuiltinModule('node:fs/promises'), { syncBuiltinESMExports } = process.getBuiltinModule('node:module'), write = fs.writeFile;
    let release!: (fail: boolean) => void; const wait = new Promise<boolean>(resolve => { release = resolve; });
    const gate: TaskWriteGate = { waiting: false, release, restore: () => { fs.writeFile = write; syncBuiltinESMExports(); } };
    (globalThis as typeof globalThis & { taskWriteGate?: TaskWriteGate }).taskWriteGate = gate;
    fs.writeFile = async (...args: Parameters<typeof write>) => {
      await write(...args); if (String(args[0]) !== path || gate.waiting) return;
      const data = JSON.parse(String(args[1])) as { threads: { id: string; cwd: string }[] };
      const candidate = data.threads.find(thread => thread.id !== 't');
      if (candidate) { gate.waiting = true; gate.cwd = candidate.cwd; if (await wait) throw new Error('TASK_SAVE_FAILED'); }
    };
    syncBuiltinESMExports();
  }, join(fixture.storage, 'desktop.json.tmp'));
}
async function waitForTaskWrite() { await expect.poll(() => fixture.app.evaluate(() => (globalThis as typeof globalThis & { taskWriteGate?: TaskWriteGate }).taskWriteGate?.waiting)).toBe(true); }
async function releaseTaskWrite(fail = false) {
  await fixture.app.evaluate((_, fail) => { const root = globalThis as typeof globalThis & { taskWriteGate?: TaskWriteGate }; root.taskWriteGate?.release(fail); root.taskWriteGate?.restore(); delete root.taskWriteGate; }, fail);
}

test('failed project task creation stays private and a later save cannot resurrect it', async () => {
  const blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  try {
    await expect(fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false })).rejects.toThrow(/EISDIR|EPERM|EACCES/);
    expect((await fixture.snapshot()).data.threads.map(thread => thread.id)).toEqual(['t']);
  } finally { await rm(blocked, { recursive: true, force: true }); }
  await fixture.invoke({ op: 'ui.threadPatch', threadId: 't', patch: { draft: { text: 'Still here', attachments: [] } } });
  await fixture.restart(); expect((await fixture.snapshot()).data.threads.map(thread => thread.id)).toEqual(['t']);
  const retry = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: false }) as Thread;
  expect((await fixture.snapshot()).data.threads.map(thread => thread.id)).toEqual([retry.id, 't']); expect(fixture.calls).toHaveLength(0);
});

test('concurrent project creation and lost acknowledgements reuse one durable identity', async () => {
  const requestId = crypto.randomUUID(); await holdTaskWrite();
  const request = { op: 'thread.create' as const, projectId: 'p', worktree: false, requestId };
  const creating = fixture.invoke(request); let duplicate: Promise<unknown> | undefined;
  try {
    await waitForTaskWrite(); expect((await fixture.snapshot()).data.threads.map(thread => thread.id)).toEqual(['t']);
    duplicate = fixture.invoke(request);
    await expect(fixture.invoke({ ...request, worktree: true })).rejects.toThrow(/请求已被使用/);
  } finally { await releaseTaskWrite(); await creating; await duplicate; }
  expect((await fixture.snapshot()).data.threads.filter(thread => thread.id === requestId)).toHaveLength(1);
  await fixture.restart(); expect((await fixture.invoke(request) as Thread).id).toBe(requestId);
  expect((await fixture.snapshot()).data.threads).toHaveLength(2); expect(fixture.calls).toHaveLength(0);
});

test('failed worktree task creation removes only its clean checkout, branch and prepared snapshot', async () => {
  const requestId = crypto.randomUUID(), blocked = join(fixture.storage, 'desktop.json.tmp'); await mkdir(blocked);
  const before = execFileSync('git', ['-C', fixture.project, 'branch', '--list'], { encoding: 'utf8' });
  try { await expect(fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId })).rejects.toThrow(/EISDIR|EPERM|EACCES/); }
  finally { await rm(blocked, { recursive: true, force: true }); }
  expect((await fixture.snapshot()).data.threads).toHaveLength(1); expect((await fixture.snapshot()).data.worktrees).toHaveLength(0);
  expect(execFileSync('git', ['-C', fixture.project, 'branch', '--list'], { encoding: 'utf8' })).toBe(before);
  expect(await readdir(join(fixture.storage, 'worktrees'))).toEqual([]);
  await expect(access(join(fixture.storage, 'round-snapshots', requestId))).rejects.toMatchObject({ code: 'ENOENT' });
  const retry = await fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId }) as Thread;
  await fixture.restart(); expect((await fixture.snapshot()).data.worktrees[0].threadId).toBe(retry.id); expect((await fixture.snapshot()).data.threads[0].cwd).toBe(retry.cwd);
});

test('worktree baseline preparation failure cleans its private checkout without publishing a task', async () => {
  const requestId = crypto.randomUUID(), blocked = join(fixture.storage, 'round-snapshots', requestId); await mkdir(join(fixture.storage, 'round-snapshots'), { recursive: true }); await writeFile(blocked, 'BLOCK_BASELINE_DIRECTORY');
  const before = execFileSync('git', ['-C', fixture.project, 'branch', '--list'], { encoding: 'utf8' });
  await expect(fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId })).rejects.toThrow(/ENOTDIR|EEXIST/);
  expect((await fixture.snapshot()).data.threads).toHaveLength(1); expect((await fixture.snapshot()).data.worktrees).toHaveLength(0);
  expect(execFileSync('git', ['-C', fixture.project, 'branch', '--list'], { encoding: 'utf8' })).toBe(before); expect(await readdir(join(fixture.storage, 'worktrees'))).toEqual([]);
  expect(await readFile(blocked, 'utf8')).toBe('BLOCK_BASELINE_DIRECTORY');
});

test('failed worktree registration preserves external edits and reopening persists the actual checkout', async () => {
  await holdTaskWrite();
  const creating = fixture.invoke({ op: 'thread.create', projectId: 'p', worktree: true, requestId: crypto.randomUUID() }).catch(error => String(error));
  let cwd = '';
  try {
    await waitForTaskWrite(); cwd = (await fixture.app.evaluate(() => (globalThis as typeof globalThis & { taskWriteGate?: TaskWriteGate }).taskWriteGate?.cwd))!;
    await writeFile(join(cwd, 'external.txt'), 'EXTERNAL_EDIT');
  } finally { await releaseTaskWrite(true); }
  expect(await creating).toContain('恢复目录已保留'); expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  expect(await readFile(join(cwd, 'external.txt'), 'utf8')).toBe('EXTERNAL_EDIT');
  const reopened = await fixture.invoke({ op: 'thread.inWorktree', projectId: 'p', path: cwd, reveal: false }) as Thread;
  await fixture.restart(); const saved = (await fixture.snapshot()).data.threads.find(thread => thread.id === reopened.id)!;
  expect(saved.cwd.replaceAll('\\', '/')).toBe(cwd.replaceAll('\\', '/')); expect(saved.worktreeBranch).toBeTruthy();
  expect(await readFile(join(saved.cwd, 'external.txt'), 'utf8')).toBe('EXTERNAL_EDIT'); expect(fixture.calls).toHaveLength(0);
});

test('automation registration failure publishes neither a ghost task nor a run link and supports a deliberate retry', async () => {
  const job: Automation = { id: crypto.randomUUID(), name: 'Create safely', projectId: 'p', prompt: 'Check local files', intervalMinutes: 60, enabled: false, nextRunAt: 0 };
  await fixture.invoke({ op: 'automation.save', automation: job }); await holdTaskWrite();
  const run = await fixture.invoke({ op: 'automation.run', id: job.id }) as AutomationRun;
  try { await waitForTaskWrite(); expect((await fixture.snapshot()).data.threads).toHaveLength(1); }
  finally { await releaseTaskWrite(true); }
  await expect.poll(async () => (await fixture.snapshot()).data.automationRuns.find(item => item.id === run.id)?.status).toBe('failed');
  expect((await fixture.snapshot()).data.automationRuns[0].threadId).toBeUndefined(); expect(fixture.calls).toHaveLength(0);
  await fixture.restart(); expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  const retry = await fixture.invoke({ op: 'automation.run', id: job.id }) as AutomationRun;
  await expect.poll(async () => (await fixture.snapshot()).data.automationRuns.find(item => item.id === retry.id)?.status).toBe('succeeded');
  const state = (await fixture.snapshot()).data; expect(state.threads.find(thread => thread.id === state.automationRuns.at(-1)?.threadId)?.automationRunId).toBe(retry.id);
});

test('subtask registration failure and cancellation cannot leave a child or widen its parent permissions', async () => {
  await fixture.invoke({ op: 'settings.patch', patch: { subtasksEnabled: true } });
  const definition = { title: 'Read only', prompt: 'Check files', environment: 'local' as const, policy: 'deny' as const, startPoint: 'HEAD', includeContext: false };
  for (const fail of [true, false]) {
    await holdTaskWrite(); const record = await fixture.invoke({ op: 'subtask.create', parentThreadId: 't', requestId: crypto.randomUUID(), definition }) as Subtask;
    let stopping: Promise<unknown> | undefined;
    try { await waitForTaskWrite(); expect((await fixture.snapshot()).data.threads).toHaveLength(1); if (!fail) stopping = fixture.invoke({ op: 'subtask.stop', parentThreadId: 't', id: record.id }); await fixture.snapshot(); }
    finally { await releaseTaskWrite(fail); await stopping; }
    await expect.poll(async () => (await fixture.snapshot()).data.subtasks.find(item => item.id === record.id)?.status).toBe(fail ? 'failed' : 'cancelled');
    expect((await fixture.snapshot()).data.subtasks.find(item => item.id === record.id)?.childThreadId).toBeUndefined();
    expect((await fixture.snapshot()).data.threads).toHaveLength(1); expect(fixture.calls).toHaveLength(0);
  }
  await fixture.restart(); expect((await fixture.snapshot()).data.threads).toHaveLength(1);
  await fixture.invoke({ op: 'subtask.create', parentThreadId: 't', requestId: crypto.randomUUID(), definition });
  await expect.poll(async () => (await fixture.snapshot()).data.subtasks.at(-1)?.status).toBe('succeeded');
  const state = (await fixture.snapshot()).data; expect(state.threads.find(thread => thread.id === state.subtasks.at(-1)?.childThreadId)?.policy).toBe('deny');
});
