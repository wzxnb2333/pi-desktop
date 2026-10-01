import type { TimelineItem } from '../../../shared/contracts.ts';
import type { Subtask } from '../../../shared/subtasks.ts';

/** Bind only confirmed create results; reads/lists and repeated titles must not duplicate creation rows. */
export function subtaskCreations(tools: TimelineItem[], records: Subtask[]): Map<string, Subtask> {
  const available = new Map(records.map(record => [record.id, record]));
  const created = new Map<string, Subtask>();
  for (const item of tools) {
    if (item.toolName !== 'manage_subtasks' || item.state === 'error') continue;
    try {
      const args: unknown = JSON.parse(item.args ?? '{}');
      if (!args || typeof args !== 'object' || !('action' in args) || args.action !== 'subtasks.create') continue;
    } catch { continue; }
    const results = [...(item.toolResult?.result.content ?? []).flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []), item.text];
    for (const text of results) {
      try {
        const result: unknown = JSON.parse(text);
        if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') continue;
        const record = available.get(result.id);
        if (record) { created.set(item.id, record); available.delete(record.id); break; }
      } catch { /* A pending/legacy result keeps its record in the process fallback. */ }
    }
  }
  return created;
}
