import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { GitWorkflow } from '../src/main/git-workflow.ts';
import { requestSchema } from '../src/shared/contracts.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function runningCommit(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-cancel-retry-'));
  const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']);
  await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(cwd, 'file.txt'), 'old\n'); await gitRun(cwd, ['add', '--', 'file.txt']); await gitRun(cwd, ['commit', '-m', 'initial']);
  await writeFile(join(cwd, 'file.txt'), 'new\n'); await gitRun(cwd, ['add', '--', 'file.txt']);
  const slow = await slowGitFixture(root); const hooks = join(root, 'hooks'); await mkdir(hooks);
  await writeFile(join(hooks, 'pre-commit'), '#!/bin/sh\nexec ' + slow.command + '\n', { mode: 0o755 });
  await gitRun(cwd, ['config', 'core.hooksPath', hooks]);
  const workflow = new GitWorkflow(new GitService(root)); context.after(() => workflow.dispose());
  const request = requestSchema.parse({ op: 'git.action', threadId: 't', requestId: 'retry', action: 'commitStaged', paths: ['file.txt'], value: 'pending' });
  if (request.op !== 'git.action') throw new Error('Unexpected request');
  return { root, cwd, slow, workflow, request };
}

test('failed Windows Git termination reaches the caller and a second cancellation stops the same owned process', { skip: process.platform !== 'win32' }, async context => {
  const { root, cwd, slow, workflow, request } = await runningCommit(context);
  let settled = false;
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)).then(() => '', error => String(error)).finally(() => { settled = true; });
  const originalRoot = process.env.SystemRoot;
  try {
    const ids = await slow.ready(); const index = await readFile(join(cwd, '.git', 'index'));
    // Only this test runner's environment changes. The real OS launch must fail.
    process.env.SystemRoot = join(root, 'missing-system');
    await assert.rejects(Promise.resolve(workflow.cancel(cwd, request.requestId!)), /无法结束 Git 进程/);
    assert.equal(settled, false); assert.deepEqual(ids.filter(processAlive), ids);
    assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await workflow.cancel(cwd, request.requestId!);
    assert.match(await action, /Git 操作已取消/); assert.deepEqual(ids.filter(processAlive), []);
    assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await slow.cleanup(); await action;
  }
});

test('failed Windows Git shutdown preserves the repository lock and allows a later shutdown retry', { skip: process.platform !== 'win32' }, async context => {
  const { root, cwd, slow, workflow, request } = await runningCommit(context);
  const action = workflow.exclusive(cwd, () => workflow.action(cwd, request)).then(() => '', error => String(error));
  const originalRoot = process.env.SystemRoot;
  let queued = false;
  let next: Promise<string> | undefined;
  try {
    const ids = await slow.ready(); const index = await readFile(join(cwd, '.git', 'index'));
    next = workflow.exclusive(cwd, async () => { queued = true; return 'should not run'; }).catch(error => String(error));
    process.env.SystemRoot = join(root, 'missing-system');
    await assert.rejects(workflow.dispose(), /无法结束 Git 进程/);
    assert.deepEqual(ids.filter(processAlive), ids); assert.equal(queued, false);
    // Returning to the application leaves unrelated repositories operational.
    assert.equal(await workflow.exclusive(root, async () => 'usable'), 'usable');
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await workflow.dispose();
    assert.match(await action, /Git 操作已取消/); assert.match(await next, /应用正在关闭/);
    assert.equal(queued, false); assert.deepEqual(ids.filter(processAlive), []);
    assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await slow.cleanup(); await action; await next;
  }
});
