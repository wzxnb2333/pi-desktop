import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OperationRecord } from '../shared/operations.ts';
import { operationToolSchema, type OperationToolRequest } from '../shared/operation-tools.ts';

interface OperationToolRuntime {
  authorize(): { threadId: string; canCancel: boolean };
  records(): OperationRecord[];
  active(id: string): boolean;
  subscribe(listener: (id: string) => void): () => void;
  stop(threadId: string, id: string): Promise<void>;
}
const cursorSchema = z.object({ version: z.literal(1), threadId: z.string(), operationId: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const projectAction = (kind: string) => /^environment\.(?:initialization|cleanup|action\..+)$/.test(kind);
function bounded(value: string, limit: number): string {
  const end = value.length > limit && /[\uD800-\uDBFF]/.test(value[limit - 1]) && /[\uDC00-\uDFFF]/.test(value[limit]) ? limit - 1 : limit;
  return value.slice(0, end);
}

/** Scoped observation and cooperative cancellation; never launches, retries or force-kills a job. */
export async function runOperationTool(runtime: OperationToolRuntime, input: OperationToolRequest, signal: AbortSignal) {
  const request = operationToolSchema.parse(input);
  signal.throwIfAborted(); const threadId = runtime.authorize().threadId;
  const context = () => {
    signal.throwIfAborted(); const current = runtime.authorize();
    if (current.threadId !== threadId) throw new Error('此会话不能管理桌面操作');
    return current;
  };
  const metadata = (record: OperationRecord) => ({
    id: record.id, directoryId: record.directoryId, kind: bounded(record.kind, 200),
    status: runtime.active(record.id) ? 'running' as const : record.status,
    stage: bounded(record.stage, 1000), startedAt: record.startedAt, endedAt: runtime.active(record.id) ? undefined : record.endedAt,
    cancellable: context().canCancel && projectAction(record.kind) && runtime.active(record.id),
  });
  if (request.action === 'operations.list') {
    const records = runtime.records().filter(record => record.threadId === threadId).sort((a, b) =>
      Number(runtime.active(b.id)) - Number(runtime.active(a.id)) || b.startedAt - a.startedAt);
    return { kind: 'list' as const, operations: records.slice(0, 50).map(metadata), total: records.length, truncated: records.length > 50 };
  }
  const current = () => {
    context(); const record = runtime.records().find(record => record.id === request.operationId);
    if (record && record.threadId !== threadId) throw new Error('操作不存在或不属于此任务');
    return record;
  };
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (request.action === 'operations.wait' && request.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString()));
      if (cursor.threadId !== threadId || cursor.operationId !== request.operationId) throw new Error('scope');
    } catch { throw new Error('操作读取游标无效，请重新读取'); }
  }
  const initial = current(); if (!initial) throw new Error('操作不存在或不属于此任务');
  const snapshot = (record: OperationRecord) => {
    // Project actions have a known result shape. Other operation results may contain credentials
    // or resource payloads; inspect them through their dedicated tools/views, never raw JSON here.
    const raw = projectAction(record.kind) && record.result && !Array.isArray(record.result) && typeof record.result === 'object' ? record.result : undefined;
    const result = raw ? {
      terminalId: z.uuid().safeParse(raw.terminalId).success ? String(raw.terminalId) : undefined,
      exitCode: typeof raw.exitCode === 'number' ? raw.exitCode : undefined,
      output: typeof raw.output === 'string' ? bounded(raw.output, 8000) : undefined,
      outputTruncated: typeof raw.output === 'string' && raw.output.length > 8000,
    } : undefined;
    const operation = { ...metadata(record), hasError: !!record.error, error: projectAction(record.kind) && record.error ? bounded(record.error, 2000) : undefined, result };
    const hash = createHash('sha256').update(JSON.stringify(operation)).digest('hex');
    return { kind: 'operation' as const, operation, settled: !runtime.active(record.id) && record.status !== 'running',
      cursor: Buffer.from(JSON.stringify({ version: 1, threadId, operationId: record.id, hash })).toString('base64url'),
      changed: !cursor || hash !== cursor.hash, timedOut: false };
  };
  if (request.action === 'operations.cancel') {
    if (!context().canCancel || !projectAction(initial.kind)) throw new Error('此操作不允许模型取消，请使用对应界面');
    const cancelRequested = runtime.active(initial.id);
    if (cancelRequested) await runtime.stop(threadId, initial.id);
    const record = current(); if (!record) throw new Error('操作不存在或不属于此任务');
    return { ...snapshot(record), cancelRequested };
  }
  const first = snapshot(initial);
  if (request.action !== 'operations.wait' || !cursor || first.changed || first.settled || !request.timeoutMs) return first;
  type WaitResult = typeof first | { kind: 'unavailable'; operationId: string; changed: true; timedOut: false };
  return new Promise<WaitResult>((resolve, reject) => {
    let settled = false, unsubscribe = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: WaitResult, error?: unknown) => {
      if (settled) return; settled = true;
      if (timer) clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', cancel);
      if (error !== undefined) reject(error); else resolve(result!);
    };
    const cancel = () => finish(undefined, signal.reason ?? new Error('操作等待已取消'));
    const check = (timedOut = false) => {
      try {
        const record = current();
        if (!record) { finish({ kind: 'unavailable', operationId: request.operationId, changed: true, timedOut: false }); return; }
        const result = snapshot(record);
        if (result.changed || result.settled || timedOut) finish({ ...result, timedOut: timedOut && !result.changed && !result.settled });
      } catch (error) { finish(undefined, error); }
    };
    try {
      unsubscribe = runtime.subscribe(id => { if (id === request.operationId) check(); });
      if (settled) { unsubscribe(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => check(true), request.timeoutMs); check();
    } catch (error) { finish(undefined, error); }
  });
}
