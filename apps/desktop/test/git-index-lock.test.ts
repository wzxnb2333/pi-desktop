import assert from 'node:assert/strict';
import { readFile, writeFile, utimes, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { GitService, gitRun } from '../src/main/git.ts';

test('background Git reads never refresh the index while explicit writes respect its lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-index-'));
  await gitRun(root, ['init', '-b', 'main']);
  await gitRun(root, ['config', 'user.name', 'Desktop Test']);
  await gitRun(root, ['config', 'user.email', 'test@example.invalid']);
  await gitRun(root, ['config', 'core.autocrlf', 'false']);
  const path = join(root, 'tracked.txt'), index = join(root, '.git', 'index'), lock = index + '.lock';
  await writeFile(path, 'unchanged content\n');
  await gitRun(root, ['add', '--', 'tracked.txt']);
  await gitRun(root, ['commit', '-m', 'initial']);
  const before = await readFile(index);
  const future = new Date(Date.now() + 10000);
  await utimes(path, future, future);
  await gitRun(root, ['status', '--porcelain=v1']);
  assert.deepEqual(await readFile(index), before, 'status must not refresh cached stat data');
  await gitRun(root, ['diff', '--numstat', 'HEAD']);
  assert.deepEqual(await readFile(index), before, 'diff must not refresh cached stat data');
  const service = new GitService(root);
  assert.deepEqual((await service.status(root)).files, []);
  assert.deepEqual(await readFile(index), before, 'a read must not acquire the index to refresh cached stat data');
  await writeFile(path, 'changed content\n');
  await writeFile(lock, 'LOCK_OWNED_BY_TEST', { flag: 'wx' });
  try {
    assert.equal((await service.status(root)).available, true);
    assert.match(await service.diff(root, 'tracked.txt'), /changed content/);
    await assert.rejects(gitRun(root, ['add', '--', 'tracked.txt']), /index\.lock/);
    assert.equal(await readFile(lock, 'utf8'), 'LOCK_OWNED_BY_TEST');
  } finally { await unlink(lock); }
  await gitRun(root, ['add', '--', 'tracked.txt']);
  assert.equal(await gitRun(root, ['show', ':tracked.txt']), 'changed content\n');
});
