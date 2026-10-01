import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { artifactFile, artifactHash, artifactKind, artifactMime } from '../src/main/artifact-files.ts';
import { requestSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

test('artifact reads retain original bytes and reject outside directories, links and oversized files', async () => {
  const storage = await mkdtemp(join(tmpdir(), 'pi-artifact-files-')), root = join(storage, 'project'), outside = join(storage, 'outside');
  await mkdir(root); await mkdir(outside); await writeFile(join(root, '中文.html'), '<h1>本地</h1>'); await writeFile(join(outside, 'secret.html'), 'secret');
  const file = await artifactFile(root, '中文.html'); assert.equal(file.bytes.toString(), '<h1>本地</h1>'); assert.equal(file.version, artifactHash(file.bytes));
  await assert.rejects(artifactFile(root, '../outside/secret.html'), /超出/);
  await symlink(outside, join(root, 'linked'), 'junction'); await assert.rejects(artifactFile(root, 'linked/secret.html'), /超出/);
  await assert.rejects(artifactFile(root, '中文.html', 3), /超过/);
  assert.equal(artifactKind('目录/A.PDF'), 'pdf'); assert.equal(artifactKind('a.htm'), 'html'); assert.throws(() => artifactKind('a.docx'));
  assert.equal(artifactMime('a.js'), 'text/javascript'); assert.equal(artifactMime('.env'), undefined);
  assert.equal(requestSchema.safeParse({ op: 'artifact.network', threadId: 't', previewId: crypto.randomUUID(), origin: 'file:///C:/', allowed: true }).success, false);
  assert.equal(requestSchema.safeParse({ op: 'artifact.capture', threadId: 't', previewId: crypto.randomUUID(), pdf: { image: 'data:text/html,test', page: 0 } }).success, false);
});
