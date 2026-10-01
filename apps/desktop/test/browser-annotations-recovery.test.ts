import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BrowserAnnotations } from '../src/main/browser-annotations.ts';
import { JsonStore } from '../src/main/store.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import type { AnnotationSelection, BrowserAnnotation } from '../src/shared/browser-annotations.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

type Source = ConstructorParameters<typeof BrowserAnnotations>[1];
const bytes = Buffer.from('owned screenshot');
const selection: AnnotationSelection = { mode: 'region', rect: { x: 1, y: 2, width: 20, height: 30 }, comment: 'keep my comment' };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function setup(capture?: Source['capture']) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-annotation-recovery-'));
  const store = new JsonStore(dir); await store.load();
  const thread = threadSchema.parse({ id: 'annotations', projectId: '', cwd: dir, title: 'Annotations', providerId: '', policy: 'deny', thinking: 'off', createdAt: 1, updatedAt: 1 });
  store.data.threads.push(thread); await store.save();
  const source: Source = {
    agentContents: (_thread, tab) => ({ executeJavaScriptInIsolatedWorld: async () => ({ url: 'https://example.com/' + tab, title: tab, width: 800, height: 600, scrollX: 0, scrollY: 0, elements: [], text: 'stable' }) }),
    capture: capture ?? (async () => ({ isEmpty: () => false, toPNG: () => bytes })),
  };
  const commit = (id: string, annotations: BrowserAnnotation[]) => store.saveBrowserAnnotations(id, annotations);
  const service = new BrowserAnnotations(dir, source, id => { const item = store.data.threads.find(item => item.id === id && !item.deletedAt); if (!item) throw new Error('任务不存在'); return item; }, commit);
  const png = (id: string) => join(dir, 'attachments', thread.id, 'annotations', id + '.png');
  return { dir, store, thread, source, service, commit, png };
}

test('annotation save failure preserves the capture and draft, with one record after a duplicate retry', async () => {
  const { dir, store, thread, service, png } = await setup();
  const capture = await service.capture(thread.id, 'page', 1);
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(service.saveCapture(thread.id, capture.id, 1, selection), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(thread.browserAnnotations ?? [], []); await assert.rejects(readFile(png(capture.id)), { code: 'ENOENT' });
  await rm(blocked, { recursive: true }); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads[0].browserAnnotations ?? [], []);
  const [first, duplicate] = await Promise.all([service.saveCapture(thread.id, capture.id, 1, selection), service.saveCapture(thread.id, capture.id, 1, selection)]);
  assert.deepEqual(first, duplicate); assert.equal(thread.browserAnnotations?.length, 1);
  await assert.rejects(service.saveCapture(thread.id, capture.id, 2, selection), /失效/);
  assert.deepEqual(await readFile(png(capture.id)), bytes);
  await service.dispose();
});

test('browser annotation commits stay private until durable and survive queued background snapshots', async () => {
  const { dir, store, thread, service } = await setup();
  const capture = await service.capture(thread.id, 'page', 1);
  const record = await service.saveCapture(thread.id, capture.id, 1, selection);
  const commit = store.saveBrowserAnnotations(thread.id, [{ ...record, deleting: true }]);
  assert.equal(thread.browserAnnotations![0].deleting, undefined);
  thread.updatedAt = 123; const background = store.save();
  await Promise.all([commit, background]);
  assert.equal(store.data.threads[0], thread);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads[0].browserAnnotations![0].deleting, true); assert.equal(reopened.data.threads[0].updatedAt, 123);
  await Promise.all([store.saveBrowserAnnotations(thread.id, []), store.save()]);
  await reopened.load(); assert.deepEqual(reopened.data.threads[0].browserAnnotations, []);
  await service.dispose();
});

test('failed delete intent keeps the annotation and screenshot readable', async () => {
  const { dir, thread, service, png } = await setup();
  const capture = await service.capture(thread.id, 'page', 1); await service.saveCapture(thread.id, capture.id, 1, selection);
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(service.remove(thread.id, capture.id), /EISDIR|EPERM|EACCES/);
  assert.equal(thread.browserAnnotations![0].deleting, undefined); assert.deepEqual(await readFile(png(capture.id)), bytes);
  assert.equal((await service.read(thread.id, capture.id)).stale, false);
  await rm(blocked, { recursive: true }); await service.remove(thread.id, capture.id);
  await assert.rejects(service.saveCapture(thread.id, capture.id, 1, selection), /失效/);
  await service.dispose();
});

test('failed screenshot deletion stays visible across restart and cannot be attached until removal is retried', async () => {
  const { dir, store, thread, source, service, commit, png } = await setup();
  const capture = await service.capture(thread.id, 'page', 1); await service.saveCapture(thread.id, capture.id, 1, selection);
  const attachment = await service.attachment(thread.id, capture.id);
  await rm(png(capture.id)); await mkdir(png(capture.id));
  await assert.rejects(service.remove(thread.id, capture.id), /EISDIR|EPERM|EACCES/);
  assert.equal(thread.browserAnnotations![0].deleting, true);
  await assert.rejects(service.read(thread.id, capture.id), /正在删除/); await assert.rejects(service.attachment(thread.id, capture.id), /正在删除/);
  await service.dispose(); await store.load(); assert.equal(store.data.threads[0].browserAnnotations![0].deleting, true);
  const restarted = new BrowserAnnotations(dir, source, () => store.data.threads[0], commit);
  await rm(png(capture.id), { recursive: true }); await restarted.remove(thread.id, capture.id); await restarted.remove(thread.id, capture.id);
  await store.load(); assert.deepEqual(store.data.threads[0].browserAnnotations, []);
  assert.deepEqual(await readFile(attachment.path), bytes); await restarted.dispose();
});

test('failure after removing screenshot keeps durable intent and retry completes when the PNG is already absent', async () => {
  const { dir, store, thread, source, service, commit, png } = await setup();
  const capture = await service.capture(thread.id, 'page', 1); await service.saveCapture(thread.id, capture.id, 1, selection);
  const blocked = join(dir, 'desktop.json.tmp');
  const failing = new BrowserAnnotations(dir, source, () => thread, async (id, next) => { if (!next.length) await mkdir(blocked); await commit(id, next); });
  await assert.rejects(failing.remove(thread.id, capture.id), /EISDIR|EPERM|EACCES/);
  await assert.rejects(readFile(png(capture.id)), { code: 'ENOENT' });
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].browserAnnotations![0].deleting, true);
  await rm(blocked, { recursive: true }); await service.remove(thread.id, capture.id);
  await store.save(); await reopened.load(); assert.deepEqual(reopened.data.threads[0].browserAnnotations, []);
  await service.dispose(); await failing.dispose();
});

test('late captures cannot replace a newer capture or survive owner, thread or application disposal', async t => {
  for (const cancel of ['newer', 'owner', 'thread', 'app'] as const) await t.test(cancel, async () => {
    const entered = deferred(), release = deferred();
    const { thread, service } = await setup(async (_id, tab) => { if (tab === 'held') { entered.resolve(); await release.promise; } return { isEmpty: () => false, toPNG: () => bytes }; });
    const pending = service.capture(thread.id, 'held', 1); const rejected = assert.rejects(pending, /失效/);
    await entered.promise;
    if (cancel === 'newer') { const latest = await service.capture(thread.id, 'latest', 1); await service.saveCapture(thread.id, latest.id, 1, selection); }
    if (cancel === 'owner') service.discard(1);
    if (cancel === 'thread') await service.closeThread(thread.id);
    if (cancel === 'app') await service.dispose();
    release.resolve(); await rejected;
    assert.equal(thread.browserAnnotations?.length ?? 0, cancel === 'newer' ? 1 : 0); await service.dispose();
  });
});

test('failed recapture keeps the previous capture usable and rejects a conflicting leftover PNG', async () => {
  const { thread, source, service, png } = await setup(); const capture = await service.capture(thread.id, 'page', 1);
  source.capture = async () => { throw new Error('capture failed'); };
  await assert.rejects(service.capture(thread.id, 'page', 1), /capture failed/);
  const saved = await service.saveCapture(thread.id, capture.id, 1, selection); assert.equal(saved.comment, selection.comment);
  source.capture = async () => ({ isEmpty: () => false, toPNG: () => bytes });
  const next = await service.capture(thread.id, 'page', 1); await writeFile(png(next.id), 'unrelated bytes');
  await assert.rejects(service.saveCapture(thread.id, next.id, 1, selection), /EEXIST/);
  assert.equal(await readFile(png(next.id), 'utf8'), 'unrelated bytes');
  await rm(png(next.id)); await writeFile(png(next.id), bytes); await service.saveCapture(thread.id, next.id, 1, selection);
  assert.equal(thread.browserAnnotations!.length, 2); await service.dispose();
});

test('an unresponsive document times out and late inspection cannot start a screenshot or block a retry', async t => {
  const { thread, source, service } = await setup();
  const release = deferred(), original = source.agentContents;
  let images = 0;
  source.agentContents = (id, tab) => ({ executeJavaScriptInIsolatedWorld: async () => { await release.promise; return original(id, tab).executeJavaScriptInIsolatedWorld(1002, []); } });
  source.capture = async () => { images++; return { isEmpty: () => false, toPNG: () => bytes }; };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const capture = service.capture(thread.id, 'page', 1), rejected = assert.rejects(capture, /读取超时/);
  t.mock.timers.tick(30000); await rejected; release.resolve();
  await Promise.resolve(); await Promise.resolve(); assert.equal(images, 0);
  source.agentContents = original;
  const retry = await service.capture(thread.id, 'page', 1); await service.saveCapture(thread.id, retry.id, 1, selection);
  assert.equal(images, 1); assert.equal(thread.browserAnnotations!.length, 1); await service.dispose();
});
