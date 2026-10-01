import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { TemporaryDirectories } from './fixtures/temporary-directories.ts';

test('owned test scope removes readonly files and links without deleting external data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-temp-lifecycle-'));
  const scope = new TemporaryDirectories(root);
  try {
    await writeFile(join(root, 'keep.txt'), 'external data');
    const [first, second] = await Promise.all([scope.create('pi-first-'), scope.create('pi-second-')]);
    assert.equal(dirname(first), dirname(second));
    assert.deepEqual(await readdir(first), []);
    const owner = JSON.parse(await readFile(join(dirname(first), '.pi-test-owner.json'), 'utf8'));
    assert.equal(owner.root, dirname(first));
    assert.equal(owner.pid, process.pid);
    await writeFile(join(first, 'readonly'), 'test');
    await chmod(join(first, 'readonly'), 0o444);
    await symlink(root, join(second, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    await scope.cleanup();
    await scope.cleanup();
    assert.deepEqual(await readdir(root), ['keep.txt']);
    assert.equal(await readFile(join(root, 'keep.txt'), 'utf8'), 'external data');
    const next = await scope.create('pi-next-');
    assert.notEqual(dirname(next), dirname(first));
    await scope.cleanup();
    assert.deepEqual(await readdir(root), ['keep.txt']);
  } finally {
    await scope.cleanup();
    await rm(root, { recursive: true, force: true });
  }
});
