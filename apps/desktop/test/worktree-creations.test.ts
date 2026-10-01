import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { gitProcess } from '../src/main/git-process.ts';
import { WorktreeCreations } from '../src/main/worktree-creations.ts';
import { managedWorktreeSchema } from '../src/shared/worktrees.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pi-creation-journal-')), repository = join(root, 'repository'), storage = join(root, 'storage');
  await mkdir(repository); await mkdir(storage); await gitRun(repository, ['init', '-b', 'main']);
  await gitRun(repository, ['config', 'user.name', 'Test']); await gitRun(repository, ['config', 'user.email', 'test@example.invalid']); await gitRun(repository, ['config', 'core.autocrlf', 'false']);
  await writeFile(join(repository, 'file.txt'), 'BASE'); await gitRun(repository, ['add', '--', '.']); await gitRun(repository, ['commit', '-m', 'base']);
  const git = new GitService(storage), service = new WorktreeCreations(storage, git);
  const create = () => service.create('owner', 'project', { id: 'directory', path: repository }, 'HEAD');
  return { repository, storage, git, service, create };
}

test('a completed checkout retains an independently readable intent until its task commits', async () => {
  const { repository, storage, service, create, git } = await fixture(), before = await readFile(join(repository, '.git/index'));
  const worktree = await create(); assert.deepEqual(await service.collect([]), []); service.release(worktree.id);
  await writeFile(join(worktree.path, 'external.txt'), 'EXTERNAL');
  const reopened = new WorktreeCreations(storage, git), issues = await reopened.collect([]);
  assert.equal(issues.length, 1); assert.equal(issues[0].canOpen, true); assert.equal(issues[0].path, worktree.path);
  assert.equal((await reopened.inspect(worktree.id)).threadId, 'owner'); assert.deepEqual(await readFile(join(repository, '.git/index')), before);
  assert.equal(await readFile(join(worktree.path, 'external.txt'), 'utf8'), 'EXTERNAL');
});

test('failed intent persistence cannot create a branch or checkout', async () => {
  const { repository, storage, create } = await fixture(), before = await gitRun(repository, ['branch', '--list']);
  await writeFile(join(storage, 'worktree-creations'), 'BLOCK'); await assert.rejects(create());
  assert.equal(await gitRun(repository, ['branch', '--list']), before); assert.deepEqual(await readdir(join(storage, 'worktrees')), []);
});

test('committed registration removes only the receipt and keeps files and original snapshots', async () => {
  const { service, create, storage } = await fixture(), worktree = await create(); service.release(worktree.id);
  const receipt = await service.inspect(worktree.id); await writeFile(join(worktree.path, 'external.txt'), 'KEEP');
  const managed = managedWorktreeSchema.parse({ ...worktree, threadId: 'new-owner', projectId: 'project', directoryId: 'directory', localPath: receipt.localPath, snapshotThreadId: receipt.threadId,
    localBaseline: 'tree', worktreeBaseline: 'tree', status: 'ready', createdAt: 1, lastUsedAt: 2 });
  assert.deepEqual(await service.collect([managed]), []); assert.deepEqual(await readdir(join(storage, 'worktree-creations')), []);
  assert.equal(await readFile(join(worktree.path, 'external.txt'), 'utf8'), 'KEEP');
});

test('replaced checkout identity is retained and refused instead of silently adopting another folder', async () => {
  const { service, create } = await fixture(), worktree = await create(); service.release(worktree.id);
  await rename(worktree.checkoutPath, worktree.checkoutPath + '-original'); await mkdir(worktree.checkoutPath); await writeFile(join(worktree.checkoutPath, 'external.txt'), 'KEEP');
  const issues = await service.collect([]); assert.equal(issues[0].canOpen, false); assert.match(issues[0].message, /身份发生变化/);
  await assert.rejects(service.inspect(worktree.id), /身份发生变化/); assert.equal(await readFile(join(worktree.path, 'external.txt'), 'utf8'), 'KEEP');
});

test('Git locks, live creation processes and changed branches block reopening without editing data', async () => {
  const { service, create, storage } = await fixture(), worktree = await create(); service.release(worktree.id);
  const gitDir = resolve(worktree.path, (await gitRun(worktree.path, ['rev-parse', '--git-dir'])).trim());
  await writeFile(join(gitDir, 'index.lock'), 'EXTERNAL_LOCK'); await assert.rejects(service.inspect(worktree.id), /Git 锁/); assert.equal(await readFile(join(gitDir, 'index.lock'), 'utf8'), 'EXTERNAL_LOCK'); await rm(join(gitDir, 'index.lock'));
  const receipt = await service.read(worktree.id), path = join(storage, 'worktree-creations', worktree.id + '.json');
  await writeFile(path, JSON.stringify({ ...receipt, phase: 'prepared', pid: process.pid })); await assert.rejects(service.inspect(worktree.id), /进程仍在运行/);
  await writeFile(path, JSON.stringify(receipt)); await gitRun(worktree.path, ['checkout', '-b', 'external']); await assert.rejects(service.inspect(worktree.id), /分支已变化/);
  assert.equal((await gitRun(worktree.path, ['branch', '--show-current'])).trim(), 'external');
});

test('invalid receipt paths and corrupted JSON remain visible without touching external files', async () => {
  const { service, create, storage, repository } = await fixture(), worktree = await create(); service.release(worktree.id);
  const path = join(storage, 'worktree-creations', worktree.id + '.json'), receipt = await service.read(worktree.id);
  await writeFile(path, JSON.stringify({ ...receipt, checkoutPath: repository })); assert.equal((await service.collect([]))[0].canOpen, false);
  assert.equal(await readFile(join(repository, 'file.txt'), 'utf8'), 'BASE');
  await writeFile(path, '{BROKEN'); const issues = await service.collect([]); assert.equal(issues.length, 1); assert.equal(issues[0].canOpen, false); assert.equal(await readFile(path, 'utf8'), '{BROKEN');
});

test('a dead launcher with no completed checkpoint cannot prove its Git descendants stopped', async () => {
  const { service, create, storage, repository } = await fixture(), worktree = await create(); service.release(worktree.id);
  let pid = 0; await gitProcess(repository, ['--version'], { onSpawn: value => { pid = value; } });
  const path = join(storage, 'worktree-creations', worktree.id + '.json'), receipt = await service.read(worktree.id);
  await writeFile(path, JSON.stringify({ ...receipt, phase: 'prepared', pid })); await gitRun(repository, ['worktree', 'remove', '--', worktree.checkoutPath]);
  const issues = await service.collect([]); assert.equal(issues.length, 1); assert.equal(issues[0].canOpen, false); assert.match(issues[0].message, /创建阶段无法确认/);
  assert.ok((await gitRun(repository, ['branch', '--list', worktree.branch])).trim()); await access(path);
});

test('a Git-complete receipt is adopted only after independent checkout proof', async () => {
  const { service, create, storage, git } = await fixture(), worktree = await create(); service.release(worktree.id);
  const path = join(storage, 'worktree-creations', worktree.id + '.json'), receipt = await service.read(worktree.id);
  await writeFile(path, JSON.stringify({ ...receipt, phase: 'git-complete', pid: undefined, ino: undefined, dev: undefined }));
  const reopened = new WorktreeCreations(storage, git), issues = await reopened.collect([]);
  assert.deepEqual(issues, [{ id: worktree.id, projectId: 'project', directoryId: 'directory', path: worktree.path, branch: worktree.branch, canOpen: true, message: 'Worktree 创建已中断，保留的文件可以重新打开。' }]);
  assert.equal((await reopened.inspect(worktree.id)).phase, 'checkout');
});

test('a Git-complete receipt with an unregistered partial directory remains retained', async () => {
  const { service, create, storage, git, repository } = await fixture(), worktree = await create(); service.release(worktree.id);
  const path = join(storage, 'worktree-creations', worktree.id + '.json'), receipt = await service.read(worktree.id);
  await gitRun(repository, ['worktree', 'remove', '--', worktree.checkoutPath]); await mkdir(worktree.checkoutPath); await writeFile(join(worktree.checkoutPath, 'partial.txt'), 'KEEP');
  await writeFile(path, JSON.stringify({ ...receipt, phase: 'git-complete', pid: undefined, ino: undefined, dev: undefined }));
  const issues = await new WorktreeCreations(storage, git).collect([]);
  assert.equal(issues[0].canOpen, false); assert.match(issues[0].message, /创建阶段无法确认/); assert.equal(await readFile(join(worktree.checkoutPath, 'partial.txt'), 'utf8'), 'KEEP');
});

test('a completed receipt without a checkout removes only its unchanged unused branch', async () => {
  const { service, create, storage, repository } = await fixture(), worktree = await create(); service.release(worktree.id);
  await gitRun(repository, ['worktree', 'remove', '--', worktree.checkoutPath]);
  assert.deepEqual(await service.collect([]), []); assert.equal((await gitRun(repository, ['branch', '--list', worktree.branch])).trim(), '');
  await assert.rejects(access(join(storage, 'worktree-creations', worktree.id + '.json')), { code: 'ENOENT' });
});

test('incomplete receipt writes stay visible and committed cleanup removes both owned receipt files', async () => {
  const { service, create, storage } = await fixture(), worktree = await create(); service.release(worktree.id);
  const path = join(storage, 'worktree-creations', worktree.id + '.json');
  await rename(path, path + '.tmp'); const issues = await service.collect([]); assert.equal(issues.length, 1); assert.equal(issues[0].canOpen, false);
  await writeFile(path, await readFile(path + '.tmp')); await service.finish(worktree.id);
  assert.deepEqual(await readdir(join(storage, 'worktree-creations')), []); await access(worktree.path);
});

test('a failed child identity checkpoint stops the Git invocation and reports the persistence failure', async () => {
  const { repository } = await fixture(); let pid = 0;
  await assert.rejects(gitProcess(repository, ['--version'], { onSpawn: value => { pid = value; throw new Error('PID_SAVE_FAILED'); } }), /PID_SAVE_FAILED/);
  assert.ok(pid > 0); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
