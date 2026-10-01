import type { Automation } from './contracts.ts';

/** Compare editable fields only; scheduler progress must not invalidate an open form. */
export function automationConfigurationKey(job: Automation): string {
  const schedule = job.schedule, execution = job.execution;
  return JSON.stringify([job.id, job.name, job.projectId, job.prompt, job.intervalMinutes, job.enabled, job.targetThreadId ?? '',
    schedule ? [schedule.kind, schedule.time, schedule.timezone, schedule.weekday, schedule.monthday] : null,
    [execution?.providerId ?? '', execution?.thinking ?? '', execution?.policy ?? '', execution?.directoryId ?? '', execution?.environment ?? 'local', execution?.startPoint ?? 'HEAD']]);
}

export function assertAutomationBase(current: Automation | undefined, base: Automation | null | undefined): void {
  if (base === undefined) return;
  if (base === null ? !!current : !current || automationConfigurationKey(current) !== automationConfigurationKey(base))
    throw new Error('自动化已被修改或删除，请加载最新版本后重试');
}
