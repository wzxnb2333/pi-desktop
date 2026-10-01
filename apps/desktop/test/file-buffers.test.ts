import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileContent } from '../src/shared/contracts.ts';
import { fileBufferDirty, FileBuffers } from '../src/renderer/src/lib/file-buffers.ts';

const file: FileContent = { path: 'a.txt', kind: 'text', content: 'original', version: 'v1', writable: true, truncated: false };
const key = 'thread/a.txt';

test('in-flight save preserves edits back to the original and rebases the next save', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file);
  buffers.edit(key, 'submitted');
  let finish!: (file: FileContent) => void;
  const saving = buffers.save(key, () => new Promise(resolve => { finish = resolve; }));
  buffers.edit(key, 'original');
  assert.equal(buffers.hasUnsaved(), true);
  finish({ ...file, content: 'submitted', version: 'v2' });
  await saving;
  assert.equal(buffers.snapshot().get(key)?.content, 'original');
  assert.equal(buffers.hasUnsaved(), true);
  await buffers.save(key, async (base, content) => {
    assert.equal(base.version, 'v2');
    return { ...base, content, version: 'v3' };
  });
  assert.equal(buffers.hasUnsaved(), false);
});

test('duplicate saves and discard cannot race a pending write; rejected writes retain the draft', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file);
  buffers.edit(key, 'unsaved');
  let fail!: (reason: Error) => void;
  const saving = buffers.save(key, () => new Promise((_resolve, reject) => { fail = reject; }));
  await buffers.save(key, async () => { assert.fail('duplicate write'); });
  assert.equal(buffers.discard(key), false);
  fail(new Error('WRITE_FAILED'));
  await saving;
  assert.equal(buffers.snapshot().get(key)?.content, 'unsaved');
  assert.equal(buffers.snapshot().get(key)?.error, 'WRITE_FAILED');
  assert.equal(buffers.hasUnsaved(), true);
  assert.equal(buffers.discard(key), true);
  assert.equal(buffers.hasUnsaved(), false);
});

test('a late read cannot replace a newer save, and reload detects external changes without discarding edits', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file);
  buffers.edit(key, 'draft');
  let finish!: (file: FileContent) => void;
  const loading = buffers.load(key, () => new Promise(resolve => { finish = resolve; }));
  await buffers.save(key, async (base, content) => ({ ...base, content, version: 'v2' }));
  finish(file);
  await loading;
  assert.equal(buffers.snapshot().get(key)?.file?.version, 'v2');
  assert.equal(buffers.snapshot().get(key)?.content, 'draft');
  buffers.edit(key, 'next draft');
  await buffers.load(key, async () => ({ ...file, content: 'external', version: 'external' }));
  assert.equal(buffers.snapshot().get(key)?.content, 'next draft');
  assert.match(buffers.snapshot().get(key)?.error ?? '', /外部修改/);
});

test('closed and superseded reads cannot recreate stale buffers or overwrite the current file', async () => {
  const buffers = new FileBuffers();
  let finish!: (file: FileContent) => void;
  const loading = buffers.load(key, () => new Promise(resolve => { finish = resolve; }));
  buffers.discard(key);
  finish(file);
  await loading;
  assert.equal(buffers.snapshot().has(key), false);
  const earlier = buffers.load(key, () => new Promise(resolve => { finish = resolve; }));
  await buffers.load(key, async () => ({ ...file, content: 'fresh', version: 'v2' }));
  finish(file);
  await earlier;
  assert.equal(buffers.snapshot().get(key)?.content, 'fresh');
});

test('reopening a dirty file preserves save errors, while a successful read clears read errors', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file);
  buffers.edit(key, 'draft');
  await buffers.save(key, async () => { throw new Error('WRITE_DENIED'); });
  await buffers.load(key, async () => file);
  assert.equal(buffers.snapshot().get(key)?.error, 'WRITE_DENIED');
  assert.equal(buffers.snapshot().get(key)?.content, 'draft');
  await buffers.load(key, async () => { throw new Error('READ_FAILED'); });
  assert.equal(buffers.snapshot().get(key)?.error, 'READ_FAILED');
  await buffers.load(key, async () => file);
  assert.equal(buffers.snapshot().get(key)?.error, '');
  assert.equal(buffers.snapshot().get(key)?.content, 'draft');
});

test('accepted newline and BOM normalization is clean without replacing newer edits', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => ({ ...file, content: '\ufefforiginal\r\n' }));
  buffers.edit(key, 'changed\n');
  await buffers.save(key, async base => ({ ...base, content: '\ufeffchanged\r\n', version: 'v2' }));
  assert.equal(buffers.hasUnsaved(), false);
  assert.equal(buffers.snapshot().get(key)?.content, '\ufeffchanged\r\n');
  buffers.edit(key, 'submitted\n');
  let finish!: (file: FileContent) => void;
  const saving = buffers.save(key, () => new Promise(resolve => { finish = resolve; }));
  buffers.edit(key, 'newer\n');
  finish({ ...file, content: '\ufeffsubmitted\r\n', version: 'v3' });
  await saving;
  assert.equal(buffers.snapshot().get(key)?.content, 'newer\n');
  assert.equal(buffers.hasUnsaved(), true);
});

test('confirmed reload retains the draft on failure and replaces it only after a successful read', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file);
  buffers.edit(key, 'draft');
  await buffers.load(key, async () => { throw new Error('RELOAD_FAILED'); }, { discardChanges: true });
  assert.equal(buffers.snapshot().get(key)?.content, 'draft');
  assert.equal(buffers.hasUnsaved(), true);
  await buffers.load(key, async () => ({ ...file, content: 'external', version: 'v2' }), { discardChanges: true });
  assert.equal(buffers.snapshot().get(key)?.content, 'external');
  assert.equal(buffers.hasUnsaved(), false);
});

test('edits during confirmed reload survive even when they return to the previous disk content', async () => {
  for (const edit of ['new edit', file.content]) {
    const buffers = new FileBuffers();
    await buffers.load(key, async () => file);
    buffers.edit(key, 'approved discard');
    let finish!: (value: FileContent) => void;
    const loading = buffers.load(key, () => new Promise(resolve => { finish = resolve; }), { discardChanges: true });
    buffers.edit(key, edit);
    finish({ ...file, content: 'external', version: 'v2' }); await loading;
    assert.equal(buffers.snapshot().get(key)?.content, edit);
    assert.equal(buffers.snapshot().get(key)?.file?.version, 'v1');
    assert.equal(fileBufferDirty(buffers.snapshot().get(key)), true);
    assert.equal(buffers.hasUnsaved(), true);
    await buffers.save(key, async (base) => { assert.equal(base.version, 'v1'); throw new Error('STALE_VERSION'); });
    assert.equal(buffers.hasUnsaved(), true);
    await buffers.load(key, async () => ({ ...file, content: 'external', version: 'v2' }));
    assert.equal(buffers.snapshot().get(key)?.content, edit);
    await buffers.load(key, async () => ({ ...file, content: 'external', version: 'v2' }), { discardChanges: true });
    assert.equal(buffers.hasUnsaved(), false);
  }
});

test('closing or saving during confirmed reload cannot resurrect an old draft or overwrite a newer save', async () => {
  const buffers = new FileBuffers();
  await buffers.load(key, async () => file); buffers.edit(key, 'draft');
  let finish!: (value: FileContent) => void;
  const closed = buffers.load(key, () => new Promise(resolve => { finish = resolve; }), { discardChanges: true });
  assert.equal(buffers.discard(key), true); finish(file); await closed;
  assert.equal(buffers.snapshot().has(key), false);
  await buffers.load(key, async () => file); buffers.edit(key, 'newer save');
  const loading = buffers.load(key, () => new Promise(resolve => { finish = resolve; }), { discardChanges: true });
  await buffers.save(key, async (base, content) => ({ ...base, content, version: 'v3' }));
  finish({ ...file, content: 'obsolete read', version: 'v2' }); await loading;
  assert.equal(buffers.snapshot().get(key)?.file?.version, 'v3');
  assert.equal(buffers.snapshot().get(key)?.content, 'newer save');
  assert.equal(buffers.hasUnsaved(), false);
});
