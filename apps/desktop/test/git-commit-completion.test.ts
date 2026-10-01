import assert from 'node:assert/strict';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { GitWorkflow } from '../src/main/git-workflow.ts';
import { requestSchema } from '../src/shared/contracts.ts';
import { isGitCommitResult } from '../src/shared/git-results.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function repository(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-completion-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']);
  await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await gitRun(cwd, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(cwd, 'file.txt'), 'old\n'); await writeFile(join(cwd, 'other.txt'), 'other old\n');
  await gitRun(cwd, ['add', '--', 'file.txt', 'other.txt']); await gitRun(cwd, ['commit', '-m', 'initial']);
  await writeFile(join(cwd, 'file.txt'), 'selected\n'); await writeFile(join(cwd, 'other.txt'), 'other staged\n');
  await gitRun(cwd, ['add', '--', 'file.txt', 'other.txt']);
  const slow = await slowGitFixture(root); context.after(() => slow.cleanup());
  const hooks = join(root, 'hooks'); await mkdir(hooks);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nprintf \'formatted\\n\' > file.txt\ngit add -- file.txt\n', { mode: 0o755 });
  await writeFile(join(hooks, 'post-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
  await gitRun(cwd, ['config', 'core.hooksPath', hooks]);
  const workflow = new GitWorkflow(new GitService(root)); context.after(() => workflow.dispose());
  const request = requestSchema.parse({ op: 'git.action', threadId: 't', requestId: 'commit', action: 'commitStaged', paths: ['file.txt'], value: 'selected commit' });
  if (request.op !== 'git.action') throw new Error('Unexpected request');
  return { root, cwd, hooks, slow, workflow, request };
}

test('late commit cancellation reports the completed commit and reconciles the selected index after hooks', async context => {
  const { cwd, slow, workflow, request } = await repository(context);
  const before = await gitRun(cwd, ['rev-parse', 'HEAD']);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)).then(result => ({ result }), error => ({ error: String(error) }));
  const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
  const committed = (await gitRun(cwd, ['rev-parse', 'HEAD'])).trim(); assert.notEqual(committed, before.trim());
  workflow.cancel(cwd, request.requestId!);
  const outcome = await action; assert.ok('result' in outcome, JSON.stringify(outcome));
  assert.ok(isGitCommitResult(outcome.result)); assert.equal(outcome.result.id, committed);
  assert.equal(outcome.result.interrupted, true); assert.deepEqual(outcome.result.warnings, []);
  assert.deepEqual(ids.filter(processAlive), []); await assert.rejects(access(temporary), { code: 'ENOENT' });
  assert.equal(await gitRun(cwd, ['show', 'HEAD:file.txt']), 'formatted\n');
  assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'formatted\n');
  assert.equal(await gitRun(cwd, ['show', ':other.txt']), 'other staged\n');
  assert.equal(await gitRun(cwd, ['show', 'HEAD:other.txt']), 'other old\n');
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'formatted\n');
  assert.equal((await gitRun(cwd, ['diff', '--cached', '--name-only'])).trim(), 'other.txt');
});

test('shutdown after the ref update still finishes index reconciliation before returning', async context => {
  const { cwd, slow, workflow, request } = await repository(context);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request));
  const ids = await slow.ready(); const temporary = dirname(await slow.indexPath());
  await workflow.dispose();
  const result = await action; assert.ok(isGitCommitResult(result));
  assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'formatted\n');
  assert.equal(await gitRun(cwd, ['show', ':other.txt']), 'other staged\n');
  assert.deepEqual(ids.filter(processAlive), []); await assert.rejects(access(temporary), { code: 'ENOENT' });
});

test('completed commits preserve concurrent staging instead of resetting it to the committed version', async context => {
  const { cwd, slow, workflow, request } = await repository(context);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request));
  await slow.ready();
  await writeFile(join(cwd, 'file.txt'), 'external staged\n'); await gitRun(cwd, ['add', '--', 'file.txt']);
  const index = await readFile(join(cwd, '.git', 'index'));
  workflow.cancel(cwd, request.requestId!);
  const result = await action; assert.ok(isGitCommitResult(result));
  assert.deepEqual(result.warnings, [{ code: 'index-changed' }]);
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
  assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'external staged\n');
  assert.equal(await gitRun(cwd, ['show', 'HEAD:file.txt']), 'formatted\n');
  await assert.rejects(access(join(cwd, '.git', 'index.lock')), { code: 'ENOENT' });
});

test('a locked index cannot turn an already completed commit into a retryable failure or remove an outside lock', async context => {
  const { cwd, slow, workflow, request } = await repository(context);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)); await slow.ready();
  const lock = join(cwd, '.git', 'index.lock'); await writeFile(lock, 'outside owner', { flag: 'wx' });
  try {
    workflow.cancel(cwd, request.requestId!);
    const result = await action; assert.ok(isGitCommitResult(result));
    assert.equal(result.warnings[0]?.code, 'index-failed'); assert.match(result.warnings[0].detail!, /EEXIST/);
    assert.equal(await readFile(lock, 'utf8'), 'outside owner');
    assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'selected\n');
    assert.equal(await gitRun(cwd, ['show', 'HEAD:file.txt']), 'formatted\n');
  } finally { await unlink(lock); }
});

test('another HEAD update after the commit does not change its receipt or reset the current index', async context => {
  const { cwd, slow, workflow, request } = await repository(context);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)); await slow.ready();
  const ours = (await gitRun(cwd, ['rev-parse', 'HEAD'])).trim();
  const tree = (await gitRun(cwd, ['rev-parse', 'HEAD^{tree}'])).trim();
  const outside = (await gitRun(cwd, ['commit-tree', tree, '-p', ours, '-m', 'outside commit'])).trim();
  await gitRun(cwd, ['update-ref', '-m', 'outside update', 'HEAD', outside, ours]);
  const index = await readFile(join(cwd, '.git', 'index')); workflow.cancel(cwd, request.requestId!);
  const result = await action; assert.ok(isGitCommitResult(result)); assert.equal(result.id, ours);
  assert.deepEqual(result.warnings, [{ code: 'head-changed' }]);
  assert.equal((await gitRun(cwd, ['rev-parse', 'HEAD'])).trim(), outside);
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
});

test('an outside commit while pre-commit is waiting is never reported as the cancelled request success', async context => {
  const { cwd, hooks, slow, workflow, request } = await repository(context);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + slow.command + '\n');
  await writeFile(join(hooks, 'post-commit'), '#!/bin/sh\nexit 0\n');
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)).then(() => '', error => String(error));
  await slow.ready();
  await gitRun(cwd, ['-c', 'core.hooksPath=' + join(hooks, 'no-hooks'), 'commit', '-m', request.value]);
  const outside = await gitRun(cwd, ['rev-parse', 'HEAD']); const index = await readFile(join(cwd, '.git', 'index'));
  workflow.cancel(cwd, request.requestId!);
  assert.match(await action, /提交结果暂时无法确认/);
  assert.equal(await gitRun(cwd, ['rev-parse', 'HEAD']), outside);
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
});

test('selected initial commits work with user reflogs disabled and leave unselected files staged', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-completion-'));
  await gitRun(root, ['init', '-b', 'main']);
  await gitRun(root, ['config', 'user.name', 'Test']); await gitRun(root, ['config', 'user.email', 'test@example.invalid']);
  await gitRun(root, ['config', 'core.logAllRefUpdates', 'false']);
  await writeFile(join(root, 'first.txt'), 'first\n'); await writeFile(join(root, 'second.txt'), 'second\n');
  await gitRun(root, ['add', '--', 'first.txt', 'second.txt']);
  const workflow = new GitWorkflow(new GitService(root)); context.after(() => workflow.dispose());
  const request = requestSchema.parse({ op: 'git.action', threadId: 't', action: 'commitStaged', paths: ['first.txt'], value: 'initial selected' });
  if (request.op !== 'git.action') throw new Error('Unexpected request');
  const result = await workflow.action(root, request); assert.ok(isGitCommitResult(result));
  assert.equal(result.interrupted, false); assert.deepEqual(result.warnings, []);
  assert.equal((await gitRun(root, ['ls-tree', '--name-only', 'HEAD'])).trim(), 'first.txt');
  assert.equal((await gitRun(root, ['diff', '--cached', '--name-only'])).trim(), 'second.txt');
  assert.equal((await gitRun(root, ['config', '--get', 'core.logAllRefUpdates'])).trim(), 'false');
});

test('selected commits resolve a nested project and Unicode filename without committing its neighbours', async context => {
  const { cwd, hooks, workflow, request } = await repository(context);
  await gitRun(cwd, ['config', 'core.hooksPath', join(hooks, 'no-hooks')]);
  const nested = join(cwd, 'nested'); await mkdir(nested);
  await writeFile(join(nested, '文件 name.txt'), 'nested\n'); await gitRun(nested, ['add', '--', '文件 name.txt']);
  const result = await workflow.action(nested, { ...request, paths: ['文件 name.txt'] }); assert.ok(isGitCommitResult(result));
  assert.deepEqual(result.warnings, []);
  assert.equal(await gitRun(cwd, ['show', 'HEAD:nested/文件 name.txt']), 'nested\n');
  assert.equal(await gitRun(cwd, ['show', 'HEAD:file.txt']), 'old\n');
  assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'selected\n');
});
