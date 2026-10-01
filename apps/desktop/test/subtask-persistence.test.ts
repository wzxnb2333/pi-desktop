import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { threadSchema, uiThreadSchema } from '../src/shared/contracts.ts';
import { subtaskSchema } from '../src/shared/subtasks.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-subtask-persistence-')), store = new JsonStore(dir); await store.load();
  store.data.threads.push(threadSchema.parse({ id: 'p', projectId: '', title: 'Parent', cwd: dir, createdAt: 1, updatedAt: 1, providerId: '', thinking: 'off', policy: 'deny' }));
  store.data.ui.threads.p = uiThreadSchema.parse({ draft: { text: 'Existing draft', attachments: [] } });
  const record = subtaskSchema.parse({ id: crypto.randomUUID(), parentThreadId: 'p', definition: { title: 'Inspect', prompt: 'Read only', environment: 'local', policy: 'deny' }, context: '', status: 'succeeded', stage: '子任务已完成', result: 'Actual result', createdAt: 1 });
  await store.save(); return { dir, store, record };
}

test('subtask checkpoints remain private on failure and survive delayed session saves', async () => {
  const { dir, store, record } = await setup(), blocked = join(dir, 'desktop.json.tmp');
  await mkdir(blocked); await assert.rejects(store.saveSubtasks([record])); assert.equal(store.data.subtasks.length, 0);
  await rm(blocked, { recursive: true }); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.subtasks.length, 0);
  const commit = store.saveSubtasks([record]); assert.equal(store.data.subtasks.length, 0); await Promise.all([commit, store.save()]);
  await reopened.load(); assert.equal(reopened.data.subtasks[0].result, 'Actual result');
  const live = store.data.subtasks[0]; await Promise.all([store.saveSubtasks([{ ...record, stage: 'Saved update' }]), store.save()]);
  assert.equal(store.data.subtasks[0], live); await reopened.load(); assert.equal(reopened.data.subtasks[0].stage, 'Saved update');
});

test('result delivery persists the draft and receipt together and deduplicates retries', async () => {
  const { dir, store, record } = await setup(); await store.saveSubtasks([record]);
  const live = store.data.subtasks[0], parent = store.data.threads[0];
  const delivering = store.deliverSubtask('p', record.id); assert.equal(live.deliveredAt, undefined);
  await Promise.all([delivering, store.deliverSubtask('p', record.id), store.save()]);
  const expected = 'Existing draft\n\nInspect\nActual result'; assert.equal(store.data.ui.threads.p.draft!.text, expected);
  assert.equal(store.data.subtasks[0], live); assert.equal(store.data.threads[0], parent); assert(live.deliveredAt);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.ui.threads.p.draft!.text, expected); assert.equal(reopened.data.subtasks[0].deliveredAt, live.deliveredAt);
  await reopened.deliverSubtask('p', record.id); assert.equal(reopened.data.ui.threads.p.draft!.text, expected);
});

test('delivery storage failure retains the draft and allows one durable retry', async () => {
  const { dir, store, record } = await setup(); await store.saveSubtasks([record]);
  const blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  await assert.rejects(store.deliverSubtask('p', record.id)); assert.equal(store.data.subtasks[0].deliveredAt, undefined); assert.equal(store.data.ui.threads.p.draft!.text, 'Existing draft');
  await rm(blocked, { recursive: true }); await store.save(); const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.subtasks[0].deliveredAt, undefined); assert.equal(reopened.data.ui.threads.p.draft!.text, 'Existing draft');
  await reopened.deliverSubtask('p', record.id); assert.equal(reopened.data.ui.threads.p.draft!.text, 'Existing draft\n\nInspect\nActual result');
});

test('typing during delivery is preserved and requires an explicit retry against the latest draft', async () => {
  const { dir, store, record } = await setup(); await store.saveSubtasks([record]);
  const delivering = store.deliverSubtask('p', record.id);
  // The queued operation takes its snapshot in the first microtask, before async disk I/O.
  await Promise.resolve(); store.data.ui.threads.p.draft!.text = 'Newer typing';
  await assert.rejects(delivering, /草稿已变化/); assert.equal(store.data.subtasks[0].deliveredAt, undefined); assert.equal(store.data.ui.threads.p.draft!.text, 'Newer typing');
  await store.save(); const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.ui.threads.p.draft!.text, 'Newer typing'); assert.equal(reopened.data.subtasks[0].deliveredAt, undefined);
  await store.deliverSubtask('p', record.id); assert.equal(store.data.ui.threads.p.draft!.text, 'Newer typing\n\nInspect\nActual result');
});

test('unavailable parents and scoped or unfinished results cannot change another draft', async () => {
  const { store, record } = await setup(); await store.saveSubtasks([{ ...record, status: 'running', result: undefined }]);
  await assert.rejects(store.deliverSubtask('p', record.id), /尚未可用/);
  await assert.rejects(store.deliverSubtask('p', crypto.randomUUID()), /不属于/);
  await store.saveSubtasks([record]); const delivering = store.deliverSubtask('p', record.id);
  await Promise.resolve(); store.data.threads[0].archived = true;
  await assert.rejects(delivering, /不可用/); assert.equal(store.data.ui.threads.p.draft!.text, 'Existing draft'); assert.equal(store.data.subtasks[0].deliveredAt, undefined);
});
