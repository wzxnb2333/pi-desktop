import type { Automation, AutomationRun, Thread } from '../shared/contracts.ts';
import { nextAutomationRun } from '../shared/schedule.ts';
import { saveAutomationConfiguration } from './automation-state.ts';
import { assertAutomationBase } from '../shared/automation-configuration.ts';

export function dueAutomations(jobs: Automation[], active: Set<string>, now = Date.now()): Automation[] {
  return jobs.filter((job) => job.enabled && job.nextRunAt <= now && !active.has(job.id));
}
type SchedulerState = { automations: Automation[]; automationRuns: AutomationRun[] };
interface SchedulerRuntime {
  state(): SchedulerState;
  threads(): Thread[];
  busy(thread: Thread): boolean;
  prepare(run: AutomationRun, signal: AbortSignal): Promise<Thread>;
  run(run: AutomationRun, thread: Thread, signal: AbortSignal, started: () => Promise<void>): Promise<void>;
  save(state: SchedulerState): Promise<void>;
  changed(): void;
  error(error: unknown): void;
  idle?(threadId: string): void;
}
const pending = (run: AutomationRun) => ['queued', 'preparing', 'running'].includes(run.status);

/** A durable queue owns each occurrence before any task, worktree or model is started. */
export class Scheduler {
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private ticking = false;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private readonly reservedThreads = new Set<string>();
  constructor(private readonly runtime: SchedulerRuntime) {}
  private async mutate<T>(change: (state: SchedulerState) => T): Promise<T> {
    const operation = this.writes.catch(() => {}).then(async () => {
      const state = this.runtime.state();
      const candidate = { automations: structuredClone(state.automations), automationRuns: structuredClone(state.automationRuns) };
      const result = change(candidate); await this.runtime.save(candidate); this.runtime.changed(); return result;
    });
    this.writes = operation; return operation;
  }
  async configure(input: Automation, base?: Automation | null): Promise<void> {
    await this.mutate(state => {
      const previous = state.automations.find(item => item.id === input.id);
      assertAutomationBase(previous, base);
      const saved = saveAutomationConfiguration(previous, input, Date.now());
      if (!previous) state.automations.push(saved);
      if (!saved.enabled) for (const run of state.automationRuns) if (run.automationId === saved.id && run.status === 'queued') { run.status = 'cancelled'; run.finishedAt = Date.now(); run.error = '自动化已暂停，未开始的唤醒已取消'; }
    });
    void this.tick();
  }
  async remove(id: string, base?: Automation): Promise<void> {
    await this.mutate(state => {
      assertAutomationBase(state.automations.find(item => item.id === id), base);
      state.automations = state.automations.filter(item => item.id !== id);
      for (const run of state.automationRuns) if (run.automationId === id && run.status === 'queued') { run.status = 'cancelled'; run.finishedAt = Date.now(); run.error = '自动化已删除，未开始的唤醒已取消'; }
    });
  }
  async enqueue(id: string, manual = false, now = Date.now()): Promise<AutomationRun | null> {
    const result = await this.mutate(state => {
      const job = state.automations.find(item => item.id === id);
      if (!job) throw new Error('自动化不存在');
      if (!manual && (!job.enabled || job.nextRunAt > now)) return null;
      const existing = state.automationRuns.find(run => run.automationId === id && pending(run));
      const scheduledAt = manual ? now : job.nextRunAt;
      if (!manual) job.nextRunAt = nextAutomationRun(job, now);
      if (existing) { if (!manual) existing.merged++; return structuredClone(existing); }
      const record: AutomationRun = { id: crypto.randomUUID(), automationId: id, configuration: structuredClone(job),
        scheduledAt, createdAt: now, manual, status: 'queued', threadId: job.targetThreadId, merged: 0 };
      state.automationRuns.push(record);
      const completed = state.automationRuns.filter(run => !pending(run));
      if (completed.length > 1000) { const remove = new Set(completed.slice(0, completed.length - 1000).map(run => run.id)); state.automationRuns = state.automationRuns.filter(run => !remove.has(run.id)); }
      return structuredClone(record);
    });
    this.drain(); return result;
  }
  recover(): void {
    for (const run of this.runtime.state().automationRuns) if (['preparing', 'running'].includes(run.status)) {
      run.status = 'interrupted'; run.finishedAt = Date.now(); run.error = '应用退出前运行结果不明，请检查后主动重试';
      run.threadId ??= this.runtime.threads().find(thread => thread.automationRunId === run.id)?.id;
    }
  }
  start(interval = 10000): void {
    this.stopped = false; clearInterval(this.timer);
    this.timer = setInterval(() => { void this.tick(); }, interval); void this.tick();
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      for (const job of dueAutomations(this.runtime.state().automations, new Set(), now)) { if (this.stopped) break; await this.enqueue(job.id, false, now); }
      this.drain();
    } catch (error) { this.runtime.error(error); }
    finally { this.ticking = false; }
  }
  drain(): void {
    if (this.stopped) return;
    for (const candidate of this.runtime.state().automationRuns) {
      if (candidate.status !== 'queued' || this.active.has(candidate.id)) continue;
      const target = candidate.configuration.targetThreadId;
      if (target && (this.reservedThreads.has(target) || this.runtime.threads().some(thread => thread.id === target && this.runtime.busy(thread)))) continue;
      if (target) this.reservedThreads.add(target);
      const controller = new AbortController();
      const done = this.execute(candidate.id, controller.signal).catch(error => this.runtime.error(error)).finally(() => {
        this.active.delete(candidate.id); if (target) { this.reservedThreads.delete(target); this.runtime.idle?.(target); } this.drain();
      });
      this.active.set(candidate.id, { controller, done });
    }
  }
  private record(id: string, state = this.runtime.state()): AutomationRun | undefined { return state.automationRuns.find(run => run.id === id); }
  async attachThread(id: string, threadId: string): Promise<void> {
    await this.mutate(state => {
      const run = this.record(id, state); if (!run || run.status !== 'preparing') throw new Error('自动化运行已失效');
      run.threadId = threadId;
    });
  }
  hasReservation(threadId: string): boolean { return this.reservedThreads.has(threadId); }
  private async execute(id: string, signal: AbortSignal): Promise<void> {
    let reservation = '';
    try {
      const snapshot = await this.mutate(state => {
        const run = this.record(id, state); if (!run || run.status !== 'queued' || this.stopped) return;
        const job = state.automations.find(item => item.id === run.automationId);
        if (!job || !job.enabled && !run.manual) { run.status = 'cancelled'; run.finishedAt = Date.now(); return; }
        signal.throwIfAborted(); run.status = 'preparing'; return structuredClone(run);
      });
      if (!snapshot) return;
      signal.throwIfAborted();
      const thread = await this.runtime.prepare(snapshot, signal); signal.throwIfAborted();
      if (!snapshot.configuration.targetThreadId) { reservation = thread.id; this.reservedThreads.add(reservation); }
      await this.mutate(state => {
        signal.throwIfAborted(); const run = this.record(id, state); if (!run || run.status !== 'preparing') throw new Error('自动化运行已失效');
        run.threadId = thread.id;
      });
      signal.throwIfAborted(); await this.runtime.run(snapshot, thread, signal, () => this.mutate(state => {
        signal.throwIfAborted(); const run = this.record(id, state); if (!run || run.status !== 'preparing') throw new Error('自动化运行已失效');
        // The host awaits the durable start record before sending anything to the model.
        run.status = 'running'; run.startedAt = Date.now();
        const job = state.automations.find(item => item.id === run.automationId);
        if (job) { job.lastRunAt = run.startedAt; job.lastThreadId = thread.id; }
      })); signal.throwIfAborted();
      await this.mutate(state => { const run = this.record(id, state); if (run) { run.status = 'succeeded'; run.finishedAt = Date.now(); } });
    } catch (error) {
      await this.mutate(state => {
        const run = this.record(id, state); if (!run || !pending(run)) return;
        run.threadId ??= this.runtime.threads().find(thread => thread.automationRunId === id)?.id;
        run.status = this.stopped ? 'interrupted' : signal.aborted ? 'cancelled' : 'failed'; run.finishedAt = Date.now(); run.error = error instanceof Error ? error.message : String(error);
      }).catch(saveError => {
        const run = this.record(id); if (run) { run.status = 'interrupted'; run.error = '自动化保存失败，请检查存储后主动重试'; this.runtime.changed(); }
        throw new AggregateError([error, saveError], 'Automation persistence failed');
      });
    } finally { if (reservation) { this.reservedThreads.delete(reservation); this.runtime.idle?.(reservation); } }
  }
  async cancel(id: string): Promise<void> {
    const active = this.active.get(id); if (active) { active.controller.abort(); await active.done; return; }
    await this.mutate(state => { const run = this.record(id, state); if (!run) throw new Error('自动化运行不存在'); if (run.status === 'queued') { run.status = 'cancelled'; run.finishedAt = Date.now(); } });
  }
  stop(): void { this.stopped = true; clearInterval(this.timer); for (const job of this.active.values()) job.controller.abort(); }
  async settled(): Promise<void> { await Promise.allSettled([...this.active.values()].map(item => item.done)); await this.writes.catch(() => {}); }
}
