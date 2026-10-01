import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore, StoreRecoveryError, type ProjectDirectoryConfig } from '../src/main/store.ts';
import { projectEnvironmentSchema } from '../src/shared/project-environment.ts';
import type { Project } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const base = projectEnvironmentSchema.parse({});
const environment = projectEnvironmentSchema.parse({ actions: [{ id: 'check', name: '检查', command: 'echo SAVED' }] });

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-project-environment-'));
  const store = new JsonStore(dir); await store.load();
  store.data.projects.push({ id: 'p', name: 'Project', path: dir, trusted: true, createdAt: 1 }, { id: 'other', name: 'Other', path: dir, trusted: true, createdAt: 1 });
  await store.save(); return { store, dir };
}

function directoryConfig(project: Project): ProjectDirectoryConfig {
  return { path: project.path, trusted: project.trusted, primaryDirectoryId: project.primaryDirectoryId, directories: structuredClone(project.directories) };
}

test('project environment publishes only after persistence and survives queued background snapshots', async () => {
  const { store, dir } = await setup(); const project = store.data.projects[0];
  const saving = store.saveProjectEnvironment('p', environment, base);
  assert.equal(project.environment, undefined);
  project.name = 'Renamed'; store.data.ui.sidebarWidth = 380;
  store.data.projects[1].environment = { ...base, cleanup: 'echo OTHER' };
  const background = store.save(); await Promise.all([saving, background]);
  assert.equal(store.data.projects[0], project);
  const restored = new JsonStore(dir); await restored.load();
  assert.deepEqual(restored.data.projects[0].environment, environment); assert.equal(restored.data.projects[0].name, 'Renamed');
  assert.equal(restored.data.projects[1].environment?.cleanup, 'echo OTHER'); assert.equal(restored.data.ui.sidebarWidth, 380);
});

for (const blockedFile of ['desktop.json.tmp', 'desktop.json.bak']) test('failed project environment ' + blockedFile + ' write keeps the old command and supports retry', async () => {
  const { store, dir } = await setup(); const before = await readFile(join(dir, 'desktop.json'), 'utf8');
  const blocked = join(dir, blockedFile); await mkdir(blocked);
  await assert.rejects(store.saveProjectEnvironment('p', environment, base), /EISDIR|EPERM|EACCES/);
  assert.equal(store.data.projects[0].environment, undefined); assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  await rm(blocked, { recursive: true });
  await store.saveProjectEnvironment('p', environment, base);
  const restored = new JsonStore(dir); await restored.load(); assert.deepEqual(restored.data.projects[0].environment, environment);
});

test('concurrent environment writers recheck the saved baseline inside the queue', async () => {
  const { store, dir } = await setup();
  const next = { ...environment, initialization: 'echo NEW' };
  const first = store.saveProjectEnvironment('p', environment, base);
  const stale = store.saveProjectEnvironment('p', next, base);
  const updated = store.saveProjectEnvironment('p', next, environment);
  const outcomes = await Promise.allSettled([first, stale, updated, store.save()]);
  assert.deepEqual(outcomes.map(item => item.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
  assert.match(String((outcomes[1] as PromiseRejectedResult).reason), /其他窗口/);
  const restored = new JsonStore(dir); await restored.load(); assert.deepEqual(restored.data.projects[0].environment, next);
});

test('removing a project before a queued environment write prevents recreation', async () => {
  const { store, dir } = await setup();
  const saving = store.saveProjectEnvironment('p', environment, base);
  store.data.projects = store.data.projects.filter(project => project.id !== 'p');
  const removed = store.save(); await assert.rejects(saving, /项目不存在/); await removed;
  const restored = new JsonStore(dir); await restored.load(); assert.deepEqual(restored.data.projects.map(project => project.id), ['other']);
});

test('unrecoverable project storage rejects environment changes without replacing its source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-project-environment-'));
  await writeFile(join(dir, 'desktop.json'), '{broken');
  const store = new JsonStore(dir); await assert.rejects(store.load(), StoreRecoveryError);
  await assert.rejects(store.saveProjectEnvironment('p', environment, base), StoreRecoveryError);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), '{broken');
});

test('project directory configuration commits atomically and survives queued stale snapshots', async () => {
  const { store, dir } = await setup();
  const project = store.data.projects[0], base = directoryConfig(project), extra = { id: 'extra', name: 'Extra', path: join(dir, 'extra'), trusted: false };
  const next = { ...base, directories: [extra] };
  const pending = store.saveProjectDirectories(project.id, next, base);
  store.data.projects[1].name = 'Other renamed';
  const background = store.save();
  await Promise.all([pending, background]);
  const restored = new JsonStore(dir); await restored.load();
  assert.deepEqual(restored.data.projects[0].directories, [extra]);
  assert.equal(restored.data.projects[1].name, 'Other renamed');
});

test('project directory configuration rejects stale bases and preserves live state after a write failure', async () => {
  const { store, dir } = await setup();
  const project = store.data.projects[0], base = directoryConfig(project), first = { ...base, primaryDirectoryId: project.id };
  const second = { ...base, trusted: false };
  await store.saveProjectDirectories(project.id, first, base);
  await assert.rejects(store.saveProjectDirectories(project.id, second, base), /其他窗口/);
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  const current = directoryConfig(project), next = { ...current, trusted: false };
  await assert.rejects(store.saveProjectDirectories(project.id, next, current), /EISDIR|EPERM|EACCES/);
  assert.equal(project.trusted, true);
  await rm(blocked, { recursive: true });
  await store.saveProjectDirectories(project.id, next, current);
  assert.equal(project.trusted, false);
});
