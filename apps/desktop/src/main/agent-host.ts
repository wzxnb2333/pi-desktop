import { type UtilityProcess, utilityProcess } from 'electron';
import type { DesktopToolRequest } from '../shared/worker-protocol.ts';
import type { ToolResult } from '../shared/tool-results.ts';
import {
  type WorkerCommand,
  type WorkerConfig,
  type WorkerEvent,
  workerCommandSchema,
  workerEventSchema,
} from '../shared/worker-protocol.ts';

export class AgentHost {
  private readonly child: UtilityProcess;
  private closed = false;
  private disposal?: Promise<void>;
  private readonly lifetime = new AbortController();
  private readonly desktopCalls = new Map<string, AbortController>();
  private pending = new Map<
    string,
    { resolve: (event: WorkerEvent) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout }
  >();
  constructor(
    workerFile: string,
    private readonly onEvent: (event: WorkerEvent) => void,
    private readonly onExit: () => void,
    private readonly token?: (serverId: string, rejectedToken?: string, signal?: AbortSignal) => Promise<string>,
    private readonly desktopTool?: (id: string, request: DesktopToolRequest, signal: AbortSignal, onData: (data: Uint8Array) => void) => Promise<ToolResult>,
  ) {
    this.child = utilityProcess.fork(workerFile, [], { stdio: 'pipe', serviceName: 'Pi Agent' });
    this.child.on('message', (raw: unknown) => {
      const parsed = workerEventSchema.safeParse(raw);
      if (!parsed.success) {
        this.onEvent({ type: 'status', status: 'error', error: 'Pi 进程返回了无效消息' });
        return;
      }
      const event = parsed.data;
      if (event.type === 'desktop.cancel') { this.desktopCalls.get(event.id)?.abort(); return; }
      if (event.type === 'desktop.call') {
        if (this.desktopCalls.has(event.id)) return;
        const controller = new AbortController(); this.desktopCalls.set(event.id, controller);
        const respond = (response: { result?: ToolResult; error?: string }) => { if (!this.closed) this.child.postMessage(workerCommandSchema.parse({ type: 'desktop.result', id: event.id, ...response })); };
        const onData = (data: Uint8Array) => { if (!this.closed) this.child.postMessage(workerCommandSchema.parse({ type: 'desktop.progress', id: event.id, data: Buffer.from(data).toString('base64') })); };
        void (this.desktopTool ? this.desktopTool(event.id, event.request, controller.signal, onData) : Promise.reject(new Error('桌面工具不可用')))
          .then(result => respond({ result }), error => respond({ error: error instanceof Error ? error.message : String(error) })).finally(() => this.desktopCalls.delete(event.id));
        return;
      }
      if (event.type === 'mcp.token') {
        const respond = (result: { token?: string; error?: string }) => { if (!this.closed) this.child.postMessage(workerCommandSchema.parse({ type: 'mcp.token.result', id: event.id, ...result })); };
        void (this.token ? this.token(event.serverId, event.rejectedToken, this.lifetime.signal) : Promise.reject(new Error('OAuth token service unavailable')))
          .then(token => respond({ token }), error => respond({ error: error instanceof Error ? error.message : 'OAuth token request failed' }));
        return;
      }
      this.onEvent(event);
      if ('requestId' in event) {
        const pending = this.pending.get(event.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(event.requestId);
          if (event.type === 'result' && !event.ok) pending.reject(new Error(event.error));
          else pending.resolve(event);
        }
      }
    });
    this.child.on('exit', (code) => {
      const expected = this.closed;
      this.lifetime.abort();
      for (const controller of this.desktopCalls.values()) controller.abort();
      this.desktopCalls.clear();
      this.closed = true;
      for (const item of this.pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error(`Pi 进程退出（${code}），可重新打开任务继续`));
      }
      this.pending.clear();
      if (!expected)
        this.onEvent({ type: 'status', status: 'interrupted', error: `Pi 进程退出（${code}），会话已保留` });
      this.onExit();
    });
    this.child.stderr?.on('data', () => {});
    this.child.stdout?.on('data', () => {});
  }
  request(message: WorkerCommand): Promise<WorkerEvent> {
    if (this.closed) return Promise.reject(new Error('Pi 进程已关闭'));
    const valid = workerCommandSchema.parse(message);
    if (!('requestId' in valid)) {
      this.child.postMessage(valid);
      return Promise.resolve({ type: 'approval.clear', id: valid.id });
    }
    return new Promise((resolve, reject) => {
      const timer =
        valid.type === 'prompt'
          ? undefined
          : setTimeout(() => {
              this.pending.delete(valid.requestId);
              reject(new Error('Pi 操作超时'));
            }, 120000);
      this.pending.set(valid.requestId, { resolve, reject, timer });
      this.child.postMessage(valid);
    });
  }
  async init(config: WorkerConfig, signal?: AbortSignal): Promise<WorkerEvent> {
    signal?.throwIfAborted();
    const abort = () => { void this.dispose().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await this.request({ type: 'init', requestId: crypto.randomUUID(), config });
      signal?.throwIfAborted();
      return result;
    } finally { signal?.removeEventListener('abort', abort); }
  }
  answer(id: string, approved: boolean, value?: string): void {
    this.child.postMessage(workerCommandSchema.parse({ type: 'answer', id, approved, value }));
  }
  dispose(): Promise<void> {
    return this.disposal ??= this.release();
  }
  private async release(): Promise<void> {
    if (this.closed) return;
    this.lifetime.abort();
    for (const controller of this.desktopCalls.values()) controller.abort();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.request({ type: 'dispose', requestId: crypto.randomUUID() }),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 3000);
        }),
      ]);
    } catch {
      /* A crashed worker may already be exiting. */
    } finally {
      clearTimeout(timer);
    }
    this.closed = true;
    this.child.kill();
  }
}
