import assert from 'node:assert/strict';
import { access, copyFile, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { threadSchema } from '../src/shared/contracts.ts';
import type { ManagedWorktree } from '../src/shared/worktrees.ts';
import { GitService, gitRun } from '../src/main/git.ts';
import { RoundSnapshots } from '../src/main/round-snapshots.ts';
import { WorktreeTransfer } from '../src/main/worktree-transfer.ts';
import { saveTransferJournal, type TransferJournal } from '../src/main/worktree-transfer-journal.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-transfer-recovery-')), source = join(root, 'source'), storage = join(root, 'storage');
  await mkdir(source); await mkdir(storage);
  await gitRun(source, ['init', '-b', 'main']); await gitRun(source, ['config', 'core.autocrlf', 'false']);
  await gitRun(source, ['config', 'user.name', 'Test']); await gitRun(source, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(source, 'a.txt'), 'original\r\n'); await writeFile(join(source, 'b.txt'), 'preserved\r\n');
  await gitRun(source, ['add', '--', '.']); await gitRun(source, ['commit', '-m', 'base']);
  const worktree = await new GitService(storage).createWorktree(source, crypto.randomUUID()), snapshots = new RoundSnapshots(storage);
  const targetTree = await snapshots.captureTree('t', worktree.path);
  await writeFile(join(source, 'a.txt'), 'desired\r\n'); await rm(join(source, 'b.txt')); await writeFile(join(source, 'new.bin'), Buffer.from([0, 128, 255]));
  const sourceTree = await snapshots.captureTree('t', source), id = crypto.randomUUID();
  const managed: ManagedWorktree = { id, threadId: 't', projectId: 'p', directoryId: 'p', ...worktree, localPath: source,
    localBaseline: targetTree, worktreeBaseline: targetTree, status: 'ready', createdAt: 1, lastUsedAt: 1 };
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd: source, title: 'keep', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'ask' });
  const record: TransferJournal = { version: 2, id: crypto.randomUUID(), threadId: 't', source: await realpath(source), target: await realpath(worktree.path),
    commonDirectory: await realpath(resolve(source, (await gitRun(source, ['rev-parse', '--git-common-dir'])).trim())), sourceTree, targetTree,
    changes: ['a.txt', 'b.txt', 'new.bin'], attempted: ['a.txt'], state: 'prepared', error: '', createdAt: 1,
    association: { worktreeId: id, ownerThreadId: 't', operationId: crypto.randomUUID(), sourceRevision: 0 } };
  await saveTransferJournal(storage, record);
  const service = new WorktreeTransfer(storage, snapshots), recover = () => service.recover([managed], [thread]);
  const journalPath = join(storage, 'worktree-transfers', record.id + '.json');
  return { root, source, storage, worktree, managed, thread, record, service, snapshots, recover, journalPath };
}

test('restart restores only attempted files, cleans owned partial files and leaves both indexes and unattempted edits intact', async () => {
  const f = await setup(), target = f.worktree.path;
  const localIndex = await readFile(join(f.source, '.git/index')), targetIndexPath = resolve(target, (await gitRun(target, ['rev-parse', '--git-path', 'index'])).trim());
  const targetIndex = await readFile(targetIndexPath);
  await copyFile(join(f.source, 'a.txt'), join(target, 'a.txt'));
  await copyFile(join(f.source, 'new.bin'), join(target, 'new.bin'));
  const temporary = join(target, 'a.txt.pi-transfer-' + f.record.id + '-0'); await writeFile(temporary, 'partial bytes');
  const unrelatedTemporary = join(target, 'a.txt.pi-transfer-external'); await writeFile(unrelatedTemporary, 'external');
  const result = await f.recover(); assert.deepEqual(result.issues, []); assert.equal(result.outcomes[0].state, 'rolled-back');
  assert.equal(await readFile(join(target, 'a.txt'), 'utf8'), 'original\r\n');
  assert.equal(await readFile(join(target, 'b.txt'), 'utf8'), 'preserved\r\n');
  assert.deepEqual(await readFile(join(target, 'new.bin')), Buffer.from([0, 128, 255]));
  await assert.rejects(access(temporary), { code: 'ENOENT' }); assert.equal(await readFile(unrelatedTemporary, 'utf8'), 'external');
  assert.deepEqual(await readFile(join(f.source, '.git/index')), localIndex); assert.deepEqual(await readFile(targetIndexPath), targetIndex);
  assert.deepEqual((await f.recover()).issues, []); assert.equal(await readFile(join(f.source, 'a.txt'), 'utf8'), 'desired\r\n');
});

test('restart restores deleted files and removes only additions that still match the transferred version', async () => {
  const f = await setup(); f.record.attempted = [...f.record.changes]; await saveTransferJournal(f.storage, f.record);
  await copyFile(join(f.source, 'a.txt'), join(f.worktree.path, 'a.txt')); await rm(join(f.worktree.path, 'b.txt'));
  await copyFile(join(f.source, 'new.bin'), join(f.worktree.path, 'new.bin'));
  assert.deepEqual((await f.recover()).issues, []);
  assert.equal(await readFile(join(f.worktree.path, 'b.txt'), 'utf8'), 'preserved\r\n'); await assert.rejects(access(join(f.worktree.path, 'new.bin')), { code: 'ENOENT' });
});

test('persisted commit receipt finalizes the journal without touching later edits or a changed workspace revision', async () => {
  const f = await setup(); f.record.state = 'files-transferred'; f.record.finalTree = f.record.sourceTree; await saveTransferJournal(f.storage, f.record);
  f.managed.lastTransferId = f.record.id; f.thread.cwd = f.worktree.path; f.thread.workspaceRevision = 1;
  await writeFile(join(f.worktree.path, 'a.txt'), 'external after commit');
  const result = await f.recover(); assert.deepEqual(result.issues, []); assert.equal(result.outcomes[0].state, 'complete');
  assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'complete');
  assert.equal(await readFile(join(f.worktree.path, 'a.txt'), 'utf8'), 'external after commit');
  assert.deepEqual((await f.recover()).issues, []);
});

test('conflicting external content survives recovery, and an explicitly resolved conflict can retry', async () => {
  const f = await setup(); await writeFile(join(f.worktree.path, 'a.txt'), 'external conflict');
  const first = await f.recover(); assert.equal(first.issues.length, 1); assert.equal(first.issues[0].worktreeId, f.managed.id);
  assert.match(first.issues[0].details, /a\.txt/); assert.equal(await readFile(join(f.worktree.path, 'a.txt'), 'utf8'), 'external conflict');
  assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'recovery-required');
  await writeFile(join(f.worktree.path, 'a.txt'), 'original\r\n');
  assert.deepEqual((await f.recover()).issues, []); assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'rolled-back');
});

test('failed recovery status persistence preserves evidence and retries without writing restored files again', async () => {
  const f = await setup(); await copyFile(join(f.source, 'a.txt'), join(f.worktree.path, 'a.txt')); await mkdir(f.journalPath + '.tmp');
  const failed = await f.recover(); assert.equal(failed.issues.length, 1);
  assert.equal(await readFile(join(f.worktree.path, 'a.txt'), 'utf8'), 'original\r\n'); assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'prepared');
  await rm(f.journalPath + '.tmp', { recursive: true });
  assert.deepEqual((await f.recover()).issues, []); assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'rolled-back');
});

test('changed association and forged destination are reported without modifying either directory', async () => {
  const f = await setup(); await copyFile(join(f.source, 'a.txt'), join(f.worktree.path, 'a.txt'));
  f.thread.workspaceRevision = 1;
  assert.match((await f.recover()).issues[0].details, /关联已变化/);
  f.thread.workspaceRevision = 0; f.record.target = f.source; await saveTransferJournal(f.storage, f.record);
  assert.match((await f.recover()).issues[0].details, /关联已变化/);
  assert.equal(await readFile(join(f.source, 'a.txt'), 'utf8'), 'desired\r\n'); assert.equal(await readFile(join(f.worktree.path, 'a.txt'), 'utf8'), 'desired\r\n');
});

test('malformed, legacy and linked journals remain visible and cannot redirect recovery writes', async () => {
  const f = await setup(), directory = join(f.storage, 'worktree-transfers');
  await writeFile(f.journalPath, '{broken');
  const legacy = join(directory, crypto.randomUUID() + '.json'); await writeFile(legacy, JSON.stringify({ state: 'prepared', source: f.source }));
  const external = join(f.root, 'external.json'); await writeFile(external, JSON.stringify(f.record));
  await symlink(external, join(directory, crypto.randomUUID() + '.json'), 'file');
  const result = await f.recover(); assert.equal(result.issues.length, 3); assert.equal(result.outcomes.length, 0);
  assert.equal(await readFile(f.journalPath, 'utf8'), '{broken'); assert.equal(await readFile(external, 'utf8'), JSON.stringify(f.record));
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.json')).length, 3);
});

test('cancellation preserves pending recovery evidence and retry succeeds', async () => {
  const f = await setup(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.recover([f.managed], [f.thread], controller.signal), { name: 'AbortError' });
  assert.equal(JSON.parse(await readFile(f.journalPath, 'utf8')).state, 'prepared'); assert.deepEqual((await f.recover()).issues, []);
});

test('a forward temporary path collision is preserved when exclusive creation fails', async () => {
  const f = await setup(); await rm(f.journalPath); let collision = '';
  const original = f.snapshots.blob.bind(f.snapshots);
  f.snapshots.blob = async (...args) => {
    if (!collision) {
      const directory = join(f.storage, 'worktree-transfers'), name = (await readdir(directory)).find(name => name.endsWith('.json'))!;
      const record = JSON.parse(await readFile(join(directory, name), 'utf8')) as TransferJournal;
      collision = join(f.worktree.path, 'a.txt.pi-transfer-' + record.id + '-0'); await writeFile(collision, 'belongs to another writer');
    }
    return original(...args);
  };
  await assert.rejects(f.service.transfer('t', f.source, f.worktree.path, f.record.targetTree, undefined, new AbortController().signal, () => {}), /EEXIST/);
  assert.equal(await readFile(collision, 'utf8'), 'belongs to another writer'); assert.equal(await readFile(join(f.worktree.path, 'a.txt'), 'utf8'), 'original\r\n');
});
