import assert from 'node:assert/strict';
import { access, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { gitRun } from '../src/main/git.ts';
import { WorktreeArchives } from '../src/main/worktree-archives.ts';
import { archiveFixture as fixture } from './fixtures/worktree-archive.ts';
const signal = () => new AbortController().signal;

test('interrupted directory reclamation can restore missing files without treating the damaged checkout as ready', async () => {
  const { record, archives } = await fixture();
  await writeFile(join(record.path, 'a.txt'), 'staged before removal'); await gitRun(record.path, ['add', '--', 'a.txt']);
  await writeFile(join(record.path, 'a.txt'), 'working before removal');
  await assert.rejects(archives.archive(record, signal(), stage => { if (stage === '回收已备份的 Worktree') throw new Error('simulated cleanup interruption'); }), /cleanup interruption/);
  const pending = record;
  // Reproduce the disk state after only one file has been removed, with Git metadata still present.
  await rm(join(pending.archiveRemoval?.path ?? record.checkoutPath, 'nested/a.txt'));
  await archives.recover([record]);
  assert.equal(record.status, 'archived', 'a partially removed checkout must not remain executable');
  await archives.restore(record, signal(), () => {});
  assert.equal(record.status, 'ready');
  assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'working before removal');
  assert.equal(await gitRun(record.path, ['show', ':nested/a.txt']), 'staged before removal');
});

for (const boundary of ['save', 'cancel'] as const) test('archive intent ' + boundary + ' failure keeps the complete original workspace usable', async () => {
  const { record, storage, snapshots } = await fixture(); const controller = new AbortController();
  const archives = new WorktreeArchives(storage, snapshots, async () => {
    if (record.archiveRemoval?.phase === 'prepared') {
      if (boundary === 'save') throw new Error('ARCHIVE_INTENT_EIO');
      controller.abort();
    }
  });
  await assert.rejects(archives.archive(record, controller.signal, () => {}));
  assert.equal(record.status, 'ready'); assert.equal(record.archiveRemoval, undefined);
  assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'base\r\n');
  await archives.recover([record]); assert.equal(record.status, 'ready');
  assert.deepEqual(await readdir(join(storage, 'worktree-reclamation')), []);
});

for (const collision of ['file', 'index', 'directory'] as const) test('archive cleanup preserves external ' + collision + ' changes and does not archive a restored checkout', async () => {
  const { record, archives } = await fixture();
  await assert.rejects(archives.archive(record, signal(), stage => { if (stage === '回收已备份的 Worktree') throw new Error('CLEANUP_PAUSED'); }), /CLEANUP_PAUSED/);
  const pending = record.archiveRemoval!; assert.ok(pending); const path = join(pending.path, 'external.txt');
  const indexPath = join(pending.gitDirectory, 'index'), index = await readFile(indexPath);
  if (collision === 'file') await writeFile(path, 'EXTERNAL_KEEP');
  if (collision === 'index') { await writeFile(path, 'EXTERNAL_KEEP'); await gitRun(pending.path, ['add', '--', 'external.txt']); }
  if (collision === 'directory') { await rename(pending.path, pending.path + '-saved'); await mkdir(pending.path); await writeFile(path, 'EXTERNAL_KEEP'); }
  await assert.rejects(archives.cleanup(record, signal(), () => {}), /外部变更|Git 状态|身份发生变化/);
  assert.equal(await readFile(path, 'utf8'), 'EXTERNAL_KEEP');
  if (collision === 'directory') {
    await rm(path); await rmdir(pending.path); await rename(pending.path + '-saved', pending.path);
  } else {
    await archives.restore(record, signal(), () => {}); assert.equal(record.status, 'ready');
    assert.equal(await readFile(path, 'utf8'), 'EXTERNAL_KEEP');
    await rm(path); if (collision === 'index') await writeFile(indexPath, index);
  }
  await archives.cleanup(record, signal(), () => {}); assert.equal(record.archiveRemoval, undefined);
  await assert.rejects(access(pending.path), { code: 'ENOENT' });
  if (collision !== 'directory') {
    assert.equal(record.status, 'ready'); assert.equal(await readFile(join(record.path, 'a.txt'), 'utf8'), 'base\r\n');
  }
});

for (const removed of ['pointer', 'metadata'] as const) test('archive cleanup can finish after partial removal of Git ' + removed, async () => {
  const { record, archives } = await fixture();
  await assert.rejects(archives.archive(record, signal(), stage => { if (stage === '回收已备份的 Worktree') throw new Error('CLEANUP_PAUSED'); }), /CLEANUP_PAUSED/);
  const pending = record.archiveRemoval!;
  if (removed === 'pointer') await rm(join(pending.path, '.git'));
  else await rm(pending.gitDirectory, { recursive: true });
  await archives.cleanup(record, signal(), () => {});
  assert.equal(record.archiveRemoval, undefined); assert.equal(record.status, 'archived');
  await assert.rejects(access(pending.path), { code: 'ENOENT' });
  await archives.restore(record, signal(), () => {}); assert.equal(record.status, 'ready');
});

