import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { uiSchema } from '../src/shared/contracts.ts';
import { gitStatusLabel } from '../src/renderer/src/lib/git-status.ts';

test('Git status codes have readable labels, including untracked files', () => {
  assert.equal(gitStatusLabel('??'), '未跟踪');
  assert.equal(gitStatusLabel(' M'), '修改');
  assert.equal(gitStatusLabel('AM'), '新增');
  assert.equal(gitStatusLabel('R '), '重命名');
  assert.equal(gitStatusLabel('UU'), '冲突');
});

test('the changes panel is opt-in for a fresh workspace', () => {
  assert.equal(uiSchema.parse({}).reviewOpen, false);
});

test('status and diffs stay inside a project nested in a larger repository', async context => {
  const root = await mkdtemp(join(tmpdir(), 'pi-status-scope-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project 中文');
  await mkdir(project);
  await gitRun(root, ['init', '-b', 'main']);
  await gitRun(root, ['config', 'core.autocrlf', 'false']);
  await gitRun(root, ['config', 'user.name', 'Test']);
  await gitRun(root, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(project, 'file.txt'), 'original\n');
  await writeFile(join(project, 'rename.txt'), 'renamed content\n');
  await writeFile(join(root, 'outside.txt'), 'outside original\n');
  await gitRun(root, ['add', '--', 'project 中文', 'outside.txt']);
  await gitRun(root, ['commit', '-m', 'fixture']);
  await writeFile(join(project, 'file.txt'), 'modified\nextra\n');
  await writeFile(join(project, 'new 中文.txt'), 'new\n');
  await rename(join(project, 'rename.txt'), join(project, 'renamed 中文.txt'));
  await gitRun(project, ['add', '--', 'rename.txt', 'renamed 中文.txt']);
  await writeFile(join(root, 'outside.txt'), 'OUTSIDE_TRACKED\n');
  await writeFile(join(root, 'unrelated.txt'), 'OUTSIDE_UNTRACKED\n');
  const service = new GitService(join(root, '.recovery'));
  const status = await service.status(project);
  assert.equal(status.available, true);
  assert.deepEqual(status.files.map(file => file.path).sort(), ['file.txt', 'new 中文.txt', 'renamed 中文.txt'].sort());
  assert.equal(status.files.find(file => file.path === 'new 中文.txt')?.status, '??');
  assert.equal(status.files.find(file => file.path === 'renamed 中文.txt')?.staged, true);
  assert.deepEqual(status.stats, { added: 2, removed: 1 });
  const diff = await service.diff(project);
  assert.match(diff, /\+modified/);
  assert.match(diff, /new 中文.txt/);
  assert.doesNotMatch(diff, /OUTSIDE_|outside.txt|unrelated.txt/);
  assert.match(await service.diff(project, 'new 中文.txt'), /\+new/);
});
