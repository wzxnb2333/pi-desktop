import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { JsonStore } from '../src/main/store.ts';
import { automationSchema, threadSchema, type AutomationRun } from '../src/shared/contracts.ts';
import { mkdtemp } from './fixtures/node-temp.ts';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-automation-persistence-')), store = new JsonStore(dir); await store.load();
  const job = automationSchema.parse({ id: 'a', name: 'Automation', projectId: 'p', targetThreadId: 't', prompt: 'Verify', intervalMinutes: 60, nextRunAt: 10, enabled: true });
  const run: AutomationRun = { id: crypto.randomUUID(), automationId: job.id, configuration: structuredClone(job), status: 'queued', threadId: 't', createdAt: 1, scheduledAt: 10, manual: true, merged: 0 };
  store.data.threads.push(threadSchema.parse({ id: 't', title: 'Task', cwd: dir, projectId: 'p', createdAt: 1, updatedAt: 1, modelId: '', thinking: 'off', policy: 'deny' }));
  store.data.automations.push(job); await store.save(); return { dir, store, job, run };
}

test('failed automation enqueue and configuration writes cannot leak into background saves', async () => {
  const { dir, store, job, run } = await setup(), blocked = join(dir, 'desktop.json.tmp'); await mkdir(blocked);
  const next = { automations: [{ ...job, prompt: 'Not committed', nextRunAt: 50 }], automationRuns: [run] };
  await assert.rejects(store.saveAutomationState(next), /EISDIR|EPERM|EACCES/); assert.equal(store.data.automations[0], job); assert.equal(job.prompt, 'Verify'); assert.deepEqual(store.data.automationRuns, []);
  await rm(blocked, { recursive: true }); await store.save(); const reopened = new JsonStore(dir); await reopened.load();
  assert.equal(reopened.data.automations[0].prompt, 'Verify'); assert.equal(reopened.data.automationRuns.length, 0);
  const commit = store.saveAutomationState(next); assert.deepEqual(store.data.automationRuns, []); await Promise.all([commit, store.save()]); await reopened.load();
  assert.equal(reopened.data.automations[0].nextRunAt, 50); assert.equal(reopened.data.automationRuns[0].id, run.id);
});

test('automation start and completion commits preserve live identities and survive delayed snapshots', async () => {
  const { dir, store, job, run } = await setup(); await store.saveAutomationState({ automations: [job], automationRuns: [run] });
  const live = store.data.automationRuns[0], thread = store.data.threads[0];
  const started = store.saveAutomationState({ automations: [{ ...job, lastRunAt: 20, lastThreadId: 't' }], automationRuns: [{ ...run, status: 'running', startedAt: 20 }] });
  assert.equal(live.status, 'queued'); thread.updatedAt = 42; await Promise.all([started, store.save(), store.saveSettings({ theme: 'dark' })]);
  assert.equal(store.data.automationRuns[0], live); assert.equal(store.data.automations[0], job); assert.equal(store.data.threads[0], thread); assert.equal(live.status, 'running');
  await Promise.all([store.saveAutomationState({ automations: [job], automationRuns: [{ ...live, status: 'succeeded', finishedAt: 30 }] }), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.automationRuns[0].status, 'succeeded'); assert.equal(reopened.data.threads[0].updatedAt, 42); assert.equal(reopened.data.settings.theme, 'dark');
});

test('failed cancellation retains its durable queue record and a retry survives restart', async () => {
  const { dir, store, job, run } = await setup(); await store.saveAutomationState({ automations: [job], automationRuns: [run] });
  const blocked = join(dir, 'desktop.json.bak'); await rm(blocked); await mkdir(blocked);
  const next = { automations: [job], automationRuns: [{ ...run, status: 'cancelled' as const, finishedAt: 35 }] };
  await assert.rejects(store.saveAutomationState(next), /EISDIR|EPERM|EACCES/); assert.equal(store.data.automationRuns[0].status, 'queued');
  await rm(blocked, { recursive: true }); await Promise.all([store.saveAutomationState(next), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.equal(reopened.data.automationRuns[0].status, 'cancelled');
});

test('deleted schedules stay deleted while retained history and optional configuration remain exact', async () => {
  const { dir, store, job, run } = await setup(), original = structuredClone(job); await store.saveAutomationState({ automations: [{ ...job, execution: { modelId: 'model', environment: 'local', startPoint: 'HEAD' } }], automationRuns: [run] });
  await store.saveAutomationState({ automations: [original], automationRuns: [run] }); assert.equal(store.data.automations[0].execution, undefined);
  await Promise.all([store.saveAutomationState({ automations: [], automationRuns: [{ ...run, status: 'cancelled', finishedAt: 40 }] }), store.save()]);
  const reopened = new JsonStore(dir); await reopened.load(); assert.deepEqual(reopened.data.automations, []); assert.equal(reopened.data.automationRuns.length, 1);
  const before = await readFile(join(dir, 'desktop.json'), 'utf8'); assert.throws(() => store.saveAutomationState({ automations: [{ ...job, intervalMinutes: -1 }], automationRuns: [] })); assert.equal(await readFile(join(dir, 'desktop.json'), 'utf8'), before);
});
