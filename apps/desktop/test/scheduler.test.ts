import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Scheduler } from '../src/main/scheduler.ts';
import { automationSchema } from '../src/shared/contracts.ts';
import { schedulerFixture } from './fixtures/scheduler-runtime.ts';

const job = (id = 'a') => automationSchema.parse({ id, name: id, projectId: 'p', prompt: 'Check the result', targetThreadId: 't', intervalMinutes: 60, enabled: true, nextRunAt: 1 });
async function until(check: () => boolean) { for (let i = 0; i < 600; i++) { if (check()) return; await delay(5); } assert.fail('Scheduler did not settle'); }

test('busy target queues once, coalesces triggers and preserves captured configuration', async () => {
  const f = schedulerFixture(); f.data.automations.push(job()); f.data.threads[0].status = 'running'; f.scheduler.start();
  await until(() => f.data.automationRuns.length === 1); assert.equal(f.calls.length, 0);
  const run = f.data.automationRuns[0], next = f.data.automations[0].nextRunAt;
  await Promise.all([f.scheduler.enqueue('a', true), f.scheduler.enqueue('a', false, next + 1), f.scheduler.tick(next + 1)]);
  assert.equal(f.data.automationRuns.length, 1); assert.equal(run.merged, 1);
  await f.scheduler.configure({ ...f.data.automations[0], prompt: 'Changed only for future triggers' });
  f.data.threads[0].status = 'idle'; f.scheduler.drain(); await until(() => f.data.automationRuns[0].status === 'succeeded');
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].configuration.prompt, 'Check the result'); assert.equal(f.data.threads.length, 1);
  f.scheduler.stop(); await f.scheduler.settled(); assert.deepEqual(f.errors, []);
});

test('queued occurrences survive restart while uncertain dispatched runs never repeat', async () => {
  const f = schedulerFixture(); f.data.threads[0].status = 'waiting'; f.data.automations.push(job()); f.scheduler.start();
  await until(() => f.data.automationRuns.length === 1); f.scheduler.stop(); await f.scheduler.settled();
  const resumed = new Scheduler(f.runtime); resumed.recover(); f.data.threads[0].status = 'idle'; resumed.start();
  await until(() => f.data.automationRuns[0].status === 'succeeded'); assert.equal(f.calls.length, 1); resumed.stop(); await resumed.settled();
  f.data.automationRuns[0].status = 'running'; resumed.recover(); resumed.start(); await delay(20);
  assert.equal(f.data.automationRuns[0].status, 'interrupted'); assert.equal(f.calls.length, 1); resumed.stop(); await resumed.settled();
});

test('pause or removal cancels pending work without stopping already dispatched tasks', async () => {
  for (const action of ['pause', 'remove']) {
    const f = schedulerFixture(); f.data.threads[0].status = 'running'; f.data.automations.push(job()); f.scheduler.start(); await until(() => f.data.automationRuns.length === 1);
    if (action === 'pause') await f.scheduler.configure({ ...f.data.automations[0], enabled: false }); else await f.scheduler.remove('a');
    f.data.threads[0].status = 'idle'; f.scheduler.drain(); await delay(10); assert.equal(f.calls.length, 0); assert.equal(f.data.automationRuns[0].status, 'cancelled'); f.scheduler.stop(); await f.scheduler.settled();
  }
  const f = schedulerFixture(); let release = () => {}; f.setRun(() => new Promise<void>(resolve => { release = resolve; }));
  f.data.automations.push(job()); f.scheduler.start(); await until(() => f.calls.length === 1); await f.scheduler.remove('a');
  assert.equal(f.data.automationRuns[0].status, 'running'); release(); await until(() => f.data.automationRuns[0].status === 'succeeded');
  f.scheduler.stop(); await f.scheduler.settled();
});

test('different jobs for the same conversation dispatch serially and cancel only their own run', async () => {
  const f = schedulerFixture(); const release = new Map<string, () => void>();
  f.setRun((run, signal) => new Promise<void>((resolve, reject) => { release.set(run.automationId, resolve); signal.addEventListener('abort', () => reject(new Error('CANCELLED')), { once: true }); }));
  f.data.automations.push(job('first'), job('second')); f.scheduler.start(); await until(() => f.calls.length === 1); await until(() => f.data.automationRuns.length === 2);
  assert.equal(f.data.automationRuns[1].status, 'queued'); await f.scheduler.cancel(f.data.automationRuns[0].id);
  await until(() => f.calls.length === 2); assert.equal(f.data.automationRuns[0].status, 'cancelled'); assert.equal(f.data.threads[0].status, 'running');
  release.get('second')!(); await until(() => f.data.automationRuns[1].status === 'succeeded'); f.scheduler.stop(); await f.scheduler.settled();
});

test('enqueue is atomic with next trigger time; storage failures cannot launch a task', async () => {
  const f = schedulerFixture(); f.data.automations.push(job()); f.failSave(true);
  await assert.rejects(f.scheduler.enqueue('a'), /STORAGE_FAILURE/); assert.equal(f.data.automationRuns.length, 0); assert.equal(f.data.automations[0].nextRunAt, 1); assert.equal(f.calls.length, 0);
  f.failSave(false); await f.scheduler.enqueue('a'); f.failSave(true); f.scheduler.start(); await until(() => f.data.automationRuns[0].status === 'interrupted');
  assert.equal(f.calls.length, 0); assert.equal(f.errors.length, 1); f.scheduler.stop(); await f.scheduler.settled();
});

test('saving a new schedule does not change an already claimed occurrence', async () => {
  const f = schedulerFixture(); f.data.automations.push(job()); f.data.threads[0].status = 'running'; f.scheduler.start(); await until(() => f.data.automationRuns.length === 1);
  const original = structuredClone(f.data.automationRuns[0]); await f.scheduler.configure({ ...f.data.automations[0], intervalMinutes: 120, execution: { modelId: 'other', policy: 'deny', environment: 'worktree', startPoint: 'main' } });
  assert.deepEqual(f.data.automationRuns[0], original); assert(f.data.automations[0].nextRunAt > original.scheduledAt);
  f.data.threads[0].status = 'idle'; f.scheduler.drain(); await until(() => f.calls.length === 1); f.scheduler.stop(); await f.scheduler.settled();
});

test('concurrent automation edits accept one matching base and never overwrite the winner', async () => {
  const f = schedulerFixture(); const base = job(); f.data.automations.push(structuredClone(base));
  const results = await Promise.allSettled([
    f.scheduler.configure({ ...base, prompt: 'First edit' }, base),
    f.scheduler.configure({ ...base, prompt: 'Second edit' }, base),
  ]);
  assert.equal(results[0].status, 'fulfilled'); assert.equal(results[1].status, 'rejected');
  assert.equal(f.data.automations[0].prompt, 'First edit');
  assert.equal(f.data.automationRuns.length, 0); assert.equal(f.calls.length, 0);
});

test('automation editor bases ignore runtime updates but reject deleted or replaced schedules', async () => {
  const f = schedulerFixture(); const base = job(); f.data.automations.push(structuredClone(base));
  Object.assign(f.data.automations[0], { nextRunAt: 9000, lastRunAt: 8000, lastThreadId: 'latest' });
  await f.scheduler.configure({ ...base, name: 'Updated' }, base);
  assert.equal(f.data.automations[0].lastThreadId, 'latest'); assert.equal(f.data.automations[0].nextRunAt, 9000);
  await assert.rejects(f.scheduler.remove(base.id, base), /自动化已被修改或删除/);
  const latest = structuredClone(f.data.automations[0]); await f.scheduler.remove(latest.id, latest);
  await assert.rejects(f.scheduler.configure({ ...latest, prompt: 'Stale draft' }, latest), /自动化已被修改或删除/);
  assert.equal(f.data.automations.length, 0);
  await f.scheduler.configure(latest, null);
  await assert.rejects(f.scheduler.configure({ ...latest, name: 'Colliding creation' }, null), /自动化已被修改或删除/);
  assert.equal(f.data.automations[0].name, 'Updated');
});

test('failed automation persistence keeps the base retryable without applying draft state', async () => {
  const f = schedulerFixture(); const base = job(); f.data.automations.push(structuredClone(base));
  f.failSave(true); await assert.rejects(f.scheduler.configure({ ...base, prompt: 'Retry draft' }, base), /STORAGE_FAILURE/);
  assert.equal(f.data.automations[0].prompt, base.prompt);
  f.failSave(false); await f.scheduler.configure({ ...base, prompt: 'Retry draft' }, base);
  assert.equal(f.data.automations[0].prompt, 'Retry draft');
});

test('equivalent execution defaults match while stale configuration cannot cancel queued work', async () => {
  const f = schedulerFixture(); const base = job(); f.data.automations.push(structuredClone(base));
  await f.scheduler.enqueue(base.id, true);
  await f.scheduler.configure({ ...base, prompt: 'New configuration' }, { ...base, execution: { startPoint: 'HEAD', environment: 'local' } });
  await assert.rejects(f.scheduler.configure({ ...base, enabled: false }, base), /自动化已被修改或删除/);
  assert.equal(f.data.automations[0].enabled, true); assert.equal(f.data.automationRuns[0].status, 'queued');
  assert.equal(f.data.automationRuns[0].configuration.prompt, base.prompt);
  assert.equal(f.calls.length, 0);
});

test('automation occurrence remains invisible until its queue write commits', async () => {
  const f = schedulerFixture(); f.data.automations.push(job());
  let release = () => {}, entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  f.onSave(async () => { entered(); await gate; });
  const queued = f.scheduler.enqueue('a');
  try { await started; assert.equal(f.data.automationRuns.length, 0); assert.equal(f.data.automations[0].nextRunAt, 1); }
  finally { release(); await queued; f.scheduler.stop(); await f.scheduler.settled(); }
  assert.equal(f.data.automationRuns.length, 1);
});

test('automation dispatch waits for serialized start persistence during a failed configuration save', async () => {
  const f = schedulerFixture(); f.data.automations.push(job());
  let releaseStart = () => {}, enteredRun = () => {}, releaseSave = () => {}, enteredSave = () => {}, releaseRun = () => {}, started = false;
  const ready = new Promise<void>(resolve => { enteredRun = resolve; }), startGate = new Promise<void>(resolve => { releaseStart = resolve; });
  const saving = new Promise<void>(resolve => { enteredSave = resolve; }), saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
  const running = new Promise<void>(resolve => { releaseRun = resolve; });
  f.runtime.run = async (_record, _thread, _signal, onStarted) => { enteredRun(); await startGate; await onStarted(); started = true; await running; };
  f.scheduler.start(); await ready;
  f.onSave(async () => { enteredSave(); await saveGate; }); f.failSave(true);
  const edit = assert.rejects(f.scheduler.configure({ ...f.data.automations[0], prompt: 'Uncommitted edit' }), /STORAGE_FAILURE/);
  try {
    await saving; releaseStart(); await delay(15);
    assert.equal(started, false, 'model dispatch must not escape the scheduler commit queue');
  } finally {
    releaseSave(); await edit; f.failSave(false); f.onSave(async () => {}); releaseRun(); f.scheduler.stop(); await f.scheduler.settled();
  }
});

test('a failed automation start commit cannot dispatch the model and a later manual occurrence can recover', async () => {
  const f = schedulerFixture(), persist = f.runtime.save; f.data.automations.push(job());
  f.runtime.save = async next => { if (next.automationRuns.some(run => run.status === 'running')) throw new Error('START_SAVE_FAILED'); await persist(next); };
  try {
    f.scheduler.start(); await until(() => f.data.automationRuns[0]?.status === 'failed');
    assert.equal(f.calls.length, 0); assert.equal(f.data.automationRuns[0].startedAt, undefined); assert.equal(f.data.automations[0].lastRunAt, undefined);
    f.runtime.save = persist; await f.scheduler.enqueue('a', true); await until(() => f.data.automationRuns.at(-1)?.status === 'succeeded');
    assert.equal(f.calls.length, 1); assert.equal(f.data.automationRuns[0].status, 'failed'); assert.deepEqual(f.errors, []);
  } finally { f.scheduler.stop(); await f.scheduler.settled(); }
});
