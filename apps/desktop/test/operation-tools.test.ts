import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOperationTool } from '../src/main/operation-tools.ts';
import { Operations } from '../src/main/operations.ts';
import type { OperationRecord } from '../src/shared/operations.ts';
import type { OperationToolRequest } from '../src/shared/operation-tools.ts';
import { operationTool } from '../src/worker/harness-tool.ts';

function fixture() {
  const record: OperationRecord = { id: crypto.randomUUID(), threadId: 't', directoryId: 'p', kind: 'environment.action.build', status: 'running', stage: 'Building', startedAt: 1 };
  const records = [record], active = new Set([record.id]), listeners = new Set<(id: string) => void>(), stopped: string[] = [];
  let context = { threadId: 't', canCancel: true };
  const runtime = { authorize: () => context, records: () => records, active: (id: string) => active.has(id),
    subscribe(listener: (id: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async stop(threadId: string, id: string) { assert.equal(threadId, 't'); stopped.push(id); record.stage = 'Cancelling'; },
  };
  const read = (input: OperationToolRequest = { action: 'operations.read', operationId: record.id }, signal = new AbortController().signal) => runOperationTool(runtime, input, signal);
  return { record, records, active, runtime, read, listeners, stopped, change: () => { for (const listener of listeners) listener(record.id); },
    authorize: (next: typeof context) => { context = next; } };
}

test('operation listing is scoped, bounded and does not return results or unrelated records', async () => {
  const f = fixture();
  for (let i = 0; i < 55; i++) f.records.push({ ...f.record, id: crypto.randomUUID(), startedAt: i + 2, status: 'succeeded', result: { secret: 'PRIVATE_RESULT' } });
  f.records.push({ ...f.record, id: crypto.randomUUID(), threadId: 'foreign', stage: 'PRIVATE_OTHER_CHAT' }, { ...f.record, id: crypto.randomUUID(), threadId: '', stage: 'PRIVATE_GLOBAL_OPERATION' });
  const result = await f.read({ action: 'operations.list' }); assert.equal(result.kind, 'list'); if (result.kind !== 'list') throw new Error('expected list');
  assert.equal(result.total, 56); assert.equal(result.operations.length, 50); assert.equal(result.truncated, true);
  assert.equal(result.operations[0].id, f.record.id); assert.equal(result.operations[1].startedAt, 56); assert(!JSON.stringify(result).includes('PRIVATE_'));
});

test('known project results are projected and bounded while unknown result payloads remain private', async () => {
  const f = fixture(), terminalId = crypto.randomUUID();
  f.record.result = { terminalId, exitCode: 7, output: 'x'.repeat(7999) + '\uD83D\uDE00', token: 'PRIVATE_TOKEN', command: 'PRIVATE_COMMAND' };
  const result = await f.read(); assert.equal(result.kind, 'operation'); if (result.kind !== 'operation') throw new Error('expected operation');
  assert.equal(result.operation.result?.terminalId, terminalId); assert.equal(result.operation.result?.exitCode, 7);
  assert.equal(result.operation.result?.output?.length, 7999); assert.equal(result.operation.result?.outputTruncated, true); assert(!JSON.stringify(result).includes('PRIVATE_'));
  f.record.kind = 'mcp.resource'; f.record.error = 'PRIVATE_CREDENTIAL_ERROR';
  const unknown = await f.read(); assert(!JSON.stringify(unknown).includes('terminalId')); assert(!JSON.stringify(unknown).includes('PRIVATE_'));
  assert(unknown.kind === 'operation' && unknown.operation.hasError);
});

test('model operation parameters use the existing object-root provider contract', () => {
  const tool = operationTool(async () => ({ result: { content: [] } }));
  assert('type' in tool.parameters); assert.equal(tool.parameters.type, 'object');
  assert('required' in tool.parameters); assert.deepEqual(tool.parameters.required, ['action']);
});

test('waiting returns real progress and timeout without treating either as completion', async () => {
  const f = fixture(), initial = await f.read(); if (initial.kind !== 'operation') throw new Error('expected operation');
  const waiting = f.read({ action: 'operations.wait', operationId: f.record.id, cursor: initial.cursor, timeoutMs: 1000 });
  assert.equal(f.listeners.size, 1); f.record.stage = 'Testing'; f.change();
  const changed = await waiting; if (changed.kind !== 'operation') throw new Error('expected operation');
  assert.equal(changed.changed, true); assert.equal(changed.timedOut, false); assert.equal(changed.settled, false); assert.equal(changed.operation.stage, 'Testing');
  const timeout = await f.read({ action: 'operations.wait', operationId: f.record.id, cursor: changed.cursor, timeoutMs: 5 });
  if (timeout.kind !== 'operation') throw new Error('expected operation');
  assert.equal(timeout.timedOut, true); assert.equal(timeout.changed, false); assert.equal(timeout.settled, false); assert.equal(f.listeners.size, 0);
});

test('cancelling the wait does not cancel the operation and always unsubscribes', async () => {
  const f = fixture(), initial = await f.read(), controller = new AbortController(); if (initial.kind !== 'operation') throw new Error('expected operation');
  const waiting = f.read({ action: 'operations.wait', operationId: f.record.id, cursor: initial.cursor }, controller.signal);
  const rejected = assert.rejects(waiting, /WAIT_STOP/); controller.abort(new Error('WAIT_STOP')); await rejected;
  assert.equal(f.listeners.size, 0); assert.equal(f.record.status, 'running'); assert.deepEqual(f.stopped, []);
});

test('foreign operations and cursors are rejected and revoked access releases the wait', async () => {
  const f = fixture(), initial = await f.read(); if (initial.kind !== 'operation') throw new Error('expected operation');
  const foreign = { ...f.record, id: crypto.randomUUID(), threadId: 'foreign' }; f.records.push(foreign);
  await assert.rejects(f.read({ action: 'operations.read', operationId: foreign.id }), /不属于/);
  const cursor = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(initial.cursor, 'base64url').toString()), threadId: 'foreign' })).toString('base64url');
  await assert.rejects(f.read({ action: 'operations.wait', operationId: f.record.id, cursor }), /游标无效/);
  const waiting = f.read({ action: 'operations.wait', operationId: f.record.id, cursor: initial.cursor });
  const rejected = assert.rejects(waiting, /不能管理/); f.authorize({ threadId: 'changed', canCancel: true }); f.change(); await rejected;
  assert.equal(f.listeners.size, 0);
});

test('only writable project actions can be cooperatively cancelled with no completion claim', async () => {
  const f = fixture(), request = { action: 'operations.cancel' as const, operationId: f.record.id };
  f.authorize({ threadId: 't', canCancel: false }); await assert.rejects(f.read(request), /不允许模型取消/);
  f.authorize({ threadId: 't', canCancel: true }); f.record.kind = 'pr.create'; await assert.rejects(f.read(request), /不允许模型取消/);
  f.record.kind = 'environment.action.build'; const pending = await f.read(request);
  assert('cancelRequested' in pending && pending.cancelRequested); assert('settled' in pending && !pending.settled); assert.deepEqual(f.stopped, [f.record.id]);
  f.active.clear(); f.record.status = 'cancelled'; const ended = await f.read(request);
  assert('cancelRequested' in ended && !ended.cancelRequested); assert('settled' in ended && ended.settled); assert.equal(f.stopped.length, 1);
});

test('wait handles completion during subscription and removed records without leaked listeners', async () => {
  const f = fixture(), initial = await f.read(); if (initial.kind !== 'operation') throw new Error('expected operation');
  const subscribe = f.runtime.subscribe;
  f.runtime.subscribe = listener => { f.record.status = 'succeeded'; f.active.clear(); return subscribe(listener); };
  const completed = await f.read({ action: 'operations.wait', operationId: f.record.id, cursor: initial.cursor });
  assert('settled' in completed && completed.settled); assert.equal(f.listeners.size, 0);
  f.record.status = 'running'; f.active.add(f.record.id); f.runtime.subscribe = subscribe;
  const next = await f.read(); if (next.kind !== 'operation') throw new Error('expected operation');
  const waiting = f.read({ action: 'operations.wait', operationId: f.record.id, cursor: next.cursor });
  f.records.length = 0; f.change(); assert.equal((await waiting).kind, 'unavailable'); assert.equal(f.listeners.size, 0);
});

test('real operation completion is observable only after result persistence settles, including write failure', async () => {
  for (const fail of [false, true]) {
    const f = fixture(); f.records.length = 0; let release!: () => void, finish!: () => void, saving = false;
    const work = new Promise<void>(resolve => { finish = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const operations = new Operations(() => f.records, async () => { if (f.records[0].status !== 'running') { saving = true; await gate; if (fail) throw new Error('DISK_FAILURE'); } }, () => {});
    const runtime = { ...f.runtime, active: (id: string) => operations.active(id), subscribe: (listener: (id: string) => void) => operations.subscribe(listener) };
    await operations.start(f.record, async () => { await work; return { exitCode: 0 }; });
    const initial = await runOperationTool(runtime, { action: 'operations.read', operationId: f.record.id }, new AbortController().signal);
    if (initial.kind !== 'operation') throw new Error('expected operation');
    const waiting = runOperationTool(runtime, { action: 'operations.wait', operationId: f.record.id, cursor: initial.cursor }, new AbortController().signal);
    finish(); while (!saving) await new Promise<void>(resolve => setImmediate(resolve));
    const during = await runOperationTool(runtime, { action: 'operations.read', operationId: f.record.id }, new AbortController().signal);
    assert(during.kind === 'operation' && !during.settled && during.operation.status === 'running');
    release(); const completed = await waiting;
    assert(completed.kind === 'operation' && completed.settled); assert.equal(completed.operation.status, fail ? 'failed' : 'succeeded');
    if (fail) assert.match(completed.operation.error!, /DISK_FAILURE/);
    await operations.dispose();
  }
});
