import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { WorktreeArchives } from '../src/main/worktree-archives.ts';
import { archiveFixture } from './fixtures/worktree-archive.ts';

async function interruptedFixture(t: TestContext) {
  const fixture = await archiveFixture(); const { record, archives } = fixture;
  const expected = Buffer.from([0, 255, 128, 1, 2, 3, 4, 5]);
  const target = join(record.checkoutPath, 'large.bin');
  await fs.writeFile(target, expected); await archives.archive(record, new AbortController().signal, () => {});
  const write = fs.writeFile; let interrupted = false;
  fs.writeFile = async (path, data, options) => {
    if (!interrupted && Buffer.isBuffer(data) && data.equals(expected)) {
      interrupted = true; await write(path, data.subarray(0, 3), options); throw new Error('EIO partial restore write');
    }
    return write(path, data, options);
  };
  syncBuiltinESMExports();
  t.after(() => { fs.writeFile = write; syncBuiltinESMExports(); });
  await assert.rejects(archives.restore(record, new AbortController().signal, () => {}), /EIO partial restore write/);
  assert.equal(interrupted, true);
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
  fs.writeFile = write; syncBuiltinESMExports();
  return { ...fixture, target, expected, scratch: join(fixture.storage, 'worktree-restore-files', record.id) };
}

test('partial restore writes never publish a truncated working file and can be retried', async t => {
  const { record, archives, target, expected, scratch } = await interruptedFixture(t);
  await archives.restore(record, new AbortController().signal, () => {});
  assert.deepEqual(await fs.readFile(target), expected); assert.equal(record.status, 'ready');
  assert.equal(record.restoreFiles, undefined); await assert.rejects(fs.access(scratch), { code: 'ENOENT' });
});

for (const change of ['partial-bytes', 'unknown-file', 'directory'] as const) test('restore scratch recovery preserves external ' + change, async t => {
  const { record, archives, scratch } = await interruptedFixture(t);
  let external: string;
  if (change === 'partial-bytes') external = join(scratch, (await fs.readdir(scratch))[0]);
  else {
    if (change === 'directory') { await fs.rename(scratch, scratch + '-original'); await fs.mkdir(scratch); }
    external = join(scratch, 'external.txt');
  }
  await fs.writeFile(external, 'EXTERNAL_KEEP');
  await assert.rejects(archives.restore(record, new AbortController().signal, () => {}), /临时目录/);
  assert.equal(await fs.readFile(external, 'utf8'), 'EXTERNAL_KEEP'); assert.equal(record.status, 'archived');
});

test('restore publication refuses a concurrent destination without overwriting it', async t => {
  const { record, archives, target, expected } = await interruptedFixture(t);
  const link = fs.link;
  fs.link = async (source, destination) => {
    if (String(destination) === target) { fs.link = link; syncBuiltinESMExports(); await fs.writeFile(target, 'EXTERNAL_KEEP', { flag: 'wx' }); }
    return link(source, destination);
  };
  syncBuiltinESMExports(); t.after(() => { fs.link = link; syncBuiltinESMExports(); });
  await assert.rejects(archives.restore(record, new AbortController().signal, () => {}), /外部修改/);
  assert.equal(await fs.readFile(target, 'utf8'), 'EXTERNAL_KEEP');
  await fs.unlink(target); // Release only this test's concurrent writer fixture.
  await archives.restore(record, new AbortController().signal, () => {});
  assert.deepEqual(await fs.readFile(target), expected);
});

test('restore cancellation before file publication leaves no partial destination', async t => {
  const { record, archives, target, expected } = await interruptedFixture(t);
  const controller = new AbortController(), write = fs.writeFile;
  fs.writeFile = async (path, data, options) => {
    await write(path, data, options);
    if (Buffer.isBuffer(data) && data.equals(expected)) controller.abort();
  };
  syncBuiltinESMExports(); t.after(() => { fs.writeFile = write; syncBuiltinESMExports(); });
  await assert.rejects(archives.restore(record, controller.signal, () => {}), { name: 'AbortError' });
  await assert.rejects(fs.access(target), { code: 'ENOENT' });
  fs.writeFile = write; syncBuiltinESMExports();
  await archives.restore(record, new AbortController().signal, () => {});
  assert.deepEqual(await fs.readFile(target), expected);
});

test('missing restore scratch data is regenerated from the archive without replacing published files', async t => {
  const { record, archives, scratch, target, expected } = await interruptedFixture(t);
  const published = join(record.checkoutPath, '.gitignore'), before = await fs.lstat(published, { bigint: true });
  for (const name of await fs.readdir(scratch)) await fs.unlink(join(scratch, name));
  await fs.rmdir(scratch); // Simulate removal of this fixture's incomplete, regenerable scratch data.
  await archives.restore(record, new AbortController().signal, () => {});
  assert.deepEqual(await fs.readFile(target), expected); assert.equal((await fs.lstat(published, { bigint: true })).ino, before.ino);
});

test('scratch receipt save failure does not write files and remains retryable', async () => {
  const { record, storage, snapshots, archives } = await archiveFixture(); await archives.archive(record, new AbortController().signal, () => {});
  let failed = false;
  const failing = new WorktreeArchives(storage, snapshots, async () => {
    if (record.restoreFiles && !failed) { failed = true; throw new Error('RESTORE_SCRATCH_SAVE_FAILURE'); }
  });
  await assert.rejects(failing.restore(record, new AbortController().signal, () => {}), /RESTORE_SCRATCH_SAVE_FAILURE/);
  assert.equal(record.restoreFiles, undefined); await assert.rejects(fs.access(join(record.checkoutPath, '.gitignore')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(join(storage, 'worktree-restore-files')), []);
  await archives.restore(record, new AbortController().signal, () => {}); assert.equal(record.status, 'ready');
});

for (const retry of ['manual', 'startup'] as const) test('successful restoration exposes scratch cleanup failures and supports ' + retry + ' retry', async t => {
  const { record, archives, scratch, target, expected } = await interruptedFixture(t);
  const rmdir = fs.rmdir;
  fs.rmdir = async (path, options) => {
    if (String(path) === scratch) { fs.rmdir = rmdir; syncBuiltinESMExports(); throw new Error('EACCES recovery scratch directory'); }
    return rmdir(path, options);
  };
  syncBuiltinESMExports(); t.after(() => { fs.rmdir = rmdir; syncBuiltinESMExports(); });
  await archives.restore(record, new AbortController().signal, () => {});
  assert.equal(record.status, 'ready'); assert.ok(record.restoreFiles); assert.match(record.cleanupError!, /临时数据清理失败/);
  if (retry === 'manual') await archives.cleanup(record, new AbortController().signal, () => {});
  else await archives.recover([record]);
  assert.equal(record.restoreFiles, undefined); assert.equal(record.cleanupError, undefined);
  await assert.rejects(fs.access(scratch), { code: 'ENOENT' }); assert.deepEqual(await fs.readFile(target), expected);
});
