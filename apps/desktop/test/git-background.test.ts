import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { GitWorkflow } from '../src/main/git-workflow.ts';
import { GitReads, gitProcess, gitProcessProblems, onGitProcessProblems, ownGitController, retryGitProcessStop } from '../src/main/git-process.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

test('shutdown stops a real background status helper without an explicit request ID', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-background-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']);
  await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(cwd, 'file.txt'), 'baseline\n'); await gitRun(cwd, ['add', '--', 'file.txt']); await gitRun(cwd, ['commit', '-m', 'initial']);
  const slow = await slowGitFixture(root);
  const git = new GitService(root); const workflow = new GitWorkflow(git);
  context.after(() => workflow.dispose());
  await gitRun(cwd, ['config', 'core.fsmonitor', slow.command]);
  const status = git.status(cwd);
  try {
    const ids = await slow.ready();
    await workflow.dispose();
    assert.deepEqual(ids.filter(processAlive), [], 'Background helpers must not survive normal application shutdown');
    assert.equal((await status).available, false);
  } finally { await gitRun(cwd, ['config', 'core.fsmonitor', 'false']); await slow.cleanup(); await status; }
});

test('automatic Git timeout reports a failed stop, isolates its directory and blocks later commands until explicit recovery', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-background-')); const slow = await slowGitFixture(root);
  const reads = new GitReads(); const original = process.env.SystemRoot;
  let notifications = 0, settled = false;
  const unsubscribe = onGitProcessProblems(added => { if (added) notifications++; });
  const job = reads.run(async () => {
    await gitProcess(root, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], { timeoutMs: 1500 }).catch(() => {});
    return gitRun(root, ['--version']);
  }).then(() => '', error => String(error)).finally(() => { settled = true; });
  try {
    const ids = await slow.ready(); process.env.SystemRoot = join(root, 'missing-system');
    const deadline = Date.now() + 5000;
    while (!gitProcessProblems(root).length && Date.now() < deadline) await delay(20);
    const [problem] = gitProcessProblems(root); assert.ok(problem);
    assert.match(problem.reason, /Git 操作超时/); assert.equal(notifications, 1);
    assert.equal(settled, false); assert.deepEqual(ids.filter(processAlive), ids);
    assert.deepEqual(gitProcessProblems(join(root, 'other')), []);
    await assert.rejects(retryGitProcessStop(join(root, 'other'), problem.id), /不属于此目录/);
    await assert.rejects(retryGitProcessStop(root, problem.id), /无法结束 Git 进程/);
    assert.equal(notifications, 1, 'Retry must not create a new global warning');
    if (original === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = original;
    await Promise.all([retryGitProcessStop(root, problem.id), retryGitProcessStop(root, problem.id)]);
    assert.match(await job, /Git 操作超时/); assert.deepEqual(ids.filter(processAlive), []);
    assert.deepEqual(gitProcessProblems(root), []);
    assert.match(await reads.run(() => gitRun(root, ['--version'])), /git version/);
  } finally {
    if (original === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = original;
    unsubscribe(); await slow.cleanup(); await job;
  }
});

test('background shutdown reports termination failure for combined signals and can be retried without orphaning helpers', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-background-')); const slow = await slowGitFixture(root);
  const git = new GitService(root); const workflow = new GitWorkflow(git); const external = new AbortController();
  const original = process.env.SystemRoot;
  const job = git.reads.run(() => gitProcess(root, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], { signal: external.signal })).then(() => '', error => String(error));
  try {
    const ids = await slow.ready(); process.env.SystemRoot = join(root, 'missing-system');
    await assert.rejects(workflow.prepareShutdown(), /无法结束 Git 进程/);
    assert.deepEqual(ids.filter(processAlive), ids);
    assert.match(await git.reads.run(() => gitRun(root, ['--version'])), /git version/);
    if (original === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = original;
    await workflow.dispose(); assert.match(await job, /Git 操作已取消/);
    assert.deepEqual(ids.filter(processAlive), []); assert.deepEqual(gitProcessProblems(root), []);
  } finally {
    if (original === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = original;
    await slow.cleanup(); await job; await workflow.dispose();
  }
});

test('automatic timeout aborts the owner of a write chain before a caught error can start another Git command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-background-')); const slow = await slowGitFixture(root);
  const controller = new AbortController(); const release = ownGitController(controller);
  const job = gitProcess(root, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], { signal: controller.signal, timeoutMs: 1500 }).catch(error => error as Error);
  try {
    const ids = await slow.ready(); assert.match(String(await job), /Git 操作超时/);
    assert.equal(controller.signal.aborted, true); assert.deepEqual(ids.filter(processAlive), []);
    await assert.rejects(gitRun(root, ['--version'], controller.signal), { code: 'ABORT_ERR' });
  } finally { release(); await slow.cleanup(); await job; }
});
