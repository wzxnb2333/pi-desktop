import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { gitRun } from '../src/main/git.ts';
import { prepareRestoreIndex } from '../src/main/worktree-restore-index.ts';
import { archiveFixture } from './fixtures/worktree-archive.ts';

async function indexFixture() {
  const fixture = await archiveFixture();
  const { record } = fixture;
  record.archiveIndex = (await gitRun(record.checkoutPath, ['write-tree'])).trim();
  const index = resolve(record.checkoutPath, (await gitRun(record.checkoutPath, ['rev-parse', '--git-path', 'index'])).trim());
  const bytes = await fs.readFile(index), ino = (await fs.lstat(index, { bigint: true })).ino;
  const prepare = (signal = new AbortController().signal, save = async () => {}) => prepareRestoreIndex(record.checkoutPath, record, signal, save);
  const verify = async () => {
    assert.deepEqual(await fs.readFile(index), bytes); assert.equal((await fs.lstat(index, { bigint: true })).ino, ino);
    assert.equal(record.restoreIndexPreparation, undefined);
    assert.deepEqual((await fs.readdir(dirname(index))).filter(name => name.includes('.pi-prepare-') || name.includes('.pi-restore-') || name === 'index.lock'), []);
  };
  return { ...fixture, index, bytes, prepare, verify, scratch: index + '.pi-prepare-' + record.id };
}
async function interruptedFixture(t: TestContext) {
  const fixture = await indexFixture(); const open = fs.open;
  fs.open = async (path, flags, mode) => {
    if (String(path).includes('.pi-prepare-')) { fs.open = open; syncBuiltinESMExports(); throw new Error('INDEX_PREPARATION_DISK_FAILURE'); }
    return open(path, flags, mode);
  };
  syncBuiltinESMExports(); t.after(() => { fs.open = open; syncBuiltinESMExports(); });
  await assert.rejects(fixture.prepare(), /INDEX_PREPARATION_DISK_FAILURE/);
  assert.ok(fixture.record.restoreIndexPreparation);
  const temporary = join(fixture.scratch, (await fs.readdir(fixture.scratch))[0]);
  return { ...fixture, temporary };
}

test('index preparation retries partial private lock files without touching the actual index', async t => {
  const { prepare, temporary, verify } = await interruptedFixture(t);
  const bytes = await fs.readFile(temporary); await fs.writeFile(temporary, bytes.subarray(0, 16));
  await fs.rename(temporary, temporary + '.lock');
  const restored = await prepare(); await restored.publish(async () => {}); await restored.finish(); await verify();
});

test('index preparation cancellation retains recoverable output and clears it on retry', async t => {
  const { prepare, verify, record } = await indexFixture();
  const controller = new AbortController(), open = fs.open;
  fs.open = async (path, flags, mode) => {
    const handle = await open(path, flags, mode);
    if (String(path).includes('.pi-prepare-')) controller.abort();
    return handle;
  };
  syncBuiltinESMExports(); t.after(() => { fs.open = open; syncBuiltinESMExports(); });
  await assert.rejects(prepare(controller.signal), { name: 'AbortError' }); assert.ok(record.restoreIndexPreparation);
  fs.open = open; syncBuiltinESMExports();
  const restored = await prepare(); await restored.finish(); await verify();
});

for (const change of ['contents', 'unknown-file', 'directory'] as const) test('index preparation preserves external ' + change, async t => {
  const { prepare, temporary, scratch, index, bytes } = await interruptedFixture(t);
  let external = temporary;
  if (change !== 'contents') {
    if (change === 'directory') { await fs.rename(scratch, scratch + '-original'); await fs.mkdir(scratch); }
    external = join(scratch, 'external.txt');
  }
  await fs.writeFile(external, 'EXTERNAL_KEEP');
  const entries = await fs.readdir(scratch);
  await assert.rejects(prepare(), /索引准备目录/);
  assert.equal(await fs.readFile(external, 'utf8'), 'EXTERNAL_KEEP');
  assert.deepEqual(await fs.readFile(index), bytes); assert.deepEqual(await fs.readdir(scratch), entries);
});

for (const phase of ['begin', 'finish'] as const) test('index preparation receipt save failure at ' + phase + ' can be retried', async () => {
  const { prepare, record, verify, index, bytes } = await indexFixture(); let failed = false;
  await assert.rejects(prepare(new AbortController().signal, async () => {
    if (!failed && (phase === 'begin' ? !!record.restoreIndexPreparation : !record.restoreIndexPreparation)) {
      failed = true; throw new Error('INDEX_RECEIPT_SAVE_FAILURE');
    }
  }), /INDEX_RECEIPT_SAVE_FAILURE/);
  assert.deepEqual(await fs.readFile(index), bytes);
  const restored = await prepare(); await restored.finish(); await verify();
});

test('failed Git preparation without output does not retain empty scratch directories', async () => {
  const { record, prepare, verify } = await indexFixture(); const tree = record.archiveIndex;
  record.archiveIndex = 'invalid-archive-tree'; await assert.rejects(prepare());
  assert.equal(record.restoreIndexPreparation, undefined); await verify(); record.archiveIndex = tree;
  const restored = await prepare(); await restored.finish(); await verify();
});

test('index preparation cleanup failure stays visible and does not affect the original index', async t => {
  const { prepare, verify, index, bytes } = await indexFixture(); const unlink = fs.unlink; let failed = false;
  fs.unlink = async path => {
    if (String(path).includes('.pi-prepare-') && !failed) { failed = true; throw new Error('INDEX_CLEANUP_LOCKED'); }
    return unlink(path);
  };
  syncBuiltinESMExports(); t.after(() => { fs.unlink = unlink; syncBuiltinESMExports(); });
  await assert.rejects(prepare(), /INDEX_CLEANUP_LOCKED/); assert.deepEqual(await fs.readFile(index), bytes);
  fs.unlink = unlink; syncBuiltinESMExports();
  const restored = await prepare(); await restored.finish(); await verify();
});

test('index preparation does not overwrite a foreign canonical receipt', async () => {
  const { record, prepare, index, bytes, scratch } = await indexFixture();
  const receipt = index + '.pi-restore-' + record.id; await fs.writeFile(receipt, 'FOREIGN_RECEIPT', { flag: 'wx' });
  await assert.rejects(prepare(), /恢复凭据发生变化/);
  assert.equal(await fs.readFile(receipt, 'utf8'), 'FOREIGN_RECEIPT'); assert.deepEqual(await fs.readFile(index), bytes);
  await assert.rejects(fs.access(scratch), { code: 'ENOENT' });
});

test('index preparation remains self-contained when the repository enables split indexes', async () => {
  const { record, prepare, index, verify } = await indexFixture();
  await gitRun(record.checkoutPath, ['config', 'core.splitIndex', 'true']);
  const shared = (await fs.readdir(dirname(index))).filter(name => name.startsWith('sharedindex.'));
  const restored = await prepare(); await restored.publish(async () => {}); await restored.finish();
  assert.deepEqual((await fs.readdir(dirname(index))).filter(name => name.startsWith('sharedindex.')), shared);
  await verify();
});
