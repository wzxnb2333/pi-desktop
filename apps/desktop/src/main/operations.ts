import type { OperationRecord, OperationResult } from '../shared/operations.ts';
import { cancelGitProcesses, ownGitController } from './git-process.ts';

/** Owned by the main process. Records survive window closure; active jobs never restart implicitly. */
export class Operations {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private closing = false;
  private readonly listeners = new Set<(id: string) => void>();
  constructor(private readonly records: () => OperationRecord[], private readonly save: () => Promise<void>, private readonly changed: () => void) {}
  active(id: string): boolean { return this.jobs.has(id); }
  subscribe(listener: (id: string) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(id: string): void { this.changed(); for (const listener of this.listeners) listener(id); }
  async recover(): Promise<void> {
    for (const record of this.records()) if (record.status === 'running') {
      record.status = 'interrupted'; record.endedAt = Date.now();
      record.error = '操作已中断，请刷新外部状态后重试，避免重复提交';
    }
    await this.save();
  }
  async start(input: Pick<OperationRecord, 'id' | 'threadId' | 'directoryId' | 'kind'>,
    run: (signal: AbortSignal, progress: (stage: string) => void) => Promise<OperationResult>): Promise<OperationRecord> {
    if (this.closing) throw new Error('应用正在关闭，请重启后再执行操作');
    const existing = this.records().find(record => record.id === input.id);
    if (existing) {
      if (existing.threadId !== input.threadId || existing.kind !== input.kind || existing.directoryId !== input.directoryId) throw new Error('操作标识已被使用');
      return existing;
    }
    if (this.records().some(record => record.threadId === input.threadId && record.directoryId === input.directoryId && record.kind === input.kind && record.status === 'running')) throw new Error('此操作正在运行');
    const record: OperationRecord = { ...input, status: 'running', stage: '准备操作', startedAt: Date.now() };
    const records = this.records();
    while (records.length >= 100) { const index = records.findIndex(item => item.status !== 'running'); if (index < 0) break; records.splice(index, 1); }
    records.push(record);
    const controller = new AbortController();
    const release = ownGitController(controller);
    let ready: () => void = () => {};
    const started = new Promise<void>(resolve => { ready = resolve; });
    this.jobs.set(record.id, { controller, done: started });
    try { await this.save(); }
    catch (error) { records.splice(records.indexOf(record), 1); this.jobs.delete(record.id); release(); ready(); throw error; }
    const done = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        record.result = await run(controller.signal, stage => { record.stage = stage; this.notify(record.id); });
        record.status = 'succeeded';
      } catch (error) {
        record.status = controller.signal.aborted ? 'cancelled' : 'failed';
        record.error = error instanceof Error ? error.message : String(error);
      } finally {
        record.endedAt = Date.now();
        try { await this.save(); } catch (error) { record.status = 'failed'; record.error = '操作结果保存失败：' + String(error); }
        this.jobs.delete(record.id); release(); this.notify(record.id); ready();
      }
    });
    this.jobs.set(record.id, { controller, done }); this.notify(record.id);
    return record;
  }
  cancel(threadId: string, id: string): void {
    if (!this.records().some(record => record.id === id && record.threadId === threadId)) throw new Error('操作不属于此任务');
    const job = this.jobs.get(id);
    if (job) { this.records().find(record => record.id === id)!.stage = '正在取消操作'; job.controller.abort(); this.notify(id); }
  }
  async stop(threadId: string, id: string): Promise<void> {
    this.cancel(threadId, id);
    const job = this.jobs.get(id);
    if (job) await cancelGitProcesses(job.controller.signal);
  }
  async wait(threadId: string, id: string): Promise<OperationRecord> {
    const record = this.records().find(record => record.id === id && record.threadId === threadId);
    if (!record) throw new Error('操作不属于此任务');
    await this.jobs.get(id)?.done;
    return record;
  }
  async prepareShutdown(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled([...this.jobs.values()].map(job => { job.controller.abort(); return cancelGitProcesses(job.controller.signal); }));
    const failed = results.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') { this.resume(); throw failed.reason; }
  }
  resume(): void { this.closing = false; }
  async dispose(): Promise<void> {
    await this.prepareShutdown();
    await Promise.all([...this.jobs.values()].map(job => job.done));
  }
}
