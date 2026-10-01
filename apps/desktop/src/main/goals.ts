import type { Thread } from '../shared/contracts.ts';
import { goalCheckpointSchema, goalDefinitionSchema, goalPrompt, type Goal, type GoalCheckpoint, type GoalDefinition } from '../shared/goals.ts';

interface GoalRuntime {
  threads(): Thread[];
  busy(thread: Thread): boolean;
  run(thread: Thread, prompt: string): Promise<void>;
  save(threadId: string, goal: Goal | undefined, expected?: Pick<Goal, 'id' | 'revision'>): Promise<void>;
  changed(): void;
  error(error: unknown): void;
}

/** Owns continuation; worker checkpoints cannot create, resume or silently replace a goal. */
export class Goals {
  private readonly writes = new Map<string, Promise<unknown>>();
  private readonly jobs = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private stopped = false;
  constructor(private readonly runtime: GoalRuntime, private readonly delay = 500) {}
  private thread(id: string, allowInactive = false): Thread {
    const thread = this.runtime.threads().find(item => item.id === id);
    if (!thread || !allowInactive && (thread.deletedAt || thread.archived) || thread.review || thread.sidechat?.temporary) throw new Error('此会话不能运行持续目标');
    return thread;
  }
  private async write<T>(id: string, change: (thread: Thread) => T, allowInactive = false, pauseOnFailure = false): Promise<T> {
    const operation = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      const thread = this.thread(id, allowInactive), previous = thread.goal;
      const candidate = { ...thread, goal: structuredClone(previous) };
      const value = change(candidate);
      try { await this.runtime.save(id, candidate.goal, previous && { id: previous.id, revision: previous.revision }); }
      catch (error) {
        // A failed storage write cannot revoke an explicit pause/stop. Apply
        // that conservative runtime intent before releasing the per-goal queue.
        if (pauseOnFailure && thread.goal && thread.goal.id === previous?.id && thread.goal.status !== 'completed') {
          thread.goal.status = 'paused'; thread.goal.completionRequested = false;
          thread.goal.reason = '目标已暂停，但暂停状态未能保存。请检查存储后重试。';
          thread.goal.revision++; thread.goal.updatedAt = Date.now(); this.runtime.changed();
          throw new Error(thread.goal.reason, { cause: error });
        }
        throw error;
      }
      this.runtime.changed(); return value;
    });
    this.writes.set(id, operation);
    try { return await operation; } finally { if (this.writes.get(id) === operation) this.writes.delete(id); }
  }
  private current(thread: Thread, id: string, revision: number): Goal {
    const goal = thread.goal;
    if (!goal || goal.id !== id || goal.revision !== revision) throw new Error('目标已更新，请重新读取后再操作');
    return goal;
  }
  async save(id: string, definition: GoalDefinition, start: boolean, expectedId?: string, expectedRevision?: number): Promise<Goal> {
    const input = goalDefinitionSchema.parse(definition);
    const result = await this.write(id, thread => {
      const old = thread.goal;
      if (old ? old.id !== expectedId || old.revision !== expectedRevision : expectedId !== undefined) throw new Error('目标已更新，请重新读取后再操作');
      const now = Date.now();
      const goal: Goal = { id: old?.id ?? crypto.randomUUID(), revision: (old?.revision ?? 0) + 1,
        objective: input.objective, criteria: input.criteria.map(item => {
          const previous = old?.objective === input.objective ? old.criteria.find(row => row.id === item.id && row.text === item.text) : undefined;
          return { ...item, completed: previous?.completed ?? false, evidence: previous?.evidence ?? '' };
        }), status: start ? 'active' : 'paused', reason: '', createdAt: old?.createdAt ?? now, updatedAt: now,
        rounds: old?.rounds ?? 0, consecutiveFailures: 0, noProgress: 0, burstRounds: 0, completionRequested: false,
        pendingRunId: old?.pendingRunId, history: old?.history ?? [],
      };
      thread.goal = goal;
      return structuredClone(goal);
    });
    this.kick(id); return result;
  }
  async control(id: string, goalId: string, revision: number, action: 'pause' | 'resume' | 'clear'): Promise<Goal | null> {
    const result = await this.write(id, thread => {
      const goal = this.current(thread, goalId, revision);
      if (action === 'clear') { delete thread.goal; return null; }
      if (action === 'resume' && goal.status === 'completed') throw new Error('已完成目标需要修改验收条件后才能继续');
      goal.status = action === 'resume' ? 'active' : 'paused'; goal.reason = ''; goal.revision++; goal.updatedAt = Date.now();
      goal.completionRequested = false;
      if (action === 'resume') { goal.consecutiveFailures = 0; goal.noProgress = 0; goal.burstRounds = 0; }
      return structuredClone(goal);
    }, false, action === 'pause');
    this.kick(id); return result;
  }
  async pause(id: string, reason: string): Promise<void> {
    const thread = this.runtime.threads().find(item => item.id === id);
    if (!thread?.goal || thread.goal.status === 'completed') return;
    await this.write(id, current => { if (!current.goal) return; current.goal.status = 'paused'; current.goal.reason = reason; current.goal.completionRequested = false; current.goal.revision++; current.goal.updatedAt = Date.now(); }, false, true);
  }
  async checkpoint(id: string, raw: GoalCheckpoint): Promise<Goal> {
    const input = goalCheckpointSchema.parse(raw);
    return this.write(id, thread => {
      const goal = this.current(thread, input.goalId, input.revision);
      if (goal.status !== 'active' || !goal.pendingRunId) throw new Error('目标未在执行，不能由工具恢复或完成');
      if (new Set(input.checks.map(item => item.id)).size !== input.checks.length || input.checks.some(item => !goal.criteria.some(row => row.id === item.id))) throw new Error('目标验收项无效');
      if (input.checks.some(item => item.completed && !item.evidence)) throw new Error('已完成验收项必须提供证据');
      const criteria = goal.criteria.map(item => ({ ...item, ...input.checks.find(check => check.id === item.id) }));
      if (input.status === 'completed' && criteria.some(item => !item.completed || !item.evidence)) throw new Error('尚有未完成验收项，不能完成目标');
      goal.criteria = criteria; goal.reason = input.summary; goal.revision++; goal.updatedAt = Date.now();
      goal.completionRequested = input.status === 'completed';
      if (input.status === 'blocked') goal.status = 'blocked';
      const record = goal.history.find(item => item.id === goal.pendingRunId); if (record) record.summary = input.summary;
      return structuredClone(goal);
    });
  }
  recover(): void {
    for (const thread of this.runtime.threads()) {
      const goal = thread.goal; if (!goal) continue;
      if (goal.pendingRunId) {
        const round = goal.history.find(item => item.id === goal.pendingRunId);
        if (round) { round.status = 'interrupted'; round.finishedAt = Date.now(); }
        delete goal.pendingRunId;
      }
      if (goal.status === 'active') { goal.status = 'blocked'; goal.reason = '应用重启后目标等待恢复，请检查上一轮结果'; goal.revision++; goal.updatedAt = Date.now(); }
      goal.completionRequested = false;
    }
  }
  kick(id: string): void {
    if (this.stopped || this.jobs.has(id) || this.timers.has(id)) return;
    const thread = this.runtime.threads().find(item => item.id === id);
    if (!thread?.goal || thread.goal.status !== 'active' || thread.deletedAt || thread.archived || this.runtime.busy(thread)) return;
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      if (this.stopped || this.jobs.has(id)) return;
      const job = this.round(id).catch(error => {
        const goal = this.runtime.threads().find(item => item.id === id)?.goal;
        if (goal) {
          // The worker has ended even if committing its result failed. This is a
          // conservative runtime stop, never a publication of uncommitted edits.
          const round = goal.history.find(item => item.id === goal.pendingRunId);
          if (round) { round.status = 'interrupted'; round.finishedAt = Date.now(); }
          delete goal.pendingRunId; goal.completionRequested = false;
          if (goal.status === 'active') goal.status = 'blocked';
          goal.reason = '目标保存失败，请检查存储后恢复'; goal.revision++; goal.updatedAt = Date.now();
          this.runtime.changed();
        }
        this.runtime.error(error);
      }).finally(() => { this.jobs.delete(id); this.kick(id); });
      this.jobs.set(id, job);
    }, this.delay));
  }
  private async round(id: string): Promise<void> {
    let runId = '', goalId = '', before = 0, prompt = '';
    await this.write(id, thread => {
      const goal = thread.goal;
      if (this.stopped || !goal || goal.status !== 'active' || this.runtime.busy(thread)) return;
      runId = crypto.randomUUID(); goalId = goal.id; before = goal.criteria.filter(item => item.completed).length;
      goal.pendingRunId = runId; goal.completionRequested = false;
      goal.history = [...goal.history, { id: runId, startedAt: Date.now(), status: 'running' as const, summary: '' }].slice(-100);
      goal.rounds++; goal.burstRounds++; goal.revision++; goal.updatedAt = Date.now(); prompt = goalPrompt(goal);
    });
    if (!runId) return;
    let error: unknown;
    try {
      const thread = this.thread(id);
      if (this.stopped || thread.goal?.id !== goalId || thread.goal.status !== 'active') throw Object.assign(new Error('目标已暂停'), { name: 'AbortError' });
      await this.runtime.run(thread, prompt);
    } catch (reason) { error = reason; }
    // A cleared goal or deleted chat can never be resurrected by a late worker response.
    const thread = this.runtime.threads().find(item => item.id === id);
    if (!thread || thread.goal?.id !== goalId) return;
    await this.write(id, current => {
      const goal = current.goal; if (!goal || goal.id !== goalId) return;
      const round = goal.history.find(item => item.id === runId);
      if (round) { round.finishedAt = Date.now(); round.status = this.stopped || error instanceof Error && error.name === 'AbortError' ? 'interrupted' : error ? 'failed' : 'succeeded'; if (error) round.summary = String(error).slice(0, 6000); }
      delete goal.pendingRunId; goal.revision++; goal.updatedAt = Date.now();
      if (goal.status !== 'active') { goal.completionRequested = false; return; }
      if (this.stopped) { goal.status = 'blocked'; goal.reason = '应用退出，目标等待恢复'; }
      else if (error) {
        goal.completionRequested = false; goal.consecutiveFailures++; goal.reason = String(error).slice(0, 6000);
        if (goal.consecutiveFailures >= 3) { goal.status = 'blocked'; goal.reason = '连续三轮失败，目标已停止自动重试'; }
      } else {
        goal.consecutiveFailures = 0;
        goal.noProgress = goal.criteria.filter(item => item.completed).length > before ? 0 : goal.noProgress + 1;
        if (goal.completionRequested && goal.criteria.every(item => item.completed && item.evidence)) goal.status = 'completed';
        else if (goal.noProgress >= 3) { goal.status = 'blocked'; goal.reason = '连续三轮没有完成新的验收项，请检查目标或拆分验收条件'; }
      }
      if (goal.status === 'active' && goal.burstRounds >= 20) { goal.status = 'blocked'; goal.reason = '已连续执行二十轮，请检查进展后主动恢复'; }
      goal.completionRequested = false;
    }, true);
  }
  stop(): void { this.stopped = true; for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); }
  async settled(): Promise<void> { await Promise.allSettled([...this.jobs.values(), ...this.writes.values()]); }
}
