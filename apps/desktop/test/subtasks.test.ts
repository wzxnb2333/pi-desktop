import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Subtasks } from '../src/main/subtasks.ts';
import { publishSubtasks } from '../src/main/subtask-state.ts';
import { defaultData, requestSchema, threadSchema, type Thread } from '../src/shared/contracts.ts';
import { activeSubtask, type Subtask, type SubtaskDefinition } from '../src/shared/subtasks.ts';

const definition: SubtaskDefinition = { title: 'Inspect files', prompt: 'Read and report only', environment: 'local', startPoint: 'HEAD', policy: 'deny', includeContext: true };
async function until(check: () => boolean) { for (let i = 0; i < 400; i++) { if (check()) return; await delay(5); } assert.fail('Subtask did not settle'); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function fixture() {
  const state = defaultData(); state.settings.subtasksEnabled = true;
  state.threads.push(threadSchema.parse({ id: 'p', projectId: 'project', title: 'Parent', cwd: 'unused', createdAt: 1, updatedAt: 1, providerId: 'local', thinking: 'off', policy: 'auto', items: [{ id: 'message', role: 'user', text: 'Captured context', timestamp: 1 }] }));
  let saveError = false, failPrepare = false, calls = 0;
  let saving = async (_records: Subtask[]) => {};
  const errors: unknown[] = [];
  let run: (record: Subtask, child: Thread, signal: AbortSignal) => Promise<string> = async () => 'Actual result';
  const service = new Subtasks({ records: () => state.subtasks, threads: () => state.threads, enabled: () => state.settings.subtasksEnabled,
    prepare: async record => { if (failPrepare) throw new Error('PREPARE_FAILED'); const child = { ...state.threads[0], id: crypto.randomUUID(), subtaskId: record.id }; state.threads.push(child); return child; },
    run: async (...args) => { calls++; return run(...args); }, save: async records => { await saving(records); if (saveError) throw new Error('STORAGE_FAILURE'); publishSubtasks(state.subtasks, records); }, deliver: async () => {}, changed: () => {}, error: error => errors.push(error) });
  return { state, service, errors, get calls() { return calls; }, setRun(next: typeof run) { run = next; }, onSave(next: typeof saving) { saving = next; }, failSave(next: boolean) { saveError = next; }, failPrepare(next: boolean) { failPrepare = next; } };
}

test('uncommitted delegation stays private and cannot dispatch before storage succeeds', async () => {
  const f = fixture(), gate = deferred(); let entered = false;
  f.onSave(async () => { entered = true; await gate.promise; });
  const creating = f.service.create('p', crypto.randomUUID(), definition);
  try {
    await until(() => entered);
    assert.equal(f.state.subtasks.length, 0, 'A failed save must never publish a queued task');
    f.service.drain(); assert.equal(f.calls, 0);
  } finally { gate.resolve(); await creating; await f.service.dispose(); }
});

test('stopping during a queued save also cancels the delegation currently being committed', async () => {
  const f = fixture(), gate = deferred(); let entered = false;
  f.onSave(async () => { entered = true; await gate.promise; });
  const creating = f.service.create('p', crypto.randomUUID(), definition);
  await until(() => entered);
  const stopping = f.service.stop('p'); gate.resolve();
  await creating; await stopping; await f.service.dispose();
  assert.equal(f.calls, 0); assert.equal(f.state.subtasks[0]?.status, 'cancelled');
});

test('subtasks require opt-in and explicit scoped permissions; request IDs deduplicate actual dispatch', async () => {
  assert.equal(defaultData().settings.subtasksEnabled, false); const f = fixture(); f.state.settings.subtasksEnabled = false;
  await assert.rejects(f.service.create('p', crypto.randomUUID(), definition), /启用/); f.state.settings.subtasksEnabled = true;
  await assert.rejects(f.service.create('p', crypto.randomUUID(), { ...definition, policy: 'auto' }), /只允许读取/);
  f.state.threads[0].policy = 'deny'; await assert.rejects(f.service.create('p', crypto.randomUUID(), { ...definition, environment: 'worktree', policy: 'ask' }), /权限/);
  const id = crypto.randomUUID(); await Promise.all([f.service.create('p', id, definition), f.service.create('p', id, definition)]);
  await until(() => f.state.subtasks[0]?.status === 'succeeded'); assert.equal(f.calls, 1); assert.equal(f.state.subtasks.length, 1);
  assert.match(f.state.subtasks[0].context, /Captured context/); assert.equal(f.state.subtasks[0].result, 'Actual result');
  await assert.rejects(f.service.create('p', id, { ...definition, prompt: 'different' }), /已被使用/); await f.service.dispose(); assert.deepEqual(f.errors, []);
  assert.equal(requestSchema.safeParse({ op: 'subtask.create', parentThreadId: 'p', requestId: id, definition: { ...definition, injected: true } }).success, false);
});

test('four active slots bound concurrency and stop isolates parents while preserving results', async () => {
  const f = fixture(); f.state.threads.push({ ...f.state.threads[0], id: 'other' });
  f.setRun(async (_record, _child, signal) => { await delay(60000, undefined, { signal }); return 'unreachable'; });
  for (let i = 0; i < 5; i++) await f.service.create('p', crypto.randomUUID(), definition);
  const other = await f.service.create('other', crypto.randomUUID(), definition);
  await until(() => f.calls === 4); assert.equal(f.state.subtasks.filter(item => item.status === 'queued').length, 2);
  await assert.rejects(f.service.stop('p', other.id), /不属于/);
  await f.service.stop('p'); await until(() => f.calls === 5);
  assert(f.state.subtasks.filter(item => item.parentThreadId === 'p').every(item => item.status === 'cancelled'));
  assert.equal(f.state.subtasks.find(item => item.id === other.id)?.status, 'running');
  f.service.cancelChild(f.state.subtasks.find(item => item.id === other.id)!.childThreadId!);
  await until(() => !f.state.subtasks.some(activeSubtask)); await f.service.dispose(); assert.deepEqual(f.errors, []);
});

test('children cannot recursively delegate and records retain the parent message anchor', async () => {
  const f = fixture(); const record = await f.service.create('p', crypto.randomUUID(), definition);
  await until(() => f.state.subtasks[0]?.status === 'succeeded');
  assert.equal(record.parentItemId, 'message');
  const child = f.state.threads.find(thread => thread.subtaskId === record.id)!;
  await assert.rejects(f.service.create(child.id, crypto.randomUUID(), definition), /不能继续委派/);
  await f.service.dispose();
});

test('restart marks uncertain work interrupted; completion and captured source remain durable data', async () => {
  const f = fixture(); await f.service.create('p', crypto.randomUUID(), definition); await until(() => f.state.subtasks[0]?.status === 'succeeded');
  const completed = structuredClone(f.state.subtasks[0]);
  for (const status of ['queued', 'preparing', 'running'] as const) f.state.subtasks.push({ ...completed, id: crypto.randomUUID(), status, result: undefined });
  f.service.recover(); f.service.drain(); await delay(20); assert.equal(f.calls, 1);
  assert.equal(f.state.subtasks[0].result, 'Actual result'); assert(f.state.subtasks.slice(1).every(item => item.status === 'interrupted'));
  await f.service.dispose();
});

test('preparation failure and storage failure preserve evidence without running or retrying', async () => {
  const f = fixture(); f.failSave(true); await assert.rejects(f.service.create('p', crypto.randomUUID(), definition), /STORAGE_FAILURE/); assert.equal(f.state.subtasks.length, 0);
  f.failSave(false); f.failPrepare(true); await f.service.create('p', crypto.randomUUID(), definition);
  await until(() => f.state.subtasks[0]?.status === 'failed'); assert.equal(f.calls, 0); assert.equal(f.state.subtasks[0].error, 'PREPARE_FAILED');
  f.service.drain(); await delay(20); assert.equal(f.calls, 0); await f.service.dispose();
});

test('parent removal blocks concurrent delegation and cancels only its active children', async () => {
  const f = fixture(); f.setRun(async (_record, _child, signal) => { await delay(60000, undefined, { signal }); return ''; });
  await f.service.create('p', crypto.randomUUID(), definition); await until(() => f.calls === 1);
  const changing = f.service.changeParent('p', () => { f.state.threads[0].deletedAt = Date.now(); });
  await assert.rejects(f.service.create('p', crypto.randomUUID(), definition), /不可用/); await changing;
  assert.equal(f.state.subtasks[0].status, 'cancelled'); assert(f.state.threads[0].deletedAt); await f.service.dispose();
});

test('stopping while the running checkpoint saves never starts the child model', async () => {
  const f = fixture(), gate = deferred(); let entered = false;
  f.onSave(async records => { if (records[0]?.status === 'running') { entered = true; await gate.promise; } });
  await f.service.create('p', crypto.randomUUID(), definition); await until(() => entered);
  const stopping = f.service.stop('p'); gate.resolve(); await stopping;
  assert.equal(f.calls, 0); assert.equal(f.state.subtasks[0].status, 'cancelled'); await f.service.dispose();
});

test('failed running and completion checkpoints cannot dispatch or claim a persisted result', async () => {
  const f = fixture();
  f.onSave(async records => { if (records.some(record => record.status === 'running')) throw new Error('START_CHECKPOINT_FAILED'); });
  await f.service.create('p', crypto.randomUUID(), definition); await until(() => f.state.subtasks[0]?.status === 'failed');
  assert.equal(f.calls, 0); assert.match(f.state.subtasks[0].error!, /START_CHECKPOINT_FAILED/);
  f.onSave(async records => { if (records.some(record => record.status === 'succeeded')) throw new Error('RESULT_CHECKPOINT_FAILED'); });
  await f.service.create('p', crypto.randomUUID(), definition); await until(() => f.state.subtasks[1]?.status === 'failed');
  assert.equal(f.calls, 1); assert.equal(f.state.subtasks[1].result, undefined); assert.match(f.state.subtasks[1].error!, /RESULT_CHECKPOINT_FAILED/);
  f.service.drain(); await f.service.dispose(); assert.equal(f.calls, 1);
});

test('restart repairs a child relation from the persisted child identity without replay', async () => {
  const f = fixture(), id = crypto.randomUUID();
  f.state.subtasks.push({ id, parentThreadId: 'p', definition, context: '', status: 'preparing', stage: '', createdAt: 1 });
  f.state.threads.push({ ...f.state.threads[0], id: 'recovered-child', subtaskId: id });
  f.service.recover(); f.service.drain(); await f.service.dispose();
  assert.equal(f.state.subtasks[0].childThreadId, 'recovered-child'); assert.equal(f.state.subtasks[0].status, 'interrupted'); assert.equal(f.calls, 0);
});

test('failed stop persistence never releases the queued child into an open execution slot', async () => {
  const f = fixture(), gate = deferred(); f.setRun(async () => { await gate.promise; return 'Completed'; });
  try {
    for (let i = 0; i < 5; i++) await f.service.create('p', crypto.randomUUID(), definition);
    await until(() => f.calls === 4); const queued = f.state.subtasks.find(record => record.status === 'queued')!;
    f.failSave(true); await assert.rejects(f.service.stop('p', queued.id), /STORAGE_FAILURE/);
    assert.equal(queued.status, 'interrupted'); f.failSave(false); gate.resolve();
    await until(() => !f.state.subtasks.some(activeSubtask)); assert.equal(f.calls, 4);
  } finally { f.failSave(false); gate.resolve(); await f.service.dispose(); }
});
