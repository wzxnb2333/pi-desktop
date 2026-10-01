import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { gitProcess } from '../src/main/git-process.ts';
import { Operations } from '../src/main/operations.ts';
import type { OperationRecord } from '../src/shared/operations.ts';
import { RoundSnapshots } from '../src/main/round-snapshots.ts';
import { WorktreeTransfer } from '../src/main/worktree-transfer.ts';
import { mkdtemp } from './fixtures/node-temp.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-worktree-cancel-'));
  const local = join(root, 'repo'), storage = join(root, 'storage'); await mkdir(local); await mkdir(storage);
  await gitRun(local, ['init', '-b', 'main']); await gitRun(local, ['config', 'core.autocrlf', 'false']);
  await gitRun(local, ['config', 'user.name', 'Test']); await gitRun(local, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(local, 'a.txt'), 'original a'); await writeFile(join(local, 'b.txt'), 'original b');
  await gitRun(local, ['add', '--', '.']); await gitRun(local, ['commit', '-m', 'base']);
  const snapshots = new RoundSnapshots(storage), service = new WorktreeTransfer(storage, snapshots);
  const worktree = await new GitService(storage).createWorktree(local, crypto.randomUUID());
  const baseline = await snapshots.captureTree('t', worktree.path);
  await writeFile(join(local, 'a.txt'), 'changed a'); await writeFile(join(local, 'b.txt'), 'changed b');
  return { root, local, storage, snapshots, service, worktree, baseline };
}

for (const phase of ['capture', 'manifest', 'blob']) test('migration cancellation stops snapshot ' + phase + ' before releasing the caller', async context => {
  const current = await fixture(); const slow = await slowGitFixture(current.root);
  const controller = new AbortController(); let intercepted = false;
  const wait = async (cwd: string, signal?: AbortSignal) => {
    if (intercepted) return; intercepted = true;
    await gitRun(cwd, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], signal);
  };
  if (phase === 'capture') {
    const original = current.snapshots.captureTree.bind(current.snapshots);
    context.mock.method(current.snapshots, 'captureTree', async (id: string, cwd: string, signal?: AbortSignal) => { await wait(cwd, signal); return original(id, cwd, signal); });
  } else if (phase === 'manifest') {
    const original = current.snapshots.manifest.bind(current.snapshots);
    context.mock.method(current.snapshots, 'manifest', async (id: string, cwd: string, tree: string, signal?: AbortSignal) => { await wait(cwd, signal); return original(id, cwd, tree, signal); });
  } else {
    const original = current.snapshots.blob.bind(current.snapshots);
    context.mock.method(current.snapshots, 'blob', async (id: string, cwd: string, hash: string, signal?: AbortSignal) => { await wait(cwd, signal); return original(id, cwd, hash, signal); });
  }
  const index = await readFile(join(current.local, '.git', 'index'));
  const outcome = current.service.transfer('t', current.local, current.worktree.path, current.baseline, undefined, controller.signal, () => {}).then(() => undefined, error => error as Error);
  try {
    const pids = await slow.ready(); controller.abort();
    const result = await Promise.race([outcome, delay(2000).then(() => 'still-running')]);
    assert.ok(result instanceof Error, 'Cancellation must reach a blocked snapshot instead of waiting for its timeout');
    assert.deepEqual(pids.filter(processAlive), [], 'Snapshot descendants must exit before the migration finishes');
    assert.equal(await readFile(join(current.worktree.path, 'a.txt'), 'utf8'), 'original a');
    assert.equal(await readFile(join(current.worktree.path, 'b.txt'), 'utf8'), 'original b');
    assert.deepEqual(await readFile(join(current.local, '.git', 'index')), index);
    assert.equal((await readdir(current.worktree.path)).some(path => path.includes('.pi-transfer-')), false);
  } finally { controller.abort(); await slow.cleanup(); await outcome; }
});

test('managed snapshot input and blob output preserve arbitrary bytes and enforce output limits', async () => {
  const current = await fixture();
  const bytes = Buffer.from(Array.from({ length: 131072 }, (_, index) => index % 256));
  const hash = (await gitProcess(current.local, ['hash-object', '-w', '--stdin'], { input: bytes })).trim();
  assert.deepEqual(await current.snapshots.blob('t', current.local, hash), bytes);
  await writeFile(join(current.local, 'binary.bin'), bytes);
  const tree = await current.snapshots.captureTree('t', current.local);
  const manifest = await current.snapshots.manifest('t', current.local, tree);
  assert.equal(manifest.get('binary.bin')!.hash, hash);
  await assert.rejects(gitProcess(current.local, ['cat-file', 'blob', hash], { encoding: 'buffer', maxBuffer: 16 }), (error: Error & { code?: string; stdout?: Buffer }) => {
    assert.equal(error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'); assert.ok(Buffer.isBuffer(error.stdout)); assert.ok(error.stdout!.length <= 16); return true;
  });
  assert.equal((await readdir(join(current.storage, 'round-snapshots', 't'))).some(file => file.startsWith('index-')), false);
});

test('workspace operation stop and shutdown failures remain retryable without reporting completion', { skip: process.platform !== 'win32' }, async () => {
  const current = await fixture(), slow = await slowGitFixture(current.root);
  const records: OperationRecord[] = [];
  const operations = new Operations(() => records, async () => {}, () => {});
  const input = { id: crypto.randomUUID(), threadId: 't', directoryId: 'p', kind: 'worktree.create' };
  const run = async (signal: AbortSignal) => { await gitRun(current.local, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], signal); return null; };
  const originalRoot = process.env.SystemRoot;
  const restoreRoot = () => { if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot; };
  try {
    await operations.start(input, run); const first = await slow.ready();
    process.env.SystemRoot = join(current.root, 'missing-system');
    await assert.rejects(operations.stop('t', input.id), /无法结束 Git 进程/);
    assert.equal(records[0].status, 'running'); assert.deepEqual(first.filter(processAlive), first);
    restoreRoot(); await operations.stop('t', input.id); await operations.wait('t', input.id);
    assert.equal(records[0].status, 'cancelled'); assert.deepEqual(first.filter(processAlive), []);
    const next = { ...input, id: crypto.randomUUID() }; await operations.start(next, run); const second = await slow.ready();
    process.env.SystemRoot = join(current.root, 'missing-system');
    await assert.rejects(operations.prepareShutdown(), /无法结束 Git 进程/);
    assert.equal(records[1].status, 'running'); assert.deepEqual(second.filter(processAlive), second);
    const other = { ...input, id: crypto.randomUUID(), threadId: 'other' };
    await operations.start(other, async () => null); assert.equal((await operations.wait('other', other.id)).status, 'succeeded');
    restoreRoot(); await operations.dispose();
    assert.equal(records[1].status, 'cancelled'); assert.deepEqual(second.filter(processAlive), []);
  } finally { restoreRoot(); await slow.cleanup(); await operations.dispose(); }
});
