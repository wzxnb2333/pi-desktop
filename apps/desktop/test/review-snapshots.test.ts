import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { currentReviewVersion, ReviewSnapshots } from '../src/main/review-snapshots.ts';
import { validateReviewSubmission } from '../src/shared/reviews.ts';

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'pi-review-'));
  context.after(async () => { await rm(root, { recursive: true, force: true }); await assert.rejects(readFile(join(root, 'marker')), { code: 'ENOENT' }); });
  const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']);
  await gitRun(cwd, ['config', 'core.autocrlf', 'false']);
  await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(cwd, 'code.ts'), 'export const value = 1;\n');
  await gitRun(cwd, ['add', '--', 'code.ts']); await gitRun(cwd, ['commit', '-m', 'initial']);
  const snapshots = new ReviewSnapshots(new GitService(root), root);
  const capture = (scope: 'uncommitted' | 'branch' | 'commit', ref = '') => snapshots.capture(cwd, crypto.randomUUID(), scope, ref, new AbortController().signal);
  return { root, cwd, snapshots, capture };
}
test('review captures staged, unstaged and untracked files without changing the real index', async context => {
  const { cwd, snapshots } = await fixture(context);
  await writeFile(join(cwd, 'code.ts'), 'export const value = 2;\n'); await gitRun(cwd, ['add', '--', 'code.ts']);
  await writeFile(join(cwd, 'code.ts'), 'export const value = 3;\n'); await writeFile(join(cwd, '新文件.txt'), 'new\n');
  const before = await readFile(join(cwd, '.git', 'index'));
  const id = crypto.randomUUID();
  const result = await snapshots.capture(cwd, id, 'uncommitted', '', new AbortController().signal);
  assert.match(result.diff, /value = 3/); assert.match(result.diff, /新文件/);
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), before);
  assert.equal((await snapshots.file(id, 'code.ts')).content, 'export const value = 3;\n');
  await writeFile(join(cwd, 'code.ts'), 'concurrent external change\n');
  assert.equal((await snapshots.inspect(cwd, result.files)).find(file => file.path === 'code.ts')?.stale, true);
  assert.equal((await snapshots.file(id, 'code.ts')).content, 'export const value = 3;\n');
  await assert.rejects(snapshots.file(id, '../outside.txt'), /不属于/);
  await snapshots.remove(id); await assert.rejects(snapshots.file(id, 'code.ts'), { code: 'ENOENT' });
});
test('branch and commit scopes use immutable Git versions, including root commits and nested project boundaries', async context => {
  const { cwd, capture, snapshots } = await fixture(context);
  const original = (await gitRun(cwd, ['rev-parse', 'HEAD'])).trim();
  const rootCommit = await capture('commit', original); assert.equal(rootCommit.base, ''); assert.match(rootCommit.diff, /value = 1/);
  await gitRun(cwd, ['switch', '-c', 'feature']);
  await writeFile(join(cwd, 'code.ts'), 'export const value = 4;\n');
  await mkdir(join(cwd, 'nested')); await writeFile(join(cwd, 'nested', 'inside.txt'), 'inside\n');
  await gitRun(cwd, ['add', '--', 'code.ts', 'nested']); await gitRun(cwd, ['commit', '-m', 'feature']);
  await writeFile(join(cwd, 'code.ts'), 'DIRTY MUST NOT ENTER COMMIT REVIEW\n');
  const branch = await capture('branch', 'main'); const commit = await capture('commit', 'HEAD');
  assert.equal(branch.base, original); assert.equal(branch.diff, commit.diff); assert.doesNotMatch(branch.diff, /DIRTY/);
  const nested = await snapshots.capture(join(cwd, 'nested'), crypto.randomUUID(), 'commit', 'HEAD', new AbortController().signal);
  assert.deepEqual(nested.files.map(file => file.path), ['inside.txt']); assert.doesNotMatch(nested.diff, /code.ts/);
  await assert.rejects(capture('commit', '--help'), /有效/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(snapshots.capture(cwd, crypto.randomUUID(), 'uncommitted', '', controller.signal));
});
test('review validates finding locations and marks deleted files without inventing current line locations', async context => {
  const { cwd, capture } = await fixture(context);
  await rm(join(cwd, 'code.ts'));
  const result = await capture('uncommitted'); assert.equal(result.files[0].deleted, true);
  assert.equal(await currentReviewVersion(cwd, 'code.ts'), 'missing');
  const valid = { summary: 'review', findings: [{ priority: 1, title: 'Missing export', body: 'Consumers break', path: 'code.ts', line: 1, endLine: 1 }] };
  assert.equal(validateReviewSubmission(valid, result.files).findings.length, 1);
  assert.throws(() => validateReviewSubmission({ ...valid, findings: [{ ...valid.findings[0], path: '../outside.txt' }] }, result.files), /范围/);
  assert.throws(() => validateReviewSubmission({ ...valid, findings: [{ ...valid.findings[0], line: 99, endLine: 99 }] }, result.files), /范围/);
  assert.equal(validateReviewSubmission({ summary: 'No issues', findings: [] }, result.files).findings.length, 0);
});

test('read-only review never executes repository filters or filesystem-monitor hooks', async context => {
  const { cwd, capture } = await fixture(context);
  await writeFile(join(cwd, '.gitattributes'), '* filter=unsafe\n'); await gitRun(cwd, ['add', '--', '.gitattributes']); await gitRun(cwd, ['commit', '-m', 'attributes']);
  await gitRun(cwd, ['config', 'filter.unsafe.clean', 'echo FILTER_EXECUTED > marker.txt']);
  await gitRun(cwd, ['config', 'filter.unsafe.process', 'echo FILTER_EXECUTED > marker.txt']);
  await gitRun(cwd, ['config', 'filter.unsafe.required', 'true']);
  await gitRun(cwd, ['config', 'core.fsmonitor', 'echo MONITOR_EXECUTED > monitor.txt']);
  await writeFile(join(cwd, 'code.ts'), 'changed without running filters\n'); await writeFile(join(cwd, 'new.txt'), 'untracked');
  const index = await readFile(join(cwd, '.git', 'index'));
  assert.match((await capture('uncommitted')).diff, /changed without running filters/);
  await assert.rejects(readFile(join(cwd, 'marker.txt')), { code: 'ENOENT' }); await assert.rejects(readFile(join(cwd, 'monitor.txt')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
});
