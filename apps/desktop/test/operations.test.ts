import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Operations } from '../src/main/operations.ts';
import type { OperationRecord } from '../src/shared/operations.ts';

test('persistent operations are idempotent, cancellable and recover interruption without rerunning', async () => {
  let records: OperationRecord[] = []; let saved = '[]'; let runs = 0;
  const service = new Operations(() => records, async () => { saved = JSON.stringify(records); }, () => {});
  const input = { id: crypto.randomUUID(), threadId: 't', directoryId: 'p', kind: 'pr.create' };
  const run = async (signal: AbortSignal, progress: (stage: string) => void) => {
    runs++; progress('working'); await new Promise<void>((resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }); return null;
  };
  await service.start(input, run); await service.start(input, run); assert.equal(runs, 1);
  assert.throws(() => service.cancel('wrong', input.id), /不属于/);
  await assert.rejects(service.start({ ...input, id: crypto.randomUUID() }, run), /正在运行/);
  service.cancel('t', input.id); await service.dispose(); assert.equal(records[0].status, 'cancelled');
  assert.equal(JSON.parse(saved)[0].status, 'cancelled');
  records = [{ ...records[0], status: 'running' }]; await service.recover(); assert.equal(records[0].status, 'interrupted'); assert.equal(runs, 1);
});
test('operation startup fails closed when persistence fails, and successful results are retained', async () => {
  const records: OperationRecord[] = []; let ran = false; let notify: (() => void) | undefined;
  const input = { id: crypto.randomUUID(), threadId: 't', directoryId: 'p', kind: 'pr.view' };
  await assert.rejects(new Operations(() => records, async () => { throw new Error('disk'); }, () => {}).start(input, async () => { ran = true; return null; }), /disk/);
  assert.equal(ran, false); assert.equal(records.length, 0);
  const service = new Operations(() => records, async () => {}, () => { if (records[0]?.status === 'succeeded') notify?.(); });
  const completed = new Promise<void>(resolve => { notify = resolve; });
  await service.start(input, async () => ({ url: 'https://github.com/a/b/pull/1' })); await completed;
  assert.deepEqual(records[0].result, { url: 'https://github.com/a/b/pull/1' }); await service.dispose();
});

test('closing during the initial save cancels the operation before it can execute', async () => {
  const records: OperationRecord[] = []; let release: () => void = () => {}; let runs = 0; let first = true;
  const saving = new Promise<void>(resolve => { release = resolve; });
  const service = new Operations(() => records, async () => { if (first) { first = false; await saving; } }, () => {});
  const input = { id: crypto.randomUUID(), threadId: 't', directoryId: '', kind: 'test' };
  const start = service.start(input, async () => { runs++; return null; });
  const closing = service.dispose(); release(); await start; await closing;
  assert.equal(runs, 0); assert.equal(records[0].status, 'cancelled');
  await assert.rejects(service.start({ ...input, id: crypto.randomUUID() }, async () => null), /正在关闭/);
});
