import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createSharedSkill } from '../src/main/skills.ts';
import { JsonStore, StoreRecoveryError } from '../src/main/store.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const skill = { id: 'skill', path: 'C:/skills/SKILL.md', name: 'Skill', kind: 'skill' as const, enabled: true };

test('resource commits publish after persistence and survive an already queued UI snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-resource-store-'));
  const store = new JsonStore(dir); await store.load(); await store.save();
  const commit = store.saveResources({ ...store.data.settings, resources: [skill], ignoredSkillPaths: [] });
  assert.deepEqual(store.data.settings.resources, []);
  store.data.ui.sidebarWidth = 400;
  store.data.settings.theme = 'dark';
  const background = store.save();
  await Promise.all([commit, background]);
  const restored = new JsonStore(dir); await restored.load();
  assert.deepEqual(restored.data.settings.resources, [skill]);
  assert.equal(restored.data.ui.sidebarWidth, 400);
  assert.equal(restored.data.settings.theme, 'dark');
});

test('failed resource writes preserve committed state and support retry and queued removal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-resource-store-'));
  const store = new JsonStore(dir); await store.load(); await store.save();
  const before = await readFile(join(dir, 'desktop.json'), 'utf8');
  const blocked = join(dir, 'desktop.json.tmp');
  await mkdir(blocked);
  await assert.rejects(store.saveResources({ resources: [skill], ignoredSkillPaths: [] }), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(store.data.settings.resources, []);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  await rm(blocked, { recursive: true });
  const first = store.saveResources({ resources: [skill], ignoredSkillPaths: [] });
  const removal = store.saveResources({ resources: [], ignoredSkillPaths: [skill.path] });
  const background = store.save();
  await Promise.all([first, removal, background]);
  const restored = new JsonStore(dir); await restored.load();
  assert.deepEqual(restored.data.settings.resources, []);
  assert.deepEqual(restored.data.settings.ignoredSkillPaths, [skill.path]);
});

test('resource commits cannot overwrite an unrecoverable store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-resource-store-'));
  await writeFile(join(dir, 'desktop.json'), '{broken');
  const store = new JsonStore(dir);
  await assert.rejects(store.load(), StoreRecoveryError);
  await assert.rejects(store.saveResources({ resources: [skill], ignoredSkillPaths: [] }), StoreRecoveryError);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), '{broken');
});

test('failed skill creation removes only its owned files and allows exactly one retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-resource-create-'));
  const input = { name: 'Skill', content: 'draft' };
  await assert.rejects(createSharedSkill(input, async () => { throw new Error('SAVE_FAILED'); }, dir), /SAVE_FAILED/);
  assert.deepEqual(await readdir(dir), []);
  const resource = await createSharedSkill(input, async resource => {
    assert.equal(await readFile(resource.path, 'utf8'), input.content);
  }, dir);
  assert.equal((await readdir(dir)).length, 1);
  assert.equal(await readFile(resource.path, 'utf8'), input.content);
});

test('failed creation reports cleanup problems without deleting newly added or externally edited files', async () => {
  for (const externalEdit of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), 'pi-resource-create-'));
    let retained = '';
    await assert.rejects(createSharedSkill({ name: 'Skill', content: 'draft' }, async resource => {
      retained = externalEdit ? resource.path : join(dirname(resource.path), 'external.txt');
      await writeFile(retained, 'EXTERNAL_CONTENT');
      throw new Error('SAVE_FAILED');
    }, dir), error => error instanceof AggregateError && error.message.includes('SAVE_FAILED') && error.message.includes(dir));
    assert.equal(await readFile(retained, 'utf8'), 'EXTERNAL_CONTENT');
  }
});

test('rollback also removes its empty directory when the skill file has already disappeared', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-resource-create-'));
  await assert.rejects(createSharedSkill({ name: 'Skill', content: 'draft' }, async resource => {
    await rm(resource.path);
    throw new Error('SAVE_FAILED');
  }, dir), error => error instanceof Error && !(error instanceof AggregateError) && error.message === 'SAVE_FAILED');
  assert.deepEqual(await readdir(dir), []);
});
