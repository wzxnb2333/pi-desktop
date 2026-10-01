import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { gitRun } from '../src/main/git.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import { managedWorktreeSchema } from '../src/shared/worktrees.ts';
import { mkdtemp } from './fixtures/node-temp.ts';
import { archiveFixture } from './fixtures/worktree-archive.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-owner-recovery-')), store = new JsonStore(dir); await store.load();
  store.data.projects.push({ id: 'p', name: 'Project', path: dir, trusted: true, createdAt: 1 });
  const original = threadSchema.parse({ id: 'old', title: 'Original', projectId: 'p', directoryId: 'p', cwd: join(dir, 'checkout'), policy: 'ask', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', deletedAt: 2 });
  const record = managedWorktreeSchema.parse({ id: crypto.randomUUID(), threadId: original.id, projectId: 'p', directoryId: 'p', path: original.cwd, checkoutPath: original.cwd, localPath: dir, branch: 'desktop/restored', baseCommit: 'base', localBaseline: 'tree', worktreeBaseline: 'tree', archiveTree: 'archive', archiveHead: 'head', archiveIndex: 'index', status: 'ready', createdAt: 1, lastUsedAt: 2 });
  store.data.threads.push(original); store.data.worktrees.push(record); await store.save();
  return { dir, store, original, record, candidate: threadSchema.parse({ ...original, id: crypto.randomUUID(), title: 'Restored', deletedAt: undefined, worktreeBranch: record.branch, baseCommit: record.baseCommit, workspaceRevision: 1 }) };
}

test('owner task and worktree association stay private on disk failure and publish together on retry', async () => {
  const { dir, store, original, record, candidate } = await setup(), before = await readFile(join(dir, 'desktop.json')), blocked = join(dir, 'desktop.json.tmp');
  await mkdir(blocked); await assert.rejects(store.restoreWorktreeOwner(record.id, candidate, () => {}));
  assert.deepEqual(store.data.threads.map(thread => thread.id), [original.id]); assert.equal(record.threadId, original.id); assert.equal(record.snapshotThreadId, undefined);
  assert.deepEqual(await readFile(join(dir, 'desktop.json')), before); await rm(blocked, { recursive: true });
  const pending = store.restoreWorktreeOwner(record.id, candidate, () => {}); assert.equal(store.data.threads.length, 1);
  await Promise.all([pending, store.save()]);
  assert.equal(store.data.worktrees[0], record); assert.equal(record.threadId, candidate.id); assert.equal(record.snapshotThreadId, original.id);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads[0].cwd, record.path); assert.equal(reopened.data.threads[0].worktreeBranch, record.branch); assert.equal(reopened.data.worktrees[0].threadId, candidate.id);
  assert.equal(reopened.data.threads.find(thread => thread.id === original.id)?.deletedAt, 2);
});

test('concurrent retries and queued stale saves keep exactly one owner and the original snapshot identity', async () => {
  const { dir, store, record, candidate } = await setup(); record.snapshotThreadId = 'snapshot-owner';
  const one = store.restoreWorktreeOwner(record.id, candidate, () => {}), two = store.restoreWorktreeOwner(record.id, { ...candidate, id: crypto.randomUUID() }, () => {});
  const [first, second] = await Promise.all([one, two, store.save()]); assert.equal(first, second); assert.equal(store.data.threads.length, 2);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 2); assert.equal(reopened.data.worktrees[0].threadId, candidate.id); assert.equal(reopened.data.worktrees[0].snapshotThreadId, 'snapshot-owner');
});

test('cancellation at the final write boundary leaves no task or association to be revived by later saves', async () => {
  const { dir, store, record, candidate } = await setup(), controller = new AbortController(); let checks = 0;
  await assert.rejects(store.restoreWorktreeOwner(record.id, candidate, () => { if (++checks === 3) controller.abort(); controller.signal.throwIfAborted(); }), { name: 'AbortError' });
  assert.equal(store.data.threads.length, 1); assert.equal(record.threadId, 'old'); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads.length, 1); assert.equal(reopened.data.worktrees[0].threadId, 'old');
});

for (const change of ['directory', 'record', 'owner'] as const) test('final association validation rejects a changed ' + change, async () => {
  const { dir, store, original, record, candidate } = await setup(), before = await readFile(join(dir, 'desktop.json')); let checks = 0;
  await assert.rejects(store.restoreWorktreeOwner(record.id, candidate, () => {
    if (++checks !== 3) return;
    if (change === 'directory') store.data.projects[0].path += '-moved';
    else if (change === 'record') record.branch = 'external';
    else original.deletedAt = undefined;
  }), /已变化/);
  assert.equal(store.data.threads.length, 1); assert.equal(record.threadId, original.id); assert.deepEqual(await readFile(join(dir, 'desktop.json')), before);
});

test('an existing owner keeps its workspace, draft and identity when restoration is retried', async () => {
  const { dir, store, original, record, candidate } = await setup(); original.deletedAt = undefined; original.cwd = dir;
  store.data.ui.threads[original.id] = { ...store.data.ui.threads[original.id], draft: { text: 'KEEP', attachments: [] } }; await store.save();
  const before = await readFile(join(dir, 'desktop.json')); assert.equal(await store.restoreWorktreeOwner(record.id, candidate, () => {}), original);
  assert.equal(original.cwd, dir); assert.equal(store.data.ui.threads[original.id].draft?.text, 'KEEP'); assert.deepEqual(await readFile(join(dir, 'desktop.json')), before);
});

test('owner creation rejects mismatched workspace or specialized task identity', async () => {
  const { store, record, candidate } = await setup();
  for (const patch of [{ cwd: record.localPath }, { directoryId: 'other' }, { projectId: 'other' }, { worktreeBranch: 'other' }, { baseCommit: 'other' }, { subtaskId: crypto.randomUUID() }, { automationId: 'a' }, { deletedAt: 3 }]) {
    await assert.rejects(store.restoreWorktreeOwner(record.id, { ...candidate, ...patch }, () => {}), /不匹配/);
    assert.equal(store.data.threads.length, 1); assert.equal(record.threadId, 'old');
  }
});

test('retrying a ready workspace checks the repository and branch without replaying archived files', async () => {
  const { record, archives, storage } = await archiveFixture();
  const index = await gitRun(record.checkoutPath, ['diff', '--cached', '--binary']);
  await writeFile(join(record.path, 'a.txt'), 'EXTERNAL_EDIT'); await archives.restore(record, new AbortController().signal, () => { throw new Error('Unexpected file restoration'); });
  assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'EXTERNAL_EDIT'); assert.equal(await gitRun(record.checkoutPath, ['diff', '--cached', '--binary']), index);
  const foreign = join(storage, 'foreign'); await mkdir(foreign); await gitRun(foreign, ['init']);
  await assert.rejects(archives.restore({ ...record, localPath: foreign }, new AbortController().signal, () => {}), /不属于原仓库/);
  await gitRun(record.checkoutPath, ['checkout', '-b', 'external']);
  await assert.rejects(archives.restore(record, new AbortController().signal, () => {}), /分支已变化/);
  assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'EXTERNAL_EDIT'); assert.equal((await gitRun(record.path, ['branch', '--show-current'])).trim(), 'external');
});

test('retrying association refuses a nested execution folder replaced by an external junction', async () => {
  const { record, archives, storage } = await archiveFixture(), foreign = join(storage, 'foreign'); await mkdir(foreign); await writeFile(join(foreign, 'keep.txt'), 'KEEP');
  await rename(record.path, record.path + '-original'); await symlink(foreign, record.path, 'junction');
  await assert.rejects(archives.restore(record, new AbortController().signal, () => {}), /执行目录不属于/);
  assert.equal(await readFile(join(foreign, 'keep.txt'), 'utf8'), 'KEEP');
});
