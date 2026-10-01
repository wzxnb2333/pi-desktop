import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { threadSchema } from '../src/shared/contracts.ts';
import { goalSchema } from '../src/shared/goals.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-goal-persistence-')), store = new JsonStore(dir); await store.load();
  const thread = threadSchema.parse({ id: 't', projectId: '', title: 'Goal', cwd: dir, createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' });
  const goal = goalSchema.parse({ id: crypto.randomUUID(), revision: 1, objective: 'Verified objective', criteria: [{ id: crypto.randomUUID(), text: 'Verified result', completed: false, evidence: '' }], status: 'paused', reason: '', createdAt: 1, updatedAt: 1, rounds: 0, consecutiveFailures: 0, noProgress: 0, burstRounds: 0, history: [] });
  store.data.threads.push(thread); await store.save();
  return { dir, store, thread, goal };
}

test('goal creation and failed edits remain private until atomic persistence succeeds', async () => {
  const { dir, store, thread, goal } = await setup(), blocked = join(dir, 'desktop.json.tmp');
  await mkdir(blocked); await assert.rejects(store.saveGoal('t', goal), /EISDIR|EPERM|EACCES/); assert.equal(thread.goal, undefined);
  await rm(blocked, { recursive: true }); await store.save();
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.threads[0].goal, undefined);
  const commit = store.saveGoal('t', goal); assert.equal(thread.goal, undefined); await Promise.all([commit, store.save()]);
  await reopened.load(); assert.deepEqual(reopened.data.threads[0].goal, goal);
  await mkdir(blocked); await assert.rejects(store.saveGoal('t', { ...goal, objective: 'Failed edit', revision: 2, status: 'active' }, goal)); assert.deepEqual(thread.goal, goal);
  await rm(blocked, { recursive: true }); await store.save(); await reopened.load(); assert.deepEqual(reopened.data.threads[0].goal, goal);
});

test('goal checkpoints and clearing survive delayed snapshots without replacing the running thread', async () => {
  const { dir, store, thread, goal } = await setup(); await store.saveGoal('t', goal);
  const next = { ...goal, revision: 2, reason: 'Verified checkpoint' };
  const commit = store.saveGoal('t', next, goal); thread.updatedAt = 55; await Promise.all([commit, store.save()]);
  assert.equal(store.data.threads[0], thread); const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.threads[0].goal?.reason, next.reason); assert.equal(reopened.data.threads[0].updatedAt, 55);
  await Promise.all([store.saveGoal('t', undefined, next), store.save()]); await reopened.load(); assert.equal(reopened.data.threads[0].goal, undefined);
});

test('goal version conflicts reject stale writes and unrelated settings commit independently', async () => {
  const { dir, store, thread, goal } = await setup(); await store.saveGoal('t', goal);
  const next = { ...goal, objective: 'New goal text', revision: 2 };
  const first = store.saveGoal('t', next, goal), stale = store.saveGoal('t', { ...goal, objective: 'Stale overwrite', revision: 2 }, goal);
  await Promise.all([first, assert.rejects(stale, /目标已更新/), store.saveSettings({ theme: 'dark' }), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads[0].goal, next); assert.equal(reopened.data.settings.theme, 'dark'); assert.equal(store.data.threads[0], thread);
});

test('goal writes cannot recreate a removed task or clear another goal identity', async () => {
  const { dir, store, thread, goal } = await setup(); await store.saveGoal('t', goal);
  await assert.rejects(store.saveGoal('t', undefined, { ...goal, id: crypto.randomUUID() }), /目标已更新/);
  assert.throws(() => store.saveGoal('t', { ...goal, criteria: [] }, goal));
  const commit = store.saveGoal('t', { ...goal, revision: 2 }, goal); await Promise.resolve();
  const background = store.save(); store.data.threads = [];
  await Promise.all([commit, background]); assert.equal(thread.goal?.revision, 1);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.threads, []);
  await assert.rejects(store.saveGoal('t', goal), /任务不存在/);
});
