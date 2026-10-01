import { type WorkerEvent, workerCommandSchema, workerEventSchema } from '../shared/worker-protocol.ts';
import { DesktopAgent } from './agent.ts';
import type { ToolResult } from '../shared/tool-results.ts';

const parent = (
  process as NodeJS.Process & {
    parentPort?: {
      postMessage(value: unknown): void;
      on(event: 'message', callback: (event: { data: unknown }) => void): void;
    };
  }
).parentPort;
function emit(event: WorkerEvent): void {
  const valid = workerEventSchema.parse(event);
  if (parent) parent.postMessage(valid);
  else process.send?.(valid);
}
const tokens = new Map<string, { resolve: (token: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
const desktopCalls = new Map<string, { resolve: (result: ToolResult) => void; reject: (error: Error) => void; onData?: (data: Uint8Array) => void }>();
const agent = new DesktopAgent(emit, (config, rejectedToken) => new Promise<string>((resolve, reject) => {
  const id = crypto.randomUUID(); const timer = setTimeout(() => { tokens.delete(id); reject(new Error('OAuth 刷新失败，请检查连接或重新登录')); }, 60000);
  tokens.set(id, { resolve, reject, timer }); emit({ type: 'mcp.token', id, serverId: config.id, rejectedToken });
}), (request, signal, onData) => new Promise<ToolResult>((resolve, reject) => {
  signal.throwIfAborted(); const id = crypto.randomUUID();
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); desktopCalls.delete(id); };
  const cancel = () => { finish(); emit({ type: 'desktop.cancel', id }); reject(new Error('桌面工具操作已取消或超时')); };
  const timer = setTimeout(cancel, request.action === 'sandbox.exec' ? Math.min((request.timeout ?? 120) * 1000 + 30000, 2147483647) : 180000);
  desktopCalls.set(id, { onData, resolve: result => { finish(); resolve(result); }, reject: error => { finish(); reject(error); } });
  signal.addEventListener('abort', cancel, { once: true }); emit({ type: 'desktop.call', id, request });
}));
async function handle(raw: unknown): Promise<void> {
  const parsed = workerCommandSchema.safeParse(raw);
  if (!parsed.success) {
    emit({ type: 'status', status: 'error', error: 'Worker 收到无效请求' });
    return;
  }
  const message = parsed.data;
  if (message.type === 'subtask.question') {
    await agent.receiveSubtaskQuestion(message.taskId, message.question);
    return;
  }
  if (message.type === 'desktop.progress') {
    desktopCalls.get(message.id)?.onData?.(Buffer.from(message.data, 'base64'));
    return;
  }
  if (message.type === 'desktop.result') {
    const pending = desktopCalls.get(message.id); if (!pending) return;
    if (message.result) pending.resolve(message.result); else pending.reject(new Error(message.error ?? '浏览器操作失败'));
    return;
  }
  if (message.type === 'mcp.token.result') {
    const pending = tokens.get(message.id); if (!pending) return;
    tokens.delete(message.id); clearTimeout(pending.timer);
    if (message.token) pending.resolve(message.token); else pending.reject(new Error(message.error ?? 'OAuth authorization unavailable'));
    return;
  }
  if (message.type === 'answer') {
    agent.answer(message.id, message.approved, message.value);
    return;
  }
  try {
    switch (message.type) {
      case 'init':
        await agent.init(message.config);
        emit({
          type: 'ready',
          requestId: message.requestId,
          sessionFile: agent.sessionFile,
          items: agent.history(),
        });
        return;
      case 'prompt':
        await agent.prompt(message.text, message.attachments, message.queue, message.context);
        break;
      case 'stop':
        await agent.stop();
        break;
      case 'compact':
        await agent.compact();
        break;
      case 'queue.clear':
        emit({ type: 'result', requestId: message.requestId, ok: true, queue: agent.clearQueue(message.expected) });
        return;
      case 'queue.change':
        await agent.changeQueue(message.change);
        emit({ type: 'result', requestId: message.requestId, ok: true });
        return;
      case 'fork':
        await agent.fork(message.entryId);
        break;
      case 'dispose':
        await agent.dispose();
        break;
    }
    emit({
      type: 'result',
      requestId: message.requestId,
      ok: true,
      sessionFile: agent.sessionFile,
      items: message.type === 'dispose' ? [] : agent.history(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    emit({ type: 'result', requestId: message.requestId, ok: false, error: reason });
    if (message.type !== 'queue.change') emit({ type: 'status', status: 'error', error: reason, sessionFile: agent.sessionFile });
  }
}
if (parent)
  parent.on('message', (event) => {
    void handle(event.data);
  });
else
  process.on('message', (message) => {
    void handle(message);
  });
process.on('uncaughtException', (error) => {
  emit({ type: 'status', status: 'error', error: error.message });
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  emit({ type: 'status', status: 'error', error: String(error) });
});
