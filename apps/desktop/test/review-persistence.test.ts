import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JsonStore, StoreRecoveryError } from '../src/main/store.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import type { LineComment } from '../src/shared/reviews.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

const comment: LineComment = { id: 'comment', directoryId: 'p', path: 'README.md', version: 'captured', line: 2, endLine: 2, body: 'Explain this line', excerpt: 'original line', createdAt: 1 };

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-review-store-'));
  const store = new JsonStore(dir); await store.load();
  const thread = threadSchema.parse({ id: 'review', projectId: 'p', title: 'Review', cwd: dir, modelId: '', thinking: 'off', policy: 'deny', createdAt: 1, updatedAt: 1,
    review: { parentThreadId: 'parent', scope: 'uncommitted', ref: '', instructions: '', capturedAt: 1, base: '', target: '', files: [], phase: 'running',
      findings: [{ id: 'finding', priority: 1, title: 'Guard', body: 'Missing guard', path: 'README.md', line: 2, endLine: 2 }] } });
  store.data.threads.push(thread);
  await store.save();
  return { dir, store, thread };
}

test('failed finding updates preserve live and durable annotations; unrelated saves cannot commit the failed feedback', async () => {
  const { dir, store, thread } = await setup();
  const finding = thread.review!.findings[0];
  const before = await readFile(join(dir, 'desktop.json'), 'utf8');
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: finding.id, ignored: true, feedback: 'retry once' }), /EISDIR|EPERM|EACCES/);
  assert.equal(finding.ignored, false); assert.deepEqual(finding.feedback, []);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  await rm(blocked, { recursive: true });
  store.data.ui.sidebarWidth = 320; await store.save();
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.threads[0].review!.findings[0].feedback, []);
  await store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: finding.id, ignored: true, feedback: 'retry once' });
  await reopened.load(); assert.equal(reopened.data.threads[0].review!.findings[0].ignored, true);
  assert.deepEqual(reopened.data.threads[0].review!.findings[0].feedback, ['retry once']);
});

test('failed comment additions stay absent through autosave and retry keeps exactly one captured version', async () => {
  const { dir, store, thread } = await setup();
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment }), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(thread.comments ?? [], []);
  await rm(blocked, { recursive: true }); await store.save();
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.threads[0].comments ?? [], []);
  const commit = store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment });
  assert.deepEqual(thread.comments ?? [], []);
  await Promise.all([commit, store.save()]);
  await reopened.load(); assert.deepEqual(reopened.data.threads[0].comments, [comment]);
});

test('failed comment removal retains the committed comment and queued snapshots cannot revive a successful removal', async () => {
  const { dir, store, thread } = await setup();
  await store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment });
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'commentRemove', commentId: comment.id }), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(thread.comments, [comment]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads[0].comments, [comment]);
  await rm(blocked, { recursive: true });
  const commit = store.saveReviewAnnotation(thread.id, { kind: 'commentRemove', commentId: comment.id });
  assert.deepEqual(thread.comments, [comment]);
  await Promise.all([commit, store.save(), store.saveReviewAnnotation(thread.id, { kind: 'commentRemove', commentId: comment.id })]);
  await reopened.load(); assert.deepEqual(reopened.data.threads[0].comments, []);
});

test('queued feedback, ignore toggles and same-name comments compose with settings and background saves', async () => {
  const { dir, store, thread } = await setup();
  const pending = [
    store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'first' }),
    store.save(),
    store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', ignored: true }),
    store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'second' }),
    store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment }),
    store.saveSettings({ theme: 'dark' }),
    store.save(),
    store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment: { ...comment, id: 'other', directoryId: 'extra' } }),
    store.saveReviewAnnotation(thread.id, { kind: 'commentRemove', commentId: comment.id }),
    store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', ignored: false }),
    store.save(),
  ];
  await Promise.all(pending);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.threads[0].review!.findings[0].feedback, ['first', 'second']);
  assert.equal(reopened.data.threads[0].review!.findings[0].ignored, false);
  assert.deepEqual(reopened.data.threads[0].comments, [{ ...comment, id: 'other', directoryId: 'extra' }]);
  assert.equal(reopened.data.settings.theme, 'dark');
});

test('annotation commits preserve worker object identities and runtime updates made during disk IO', async () => {
  const { dir, store, thread } = await setup();
  const review = thread.review!; const finding = review.findings[0];
  const commit = store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: finding.id, feedback: 'saved' });
  // Let the queued commit reach its first filesystem await before the worker completes.
  await Promise.resolve();
  review.phase = 'complete'; review.completedAt = 10; thread.updatedAt = 10;
  const background = store.save();
  await Promise.all([commit, background]);
  assert.equal(store.data.threads[0], thread); assert.equal(thread.review, review); assert.equal(review.findings[0], finding);
  assert.equal(review.phase, 'complete'); assert.equal(thread.updatedAt, 10); assert.deepEqual(finding.feedback, ['saved']);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads[0].review!.phase, 'complete'); assert.equal(reopened.data.threads[0].review!.completedAt, 10);
  assert.deepEqual(reopened.data.threads[0].review!.findings[0].feedback, ['saved']);
});

test('a removed target is not resurrected and invalid queued mutations do not poison later saves', async () => {
  const { dir, store, thread } = await setup();
  const missing = store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'missing', feedback: 'lost' });
  await assert.rejects(missing, /审查发现不存在/);
  const deleted = store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment });
  thread.deletedAt = 1; await assert.rejects(deleted, /回收站/); thread.deletedAt = null;
  const commit = store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'saved' });
  await Promise.resolve();
  const staleBackground = store.save();
  store.data.threads = [];
  await Promise.all([commit, staleBackground]);
  assert.deepEqual(store.data.threads, []);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads, []);
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment }), /任务不存在/);
  await store.save();
});

test('invalid annotation payloads and unrecoverable stores retain their previous disk data', async () => {
  const { dir, store, thread } = await setup();
  const before = await readFile(join(dir, 'desktop.json'), 'utf8');
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment: { ...comment, body: '' } }));
  assert.deepEqual(thread.comments ?? [], []); assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  const broken = await mkdtemp(join(tmpdir(), 'pi-review-store-')); await writeFile(join(broken, 'desktop.json'), '{broken');
  const recovery = new JsonStore(broken); await assert.rejects(recovery.load(), StoreRecoveryError);
  await assert.rejects(recovery.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment }), StoreRecoveryError);
  assert.equal(await readFile(join(broken, 'desktop.json'), 'utf8'), '{broken');
});

test('a backup failure after writing the candidate never publishes it and retry reuses the write queue', async () => {
  const { dir, store, thread } = await setup();
  const before = await readFile(join(dir, 'desktop.json'), 'utf8');
  const blocked = join(dir, 'desktop.json.bak'); await mkdir(blocked);
  await assert.rejects(store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'after backup recovery' }), /EISDIR|EPERM|EACCES/);
  assert.deepEqual(thread.review!.findings[0].feedback, []);
  assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
  assert.match(await readFile(join(dir, 'desktop.json.tmp'), 'utf8'), /after backup recovery/);
  await rm(blocked, { recursive: true });
  await store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'after backup recovery' });
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.threads[0].review!.findings[0].feedback, ['after backup recovery']);
});

test('identical finding and comment IDs in different tasks remain independently committed', async () => {
  const { dir, store, thread } = await setup();
  const other = threadSchema.parse({ ...structuredClone(thread), id: 'other' });
  store.data.threads.push(other); await store.save();
  await Promise.all([
    store.saveReviewAnnotation(thread.id, { kind: 'finding', findingId: 'finding', feedback: 'first task' }),
    store.saveReviewAnnotation(other.id, { kind: 'finding', findingId: 'finding', feedback: 'second task' }),
    store.saveReviewAnnotation(thread.id, { kind: 'commentAdd', comment }),
    store.saveReviewAnnotation(other.id, { kind: 'commentAdd', comment }),
    store.saveReviewAnnotation(thread.id, { kind: 'commentRemove', commentId: comment.id }),
    store.save(),
  ]);
  const reopened = new JsonStore(dir); await reopened.load();
  assert.deepEqual(reopened.data.threads.map(item => item.review!.findings[0].feedback), [['first task'], ['second task']]);
  assert.deepEqual(reopened.data.threads.map(item => item.comments), [[], [comment]]);
});
