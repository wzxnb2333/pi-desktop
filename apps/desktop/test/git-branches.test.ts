import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { GitWorkflow } from '../src/main/git-workflow.ts';
import { requestSchema } from '../src/shared/contracts.ts';

async function repository(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-branches-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await gitRun(root, ['init', '-b', 'main']);
  await gitRun(root, ['config', 'user.name', 'Branch test']);
  await gitRun(root, ['config', 'user.email', 'branch@example.invalid']);
  await writeFile(join(root, 'file.txt'), 'initial\n');
  await gitRun(root, ['add', '--', 'file.txt']);
  await gitRun(root, ['commit', '-m', 'initial']);
  await gitRun(root, ['remote', 'add', 'origin', join(root, '.git', 'remote.git')]);
  await gitRun(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  await gitRun(root, ['update-ref', 'refs/remotes/origin/feature/topic', 'HEAD']);
  await gitRun(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
  const workflow = new GitWorkflow(new GitService(join(root, '.git', 'storage')));
  const run = (value: string, startPoint: string) => {
    const request = requestSchema.parse({ op: 'git.action', threadId: 't', action: 'branchTrack', value, startPoint });
    if (request.op !== 'git.action') throw new Error('Unexpected request');
    return workflow.exclusive(root, () => workflow.action(root, request));
  };
  return { root, workflow, run };
}

test('Git inspection separates remote branches from local names and symbolic HEAD', async t => {
  const { root, workflow } = await repository(t);
  const inspection = await workflow.inspect(root);
  assert.deepEqual(inspection.branches, ['main']);
  assert.deepEqual(inspection.remoteBranches, [
    { ref: 'origin/feature/topic', remote: 'origin', name: 'feature/topic' },
    { ref: 'origin/main', remote: 'origin', name: 'main' },
  ]);
});

test('tracking a selected remote branch uses an explicit local name without moving an existing branch', async t => {
  const { root, workflow, run } = await repository(t);
  await run('local-topic', 'origin/feature/topic');
  assert.equal((await gitRun(root, ['branch', '--show-current'])).trim(), 'local-topic');
  assert.equal((await workflow.inspect(root)).upstream, 'origin/feature/topic');
  await gitRun(root, ['switch', 'main']);
  await assert.rejects(run('main', 'origin/feature/topic'), /already exists|已经存在/);
  assert.equal((await gitRun(root, ['branch', '--show-current'])).trim(), 'main');
  assert.equal((await workflow.inspect(root)).upstream, '');
});

test('tracking rejects dirty workspaces, missing refs and symbolic remote HEAD', async t => {
  const { root, run } = await repository(t);
  await writeFile(join(root, 'file.txt'), 'unsaved\n');
  await assert.rejects(run('topic', 'origin/feature/topic'), /未提交/);
  assert.equal(await gitRun(root, ['branch', '--list', 'topic']), '');
  await gitRun(root, ['restore', '--', 'file.txt']);
  await assert.rejects(run('topic', 'origin/missing'), /远端分支/);
  await assert.rejects(run('topic', 'origin/HEAD'), /远端分支/);
  await assert.rejects(run('topic', '--force'), /远端分支/);
  assert.equal((await gitRun(root, ['branch', '--show-current'])).trim(), 'main');
});

test('push preserves a differently named configured upstream without creating an extra remote branch', async t => {
  const { root, workflow, run } = await repository(t);
  const remote = join(root, '.git', 'remote.git');
  await gitRun(root, ['init', '--bare', '-b', 'main', remote]);
  await gitRun(root, ['push', '-u', 'origin', 'main']);
  await run('local-topic', 'origin/main');
  await writeFile(join(root, 'file.txt'), 'local update\n');
  await gitRun(root, ['commit', '-am', 'local update']);
  const request = requestSchema.parse({ op: 'git.action', threadId: 't', action: 'push', remote: 'origin' });
  if (request.op !== 'git.action') throw new Error('Unexpected request');
  await workflow.exclusive(root, () => workflow.action(root, request));
  assert.equal((await workflow.inspect(root)).upstream, 'origin/main');
  assert.equal(await gitRun(remote, ['show', 'main:file.txt']), 'local update\n');
  assert.equal((await gitRun(remote, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).trim(), 'main');
});
