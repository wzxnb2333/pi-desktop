import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import type { ManagedWorktree } from '../src/shared/worktrees.ts';
import { gitRun } from '../src/main/git.ts';
import { directoryBytes, WorktreeArchives } from '../src/main/worktree-archives.ts';
import { archiveFixture as fixture } from './fixtures/worktree-archive.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import { archiveBlocker } from '../src/main/worktree-availability.ts';


const signal = () => new AbortController().signal;

test('archive protection covers nested opened folders, pinned/shared tasks, active startup and terminals', async () => {
  const { record } = await fixture();
  const owner = threadSchema.parse({ id: 'owner', projectId: 'project', title: 'task', cwd: record.path, createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'ask' });
  const blockers = (threads = [owner], opened: string[] = [], busy = new Set<string>(), terminals = new Set<string>()) => archiveBlocker(record, threads, opened, busy, terminals);
  assert.equal(blockers(), undefined);
  assert.match(blockers([owner], [join(record.path, 'nested')])!, /窗口/);
  assert.match(blockers([{ ...owner, pinned: true }])!, /固定/);
  assert.match(blockers([owner, { ...owner, id: 'other' }])!, /共享/);
  assert.match(blockers([owner], [], new Set(['owner']))!, /活动/);
  assert.match(blockers([owner], [], new Set(), new Set(['owner']))!, /终端/);
  assert.equal(blockers([owner], [record.checkoutPath + '-other']), undefined);
});

test('legacy worktree adoption verifies the actual repository and preserves a conservative commit baseline', async () => {
  const { record, archives, repository } = await fixture();
  const adopted = await archives.adopt(record, signal());
  assert.equal(adopted.checkoutPath.replaceAll('\\', '/').toLowerCase(), record.checkoutPath.replaceAll('\\', '/').toLowerCase());
  assert.equal(adopted.localBaseline, (await gitRun(repository, ['rev-parse', record.baseCommit + '^{tree}'])).trim());
  await assert.rejects(archives.adopt({ ...record, path: repository }, signal()), /独立 Worktree/);
});

test('archives and restores the complete nested checkout, staged changes, raw binary and removed tracked files', async () => {
  const { record, repository, storage, archives, saved } = await fixture();
  const originalIndex = await readFile(join(repository, '.git/index'));
  await writeFile(join(record.path, 'a.txt'), 'staged\r\n'); await gitRun(record.path, ['add', '--', 'a.txt']);
  await writeFile(join(record.path, 'a.txt'), 'unstaged\r\n'); await writeFile(join(record.checkoutPath, 'binary.bin'), Buffer.from([0, 255, 128, 1]));
  await rm(join(record.checkoutPath, 'outside.txt'));
  const stage = await gitRun(record.path, ['diff', '--cached', '--binary']);
  const before = await directoryBytes(record.checkoutPath, signal()); assert.ok(before > 0);
  await archives.archive(record, signal(), () => {});
  assert.equal(saved().status, 'archived'); await assert.rejects(access(record.checkoutPath), { code: 'ENOENT' });
  assert.equal(await directoryBytes(record.checkoutPath, signal()), 0);
  // Original commits remain reachable even after branches move and Git performs pruning.
  await gitRun(repository, ['gc', '--prune=now']);
  await archives.restore(record, signal(), () => {});
  assert.equal(record.status, 'ready'); assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'unstaged\r\n');
  assert.deepEqual(await readFile(join(record.checkoutPath, 'binary.bin')), Buffer.from([0, 255, 128, 1]));
  await assert.rejects(access(join(record.checkoutPath, 'outside.txt')), { code: 'ENOENT' });
  assert.equal(await gitRun(record.path, ['diff', '--cached', '--binary']), stage);
  assert.deepEqual(await readFile(join(repository, '.git/index')), originalIndex);
  assert.deepEqual(await readdir(join(storage, 'worktree-indexes')), []);
});

test('ignored data, conflicting files and paths outside managed storage cannot be recycled', async () => {
  const { record, archives, repository } = await fixture();
  await mkdir(join(record.checkoutPath, 'ignored')); await writeFile(join(record.checkoutPath, 'ignored/private.txt'), 'private');
  await assert.rejects(archives.archive(record, signal(), () => {}), /忽略文件/);
  assert.equal(await readFile(join(record.checkoutPath, 'ignored/private.txt'), 'utf8'), 'private');
  await rm(join(record.checkoutPath, 'ignored/private.txt')); await rmdir(join(record.checkoutPath, 'ignored'));
  await assert.rejects(archives.archive({ ...record, checkoutPath: repository, path: repository }, signal(), () => {}), /独立 Worktree/);
  await archives.archive(record, signal(), () => {});
  await mkdir(record.checkoutPath); await writeFile(join(record.checkoutPath, 'occupied.txt'), 'user');
  await assert.rejects(archives.restore(record, signal(), () => {}), /已被占用/);
  assert.equal(await readFile(join(record.checkoutPath, 'occupied.txt'), 'utf8'), 'user');
});

test('interrupted restoration resumes safely and rejects edits to partially restored files', async () => {
  const { record, archives } = await fixture(); await archives.archive(record, signal(), () => {});
  const controller = new AbortController();
  await assert.rejects(archives.restore(record, controller.signal, stage => { if (stage === '恢复文件 2/3') controller.abort(); }));
  assert.equal(record.restoreInProgress, true); assert.equal(record.status, 'archived');
  await writeFile(join(record.checkoutPath, '.gitignore'), 'external modification');
  await assert.rejects(archives.restore(record, signal(), () => {}), /外部修改/);
  assert.equal(await readFile(join(record.checkoutPath, '.gitignore'), 'utf8'), 'external modification');
  await writeFile(join(record.checkoutPath, '.gitignore'), 'ignored/\n');
  await archives.restore(record, signal(), () => {}); assert.equal(record.status, 'ready');
});

test('startup reconciles archive removal and restore preserves an externally moved branch', async () => {
  const { record, archives, repository } = await fixture(); const branch = record.branch;
  await archives.archive(record, signal(), () => {});
  const interrupted: ManagedWorktree = { ...record, status: 'ready', archivedAt: undefined };
  await archives.recover([interrupted]); assert.equal(interrupted.status, 'archived');
  await writeFile(join(repository, 'new.txt'), 'external'); await gitRun(repository, ['add', '--', 'new.txt']); await gitRun(repository, ['commit', '-m', 'external']);
  const newer = (await gitRun(repository, ['rev-parse', 'HEAD'])).trim(); await gitRun(repository, ['branch', '-f', branch, newer]);
  await archives.restore(record, signal(), () => {});
  assert.notEqual(record.branch, branch); assert.equal((await gitRun(repository, ['rev-parse', 'refs/heads/' + branch])).trim(), newer);
  assert.equal((await gitRun(record.path, ['rev-parse', 'HEAD'])).trim(), record.archiveHead);
});

for (const collision of ['index', 'lock'] as const) test('restoration refuses an external ' + collision + ' written while restoring files', async () => {
  const { record, archives, snapshots } = await fixture();
  await writeFile(join(record.path, 'a.txt'), 'archived staged'); await gitRun(record.path, ['add', '--', 'a.txt']);
  await writeFile(join(record.path, 'a.txt'), 'archived working'); await archives.archive(record, signal(), () => {});
  const blob = snapshots.blob.bind(snapshots); let indexPath = '', indexBytes: Buffer | undefined;
  snapshots.blob = async (...args) => {
    const bytes = await blob(...args);
    if (!indexPath) {
      indexPath = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'])).trim());
      if (collision === 'index') {
        await gitRun(record.checkoutPath, ['read-tree', 'HEAD']);
        const hash = (await gitRun(record.checkoutPath, ['rev-parse', 'HEAD:outside.txt'])).trim();
        await gitRun(record.checkoutPath, ['update-index', '--cacheinfo', '100644', hash, 'nested/a.txt']);
        indexBytes = await readFile(indexPath);
      } else await writeFile(indexPath + '.lock', 'external lock');
    }
    return bytes;
  };
  await assert.rejects(archives.restore(record, signal(), () => {}), /暂存区|锁/);
  assert.equal(record.status, 'archived'); assert.equal(record.restoreInProgress, true);
  if (collision === 'index') {
    assert.deepEqual(await readFile(indexPath), indexBytes); assert.equal(await gitRun(record.checkoutPath, ['show', ':nested/a.txt']), 'outside');
    await assert.rejects(archives.restore(record, signal(), () => {}), /暂存区被外部修改/);
    assert.deepEqual(await readFile(indexPath), indexBytes);
  } else {
    assert.equal(await readFile(indexPath + '.lock', 'utf8'), 'external lock'); await rm(indexPath + '.lock');
    await archives.restore(record, signal(), () => {}); assert.equal(record.status, 'ready');
  }
});

test('restoration retries a failed state save without republishing or losing staged changes', async () => {
  const { record, storage, archives, snapshots } = await fixture();
  await writeFile(join(record.path, 'a.txt'), 'staged'); await gitRun(record.path, ['add', '--', 'a.txt']);
  await writeFile(join(record.path, 'a.txt'), 'working'); await archives.archive(record, signal(), () => {});
  let failed = false;
  const retryable = new WorktreeArchives(storage, snapshots, async () => { if (record.status === 'ready' && !failed) { failed = true; throw new Error('EIO saving restored state'); } });
  await assert.rejects(retryable.restore(record, signal(), () => {}), /EIO/);
  assert.equal(record.status, 'archived'); assert.equal(record.restoreInProgress, true);
  const indexPath = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'])).trim());
  const before = await readFile(indexPath);
  await retryable.restore(record, signal(), () => {});
  assert.deepEqual(await readFile(indexPath), before); assert.equal(await gitRun(record.path, ['show', ':nested/a.txt']), 'staged');
  assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'working'); assert.equal(record.status, 'ready');
  assert.equal((await readdir(dirname(indexPath))).filter(path => path.includes('.pi-restore-') || path === 'index.lock').length, 0);
});

test('restoration verifies executable index modes before publishing the index', async () => {
  const { record, archives } = await fixture();
  await gitRun(record.checkoutPath, ['update-index', '--chmod=+x', '--', 'nested/a.txt']);
  await archives.archive(record, signal(), () => {});
  await archives.restore(record, signal(), () => {});
  assert.match(await gitRun(record.checkoutPath, ['ls-files', '--stage', '--', 'nested/a.txt']), /^100755 /);
});

test('restoration preserves an equivalent externally refreshed index on retry', async () => {
  const { record, storage, archives, snapshots } = await fixture();
  await archives.archive(record, signal(), () => {});
  const failSave = new WorktreeArchives(storage, snapshots, async () => { if (record.status === 'ready') throw new Error('disk failure'); });
  await assert.rejects(failSave.restore(record, signal(), () => {}), /disk failure/);
  await gitRun(record.checkoutPath, ['update-index', '--refresh']);
  const indexPath = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'])).trim());
  const refreshed = await readFile(indexPath);
  await archives.restore(record, signal(), () => {});
  assert.equal(record.status, 'ready'); assert.deepEqual(await readFile(indexPath), refreshed);
});

for (const failure of ['cancel', 'lock', 'matching-lock', 'head'] as const) test('restoration preserves state when final validation encounters ' + failure, async () => {
  const { record, archives, snapshots, repository } = await fixture();
  await archives.archive(record, signal(), () => {});
  const capture = snapshots.captureTree.bind(snapshots), controller = new AbortController(); let indexPath = '';
  snapshots.captureTree = async (...args) => {
    const tree = await capture(...args);
    indexPath = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'])).trim());
    await access(indexPath + '.lock');
    if (failure === 'cancel') controller.abort();
    if (failure === 'lock' || failure === 'matching-lock') {
      const replacement = failure === 'lock' ? Buffer.from('external replacement') : await readFile(indexPath + '.lock');
      await rm(indexPath + '.lock'); await writeFile(indexPath + '.lock', replacement);
    }
    if (failure === 'head') {
      await gitRun(repository, ['commit', '--allow-empty', '-m', 'external']);
      await gitRun(record.checkoutPath, ['update-ref', 'HEAD', (await gitRun(repository, ['rev-parse', 'HEAD'])).trim()]);
    }
    return tree;
  };
  await assert.rejects(archives.restore(record, controller.signal, () => {}));
  assert.equal(record.status, 'archived'); await assert.rejects(access(indexPath), { code: 'ENOENT' });
  if (failure === 'lock' || failure === 'matching-lock') {
    const expected = failure === 'lock' ? Buffer.from('external replacement') : await readFile(indexPath + '.pi-restore-' + record.id);
    assert.deepEqual(await readFile(indexPath + '.lock'), expected); await rm(indexPath + '.lock');
  }
  else await assert.rejects(access(indexPath + '.lock'), { code: 'ENOENT' });
  if (failure === 'head') await gitRun(record.checkoutPath, ['update-ref', 'HEAD', record.archiveHead!]);
  snapshots.captureTree = capture;
  await archives.restore(record, signal(), () => {}); assert.equal(record.status, 'ready');
});
