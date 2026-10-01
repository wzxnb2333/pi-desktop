import type { TimelineItem } from './contracts.ts';

/** Preserve measured execution metadata when session history replaces live entries. */
export function mergeTimelineItem(item: TimelineItem, previous?: TimelineItem): TimelineItem {
  if (!previous) return item;
  return { ...item, timestamp: item.role === 'tool' ? previous.timestamp : item.timestamp,
    args: item.args ?? previous.args, startedAt: item.startedAt ?? previous.startedAt,
    completedAt: item.completedAt ?? previous.completedAt, details: item.details ?? previous.details,
    toolResult: item.toolResult ?? previous.toolResult,
    input: item.input ?? previous.input,
    blocks: item.blocks?.map((block, index) => {
      const old = previous.blocks?.[index];
      return block.type === 'thinking' && old?.type === 'thinking'
        ? { ...block, startedAt: block.startedAt ?? old.startedAt, completedAt: block.completedAt ?? old.completedAt } : block;
    }) ?? previous.blocks,
  };
}
