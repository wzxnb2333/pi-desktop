import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { schedulerFixture } from './fixtures/scheduler-runtime.ts';
import { GitService } from '../src/main/git.ts';
import { dueAutomations } from '../src/main/scheduler.ts';

test('git handles spaces/Unicode, working diffs, safe rollback and isolated worktree application', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi git 中文 '));
  const recovery = await mkdtemp(join(tmpdir(), 'pi-recovery-'));
  execFileSync('git', ['init', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'config', 'core.autocrlf', 'false']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.invalid']);
  await writeFile(join(root, '文件 hello.txt'), 'original\n');
  execFileSync('git', ['-C', root, 'add', '--', '文件 hello.txt']);
  execFileSync('git', ['-C', root, 'commit', '-m', 'initial']);
  const git = new GitService(recovery);
  await writeFile(join(root, '文件 hello.txt'), 'modified\n');
  assert.equal((await git.status(root)).files[0].path, '文件 hello.txt');
  assert.match(await git.diff(root, '文件 hello.txt'), /\+modified/);
  const backup = await git.revert(root, '文件 hello.txt');
  assert.equal(await readFile(join(root, '文件 hello.txt'), 'utf8'), 'original\n');
  assert.equal(await readFile(backup, 'utf8'), 'modified\n');
  const worktree = await git.createWorktree(root, 'example');
  await writeFile(join(worktree.path, '文件 hello.txt'), 'from worktree\n');
  await writeFile(join(worktree.path, 'new.txt'), 'new content\n');
  await git.applyWorktree(root, worktree.path, worktree.baseCommit);
  assert.equal(await readFile(join(root, '文件 hello.txt'), 'utf8'), 'from worktree\n');
  assert.equal(await readFile(join(root, 'new.txt'), 'utf8'), 'new content\n');
  await assert.rejects(git.applyWorktree(root, worktree.path, worktree.baseCommit));
  execFileSync('git', ['-C', root, 'worktree', 'remove', '--force', worktree.path]);
});

test('scheduler coalesces missed occurrences and does not duplicate running jobs', () => {
  const job = {
    id: 'a',
    name: '检查',
    projectId: 'p',
    prompt: 'test',
    intervalMinutes: 5,
    enabled: true,
    nextRunAt: 10,
  };
  assert.deepEqual(
    dueAutomations([job], new Set(), 20).map((j) => j.id),
    ['a'],
  );
  assert.deepEqual(dueAutomations([job], new Set(['a']), 20), []);
  assert.deepEqual(dueAutomations([{ ...job, enabled: false }], new Set(), 20), []);
});

test('overlapping scheduler ticks do not run a queued job twice', async (context) => {
  context.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100000 });
  const jobs = ['first', 'second'].map((id) => ({
    id,
    name: id,
    projectId: 'p',
    prompt: 'test',
    intervalMinutes: 60,
    enabled: true,
    nextRunAt: 1,
  }));
  const fixture = schedulerFixture(); fixture.data.automations = jobs;
  const calls: string[] = [];
  const releases = new Map<string, () => void>();
  fixture.setRun(run => { calls.push(run.automationId); return new Promise<void>(resolve => releases.set(run.automationId, resolve)); });
  const scheduler = fixture.scheduler; scheduler.start();
  await nextTurn();
  context.mock.timers.tick(10000);
  await nextTurn();
  releases.get('first')?.();
  await nextTurn();
  scheduler.stop();
  releases.get('second')?.();
  await scheduler.settled();
  assert.deepEqual(calls, ['first', 'second']);
});
