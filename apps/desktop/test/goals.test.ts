import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Goals } from '../src/main/goals.ts';
import { threadSchema, requestSchema } from '../src/shared/contracts.ts';
import type { Goal } from '../src/shared/goals.ts';

async function until(check: () => boolean) { for (let i = 0; i < 400; i++) { if (check()) return; await delay(5); } assert.fail('Goal did not settle'); }
function fixture() {
  const thread = threadSchema.parse({ id: 't', projectId: '', title: 'Goal', cwd: 'unused', createdAt: 1, updatedAt: 1, modelId: 'local', thinking: 'off', policy: 'deny', plan: [{ text: 'Independent plan', status: 'pending' }] });
  let run = async () => {}, saveHook = async () => {}, busy = false, saveError = false, calls = 0;
  const errors: unknown[] = [];
  const service = new Goals({ threads: () => [thread], busy: () => busy,
    run: async () => { calls++; await run(); }, save: async (_id, goal) => { await saveHook(); if (saveError) throw new Error('STORAGE_FAILURE'); thread.goal = structuredClone(goal); }, changed: () => {}, error: error => errors.push(error) }, 1);
  const definition = { objective: 'Complete both verified steps', criteria: [{ id: crypto.randomUUID(), text: 'First' }, { id: crypto.randomUUID(), text: 'Second' }] };
  return { thread, service, errors, definition, get calls() { return calls; }, setRun(value: typeof run) { run = value; }, setSaveHook(value: typeof saveHook) { saveHook = value; }, setBusy(value: boolean) { busy = value; }, failSave(value: boolean) { saveError = value; } };
}
function checkpoint(goal: Goal, count: number, status: 'active' | 'completed' | 'blocked' = 'active') {
  return { goalId: goal.id, revision: goal.revision, summary: 'Verified result', status,
    checks: goal.criteria.slice(0, count).map(item => ({ id: item.id, completed: true, evidence: 'Verified actual outcome for ' + item.text })) };
}

test('goal continues only after finished turns and requires evidence independent of plan steps', async () => {
  const f = fixture();
  f.setRun(async () => {
    assert(f.thread.goal?.pendingRunId);
    await f.service.checkpoint('t', checkpoint(f.thread.goal, f.calls, f.calls === 2 ? 'completed' : 'active'));
    if (f.calls === 2) assert.equal(f.thread.goal.status, 'active', 'completion waits for successful turn');
  });
  await f.service.save('t', f.definition, true); await until(() => f.thread.goal?.status === 'completed');
  assert.equal(f.calls, 2); assert.equal(f.thread.goal?.rounds, 2); assert.equal(f.thread.plan[0].status, 'pending');
  assert(f.thread.goal?.history.every(item => item.status === 'succeeded' && item.finishedAt)); assert.equal(f.thread.goal?.pendingRunId, undefined);
  f.service.stop(); await f.service.settled(); assert.deepEqual(f.errors, []);
});

test('three no-progress or failing turns stop automatically; resume is explicit', async () => {
  const f = fixture(); await f.service.save('t', f.definition, true); await until(() => f.thread.goal?.status === 'blocked');
  assert.equal(f.calls, 3); assert.equal(f.thread.goal?.noProgress, 3);
  const g = f.thread.goal!; f.setRun(async () => { throw new Error('PROVIDER_FAILED'); });
  await f.service.control('t', g.id, g.revision, 'resume'); await until(() => f.thread.goal?.consecutiveFailures === 3);
  assert.equal(f.calls, 6); assert.equal(f.thread.goal?.status, 'blocked');
  f.service.stop(); await f.service.settled(); assert.deepEqual(f.errors, []);
});

test('pause preserves current turn, stale checkpoints cannot resume, and clear cannot resurrect a goal', async () => {
  const f = fixture(); let release = () => {}; f.setRun(() => new Promise<void>(resolve => { release = resolve; }));
  await f.service.save('t', f.definition, true); await until(() => f.calls === 1);
  const stale = structuredClone(f.thread.goal!); await f.service.pause('t', 'User paused');
  await assert.rejects(f.service.checkpoint('t', checkpoint(stale, 2, 'completed')), /目标已更新/);
  release(); await f.service.settled(); assert.equal(f.calls, 1); assert.equal(f.thread.goal?.status, 'paused');
  const g = f.thread.goal!; await f.service.control('t', g.id, g.revision, 'resume'); await until(() => f.calls === 2);
  const next = structuredClone(f.thread.goal!); await f.service.control('t', next.id, next.revision, 'clear');
  release(); await f.service.settled(); assert.equal(f.thread.goal, undefined);
  await assert.rejects(f.service.checkpoint('t', checkpoint(next, 2, 'completed')));
  f.service.stop(); assert.deepEqual(f.errors, []);
});

test('checkpoints validate IDs, revisions and evidence; edits keep only unchanged verified criteria', async () => {
  const f = fixture(); let release = () => {}; f.setRun(() => new Promise<void>(resolve => { release = resolve; }));
  await f.service.save('t', f.definition, true); await until(() => f.calls === 1);
  let g = f.thread.goal!;
  await assert.rejects(f.service.checkpoint('t', { ...checkpoint(g, 0, 'completed') }), /尚有未完成/);
  g = f.thread.goal!; await assert.rejects(f.service.checkpoint('t', { ...checkpoint(g, 1), checks: [{ id: g.criteria[0].id, completed: true, evidence: '' }] }), /证据/);
  g = f.thread.goal!; await assert.rejects(f.service.checkpoint('t', { ...checkpoint(g, 1), checks: [{ id: crypto.randomUUID(), completed: true, evidence: 'wrong' }] }), /无效/);
  g = f.thread.goal!; await f.service.checkpoint('t', checkpoint(g, 1));
  g = f.thread.goal!; await assert.rejects(f.service.save('t', f.definition, false, g.id, g.revision - 1), /已更新/);
  g = f.thread.goal!; const changed = { ...f.definition, criteria: [{ ...f.definition.criteria[0], text: 'Changed first' }, f.definition.criteria[1]] };
  await f.service.save('t', changed, false, g.id, g.revision); assert.equal(f.thread.goal?.criteria[0].completed, false);
  release(); await f.service.settled(); f.service.stop(); assert.deepEqual(f.errors, []);
  assert.equal(requestSchema.safeParse({ op: 'goal.save', threadId: 't', start: true, definition: { ...changed, criteria: [changed.criteria[0], changed.criteria[0]] } }).success, false);
});

test('storage failure rolls back edits and blocks continuation without a retry loop', async () => {
  const f = fixture(); const g = await f.service.save('t', f.definition, false);
  f.failSave(true); await assert.rejects(f.service.save('t', { ...f.definition, objective: 'Changed' }, true, g.id, g.revision), /STORAGE_FAILURE/);
  assert.equal(f.thread.goal?.objective, f.definition.objective); assert.equal(f.thread.goal?.status, 'paused');
  f.failSave(false); f.setBusy(true); const current = f.thread.goal!; await f.service.control('t', current.id, current.revision, 'resume');
  f.failSave(true); f.setBusy(false); f.service.kick('t'); await until(() => f.thread.goal?.status === 'blocked');
  assert.equal(f.calls, 0); assert.equal(f.errors.length, 1); await delay(30); assert.equal(f.errors.length, 1);
  f.service.stop(); await f.service.settled();
});

test('restart retains interrupted evidence and never repeats an uncertain round', async () => {
  const f = fixture(); f.setBusy(true); await f.service.save('t', f.definition, true);
  const g = f.thread.goal!, id = crypto.randomUUID(); g.pendingRunId = id; g.history.push({ id, startedAt: 1, status: 'running', summary: 'Before crash' });
  f.service.recover(); f.setBusy(false); f.service.kick('t'); await delay(30);
  assert.equal(f.calls, 0); assert.equal(g.status, 'blocked'); assert.equal(g.history[0].status, 'interrupted'); assert.equal(g.pendingRunId, undefined);
  assert.equal(g.history[0].summary, 'Before crash'); f.service.stop();
});

test('goal publication waits for persistence and a failed edit cannot escape through live state', async () => {
  const f = fixture(), saved = await f.service.save('t', f.definition, false);
  let release = () => {}, entered = () => {};
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.setSaveHook(async () => { entered(); await gate; }); f.failSave(true);
  const edit = f.service.save('t', { ...f.definition, objective: 'Uncommitted objective' }, true, saved.id, saved.revision);
  const failed = assert.rejects(edit, /STORAGE_FAILURE/);
  try {
    await started;
    assert.deepEqual(f.thread.goal, saved, 'snapshots and schedulers must see the committed goal while saving');
  } finally { release(); await failed; f.service.stop(); await f.service.settled(); }
  assert.deepEqual(f.thread.goal, saved); assert.equal(f.calls, 0);
});

test('failed finalization releases the finished round and permits explicit resume after storage recovery', async () => {
  const f = fixture(); f.setRun(async () => { f.failSave(true); });
  try {
    await f.service.save('t', f.definition, true); await until(() => f.errors.length === 1);
    assert.equal(f.thread.goal?.status, 'blocked');
    assert.equal(f.thread.goal?.pendingRunId, undefined, 'an ended worker cannot reserve the task forever');
    assert.equal(f.thread.goal?.history.at(-1)?.status, 'interrupted');
    assert.equal(f.calls, 1);
    f.failSave(false); f.setRun(async () => { await f.service.checkpoint('t', checkpoint(f.thread.goal!, 2, 'completed')); });
    const g = f.thread.goal!; await f.service.control('t', g.id, g.revision, 'resume');
    await until(() => f.thread.goal?.status === 'completed'); assert.equal(f.calls, 2);
  } finally { f.service.stop(); await f.service.settled(); }
});

test('archiving an active task records the ended round without leaving a pending reservation', async () => {
  const f = fixture(); let release = () => {}; f.setRun(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    await f.service.save('t', f.definition, true); await until(() => f.calls === 1);
    await f.service.pause('t', 'Archived'); f.thread.archived = true;
    release(); await f.service.settled();
    assert.equal(f.thread.goal?.pendingRunId, undefined); assert.equal(f.thread.goal?.history[0].status, 'succeeded'); assert.equal(f.thread.goal?.status, 'paused');
    assert.equal(f.calls, 1); assert.deepEqual(f.errors, []);
  } finally { release(); f.service.stop(); await f.service.settled(); }
});

for (const method of ['control', 'stop'] as const)
test('goal pause remains effective after persistence failure through ' + method, async () => {
  const f = fixture(); let release = () => {}; f.setRun(() => new Promise<void>(resolve => { release = resolve; }));
  try {
    await f.service.save('t', f.definition, true); await until(() => f.calls === 1); f.failSave(true);
    const g = f.thread.goal!;
    await assert.rejects(method === 'control' ? f.service.control('t', g.id, g.revision, 'pause') : f.service.pause('t', 'User stopped'), /暂停状态未能保存/);
    assert.equal(f.thread.goal?.status, 'paused'); assert.equal(f.thread.goal?.objective, f.definition.objective);
    f.failSave(false); release(); await f.service.settled(); assert.equal(f.calls, 1); assert.equal(f.thread.goal?.status, 'paused');
    f.setRun(async () => { await f.service.checkpoint('t', checkpoint(f.thread.goal!, 2, 'completed')); });
    const current = f.thread.goal!; await f.service.control('t', current.id, current.revision, 'resume'); await until(() => f.thread.goal?.status === 'completed'); assert.equal(f.calls, 2);
  } finally { release(); f.service.stop(); await f.service.settled(); }
});
