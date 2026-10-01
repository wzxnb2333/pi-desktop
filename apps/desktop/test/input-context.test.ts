import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from './fixtures/node-temp.ts';
import { resolveInputContext } from '../src/worker/input-context.ts';
import { inputCatalog } from '../src/main/input-catalog.ts';
import { defaultData, threadSchema, requestSchema } from '../src/shared/contracts.ts';
import { mergeContextReferences } from '../src/shared/input-context.ts';

test('references read the selected file version and only direct folder entries', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-input-context-'));
  await mkdir(join(cwd, 'nested'));
  await writeFile(join(cwd, 'readme.txt'), '中文 CONTEXT_FILE');
  await writeFile(join(cwd, 'nested', 'private.txt'), 'NESTED_CONTENT');
  const result = await resolveInputContext(cwd, [
    { kind: 'file', id: 'readme.txt', label: 'fake label ignored' },
    { kind: 'folder', id: '.', label: '.' }, { kind: 'tool', id: 'read', label: 'read' },
  ], [], ['read']);
  assert.match(result, /中文 CONTEXT_FILE/);
  assert.match(result, /SHA256 [a-f0-9]{64}/);
  assert.match(result, /nested/);
  assert.doesNotMatch(result, /NESTED_CONTENT|fake label/);
  assert.match(result, /Existing task permissions/);
  await writeFile(join(cwd, 'readme.txt'), 'UPDATED');
  assert.match(await resolveInputContext(cwd, [{ kind: 'file', id: 'readme.txt', label: '' }], [], []), /UPDATED/);
});

test('references cannot escape the task root, load disabled skills or enable unavailable tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-context-permissions-'));
  const cwd = join(root, 'project');
  await mkdir(cwd);
  const skill = join(root, 'SKILL.md');
  await writeFile(skill, 'EXPLICIT_SKILL_CONTENT');
  for (const kind of ['file', 'folder', 'skill', 'tool'] as const)
    await assert.rejects(resolveInputContext(cwd, [{ kind, id: kind === 'tool' ? 'write' : skill, label: 'claimed safe' }], [], ['read']));
  const content = await resolveInputContext(cwd, [{ kind: 'skill', id: skill, label: 'untrusted title' }], [{ filePath: skill, name: 'approved' }], []);
  assert.match(content, /EXPLICIT_SKILL_CONTENT/);
  assert.doesNotMatch(content, /untrusted title/);
});

test('metadata catalog has usable commands without launching an extension or a worker', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-input-catalog-'));
  const skill = join(cwd, 'skill');
  await mkdir(skill);
  await writeFile(join(skill, 'SKILL.md'), '---\nname: context-skill\ndescription: Selected skill\n---\nDo the selected work.');
  const data = defaultData();
  data.settings.resources = [{ id: 's', kind: 'skill', name: 'context-skill', path: skill, enabled: true },
    { id: 'e', kind: 'extension', name: 'never-execute', path: 'missing.mjs', enabled: true }];
  const thread = threadSchema.parse({ id: 't', projectId: 'p', cwd, title: '', createdAt: 1, updatedAt: 1, providerId: 'local', thinking: 'off', policy: 'deny' });
  const catalog = inputCatalog(thread, data.settings, cwd);
  assert.equal(catalog.references.filter(item => item.kind === 'skill').length, 1);
  assert.equal(catalog.references.some(item => item.id === 'write'), false);
  assert.equal(catalog.commands.find(item => item.id === 'compact')?.enabled, true);
  thread.status = 'running';
  const busy = inputCatalog(thread, data.settings, cwd);
  assert.equal(busy.commands.find(item => item.id === 'compact')?.enabled, false);
  assert.equal(busy.commands.find(item => item.id === 'stop')?.enabled, true);
});

test('reference patches retain their type and queue recovery merges without duplicate references', () => {
  const ref = { kind: 'file' as const, id: 'a', label: 'a' };
  const request = requestSchema.parse({ op: 'ui.threadPatch', threadId: 't', patch: { contextReferences: [ref] } });
  assert.deepEqual(request, { op: 'ui.threadPatch', threadId: 't', patch: { contextReferences: [ref] } });
  assert.deepEqual(mergeContextReferences([ref], [ref], [{ ...ref, kind: 'folder' }]), [ref, { ...ref, kind: 'folder' }]);
});
