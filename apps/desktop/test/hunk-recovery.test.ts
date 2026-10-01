import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { access, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { GitService, gitRun } from '../src/main/git.ts';
import { HunkRecovery } from '../src/main/hunk-recovery.ts';
import { readProjectFile } from '../src/main/files.ts';
import { diffHunks, reverseTextHunk } from '../src/shared/git-patches.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup(context: TestContext, original: string) {
  const root = await mkdtemp(join(tmpdir(), 'pi-hunk-'));
  context.after(async () => { await rm(root, { recursive: true, force: true }); await assert.rejects(access(root), { code: 'ENOENT' }); });
  const cwd = join(root, 'project'); await mkdir(cwd);
  await gitRun(cwd, ['init', '-b', 'main']); await gitRun(cwd, ['config', 'core.autocrlf', 'false']);
  await gitRun(cwd, ['config', 'user.name', 'Test']); await gitRun(cwd, ['config', 'user.email', 'test@example.invalid']);
  await writeFile(join(cwd, 'file.txt'), original); await gitRun(cwd, ['add', '--', 'file.txt']); await gitRun(cwd, ['commit', '-m', 'initial']);
  const git = new GitService(root); const recovery = new HunkRecovery(git, root);
  return { root, cwd, git, recovery };
}
test('revert restores only the selected hunk, preserves the index, and can restore its exact recovery copy after restart', async context => {
  const original = Array.from({ length: 25 }, (_, index) => 'line ' + index).join('\r\n') + '\r\n';
  const { root, cwd, git, recovery } = await setup(context, original);
  const changed = original.replace('line 1\r\n', 'first changed\r\n').replace('line 20\r\n', 'second changed\r\n');
  await writeFile(join(cwd, 'file.txt'), changed);
  const patches = diffHunks(await git.diff(cwd, 'file.txt')); assert.equal(patches.length, 2);
  const beforeIndex = await readFile(join(cwd, '.git', 'index'));
  const version = (await readProjectFile(cwd, 'file.txt')).version!;
  const record = await recovery.revert(cwd, 'file.txt', patches[0], version, 'all');
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), original.replace('line 20\r\n', 'second changed\r\n'));
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), beforeIndex);
  const restarted = new HunkRecovery(git, root); assert.equal((await restarted.list(cwd)).records[0].id, record.id);
  await restarted.restore(cwd, record.id); assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), changed);
  assert.equal((await restarted.list(cwd)).records[0].state, 'restored'); await assert.rejects(restarted.restore(cwd, record.id), /已经应用/);
});
test('stale versions, forged patches, corrupted backups and edits after revert are rejected without overwriting files', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n'); await writeFile(join(cwd, 'file.txt'), 'new\n');
  const patch = diffHunks(await git.diff(cwd, 'file.txt'))[0]; const version = (await readProjectFile(cwd, 'file.txt')).version!;
  await assert.rejects(recovery.revert(cwd, 'file.txt', patch, 'stale', 'all'), /变化/);
  await assert.rejects(recovery.revert(cwd, 'file.txt', patch.replace('a/file.txt', 'a/other.txt'), version, 'all'), /差异已变化/);
  const record = await recovery.revert(cwd, 'file.txt', patch, version, 'all');
  await writeFile(join(cwd, 'file.txt'), 'external\n'); await assert.rejects(recovery.restore(cwd, record.id), /其他程序/);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'external\n');
  await writeFile(join(root, 'recovery', 'hunks', record.id, 'original'), 'tampered');
  await assert.rejects(recovery.restore(cwd, record.id), /校验失败/);
  assert.match((await recovery.list(cwd)).records[0].error!, /校验失败/);
});
test('reverse hunks preserve missing final newline, insertions, deletions, BOM and UTF-8 text', async context => {
  const original = '\ufeff中文\nsecond\nlast'; const { cwd, git } = await setup(context, original);
  for (const changed of ['\ufeff中文\ninserted\nsecond\nlast', '\ufeff中文\nlast', '\ufeff中文\nsecond\nmodified\n']) {
    await writeFile(join(cwd, 'file.txt'), changed);
    let text = changed;
    for (const patch of diffHunks(await git.diff(cwd, 'file.txt')).reverse()) text = reverseTextHunk(text, patch);
    assert.equal(text, original);
  }
});

test('added and deleted text hunks restore file existence in both directions', async context => {
  const { cwd, git, recovery } = await setup(context, 'original content\n');
  await writeFile(join(cwd, 'new.txt'), 'new file\n');
  const added = await recovery.revert(cwd, 'new.txt', diffHunks(await git.diff(cwd, 'new.txt'))[0], await recovery.currentVersion(cwd, 'new.txt'), 'all');
  await assert.rejects(access(join(cwd, 'new.txt')), { code: 'ENOENT' });
  await recovery.restore(cwd, added.id); assert.equal(await readFile(join(cwd, 'new.txt'), 'utf8'), 'new file\n');
  await rm(join(cwd, 'file.txt'));
  const deleted = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], 'missing', 'all');
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'original content\n');
  await recovery.restore(cwd, deleted.id); await assert.rejects(access(join(cwd, 'file.txt')), { code: 'ENOENT' });
});

test('recovery state write failures leave the working file intact and can retry after restart', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  const directory = join(root, 'recovery', 'hunks', record.id);
  const before = await readFile(join(directory, 'record.json'), 'utf8');
  const blocked = join(directory, 'record.json.tmp'); await mkdir(blocked);
  await assert.rejects(recovery.restore(cwd, record.id), /EISDIR|EPERM|EACCES/);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'old\n');
  assert.equal(await readFile(join(directory, 'record.json'), 'utf8'), before);
  await rm(blocked, { recursive: true });
  const restarted = new HunkRecovery(git, root);
  await restarted.restore(cwd, record.id);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
});

function failReceipt(context: TestContext, state: 'applied' | 'restored') {
  const write = fs.writeFile;
  return context.mock.method(fs, 'writeFile', async (...[path, data, options]: Parameters<typeof fs.writeFile>) => {
    if (String(path).endsWith('record.json.tmp') && typeof data === 'string' && JSON.parse(data).state === state) {
      await write(path, '{interrupted', options);
      throw Object.assign(new Error('ENOSPC during recovery receipt'), { code: 'ENOSPC' });
    }
    return write(path, data, options);
  });
}
test('a partial revert receipt cannot corrupt the recovery journal or prevent restoring after restart', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const index = await readFile(join(cwd, '.git', 'index'));
  const fault = failReceipt(context, 'applied');
  await assert.rejects(recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all'), /已撤销.*状态保存失败/);
  fault.mock.restore();
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'old\n');
  const restarted = new HunkRecovery(git, root);
  const { records, errors } = await restarted.list(cwd);
  assert.deepEqual(errors, []); assert.equal(records.length, 1); assert.equal(records[0].state, 'applied');
  const directory = join(root, 'recovery', 'hunks', records[0].id);
  assert.equal(JSON.parse(await readFile(join(directory, 'record.json'), 'utf8')).state, 'prepared');
  assert.equal(await readFile(join(directory, 'record.json.tmp'), 'utf8'), '{interrupted');
  await restarted.restore(cwd, records[0].id);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
  await assert.rejects(access(join(directory, 'record.json.tmp')), { code: 'ENOENT' });
  assert.deepEqual(await readFile(join(cwd, '.git', 'index')), index);
});

test('an interrupted restore receipt is recognized after restart and retry does not write the file again', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  const fault = failReceipt(context, 'restored');
  await assert.rejects(recovery.restore(cwd, record.id), /文件已恢复.*状态保存失败/); fault.mock.restore();
  const target = join(root, 'recovery', 'hunks', record.id, 'record.json');
  assert.equal(JSON.parse(await readFile(target, 'utf8')).state, 'restoring');
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
  const before = await stat(join(cwd, 'file.txt'));
  const restarted = new HunkRecovery(git, root);
  assert.equal((await restarted.list(cwd)).records[0].state, 'restored');
  assert.equal((await restarted.list(cwd)).records[0].receiptPending, true);
  // Listing is read-only; retry only settles the interrupted journal receipt.
  assert.equal(JSON.parse(await readFile(target, 'utf8')).state, 'restoring');
  await restarted.restore(cwd, record.id);
  assert.equal((await stat(join(cwd, 'file.txt'))).mtimeMs, before.mtimeMs);
  assert.equal(JSON.parse(await readFile(target, 'utf8')).state, 'restored');
});

test('prepared and restoring journals distinguish interrupted operations without replacing external edits', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  const target = join(root, 'recovery', 'hunks', record.id, 'record.json');
  await writeFile(target, JSON.stringify({ ...record, state: 'prepared' }));
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const restarted = new HunkRecovery(git, root);
  assert.equal((await restarted.list(cwd)).records[0].state, 'unapplied');
  await assert.rejects(restarted.restore(cwd, record.id), /尚未执行/);
  await writeFile(target, JSON.stringify({ ...record, state: 'restoring' }));
  await writeFile(join(cwd, 'file.txt'), 'external\n');
  assert.match((await restarted.list(cwd)).records[0].error!, /其他程序/);
  await assert.rejects(restarted.restore(cwd, record.id), /其他程序/);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'external\n');
  await writeFile(join(cwd, 'file.txt'), 'old\n');
  assert.equal((await restarted.list(cwd)).records[0].state, 'applied');
  await restarted.restore(cwd, record.id);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
});

test('broken records are reported independently and cannot hide valid recovery copies', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  const records = join(root, 'recovery', 'hunks');
  const broken = crypto.randomUUID(); await mkdir(join(records, broken)); await writeFile(join(records, broken, 'record.json'), '{');
  const missing = crypto.randomUUID(); await mkdir(join(records, missing)); await writeFile(join(records, missing, 'original'), 'keep this backup');
  const mismatch = crypto.randomUUID(); await mkdir(join(records, mismatch)); await writeFile(join(records, mismatch, 'record.json'), JSON.stringify(record));
  await mkdir(join(records, '.pending-' + crypto.randomUUID()));
  const result = await recovery.list(cwd);
  assert.deepEqual(result.records.map(item => item.id), [record.id]);
  assert.deepEqual(result.errors.map(item => item.id).sort(), [broken, missing, mismatch].sort());
  assert.equal(await readFile(join(records, missing, 'original'), 'utf8'), 'keep this backup');
  await recovery.restore(cwd, record.id);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
  assert.deepEqual((await recovery.list(join(root, 'different-project'))).records, []);
  await assert.rejects(recovery.restore(join(root, 'different-project'), record.id), /不属于/);
});

test('failed recovery preparation never publishes an incomplete backup or modifies the working file', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const blocked = join(root, 'recovery', 'hunks'); await mkdir(join(root, 'recovery')); await writeFile(blocked, 'occupied');
  await assert.rejects(recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all'), /EEXIST|ENOTDIR/);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
  await rm(blocked);
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  assert.deepEqual(await readdir(blocked), [record.id]);
});

test('an external edit between restore intent and replacement remains intact and retry requires the captured version', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'file.txt'), 'new\n');
  const record = await recovery.revert(cwd, 'file.txt', diffHunks(await git.diff(cwd, 'file.txt'))[0], await recovery.currentVersion(cwd, 'file.txt'), 'all');
  const rename = fs.rename;
  const fault = context.mock.method(fs, 'rename', async (...[from, to]: Parameters<typeof fs.rename>) => {
    await rename(from, to);
    if (String(to).endsWith('record.json') && JSON.parse(await readFile(to, 'utf8')).state === 'restoring') await writeFile(join(cwd, 'file.txt'), 'external\n');
  });
  await assert.rejects(recovery.restore(cwd, record.id), /其他程序/); fault.mock.restore();
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'external\n');
  const restarted = new HunkRecovery(git, root);
  await assert.rejects(restarted.restore(cwd, record.id), /其他程序/);
  await writeFile(join(cwd, 'file.txt'), 'old\n'); await restarted.restore(cwd, record.id);
  assert.equal(await readFile(join(cwd, 'file.txt'), 'utf8'), 'new\n');
});

test('interrupted restore receipts preserve added and deleted file existence without replaying writes', async context => {
  const { root, cwd, git, recovery } = await setup(context, 'old\n');
  await writeFile(join(cwd, 'new.txt'), 'new file\n'); await rm(join(cwd, 'file.txt'));
  for (const path of ['new.txt', 'file.txt']) {
    const record = await recovery.revert(cwd, path, diffHunks(await git.diff(cwd, path))[0], await recovery.currentVersion(cwd, path), 'all');
    const fault = failReceipt(context, 'restored');
    await assert.rejects(recovery.restore(cwd, record.id), /文件已恢复.*状态保存失败/); fault.mock.restore();
    const restarted = new HunkRecovery(git, root);
    const listing = await restarted.list(cwd, path);
    assert.equal(listing.records.length, 1); assert.equal(listing.records[0].receiptPending, true);
    if (path === 'new.txt') assert.equal(await readFile(join(cwd, path), 'utf8'), 'new file\n');
    else await assert.rejects(access(join(cwd, path)), { code: 'ENOENT' });
    await restarted.restore(cwd, record.id);
    assert.equal((await restarted.list(cwd, path)).records[0].state, 'restored');
    if (path === 'new.txt') assert.equal(await readFile(join(cwd, path), 'utf8'), 'new file\n');
    else await assert.rejects(access(join(cwd, path)), { code: 'ENOENT' });
  }
});
