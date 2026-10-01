import { z } from 'zod';
import type { TerminalInfo } from '../shared/contracts.ts';
import { terminalOutputEnd } from '../shared/terminal-output.ts';
import { terminalToolSchema, type TerminalReadRequest } from '../shared/terminal-tools.ts';

interface TerminalReadRuntime {
  authorize(): string;
  list(): TerminalInfo[];
  subscribe(listener: (id: string) => void): () => void;
}
type TerminalMetadata = Pick<TerminalInfo, 'id' | 'title' | 'exited' | 'exitCode' | 'operationId'>;
interface TerminalReadResult {
  kind: 'terminal'; terminal: TerminalMetadata; status: 'open' | 'exited' | 'closed'; output: string;
  startOffset: number; endOffset: number; bufferStart: number; bufferEnd: number; skippedChars: number;
  cursor: string; changed: boolean; timedOut: boolean; hasMore: boolean;
}
const cursorSchema = z.object({ version: z.literal(1), threadId: z.string(), terminalId: z.uuid(), offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), exited: z.boolean() }).strict();
const metadata = (info: TerminalInfo): TerminalMetadata => ({ id: info.id, title: info.title, exited: info.exited, exitCode: info.exitCode, operationId: info.operationId });

/** Read existing native PTY output only. Does not write input, spawn processes or change window state. */
export async function inspectTerminal(runtime: TerminalReadRuntime, input: TerminalReadRequest, signal: AbortSignal): Promise<TerminalReadResult | { kind: 'list'; terminals: TerminalMetadata[]; total: number; truncated: boolean }> {
  const request = terminalToolSchema.parse(input);
  signal.throwIfAborted();
  const threadId = runtime.authorize();
  if (!request.terminalId) {
    const owned = runtime.list().filter(info => info.threadId === threadId);
    return { kind: 'list', terminals: owned.slice(-100).map(metadata), total: owned.length, truncated: owned.length > 100 };
  }
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (request.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString()));
      if (cursor.threadId !== threadId || cursor.terminalId !== request.terminalId) throw new Error('scope');
    } catch { throw new Error('终端读取游标无效，请重新读取'); }
  }
  const current = () => {
    signal.throwIfAborted();
    if (runtime.authorize() !== threadId) throw new Error('此会话不能读取桌面终端');
    const info = runtime.list().find(info => info.id === request.terminalId);
    if (info && info.threadId !== threadId) throw new Error('终端不存在或不属于此任务');
    return info;
  };
  const initial = current();
  if (!initial) throw new Error('终端不存在或不属于此任务');
  const snapshot = (info: TerminalInfo): TerminalReadResult => {
    const base = info.outputOffset ?? 0, end = terminalOutputEnd(info);
    if (cursor && cursor.offset > end) throw new Error('终端读取游标无效，请重新读取');
    const requested = cursor?.offset ?? Math.max(base, end - request.maxChars);
    let start = Math.max(base, requested), stop = Math.min(end, start + request.maxChars);
    // IPC offsets count UTF-16 units; never return half of a surrogate pair.
    if (start > base && /[\uDC00-\uDFFF]/.test(info.output[start - base] ?? '') && /[\uD800-\uDBFF]/.test(info.output[start - base - 1] ?? '')) start++;
    if (stop < end && stop > start && /[\uDC00-\uDFFF]/.test(info.output[stop - base] ?? '') && /[\uD800-\uDBFF]/.test(info.output[stop - base - 1] ?? '')) stop--;
    const next = { version: 1, threadId, terminalId: info.id, offset: stop, exited: info.exited };
    return { kind: 'terminal', terminal: metadata(info), status: info.exited ? 'exited' : 'open', output: info.output.slice(start - base, stop - base),
      startOffset: start, endOffset: stop, bufferStart: base, bufferEnd: end, skippedChars: cursor ? start - cursor.offset : start,
      cursor: Buffer.from(JSON.stringify(next)).toString('base64url'), changed: !cursor || stop !== cursor.offset || info.exited !== cursor.exited,
      timedOut: false, hasMore: stop < end };
  };
  const first = snapshot(initial);
  if (first.changed || first.status === 'exited' || !request.timeoutMs) return first;
  return new Promise<TerminalReadResult>((resolve, reject) => {
    let settled = false, unsubscribe = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: TerminalReadResult, error?: unknown) => {
      if (settled) return;
      settled = true; if (timer) clearTimeout(timer); unsubscribe(); signal.removeEventListener('abort', cancel);
      if (error !== undefined) reject(error); else resolve(result!);
    };
    const cancel = () => finish(undefined, signal.reason ?? new Error('终端读取已取消'));
    const check = (timedOut = false) => {
      try {
        const info = current();
        if (!info) { finish({ ...first, status: 'closed', output: '', changed: true, hasMore: false }); return; }
        const result = snapshot(info);
        if (result.changed || result.status === 'exited' || timedOut) finish({ ...result, timedOut: timedOut && !result.changed });
      } catch (error) { finish(undefined, error); }
    };
    try {
      unsubscribe = runtime.subscribe(id => { if (id === request.terminalId) check(); });
      if (settled) { unsubscribe(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => check(true), request.timeoutMs);
      check();
    } catch (error) { finish(undefined, error); }
  });
}
