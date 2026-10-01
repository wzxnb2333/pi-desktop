import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { GitService, gitRun } from '../src/main/git.ts';
import { RoundSnapshots } from '../src/main/round-snapshots.ts';
import { WorktreeTransfer } from '../src/main/worktree-transfer.ts';

async function fixture(nested = false) {
  const root = await mkdtemp(join(tmpdir(), 'pi-transfer-')); const repository = join(root, 'repo'); const storage = join(root, 'storage'); await mkdir(repository); await mkdir(storage);
  await gitRun(repository, ['init', '-b', 'main']); await gitRun(repository, ['config', 'core.autocrlf', 'false']);
  await gitRun(repository, ['config', 'user.name', 'Test']); await gitRun(repository, ['config', 'user.email', 'test@example.invalid']);
  const local = nested ? join(repository, 'nested') : repository; await mkdir(local, { recursive: true });
  await writeFile(join(local, 'a.txt'), 'a\r\n'); await writeFile(join(local, 'b.txt'), 'b\r\n'); await writeFile(join(repository, 'outside.txt'), 'outer\n');
  await gitRun(repository, ['add', '--', '.']); await gitRun(repository, ['commit', '-m', 'base']);
  const git = new GitService(storage); const snapshots = new RoundSnapshots(storage); const service = new WorktreeTransfer(storage, snapshots);
  const worktree = await git.createWorktree(local, crypto.randomUUID());
  return { repository, local, storage, git, snapshots, service, worktree };
}
test('file transfer preserves staging, raw binary/CRLF and independent local edits, then reuses the worktree', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture();
  await writeFile(join(local, 'a.txt'), 'local staged\r\n'); await gitRun(local, ['add', '--', 'a.txt']);
  await writeFile(join(local, 'new.bin'), Buffer.from([0, 255, 128, 65]));
  const beforeIndex = await readFile(join(local, '.git', 'index'));
  const worktreeIndex = resolve(worktree.path, (await gitRun(worktree.path, ['rev-parse', '--git-path', 'index'])).trim());
  const originalWorktreeIndex = await readFile(worktreeIndex);
  const clean = await snapshots.captureTree('t', worktree.path);
  const outward = await service.transfer('t', local, worktree.path, clean, undefined, new AbortController().signal, () => {});
  assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'local staged\r\n');
  assert.deepEqual(await readFile(join(worktree.path, 'new.bin')), Buffer.from([0, 255, 128, 65]));
  assert.deepEqual(await readFile(join(local, '.git', 'index')), beforeIndex); assert.deepEqual(await readFile(worktreeIndex), originalWorktreeIndex);
  await writeFile(join(worktree.path, 'a.txt'), 'worktree changed\r\n'); await writeFile(join(local, 'independent.txt'), 'other edit');
  await service.transfer('t', worktree.path, local, outward.sourceTree, outward.sourceTree, new AbortController().signal, () => {});
  assert.equal(await readFile(join(local, 'a.txt'), 'utf8'), 'worktree changed\r\n'); assert.equal(await readFile(join(local, 'independent.txt'), 'utf8'), 'other edit');
  assert.deepEqual(await readFile(join(local, '.git', 'index')), beforeIndex);
  const anchor = await snapshots.captureTree('t', worktree.path); await writeFile(join(local, 'b.txt'), 'next visit\n');
  await service.transfer('t', local, worktree.path, anchor, undefined, new AbortController().signal, () => {});
  assert.equal(await readFile(join(worktree.path, 'b.txt'), 'utf8'), 'next visit\n');
  assert.equal((await readdir(join(storage, 'worktree-transfers'))).filter(name => name.endsWith('.json')).length, 3);
});
test('conflicting external edits never get overwritten; cancellation rolls back already transferred files', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture();
  const clean = await snapshots.captureTree('t', worktree.path);
  await writeFile(join(local, 'a.txt'), 'source a'); await writeFile(join(local, 'b.txt'), 'source b');
  await writeFile(join(worktree.path, 'a.txt'), 'external target');
  await assert.rejects(service.transfer('t', local, worktree.path, clean, undefined, new AbortController().signal, () => {}), /迁移冲突/);
  assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'external target'); assert.equal(await readFile(join(worktree.path, 'b.txt'), 'utf8'), 'b\r\n');
  await writeFile(join(worktree.path, 'a.txt'), 'a\r\n'); const controller = new AbortController();
  await assert.rejects(service.transfer('t', local, worktree.path, clean, undefined, controller.signal, stage => { if (stage === '迁移文件 2/2') controller.abort(); }));
  assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'a\r\n'); assert.equal(await readFile(join(local, 'a.txt'), 'utf8'), 'source a');
  const record = (await readdir(join(storage, 'worktree-transfers'))).find(name => name.endsWith('.json'))!;
  assert.equal(JSON.parse(await readFile(join(storage, 'worktree-transfers', record), 'utf8')).state, 'rolled-back');
  assert.equal((await readdir(worktree.path)).some(name => name.includes('.pi-transfer-')), false);
});
test('nested projects retain their execution boundary and starting references resolve before creating a checkout', async () => {
  const { repository, local, storage, git, snapshots, service, worktree } = await fixture(true);
  assert.equal(worktree.path, join(worktree.checkoutPath, 'nested'));
  const base = await snapshots.captureTree('t', worktree.path);
  assert.deepEqual([...await snapshots.manifest('t', worktree.path, base)].map(([path]) => path), ['a.txt', 'b.txt']);
  await writeFile(join(local, 'a.txt'), 'nested transfer');
  await service.transfer('t', local, worktree.path, base, undefined, new AbortController().signal, () => {});
  assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'nested transfer');
  assert.equal(await readFile(join(worktree.checkoutPath, 'outside.txt'), 'utf8'), 'outer\n');
  const oldHead = (await gitRun(repository, ['rev-parse', 'HEAD'])).trim();
  await writeFile(join(local, 'b.txt'), 'new commit'); await gitRun(repository, ['add', '--', 'nested/b.txt']); await gitRun(repository, ['commit', '-m', 'new']);
  const older = await git.createWorktree(local, crypto.randomUUID(), oldHead); assert.equal(await readFile(join(older.path, 'b.txt'), 'utf8'), 'b\r\n');
  const invalidId = crypto.randomUUID(); await assert.rejects(git.createWorktree(local, invalidId, 'missing-ref')); await assert.rejects(access(join(storage, 'worktrees', invalidId)), { code: 'ENOENT' });
});

test('failed association commit rolls back changed, added and removed files while preserving indexes', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture();
  const baseline = await snapshots.captureTree('t', worktree.path), index = await readFile(join(local, '.git/index'));
  await writeFile(join(local, 'a.txt'), 'changed\r\n'); await rm(join(local, 'b.txt')); await writeFile(join(local, 'new.bin'), Buffer.from([0, 128, 255]));
  let reached = false;
  await assert.rejects(service.transfer('t', local, worktree.path, baseline, undefined, new AbortController().signal, () => {}, async () => {
    reached = true;
    assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'changed\r\n');
    await assert.rejects(access(join(worktree.path, 'b.txt')), { code: 'ENOENT' });
    throw new Error('STATE_SAVE_FAILED');
  }), /STATE_SAVE_FAILED/);
  assert.equal(reached, true); assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'a\r\n');
  assert.equal(await readFile(join(worktree.path, 'b.txt'), 'utf8'), 'b\r\n');
  await assert.rejects(access(join(worktree.path, 'new.bin')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(local, '.git/index')), index);
  const name = (await readdir(join(storage, 'worktree-transfers'))).find(name => name.endsWith('.json'))!;
  assert.equal(JSON.parse(await readFile(join(storage, 'worktree-transfers', name), 'utf8')).state, 'rolled-back');
});

test('rollback after failed association preserves external edits and retains recovery evidence', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture();
  const baseline = await snapshots.captureTree('t', worktree.path);
  await writeFile(join(local, 'a.txt'), 'source a'); await writeFile(join(local, 'b.txt'), 'source b');
  await assert.rejects(service.transfer('t', local, worktree.path, baseline, undefined, new AbortController().signal, () => {}, async () => {
    await writeFile(join(worktree.path, 'a.txt'), 'external a'); throw new Error('STATE_SAVE_FAILED');
  }), /外部修改已保留.*恢复记录/);
  assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'external a'); assert.equal(await readFile(join(worktree.path, 'b.txt'), 'utf8'), 'b\r\n');
  const name = (await readdir(join(storage, 'worktree-transfers'))).find(name => name.endsWith('.json'))!;
  const record = JSON.parse(await readFile(join(storage, 'worktree-transfers', name), 'utf8'));
  assert.equal(record.state, 'recovery-required'); assert.match(record.error, /STATE_SAVE_FAILED/);
  assert.ok((await snapshots.manifest('t', worktree.path, record.targetTree)).has('a.txt'));
});

test('target edits after copying are checked before publishing the association', async () => {
  const { local, snapshots, service, worktree } = await fixture();
  const baseline = await snapshots.captureTree('t', worktree.path); await writeFile(join(local, 'a.txt'), 'source a');
  const capture = snapshots.captureTree.bind(snapshots); let targets = 0;
  snapshots.captureTree = async (id, cwd, signal) => {
    if (cwd === worktree.path && ++targets === 3) await writeFile(join(cwd, 'outside.txt'), 'external unrelated');
    return capture(id, cwd, signal);
  };
  let committed = false;
  await assert.rejects(service.transfer('t', local, worktree.path, baseline, undefined, new AbortController().signal, () => {}, async () => { committed = true; }), /目标目录发生变化/);
  assert.equal(committed, false); assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'a\r\n');
  assert.equal(await readFile(join(worktree.path, 'outside.txt'), 'utf8'), 'external unrelated');
});

test('late cancellation and journal failure cannot roll back an already committed migration', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture(); const controller = new AbortController();
  const baseline = await snapshots.captureTree('t', worktree.path); await writeFile(join(local, 'a.txt'), 'committed');
  let blocked = '', association = '';
  try {
    const result = await service.transfer('t', local, worktree.path, baseline, undefined, controller.signal, () => {}, async (result) => {
      association = result.id; blocked = join(storage, 'worktree-transfers', result.id + '.json.tmp');
      await mkdir(blocked); controller.abort();
    });
    assert.equal(result.id, association); assert.match(result.warning!, /迁移已完成/);
    assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'committed');
    assert.equal(JSON.parse(await readFile(join(storage, 'worktree-transfers', result.id + '.json'), 'utf8')).state, 'files-transferred');
  } finally { if (blocked) await rm(blocked, { recursive: true }); }
});

test('failed recovery status save retains original evidence and restored files without masking the association failure', async () => {
  const { local, storage, snapshots, service, worktree } = await fixture();
  const baseline = await snapshots.captureTree('t', worktree.path); await writeFile(join(local, 'a.txt'), 'changed');
  let blocked = '', id = '';
  try {
    await assert.rejects(service.transfer('t', local, worktree.path, baseline, undefined, new AbortController().signal, () => {}, async result => {
      id = result.id; blocked = join(storage, 'worktree-transfers', id + '.json.tmp'); await mkdir(blocked); throw new Error('ORIGINAL_ASSOCIATION_FAILURE');
    }), error => {
      assert.match(String(error), /迁移恢复记录保存失败/); assert.match(String(error), /ORIGINAL_ASSOCIATION_FAILURE/); assert.ok(String(error).includes(id)); return true;
    });
    assert.equal(await readFile(join(worktree.path, 'a.txt'), 'utf8'), 'a\r\n');
    const record = JSON.parse(await readFile(join(storage, 'worktree-transfers', id + '.json'), 'utf8'));
    assert.equal(record.state, 'files-transferred'); assert.equal(record.targetTree, baseline);
  } finally { if (blocked) await rm(blocked, { recursive: true }); }
});
