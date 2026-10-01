import type { Automation, AutomationRun } from '../shared/contracts.ts';
import { nextAutomationRun } from '../shared/schedule.ts';

function publishRows<T extends { id: string }>(current: T[], next: T[]): T[] {
  const existing = new Map(current.map(item => [item.id, item]));
  return next.map(item => {
    const row = existing.get(item.id); if (!row) return structuredClone(item);
    for (const key of Object.keys(row) as (keyof T)[]) if (!Object.hasOwn(item, key)) delete row[key];
    return Object.assign(row, structuredClone(item));
  });
}

export function publishAutomationState(state: { automations: Automation[]; automationRuns: AutomationRun[] }, next: { automations: Automation[]; automationRuns: AutomationRun[] }): void {
  state.automations = publishRows(state.automations, next.automations);
  state.automationRuns = publishRows(state.automationRuns, next.automationRuns);
}

/** Only editable configuration comes from the renderer; runtime history belongs to the host. */
export function saveAutomationConfiguration(previous: Automation | undefined, input: Automation, now: number): Automation {
  const { id, name, projectId, prompt, intervalMinutes, enabled, schedule, targetThreadId, execution } = input;
  const changedSchedule = !previous || previous.intervalMinutes !== intervalMinutes ||
    JSON.stringify(previous.schedule) !== JSON.stringify(schedule);
  const configuration = { id, name: name.trim(), projectId, prompt, intervalMinutes, enabled, schedule, targetThreadId, execution };
  const nextRunAt = changedSchedule ? nextAutomationRun(input, now) : previous.nextRunAt;
  // Scheduler and an in-flight run retain this object across awaits. Do not replace it.
  if (previous) return Object.assign(previous, configuration, { nextRunAt });
  return { ...configuration, nextRunAt };
}
