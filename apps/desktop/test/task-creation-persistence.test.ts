import assert from 'node:assert/strict';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { RoundSnapshots } from '../src/main/round-snapshots.ts';
import { automationSchema, threadSchema, type AutomationRun } from '../src/shared/contracts.ts';
import { subtaskSchema } from '../src/shared/subtasks.ts';
import { managedWorktreeSchema } from '../src/shared/worktrees.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-task-creation-')), store = new JsonStore(dir); await store.load();
  store.data.projects.push({ id: 'p', name: 'Project', path: dir, trusted: true, createdAt: 1 });
  const parent = threadSchema.parse({ id: 'parent', title: 'Parent', projectId: 'p', directoryId: 'p', cwd: dir, policy: 'deny', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off' });
  store.data.threads.push(parent); await store.save();
  return { dir, store, parent, task: threadSchema.parse({ ...parent, id: crypto.randomUUID(), title: 'Candidate' }) };
}

test('private task and managed worktree publish together and resist stale full saves', async () => {
  const { dir, store, task } = await setup(); task.cwd = join(dir, 'checkout');
  const managed = managedWorktreeSchema.parse({ id: crypto.randomUUID(), threadId: task.id, projectId: 'p', directoryId: 'p', path: task.cwd, checkoutPath: task.cwd, localPath: dir, branch: 'desktop/test', baseCommit: 'base', localBaseline: 'tree', worktreeBaseline: 'tree', status: 'ready', createdAt: 1, lastUsedAt: 1 });
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.createTask(task, managed, () => {})); assert.equal(store.data.threads.length, 1); assert.equal(store.data.worktrees.length, 0);
  await rm(blocked, { recursive: true });
  const commit = store.createTask(task, managed, () => {}); assert.equal(store.data.threads.length, 1);
  await Promise.all([commit, store.save()]); const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads[0].id, task.id); assert.equal(reopened.data.worktrees[0].threadId, task.id); assert.equal(reopened.data.threads[0].cwd, managed.path);
});

test('automation task registration commits the run link and preserves it against queued scheduler snapshots', async () => {
  const { dir, store, task } = await setup();
  const job = automationSchema.parse({ id: 'a', name: 'Automation', projectId: 'p', prompt: 'Check', intervalMinutes: 60, nextRunAt: 10, enabled: true });
  const run: AutomationRun = { id: crypto.randomUUID(), automationId: job.id, configuration: job, status: 'preparing', createdAt: 1, scheduledAt: 10, manual: true, merged: 0 };
  await store.saveAutomationState({ automations: [job], automationRuns: [run] }); task.automationId = job.id; task.automationRunId = run.id;
  const live = store.data.automationRuns[0], stale = structuredClone({ automations: store.data.automations, automationRuns: store.data.automationRuns });
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.createTask(task, undefined, () => {})); assert.equal(live.threadId, undefined); assert.equal(store.data.threads.length, 1);
  await rm(blocked, { recursive: true });
  await Promise.all([store.createTask(task, undefined, () => {}), store.saveAutomationState(stale), store.save()]);
  assert.equal(store.data.automationRuns[0], live); assert.equal(live.threadId, task.id);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.automationRuns[0].threadId, task.id); assert.equal(reopened.data.threads[0].automationRunId, run.id);
});

test('subtask registration commits its child link without overwriting a queued progress save', async () => {
  const { dir, store, task, parent } = await setup();
  const record = subtaskSchema.parse({ id: crypto.randomUUID(), parentThreadId: parent.id, definition: { title: 'Read', prompt: 'Check', environment: 'local', policy: 'deny' }, context: '', status: 'preparing', stage: 'Preparing', createdAt: 1 });
  await store.saveSubtasks([record]); task.subtaskId = record.id;
  const live = store.data.subtasks[0], stale = [{ ...record, stage: 'Still preparing' }];
  await Promise.all([store.createTask(task, undefined, () => {}), store.saveSubtasks(stale), store.save()]);
  assert.equal(store.data.subtasks[0], live); assert.equal(live.childThreadId, task.id); assert.equal(live.stage, 'Still preparing');
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.subtasks[0].childThreadId, task.id);
});

test('final commit rejects stopped, deleted, relocated or permission-restricted subtask parents', async () => {
  for (const mutation of ['stopped', 'deleted', 'relocated', 'permission']) {
    const { dir, store, parent, task } = await setup(); parent.policy = 'auto'; task.policy = 'auto';
    const record = subtaskSchema.parse({ id: crypto.randomUUID(), parentThreadId: parent.id, definition: { title: 'Read', prompt: 'Check', environment: 'local', policy: 'auto' }, context: '', status: 'preparing', stage: 'Preparing', createdAt: 1 });
    await store.saveSubtasks([record]); task.subtaskId = record.id; let checks = 0;
    await assert.rejects(store.createTask(task, undefined, () => {
      if (++checks !== 2) return;
      if (mutation === 'stopped') store.data.subtasks[0].status = 'cancelled';
      else if (mutation === 'deleted') parent.deletedAt = 2;
      else if (mutation === 'relocated') parent.cwd = join(dir, 'moved');
      else parent.policy = 'deny';
    }));
    assert.equal(store.data.threads.length, 1); assert.equal(store.data.subtasks[0].childThreadId, undefined);
    const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 1);
  }
});

test('shutdown cancellation and conflicting request IDs never publish a second task', async () => {
  const { dir, store, task } = await setup(), controller = new AbortController(); let checks = 0;
  await assert.rejects(store.createTask(task, undefined, () => { if (++checks === 2) controller.abort(); controller.signal.throwIfAborted(); }));
  assert.equal(store.data.threads.length, 1);
  const results = await Promise.allSettled([store.createTask(task, undefined, () => {}), store.createTask(task, undefined, () => {})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.filter(thread => thread.id === task.id).length, 1);
});

test('automation cancellation at the final rename boundary cannot publish an orphan task', async () => {
  const { dir, store, task } = await setup();
  const job = automationSchema.parse({ id: 'a', name: 'Automation', projectId: 'p', prompt: 'Check', intervalMinutes: 60, nextRunAt: 10, enabled: true });
  const run: AutomationRun = { id: crypto.randomUUID(), automationId: job.id, configuration: job, status: 'preparing', createdAt: 1, scheduledAt: 10, manual: true, merged: 0 };
  await store.saveAutomationState({ automations: [job], automationRuns: [run] }); task.automationId = job.id; task.automationRunId = run.id; let checks = 0;
  await assert.rejects(store.createTask(task, undefined, () => { if (++checks === 2) store.data.automationRuns[0].status = 'cancelled'; }), /失效/);
  assert.equal(store.data.automationRuns[0].threadId, undefined); const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 1);
});

test('subtask registration cannot exceed either the parent or explicitly requested policy', async () => {
  for (const policy of ['deny', 'ask', 'full'] as const) {
    const { store, task, parent } = await setup(); parent.policy = 'full'; task.policy = policy === 'full' ? 'full' : 'auto';
    const record = subtaskSchema.parse({ id: crypto.randomUUID(), parentThreadId: parent.id, definition: { title: 'Read', prompt: 'Check', environment: 'local', policy: policy === 'full' ? 'auto' : policy }, context: '', status: 'preparing', stage: 'Preparing', createdAt: 1 });
    await store.saveSubtasks([record]); task.subtaskId = record.id;
    await assert.rejects(store.createTask(task, undefined, () => {}), /不能扩大/); assert.equal(store.data.threads.length, 1);
  }
});

test('failed task cleanup only owns newly prepared snapshots and retains previous recovery data', async () => {
  const { dir } = await setup(), snapshots = new RoundSnapshots(dir);
  await snapshots.prepareUncommitted('fresh'); await writeFile(join(dir, 'round-snapshots', 'fresh', 'index'), 'NEW');
  await snapshots.discardUncommitted('fresh'); await assert.rejects(access(join(dir, 'round-snapshots', 'fresh')));
  const previous = join(dir, 'round-snapshots', 'previous'); await mkdir(previous); await writeFile(join(previous, 'objects'), 'PREVIOUS_RECOVERY');
  await snapshots.prepareUncommitted('previous'); await snapshots.discardUncommitted('previous');
  assert.equal(await readFile(join(previous, 'objects'), 'utf8'), 'PREVIOUS_RECOVERY');
});

test('snapshot cleanup refuses a replaced directory and releasing a committed preparation preserves it', async () => {
  const { dir } = await setup(), snapshots = new RoundSnapshots(dir), path = join(dir, 'round-snapshots', 'candidate');
  await snapshots.prepareUncommitted('candidate'); await rename(path, path + '-retained'); await mkdir(path); await writeFile(join(path, 'external'), 'EXTERNAL');
  await assert.rejects(snapshots.discardUncommitted('candidate'), /目录已变化/); assert.equal(await readFile(join(path, 'external'), 'utf8'), 'EXTERNAL');
  await snapshots.prepareUncommitted('committed'); snapshots.releasePreparation('committed'); await snapshots.discardUncommitted('committed');
  await access(join(dir, 'round-snapshots', 'committed'));
});
