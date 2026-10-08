import { createHash } from 'node:crypto';
import type { Thread } from '../shared/contracts.ts';
import { activeSubtask, askParentSchema, subtaskDefinitionSchema, subtaskToolSchema, type Subtask, type SubtaskDefinition, type SubtaskQuestion } from '../shared/subtasks.ts';

interface SubtaskRuntime {
  records(): Subtask[]; threads(): Thread[]; enabled(): boolean;
  prepare(record: Subtask, signal: AbortSignal, progress: (text: string) => void): Promise<Thread>;
  run(record: Subtask, child: Thread, signal: AbortSignal): Promise<string>;
  save(records: Subtask[]): Promise<void>; deliver(parentId: string, id: string): Promise<void>;
  /** Validates the delegation's model and level, then applies them to the child thread when it exists. */
  retarget?(record: Subtask, definition: SubtaskDefinition): void;
  notifyParent?(parentId: string, taskId: string, question: SubtaskQuestion): Promise<void>;
  changed(): void; error(reason: unknown): void;
}

/** Product child tasks. Never dispatches automatically after an uncertain app shutdown. */
export class Subtasks {
  private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private writes: Promise<unknown> = Promise.resolve();
  private closing = false;
  private readonly changingParents = new Set<string>();
  private readonly stops = new Set<{ parentId: string; id?: string }>();
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  constructor(private readonly runtime: SubtaskRuntime) {}
  private serialize<T>(change: () => Promise<T>): Promise<T> {
    const job = this.writes.catch(() => {}).then(change);
    this.writes = job; return job;
  }
  private mutate<T>(change: (records: Subtask[]) => T): Promise<T> {
    return this.serialize(async () => {
      const records = structuredClone(this.runtime.records()), result = change(records);
      await this.runtime.save(records); this.runtime.changed();
      for (const listener of this.listeners) listener();
      return result;
    });
  }
  private parent(id: string): Thread {
    const parent = this.runtime.threads().find(thread => thread.id === id);
    if (!parent || this.changingParents.has(id) || parent.deletedAt || parent.archived || parent.review || parent.sidechat?.temporary || parent.subtaskId) throw new Error('父任务不可用，子智能体不能继续委派');
    return parent;
  }
  async create(parentThreadId: string, id: string, raw: SubtaskDefinition): Promise<Subtask> {
    if (!this.runtime.enabled() || this.closing) throw new Error('请先在设置中启用可选子任务');
    const definition = subtaskDefinitionSchema.parse(raw), parent = this.parent(parentThreadId);
    if (definition.environment === 'local' && definition.policy !== 'deny') throw new Error('共享目录子任务只允许读取，请使用独立 Worktree 修改文件');
    if (!parent.projectId && definition.environment !== 'local') throw new Error('独立聊天的子任务不能创建 Worktree');
    if ((parent.planMode || parent.policy === 'deny') && definition.policy !== 'deny' || parent.policy === 'ask' && definition.policy === 'auto') throw new Error('子任务不能扩大父任务的权限');
    const record = await this.mutate(records => {
      const existing = records.find(item => item.id === id);
      if (existing) { if (existing.parentThreadId !== parentThreadId || JSON.stringify(existing.definition) !== JSON.stringify(definition)) throw new Error('子任务标识已被使用'); return structuredClone(existing); }
      if (!this.runtime.enabled() || this.closing) throw new Error('请先在设置中启用可选子任务');
      const currentParent = this.parent(parentThreadId);
      if ((currentParent.planMode || currentParent.policy === 'deny') && definition.policy !== 'deny' || currentParent.policy === 'ask' && definition.policy === 'auto') throw new Error('子任务不能扩大父任务的权限');
      const rows = currentParent.items.filter(item => ['user', 'assistant'].includes(item.role) && item.state === 'done').slice(-20);
      const captured = rows.map(item => ({ role: item.role, text: item.text.slice(0, 2500) }));
      while (JSON.stringify(captured).length > 55000) captured.shift();
      const next: Subtask = { id, parentThreadId, parentItemId: currentParent.items.findLast(item => item.role === 'user')?.id, definition, context: definition.includeContext ? JSON.stringify(captured) : '', status: 'queued', stage: '等待子任务执行', createdAt: Date.now() };
      records.push(next); return structuredClone(next);
    });
    this.drain(); return record;
  }
  /**
   * Retargets a child's model and reasoning level after the fact. A queued child picks the values up when it
   * starts; one that is already running keeps the turn it captured and switches from its next turn on.
   */
  async update(parentId: string, id: string, patch: { modelId?: string | null; thinking?: SubtaskDefinition['thinking'] | null }): Promise<Subtask> {
    this.parent(parentId);
    return this.mutate(records => {
      const current = records.find(item => item.id === id && item.parentThreadId === parentId);
      if (!current) throw new Error('子任务不存在');
      const definition = subtaskDefinitionSchema.parse({
        ...current.definition,
        modelId: patch.modelId === null ? undefined : patch.modelId ?? current.definition.modelId,
        thinking: patch.thinking === null ? undefined : patch.thinking ?? current.definition.thinking,
      });
      this.runtime.retarget?.(current, definition);
      current.definition = definition;
      return structuredClone(current);
    });
  }
  recover(): void {
    for (const record of this.runtime.records()) {
      record.childThreadId ??= this.runtime.threads().find(thread => thread.subtaskId === record.id)?.id;
      if (activeSubtask(record)) {
        record.status = 'interrupted'; record.finishedAt = Date.now(); record.error = '应用退出后子任务未自动重试，请检查结果后主动重新委派';
      }
      for (const question of record.questions ?? []) if (question.status === 'pending') {
        question.status = 'interrupted'; question.settledAt = Date.now();
      }
    }
  }
  drain(): void {
    if (this.closing) return;
    for (const record of this.runtime.records()) {
      if (this.jobs.size >= 4) break;
      if (record.status !== 'queued' || this.jobs.has(record.id)) continue;
      if ([...this.stops].some(stop => stop.parentId === record.parentThreadId && (!stop.id || stop.id === record.id))) continue;
      const controller = new AbortController();
      const done = this.execute(record.id, controller.signal).catch(reason => this.runtime.error(reason)).finally(() => { this.jobs.delete(record.id); this.drain(); });
      this.jobs.set(record.id, { controller, done });
    }
  }
  private record(id: string, records = this.runtime.records()): Subtask {
    const record = records.find(item => item.id === id); if (!record) throw new Error('子任务不存在'); return record;
  }
  async attachChild(id: string, childId: string): Promise<void> {
    await this.mutate(records => { this.record(id, records).childThreadId = childId; });
  }
  async deliver(parentId: string, id: string): Promise<void> {
    await this.serialize(async () => { this.parent(parentId); await this.runtime.deliver(parentId, id); this.runtime.changed(); });
  }
  private waitUntil(check: () => boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const finish = (error?: unknown) => { clearTimeout(timer); this.listeners.delete(changed); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(); };
      const cancel = () => finish(signal.reason);
      const changed = () => { try { if (check()) finish(); } catch (error) { finish(error); } };
      const timer = setTimeout(() => finish(), timeoutMs);
      this.listeners.add(changed); signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel(); else changed();
    });
  }
  private child(id: string, records = this.runtime.records()): Subtask {
    const child = this.runtime.threads().find(thread => thread.id === id && !thread.deletedAt && !thread.archived);
    const record = records.find(record => record.id === child?.subtaskId && record.childThreadId === id);
    if (!record || record.status !== 'running' || this.closing || [...this.stops].some(stop => stop.parentId === record.parentThreadId && (!stop.id || stop.id === record.id))) throw new Error('此子智能体不能向主代理提问');
    this.parent(record.parentThreadId); return record;
  }
  async ask(childId: string, questionId: string, text: string, timeoutMs: number, callerSignal: AbortSignal): Promise<SubtaskQuestion> {
    const request = askParentSchema.parse({ action: 'subtasks.ask', question: text, timeoutMs });
    const task = this.child(childId), job = this.jobs.get(task.id);
    const signal = AbortSignal.any([callerSignal, this.lifetime.signal, ...(job ? [job.controller.signal] : [])]);
    signal.throwIfAborted();
    const question = await this.mutate(records => {
      signal.throwIfAborted(); const record = this.child(childId, records);
      if (record.questions?.some(item => item.status === 'pending')) throw new Error('子智能体正在等待主代理答复');
      if ((record.questions?.length ?? 0) >= 32) throw new Error('子智能体提问次数已达到上限');
      const next: SubtaskQuestion = { id: questionId, question: request.question, status: 'pending', createdAt: Date.now() };
      if (record.questions?.some(item => item.id === questionId)) throw new Error('提问标识已被使用');
      record.questions = [...(record.questions ?? []), next]; record.stage = '等待主代理答复';
      return structuredClone(next);
    });
    const current = () => this.record(task.id).questions!.find(item => item.id === questionId)!;
    try {
      signal.throwIfAborted();
      await this.runtime.notifyParent?.(task.parentThreadId, task.id, question);
      await this.waitUntil(() => current().status !== 'pending' || !activeSubtask(this.record(task.id)), request.timeoutMs, signal);
      signal.throwIfAborted();
      if (current().status === 'pending') await this.settleQuestion(task.id, questionId, 'expired');
      return structuredClone(current());
    } catch (error) {
      await this.settleQuestion(task.id, questionId, this.closing ? 'interrupted' : 'cancelled');
      throw error;
    }
  }
  private async settleQuestion(taskId: string, questionId: string, status: 'expired' | 'cancelled' | 'interrupted'): Promise<void> {
    await this.mutate(records => {
      const record = this.record(taskId, records), question = record.questions?.find(item => item.id === questionId);
      if (question?.status !== 'pending') return;
      question.status = status; question.settledAt = Date.now();
      if (record.status === 'running') record.stage = '子任务正在执行';
    });
  }
  async reply(parentId: string, taskId: string, questionId: string, answer: string, signal: AbortSignal): Promise<SubtaskQuestion> {
    const request = subtaskToolSchema.parse({ action: 'subtasks.reply', id: taskId, questionId, answer });
    if (request.action !== 'subtasks.reply') throw new Error('无效答复');
    return this.mutate(records => {
      signal.throwIfAborted(); this.parent(parentId);
      const record = records.find(record => record.id === taskId && record.parentThreadId === parentId);
      if (!record) throw new Error('子任务不属于此父任务');
      const question = record.questions?.find(item => item.id === questionId);
      if (question?.status === 'answered') {
        if (question.answer !== request.answer) throw new Error('此问题已有不同答复');
        return structuredClone(question);
      }
      if (this.closing || record.status !== 'running' || question?.status !== 'pending' || [...this.stops].some(stop => stop.parentId === parentId && (!stop.id || stop.id === taskId))) throw new Error('此问题已不再等待答复');
      question.answer = request.answer; question.status = 'answered'; question.settledAt = Date.now(); record.stage = '子任务正在执行';
      return structuredClone(question);
    });
  }
  async wait(parentId: string, cursor: string | undefined, timeoutMs: number, callerSignal: AbortSignal) {
    const request = subtaskToolSchema.parse({ action: 'subtasks.wait', cursor, timeoutMs });
    if (request.action !== 'subtasks.wait') throw new Error('无效等待');
    const signal = AbortSignal.any([callerSignal, this.lifetime.signal]); signal.throwIfAborted();
    const snapshot = () => {
      this.parent(parentId);
      const records = this.runtime.records().filter(record => record.parentThreadId === parentId);
      const tasks = records.map(record => ({
        id: record.id, title: record.definition.title, status: record.status, stage: record.stage,
        questions: record.questions?.filter(question => question.status === 'pending'), result: record.result?.slice(0, 2000), error: record.error?.slice(0, 1000),
      }));
      const ordered = [...tasks.filter(task => ['queued', 'preparing', 'running'].includes(task.status)), ...tasks.filter(task => !['queued', 'preparing', 'running'].includes(task.status)).reverse()];
      return { cursor: createHash('sha256').update(JSON.stringify(tasks)).digest('hex'), tasks: ordered.slice(0, 100), total: tasks.length, truncated: tasks.length > 100 };
    };
    if (cursor) await this.waitUntil(() => snapshot().cursor !== cursor, request.timeoutMs, signal);
    signal.throwIfAborted(); const next = snapshot(); return { ...structuredClone(next), changed: next.cursor !== cursor };
  }
  private async execute(id: string, signal: AbortSignal): Promise<void> {
    try {
      const snapshot = await this.mutate(records => {
        const record = this.record(id, records); if (record.status !== 'queued') return;
        signal.throwIfAborted(); this.parent(record.parentThreadId); record.status = 'preparing'; record.stage = '准备子任务环境'; record.startedAt = Date.now(); return structuredClone(record);
      });
      if (!snapshot) return;
      signal.throwIfAborted(); this.parent(snapshot.parentThreadId);
      const child = await this.runtime.prepare(snapshot, signal, text => { this.record(id).stage = text; this.runtime.changed(); });
      signal.throwIfAborted(); this.parent(snapshot.parentThreadId);
      await this.mutate(records => { signal.throwIfAborted(); const record = this.record(id, records); record.childThreadId = child.id; record.status = 'running'; record.stage = '子任务正在执行'; });
      signal.throwIfAborted(); this.parent(snapshot.parentThreadId);
      const result = await this.runtime.run(snapshot, child, signal); signal.throwIfAborted();
      await this.mutate(records => { signal.throwIfAborted(); const record = this.record(id, records); record.status = 'succeeded'; record.result = result.slice(0, 30000); record.stage = '子任务已完成'; record.finishedAt = Date.now(); });
    } catch (error) {
      try { await this.mutate(records => {
        const record = this.record(id, records); record.status = this.closing ? 'interrupted' : signal.aborted || error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed'; record.error = error instanceof Error ? error.message : String(error); record.finishedAt = Date.now();
        for (const question of record.questions ?? []) if (question.status === 'pending') {
          question.status = this.closing ? 'interrupted' : 'cancelled'; question.settledAt = Date.now();
        }
      }); } catch (failure) { const record = this.record(id); record.status = 'interrupted'; record.error = '子任务状态保存失败，请检查存储后重试'; this.runtime.changed(); throw failure; }
    }
  }
  async stop(parentId: string, id?: string): Promise<void> {
    const stop = { parentId, id }; this.stops.add(stop);
    const matches = (item: Subtask) => item.parentThreadId === parentId && (!id || item.id === id);
    for (const record of this.runtime.records().filter(matches)) this.jobs.get(record.id)?.controller.abort();
    try {
      const ids = await this.mutate(records => {
        const selected = records.filter(matches);
        if (id && !selected.length) throw new Error('子任务不属于此父任务');
        for (const record of selected) {
          this.jobs.get(record.id)?.controller.abort();
          if (record.status === 'queued') { record.status = 'cancelled'; record.finishedAt = Date.now(); }
        }
        return selected.map(record => record.id);
      });
      await Promise.all(ids.map(id => this.jobs.get(id)?.done));
    } catch (error) {
      // A failed stop checkpoint must never release queued work into execution.
      for (const record of this.runtime.records().filter(matches)) if (record.status === 'queued') {
        record.status = 'interrupted'; record.finishedAt = Date.now(); record.error = '子任务状态保存失败，请检查存储后重试';
      }
      this.runtime.changed(); throw error;
    } finally { this.stops.delete(stop); this.drain(); }
  }
  async dispose(): Promise<void> {
    this.closing = true; this.lifetime.abort(); for (const job of this.jobs.values()) job.controller.abort();
    await Promise.all([...this.jobs.values()].map(job => job.done)); await this.writes.catch(() => {});
  }
  cancelChild(childId: string): void {
    for (const record of this.runtime.records()) if (record.childThreadId === childId) this.jobs.get(record.id)?.controller.abort();
  }
  async changeParent(id: string, update: () => void): Promise<void> {
    this.changingParents.add(id);
    try { await this.stop(id); update(); } finally { this.changingParents.delete(id); }
  }
}
