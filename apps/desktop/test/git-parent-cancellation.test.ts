import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gitRun } from '../src/main/git.ts';
import { cancelGitProcesses, ownGitController } from '../src/main/git-process.ts';
import { processAlive, slowGitFixture } from './fixtures/git-process.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

test('a parent operation observes and retries termination failure inside a separately cancellable child', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-git-parent-')), slow = await slowGitFixture(root);
  const parent = new AbortController(), child = new AbortController(), release = ownGitController(child, parent.signal);
  let settled = false; const originalRoot = process.env.SystemRoot;
  const action = gitRun(root, ['-c', 'alias.pi-wait=!' + slow.command, 'pi-wait'], child.signal).then(() => '', error => String(error)).finally(() => { settled = true; });
  try {
    const ids = await slow.ready(); process.env.SystemRoot = join(root, 'missing-system');
    parent.abort(); await assert.rejects(cancelGitProcesses(parent.signal), /无法结束 Git 进程/);
    assert.equal(settled, false); assert.deepEqual(ids.filter(processAlive), ids);
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await cancelGitProcesses(parent.signal); assert.match(await action, /Git 操作已取消/); assert.deepEqual(ids.filter(processAlive), []);
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = originalRoot;
    await slow.cleanup(); await action; release();
  }
});

test('parent cancellation is inherited before child startup and releasing ownership disconnects future signals', () => {
  const parent = new AbortController(); parent.abort(); const child = new AbortController();
  const release = ownGitController(child, parent.signal); assert.equal(child.signal.aborted, true); release();
  const laterParent = new AbortController(), laterChild = new AbortController();
  ownGitController(laterChild, laterParent.signal)(); laterParent.abort(); assert.equal(laterChild.signal.aborted, false);
});
