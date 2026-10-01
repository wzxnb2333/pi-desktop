import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { artifactAnnotationSchema } from '../src/shared/artifacts.ts';
import { browserAnnotationSchema } from '../src/shared/browser-annotations.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-artifact-persistence-')), store = new JsonStore(dir); await store.load();
  const thread = threadSchema.parse({ id: 'artifact', projectId: '', title: 'Artifacts', cwd: dir, createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny' });
  store.data.threads.push(thread); await store.save();
  const item = artifactAnnotationSchema.parse({ id: crypto.randomUUID(), createdAt: 1, directoryId: 'p', root: dir, path: 'test.pdf', kind: 'pdf', version: 'a'.repeat(64), resources: {}, imageHash: 'b'.repeat(64), page: 2, width: 800, height: 600, scrollX: 0, scrollY: 0, rect: { x: 10, y: 20, width: 40, height: 50 }, comment: 'Page two' });
  return { dir, store, thread, item };
}

test('failed artifact writes never publish or autosave uncommitted annotations and retry persists once', async () => {
  const { dir, store, thread, item } = await setup(), blocked = join(dir, 'desktop.json.tmp');
  const before = await readFile(join(dir, 'desktop.json'), 'utf8'); await mkdir(blocked);
  await assert.rejects(store.saveArtifactAnnotations(thread.id, [item]), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(thread.artifactAnnotations ?? [], []); assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  await rm(blocked, { recursive: true }); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads[0].artifactAnnotations ?? [], []);
  const commit = store.saveArtifactAnnotations(thread.id, [item]); assert.deepEqual(thread.artifactAnnotations ?? [], []);
  await Promise.all([commit, store.save()]); await reopened.load(); assert.deepEqual(reopened.data.threads[0].artifactAnnotations, [item]);
});

test('artifact delete intent and final removal survive stale background snapshots without replacing runtime objects', async () => {
  const { dir, store, thread, item } = await setup(); await store.saveArtifactAnnotations(thread.id, [item]);
  const commit = store.saveArtifactAnnotations(thread.id, [{ ...item, deleting: true }]);
  assert.equal(thread.artifactAnnotations![0].deleting, undefined); thread.updatedAt = 22;
  await Promise.all([commit, store.save()]); assert.equal(store.data.threads[0], thread);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].artifactAnnotations![0].deleting, true); assert.equal(reopened.data.threads[0].updatedAt, 22);
  const blocked = join(dir, 'desktop.json.bak'); await rm(blocked); await mkdir(blocked);
  await assert.rejects(store.saveArtifactAnnotations(thread.id, []), /EISDIR|EPERM|EACCES/);
  assert.equal(thread.artifactAnnotations![0].deleting, true); await rm(blocked, { recursive: true });
  await Promise.all([store.saveArtifactAnnotations(thread.id, []), store.save()]); await reopened.load(); assert.deepEqual(reopened.data.threads[0].artifactAnnotations, []);
});

test('artifact, browser annotations, settings and background writes commit independently', async () => {
  const { dir, store, thread, item } = await setup();
  const browser = browserAnnotationSchema.parse({ id: crypto.randomUUID(), createdAt: 1, tabId: 'page', url: 'https://example.com/', title: 'Page', fingerprint: 'c'.repeat(64), viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0 }, mode: 'region', rect: item.rect, comment: 'Browser' });
  await Promise.all([store.saveArtifactAnnotations(thread.id, [item]), store.save(), store.saveBrowserAnnotations(thread.id, [browser]), store.saveSettings({ theme: 'dark' }), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads[0].artifactAnnotations, [item]); assert.deepEqual(reopened.data.threads[0].browserAnnotations, [browser]); assert.equal(reopened.data.settings.theme, 'dark');
});

test('invalid or deleted artifact targets cannot overwrite committed data or resurrect a removed task', async () => {
  const { dir, store, thread, item } = await setup();
  assert.throws(() => store.saveArtifactAnnotations(thread.id, [{ ...item, page: 0 }]));
  const missing = store.saveArtifactAnnotations('missing', [item]); await assert.rejects(missing, /任务不存在/);
  const pending = store.saveArtifactAnnotations(thread.id, [item]); thread.deletedAt = 2; await assert.rejects(pending, /任务不存在/); thread.deletedAt = null;
  const commit = store.saveArtifactAnnotations(thread.id, [item]); await Promise.resolve(); const background = store.save(); store.data.threads = [];
  await Promise.all([commit, background]); const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads, []);
});
