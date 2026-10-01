import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { threadSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-worktree-storage-'));
  const store = new JsonStore(dir); await store.load();
  store.data.projects.push({ id: 'p', name: 'Project', path: dir, trusted: true, createdAt: 1 });
  store.data.threads.push(threadSchema.parse({ id: 't', projectId: 'p', title: 'Source', cwd: dir, createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'ask' }));
  const id = crypto.randomUUID();
  store.data.worktrees.push({ id, threadId: 't', projectId: 'p', directoryId: 'p', localPath: dir, path: join(dir, 'worktree'), checkoutPath: join(dir, 'worktree'), branch: 'desktop/test', baseCommit: 'c'.repeat(40), localBaseline: 'a'.repeat(40), worktreeBaseline: 'a'.repeat(40), createdAt: 1, lastUsedAt: 1, status: 'ready' });
  store.data.ui.threads.t = uiThreadSchema.parse({ selectedPath: 'a.txt', openFiles: ['a.txt'], draft: { text: 'Keep draft', attachments: [] } });
  await store.save();
  const input = { threadId: 't', worktreeId: id, sourcePath: dir, sourceRevision: 0, destination: 'worktree' as const, sourceTree: 'b'.repeat(40), targetTree: 'd'.repeat(40), transferId: crypto.randomUUID() };
  return { dir, store, input };
}

test('migration association publishes after persistence and survives stale saves without losing newer drafts', async () => {
  const { dir, store, input } = await setup();
  const thread = store.data.threads[0], record = store.data.worktrees[0];
  const saving = store.saveWorkspaceMigration(input);
  assert.equal(thread.cwd, dir); assert.equal(record.localBaseline, 'a'.repeat(40));
  store.data.ui.threads.t.draft!.text = 'Newer draft'; thread.title = 'Renamed';
  const background = store.save(); await Promise.all([saving, background]);
  assert.equal(store.data.threads[0], thread); assert.equal(store.data.worktrees[0], record);
  const restored = new JsonStore(dir); await restored.load();
  assert.equal(restored.data.threads[0].cwd, record.path); assert.equal(restored.data.threads[0].title, 'Renamed');
  assert.equal(restored.data.threads[0].workspaceRevision, 1); assert.equal(restored.data.threads[0].worktreeBranch, record.branch);
  assert.equal(restored.data.worktrees[0].localBaseline, input.sourceTree);
  assert.equal(restored.data.worktrees[0].worktreeBaseline, input.targetTree);
  assert.equal(record.lastTransferId, input.transferId); assert.equal(restored.data.worktrees[0].lastTransferId, input.transferId);
  assert.equal(restored.data.ui.threads.t.draft?.text, 'Newer draft'); assert.deepEqual(restored.data.ui.threads.t.openFiles, []);
});

for (const filename of ['desktop.json.tmp', 'desktop.json.bak']) test('migration ' + filename + ' failure keeps metadata unchanged and retry retains thread identity', async () => {
  const { dir, store, input } = await setup(); const thread = store.data.threads[0];
  const before = structuredClone(store.data), disk = await readFile(join(dir, 'desktop.json'), 'utf8');
  const blocked = join(dir, filename); await mkdir(blocked);
  try { await assert.rejects(store.saveWorkspaceMigration(input), /EISDIR|EPERM|EACCES/); }
  finally { await rm(blocked, { recursive: true }); }
  assert.deepEqual(store.data, before); assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), disk);
  await store.saveWorkspaceMigration(input); assert.equal(store.data.threads[0], thread);
  assert.equal(thread.cwd, store.data.worktrees[0].path);
});

test('stale queued migration cannot overwrite a newer directory revision or resurrect a removed task', async () => {
  const { store, input } = await setup();
  const first = store.saveWorkspaceMigration(input), second = store.saveWorkspaceMigration(input);
  await first; await assert.rejects(second, /工作区已变化/);
  const back = { ...input, sourcePath: store.data.threads[0].cwd, sourceRevision: 1, destination: 'local' as const };
  const removed = store.saveWorkspaceMigration(back); store.data.threads = [];
  await assert.rejects(removed, /任务不存在/); await store.save();
  assert.equal(store.data.threads.length, 0);
});

test('cancel before the association commit preserves state and a later return to local clears worktree fields', async () => {
  const { dir, store, input } = await setup(); const controller = new AbortController(); controller.abort();
  await assert.rejects(store.saveWorkspaceMigration(input, controller.signal), { name: 'AbortError' });
  assert.equal(store.data.threads[0].cwd, dir);
  await store.saveWorkspaceMigration(input); controller.abort();
  await store.saveWorkspaceMigration({ ...input, sourcePath: store.data.threads[0].cwd, sourceRevision: 1, destination: 'local' });
  assert.equal(store.data.threads[0].cwd, dir); assert.equal(store.data.threads[0].worktreeBranch, undefined);
  assert.equal(store.data.threads[0].baseCommit, undefined);
});
