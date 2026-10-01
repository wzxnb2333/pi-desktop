import type { Subtask } from '../shared/subtasks.ts';

/** Preserve the committed row identities held by task workers. */
export function publishSubtasks(current: Subtask[], next: Subtask[]): void {
  const rows = new Map(current.map(record => [record.id, record]));
  current.splice(0, current.length, ...next.map(value => {
    const row = rows.get(value.id); if (!row) return structuredClone(value);
    for (const key of Object.keys(row) as (keyof Subtask)[]) if (!Object.hasOwn(value, key)) delete row[key];
    return Object.assign(row, structuredClone(value));
  }));
}
