import { Scheduler } from '../../src/main/scheduler.ts';
import { publishAutomationState } from '../../src/main/automation-state.ts';
import { defaultData, threadSchema, type AutomationRun } from '../../src/shared/contracts.ts';

export function schedulerFixture() {
  const data = defaultData(), errors: unknown[] = [], calls: AutomationRun[] = [];
  let failSave = false, saveHook = async () => {}, run = async (_run: AutomationRun, _signal: AbortSignal) => {};
  const thread = (id: string) => threadSchema.parse({ id, projectId: 'p', title: id, cwd: 'unused', createdAt: 1, updatedAt: 1, modelId: 'local', thinking: 'off', policy: 'ask' });
  data.threads.push(thread('t'));
  const runtime: ConstructorParameters<typeof Scheduler>[0] = { state: () => data, threads: () => data.threads,
    busy: current => ['running', 'waiting'].includes(current.status),
    prepare: async record => { if (record.configuration.targetThreadId) return data.threads.find(item => item.id === record.configuration.targetThreadId)!; const created = thread(record.id); created.automationRunId = record.id; data.threads.push(created); return created; },
    run: async (record, current, signal, started) => { await started(); calls.push(structuredClone(record)); current.status = 'running'; try { await run(record, signal); } finally { current.status = 'idle'; } },
    save: async next => { await saveHook(); if (failSave) throw new Error('STORAGE_FAILURE'); publishAutomationState(data, next); }, changed: () => {}, error: error => errors.push(error),
  };
  const scheduler = new Scheduler(runtime);
  return { data, errors, calls, scheduler, runtime, setRun(next: typeof run) { run = next; }, failSave(value: boolean) { failSave = value; }, onSave(next: typeof saveHook) { saveHook = next; } };
}
