import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from './fixtures/node-temp.ts';
import { projectSchema, threadSchema, uiThreadSchema, requestSchema } from '../src/shared/contracts.ts';
import { projectDirectories, primaryDirectory, taskDirectory, directoryThreadUi, directoryUiPatch } from '../src/shared/project-directories.ts';
import { readProjectFile, writeProjectFile } from '../src/main/files.ts';
import { resolveInputContext } from '../src/worker/input-context.ts';
import { mergeContextReferences } from '../src/shared/input-context.ts';
import { evaluateAction } from '../src/main/policy.ts';

test('legacy projects retain their directory identity when a different primary is selected', () => {
  const project = projectSchema.parse({ id: 'p', name: 'original', path: 'original', trusted: true, createdAt: 1 });
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: '', cwd: 'worktree', createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'ask' });
  assert.equal(primaryDirectory(project).id, 'p');
  project.directories = [{ id: 'extra', name: 'extra', path: 'extra', trusted: false }];
  project.primaryDirectoryId = 'extra';
  assert.equal(primaryDirectory(project).path, 'extra');
  assert.equal(taskDirectory(project, thread).path, 'worktree');
  assert.equal(taskDirectory(project, thread, 'extra').trusted, false);
  assert.throws(() => taskDirectory(project, thread, 'forged'));
});

test('same-name files and input references remain scoped to their approved directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-project-directories-'));
  const first = join(root, 'first'); const second = join(root, 'second');
  await mkdir(first); await mkdir(second);
  await writeFile(join(first, 'same.txt'), 'FIRST'); await writeFile(join(second, 'same.txt'), 'SECOND');
  const project = projectSchema.parse({ id: 'p', name: 'first', path: first, trusted: true, createdAt: 1,
    directories: [{ id: 'second', name: 'second', path: second, trusted: false }] });
  const thread = threadSchema.parse({ id: 't', projectId: 'p', title: '', cwd: first, createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'ask' });
  const original = await readProjectFile(taskDirectory(project, thread, 'second').path, 'same.txt');
  await writeProjectFile(second, 'same.txt', 'SECOND_EDITED', original.version!);
  assert.equal(await readFile(join(first, 'same.txt'), 'utf8'), 'FIRST');
  const references = mergeContextReferences([{ kind: 'file', id: 'same.txt', label: 'same', directoryId: 'p' }], [{ kind: 'file', id: 'same.txt', label: 'same', directoryId: 'second' }]);
  assert.equal(references.length, 2);
  const text = await resolveInputContext(first, references, [], [], projectDirectories(project));
  assert.match(text, /FIRST/); assert.match(text, /SECOND_EDITED/);
  await assert.rejects(resolveInputContext(first, [{ ...references[0], directoryId: 'forged' }], [], [], projectDirectories(project)));
  await assert.rejects(readProjectFile(first, '../second/same.txt'));
});

test('directory file views isolate opened paths while sharing the conversation draft', () => {
  const initial = uiThreadSchema.parse({ selectedPath: 'first.txt', openFiles: ['first.txt'], draft: { text: 'shared', attachments: [] } });
  const patch = directoryUiPatch(initial, { selectedPath: 'second.txt', openFiles: ['second.txt'] }, 'extra', 'p');
  const next = { ...initial, ...patch };
  assert.equal(directoryThreadUi(next, 'p', 'p').selectedPath, 'first.txt');
  assert.equal(directoryThreadUi(next, 'extra', 'p').selectedPath, 'second.txt');
  assert.equal(directoryThreadUi(next, 'extra', 'p').draft?.text, 'shared');
  assert.deepEqual(requestSchema.parse({ op: 'file.read', threadId: 't', directoryId: 'extra', path: 'same.txt' }), { op: 'file.read', threadId: 't', directoryId: 'extra', path: 'same.txt' });
  assert.equal(evaluateAction('deny', true, 'project_read'), 'allow');
  assert.equal(evaluateAction('deny', true, 'project_write'), 'deny');
});
