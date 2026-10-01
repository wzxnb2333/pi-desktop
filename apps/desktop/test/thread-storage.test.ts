import assert from 'node:assert/strict';
import { access, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { mkdtemp } from './fixtures/node-temp.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { purgeThreadFiles } from '../src/main/thread-storage.ts';

test('standalone chat purge removes an empty owned sandbox but preserves fork references and contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-purge-chat-'));
  const workspace = join(root, 'chat-workspaces', 'chat');
  await mkdir(workspace, { recursive: true });
  await purgeThreadFiles(root, { id: 'chat' }, [{ cwd: workspace }]);
  await access(workspace);
  await writeFile(join(workspace, 'unexpected.txt'), 'PRESERVE');
  await purgeThreadFiles(root, { id: 'chat' }, []);
  assert.equal(await readFile(join(workspace, 'unexpected.txt'), 'utf8'), 'PRESERVE');
  const empty = join(root, 'chat-workspaces', 'empty');
  await mkdir(empty);
  await purgeThreadFiles(root, { id: 'empty' }, []);
  await assert.rejects(access(empty), { code: 'ENOENT' });
});

test('permanent deletion removes only owned unshared session and attachment files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-purge-'));
  const folder = join(root, 'agent', 'sessions', 'original');
  const attachments = join(root, 'attachments', 'original', 'picked');
  await mkdir(folder, { recursive: true }); await mkdir(attachments, { recursive: true });
  const original = join(folder, 'original.jsonl'); const fork = join(folder, 'fork.jsonl');
  const exclusive = join(attachments, 'exclusive.txt'); const shared = join(attachments, 'shared.txt');
  for (const path of [original, fork, exclusive, shared]) await writeFile(path, 'KEEP_OR_DELETE');
  await purgeThreadFiles(root, { id: 'original', sessionFile: original }, [{ sessionFile: fork, text: '附件：' + shared.replaceAll('\\', '/') }]);
  await assert.rejects(readFile(original), { code: 'ENOENT' });
  await assert.rejects(readFile(exclusive), { code: 'ENOENT' });
  assert.equal(await readFile(fork, 'utf8'), 'KEEP_OR_DELETE');
  assert.equal(await readFile(shared, 'utf8'), 'KEEP_OR_DELETE');
  await purgeThreadFiles(root, { id: 'fork', sessionFile: fork }, [{ sessionFile: fork }]);
  assert.equal(await readFile(fork, 'utf8'), 'KEEP_OR_DELETE');
});

test('permanent deletion preserves imported sessions and rejects directory traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-purge-boundary-'));
  const external = join(root, 'project.jsonl'); await writeFile(external, 'EXTERNAL');
  await purgeThreadFiles(root, { id: 'safe', sessionFile: external }, []);
  assert.equal(await readFile(external, 'utf8'), 'EXTERNAL');
  for (const id of ['..', '../project', '..\\project', '.']) await assert.rejects(purgeThreadFiles(root, { id }, []), /标识/);
  assert.equal(await readFile(external, 'utf8'), 'EXTERNAL');
});

test('permanent deletion never follows attachment junctions to project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-purge-links-'));
  const external = await mkdtemp(join(tmpdir(), 'pi-purge-project-'));
  const directory = join(root, 'attachments', 't'); await mkdir(directory, { recursive: true });
  await writeFile(join(external, 'important.txt'), 'PROJECT');
  await symlink(external, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await purgeThreadFiles(root, { id: 't' }, []);
  assert.equal(await readFile(join(external, 'important.txt'), 'utf8'), 'PROJECT');
});
