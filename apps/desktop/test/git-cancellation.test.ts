import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { gitProcess } from '../src/main/git-process.ts';
import { GitWorkflow } from '../src/main/git-workflow.ts';
import { requestSchema } from '../src/shared/contracts.ts';
import { diffHunks } from '../src/shared/git-patches.ts';
import { mkdtemp } from './fixtures/node-temp.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';

test('Git cancellation waits until real hook descendants have exited before releasing its caller', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-'));
  const fixture = await slowGitFixture(root); context.after(() => fixture.cleanup());
  const controller = new AbortController();
  const outcome = gitRun(root, ['-c', 'alias.pi-wait=!' + fixture.command, 'pi-wait'], controller.signal).then(() => null, error => error as Error);
  const ids = await fixture.ready();
  controller.abort();
  assert.ok(await outcome instanceof Error);
  assert.deepEqual(ids.filter(processAlive), [], 'Cancellation must not return while hook descendants can still modify files');
});

test('an already cancelled Git call does not launch any hook process', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-'));
  const fixture = await slowGitFixture(root); context.after(() => fixture.cleanup());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(gitRun(root, ['-c', 'alias.pi-wait=!' + fixture.command, 'pi-wait'], controller.signal), { code: 'ABORT_ERR' });
  assert.deepEqual(await fixture.pids(), []);
});

test('Git timeout terminates the complete helper tree before reporting its error', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-'));
  const fixture = await slowGitFixture(root); context.after(() => fixture.cleanup());
  const outcome = gitProcess(root, ['-c', 'alias.pi-wait=!' + fixture.command, 'pi-wait'], { timeoutMs: 3000 }).then(() => null, error => error as NodeJS.ErrnoException);
  const ids = await fixture.ready();
  assert.equal((await outcome)?.code, 'ETIMEDOUT');
  assert.deepEqual(ids.filter(processAlive), []);
});

test('Git output limits stop helpers and retain a bounded failure result', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-'));
  const fixture = await slowGitFixture(root, 8192); context.after(() => fixture.cleanup());
  await assert.rejects(gitProcess(root, ['-c', 'alias.pi-wait=!' + fixture.command, 'pi-wait'], { maxBuffer: 1024 }), (error: Error & { code?: string; stdout?: string }) => {
    assert.equal(error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'); assert.ok((error.stdout?.length ?? 0) <= 1024); return true;
  });
  const ids = await fixture.pids(); assert.equal(ids.length, 2); assert.deepEqual(ids.filter(processAlive), []);
});

test('Git preserves stdout and numeric exit codes used for changed-file diffs and handles launch failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-'));
  await writeFile(join(root, 'a.txt'), '旧文本\n'); await writeFile(join(root, 'b.txt'), '新文本\n');
  await assert.rejects(gitRun(root, ['diff', '--no-index', '--', 'a.txt', 'b.txt']), (error: Error & { code?: number; stdout?: string }) => {
    assert.equal(error.code, 1); assert.match(error.stdout!, /新文本/); return true;
  });
  await assert.rejects(gitRun(join(root, 'missing'), ['status']), { code: 'ENOENT' });
});

async function repository(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-')); const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']); await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(cwd, 'file.txt'), 'old\n'); await gitRun(cwd, ['add', '--', 'file.txt']); await gitRun(cwd, ['commit', '-m', 'initial']);
  await writeFile(join(cwd, 'file.txt'), 'changed\n'); await gitRun(cwd, ['add', '--', 'file.txt']);
  const fixture = await slowGitFixture(root); context.after(() => fixture.cleanup());
  const hooks = join(root, 'hooks'); await mkdir(hooks); await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + fixture.command + '\n', { mode: 0o755 });
  await gitRun(cwd, ['config', 'core.hooksPath', hooks]);
  const workflow = new GitWorkflow(new GitService(root));
  context.after(() => workflow.dispose());
  const input = requestSchema.parse({ op: 'git.action', threadId: 't', requestId: 'commit', action: 'commitStaged', paths: ['file.txt'], value: 'pending commit' });
  if (input.op !== 'git.action') throw new Error('Unexpected request');
  return { root, cwd, fixture, workflow, input, hooks };
}

test('cancelled commits release the repository only after helpers and the temporary index are removed', async context => {
  const { cwd, fixture, workflow, input, hooks } = await repository(context);
  const head = await gitRun(cwd, ['rev-parse', 'HEAD']), index = await readFile(join(cwd, '.git', 'index'));
  const outcome = workflow.exclusive(cwd, () => workflow.action(cwd, input)).then(() => null, error => error as Error);
  const ids = await fixture.ready(); const temporary = dirname(await fixture.indexPath());
  await assert.rejects(workflow.action(cwd, input), /正在运行/);
  const next = workflow.exclusive(cwd, async () => {
    assert.deepEqual(ids.filter(processAlive), []); await assert.rejects(access(temporary), { code: 'ENOENT' });
    return 'next action can run';
  });
  workflow.cancel(cwd, 'commit'); workflow.cancel(cwd, 'commit');
  assert.match((await outcome)!.message, /Git 操作已取消/); assert.equal(await next, 'next action can run');
  assert.equal(await gitRun(cwd, ['rev-parse', 'HEAD']), head); assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 0\n');
  await workflow.exclusive(cwd, () => workflow.action(cwd, { ...input, requestId: 'retry' }));
  assert.equal(await gitRun(cwd, ['show', 'HEAD:file.txt']), 'changed\n');
  assert.equal(await gitRun(cwd, ['diff', '--cached', '--name-only']), '');
});

test('Git shutdown cancels active helpers, rejects queued work and awaits operation cleanup', async context => {
  const { cwd, fixture, workflow, input } = await repository(context);
  const outcome = workflow.exclusive(cwd, () => workflow.action(cwd, input)).then(() => null, error => error as Error);
  const ids = await fixture.ready(); const temporary = dirname(await fixture.indexPath());
  let queuedRan = false;
  const queued = workflow.exclusive(cwd, async () => { queuedRan = true; }).then(() => null, error => error as Error);
  await workflow.dispose();
  assert.match((await outcome)!.message, /Git 操作已取消/); assert.match((await queued)!.message, /正在关闭/);
  assert.equal(queuedRan, false); assert.deepEqual(ids.filter(processAlive), []); await assert.rejects(access(temporary), { code: 'ENOENT' });
  await assert.rejects(workflow.action(cwd, { ...input, requestId: 'late' }), /正在关闭/);
  await assert.rejects(workflow.exclusive(cwd, async () => {}), /正在关闭/);
});

test('a queued Git cancellation is consumed without starting its hook or changing HEAD', async context => {
  const { cwd, fixture, workflow, input } = await repository(context);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started: () => void = () => {};
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = workflow.exclusive(cwd, () => { started(); return gate; }); await entered;
  const before = await gitRun(cwd, ['rev-parse', 'HEAD']);
  const queued = workflow.exclusive(cwd, () => workflow.action(cwd, input)).then(() => null, error => error as Error);
  workflow.cancel(cwd, 'commit'); release(); await held;
  assert.match((await queued)!.message, /Git 操作已取消/);
  assert.deepEqual(await fixture.pids(), []); assert.equal(await gitRun(cwd, ['rev-parse', 'HEAD']), before);
});

test('Git status cancellation also waits for configured filesystem monitor helpers', async context => {
  const { cwd, root, fixture } = await repository(context);
  await gitRun(cwd, ['config', 'core.fsmonitor', fixture.command]);
  const controller = new AbortController();
  const result = new GitService(root).status(cwd, controller.signal);
  const ids = await fixture.ready(); controller.abort();
  const status = await result;
  assert.equal(status.available, false); assert.match(status.error!, /Git 操作已取消/);
  assert.deepEqual(ids.filter(processAlive), []);
});

test('Git hunk actions stream patches through the managed process and preserve working files', async context => {
  const { cwd, root, workflow, input } = await repository(context);
  await gitRun(cwd, ['reset', '-q', 'HEAD', '--', 'file.txt']);
  const patch = diffHunks(await new GitService(root).diff(cwd, 'file.txt'))[0];
  await workflow.action(cwd, { ...input, requestId: 'stage-hunk', action: 'stageHunk', paths: [], patch });
  assert.equal(await gitRun(cwd, ['show', ':file.txt']), 'changed\n');
  await workflow.action(cwd, { ...input, requestId: 'unstage-hunk', action: 'unstageHunk', paths: [], patch });
  assert.equal(await gitRun(cwd, ['diff', '--cached', '--name-only']), '');
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'changed\n');
});
