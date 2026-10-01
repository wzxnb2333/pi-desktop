import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readProjectFile, writeProjectFile } from '../src/main/files.ts';
import { FileBuffers } from '../src/renderer/src/lib/file-buffers.ts';
import type { FileContent } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const file: FileContent = { path: 'edit.txt', kind: 'text', content: 'original', version: 'v1', writable: true, truncated: false };

test('Windows transient rename locks retry safely and never overwrite a concurrent edit', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-files-'));
  const path = join(root, file.path);
  for (const mode of ['release', 'change', 'blocked']) {
    await writeFile(path, 'original');
    const base = await readProjectFile(root, file.path);
    const process = spawn('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./fixtures/file-rename-lock.ps1', import.meta.url)), '-Path', path], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(process, 'exit');
    process.stderr.resume();
    try {
      const [ready] = await once(process.stdout, 'data', { signal: AbortSignal.timeout(10000) });
      assert.match(String(ready), /LOCK_READY/);
      const saving = writeProjectFile(root, file.path, 'submitted', base.version!).then(value => ({ value, error: undefined }), error => ({ value: undefined, error: error as Error }));
      await delay(100);
      assert.equal(await readFile(path, 'utf8'), 'original');
      if (mode === 'change') await writeFile(path, 'external');
      if (mode !== 'blocked') process.stdin.end('release\n');
      const result = await saving;
      if (mode === 'release') {
        assert.equal(result.error, undefined);
        assert.equal(result.value?.content, 'submitted');
        assert.equal(await readFile(path, 'utf8'), 'submitted');
      } else {
        assert.ok(result.error);
        assert.match(result.error.message, mode === 'change' ? /发生变化/ : /EPERM|EACCES|EBUSY/);
        assert.equal(await readFile(path, 'utf8'), mode === 'change' ? 'external' : 'original');
      }
      assert.equal((await readdir(root)).some(name => name.includes('.pi-edit-')), false);
    } finally { if (!process.stdin.writableEnded) process.stdin.end('release\n'); await exited; }
  }
});

test('unrepresentable edits never replace the original file or discard the full draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-files-'));
  const path = join(root, file.path);
  await writeFile(path, file.content);
  const base = await readProjectFile(root, file.path);
  for (const content of ['中'.repeat(180000), 'text\0binary']) {
    await assert.rejects(writeProjectFile(root, file.path, content, base.version!), /512 KB|空字符/);
    assert.equal(await readFile(path, 'utf8'), file.content);
  }
});

test('unexpected write acknowledgements keep the submitted draft and expose the failure', async () => {
  for (const wrong of [{ content: 'external replacement' }, { path: 'other.txt' }, { truncated: true }]) {
    const buffers = new FileBuffers();
    await buffers.load('thread/edit.txt', async () => file);
    buffers.edit('thread/edit.txt', 'submitted');
    await buffers.save('thread/edit.txt', async () => ({ ...file, content: 'submitted', version: 'v2', ...wrong }));
    assert.equal(buffers.snapshot().get('thread/edit.txt')?.content, 'submitted');
    assert.equal(buffers.snapshot().get('thread/edit.txt')?.file?.version, 'v1');
    assert.equal(buffers.snapshot().get('thread/edit.txt')?.errorKind, 'save');
    assert.equal(buffers.hasUnsaved(), true);
  }
});

test('a read failure started before a successful save cannot mark the saved file as failed', async () => {
  const buffers = new FileBuffers();
  const key = 'thread/edit.txt';
  await buffers.load(key, async () => file);
  let fail!: (reason: Error) => void;
  const loading = buffers.load(key, () => new Promise((_resolve, reject) => { fail = reject; }));
  buffers.edit(key, 'saved');
  await buffers.save(key, async () => ({ ...file, content: 'saved', version: 'v2' }));
  fail(new Error('OBSOLETE_READ_ERROR'));
  await loading;
  assert.equal(buffers.snapshot().get(key)?.error, '');
  assert.equal(buffers.snapshot().get(key)?.loading, false);
  assert.equal(buffers.snapshot().get(key)?.file?.version, 'v2');
  assert.equal(buffers.hasUnsaved(), false);
});
