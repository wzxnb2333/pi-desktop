import type { TimelineItem } from './contracts.ts';

/**
 * Literal Unicode search preserves source offsets instead of lowercasing and shifting indexes. Shared so
 * the renderer's in-conversation search and the desktop tool surface match text exactly the same way.
 */
export function literalMatches(text: string, query: string): IterableIterator<RegExpMatchArray> {
  return text.matchAll(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu'));
}

/** Content filtering includes real reasoning, arguments and diffs, without synthetic labels. */
export function itemSearchTexts(item: TimelineItem): string[] {
  return [item.text, item.thinking ?? '', item.args ?? '', item.details?.diff ?? '',
    ...(item.blocks ?? []).flatMap(block => block.type === 'text' || block.type === 'thinking' ? [block.text] : [])];
}

export interface ItemSearchMatch {
  itemId: string;
  role: TimelineItem['role'];
  timestamp: number;
  /** Which field matched, so a reader knows whether it was the answer, reasoning, arguments or a diff. */
  field: 'text' | 'thinking' | 'args' | 'diff';
  /** Bounded window around the first hit in that field. */
  excerpt: string;
  /** Character offset of the hit inside the field, and the total hits in it. */
  start: number;
  occurrences: number;
}

const EXCERPT_WINDOW = 160;

function firstMatch(text: string, query: string): { start: number; count: number } {
  let start = -1;
  let count = 0;
  for (const match of literalMatches(text, query)) {
    if (start < 0) start = match.index ?? 0;
    count += 1;
    if (count > 1000) break;
  }
  return { start, count };
}

/**
 * Search one session the way the cross-session reader exposes it: user and assistant text only. Thinking,
 * tool arguments and diffs stay out, because `sessions.read` does not return them either — one surface,
 * one rule, no accidental leak of a tool's payload into another session's context.
 */
export function searchSessionItems(items: readonly TimelineItem[], query: string, limit = 50): ItemSearchMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const matches: ItemSearchMatch[] = [];
  for (const item of items) {
    if (matches.length >= limit) break;
    if (item.role !== 'user' && item.role !== 'assistant') continue;
    const text = item.text ?? '';
    if (!text) continue;
    const hit = firstMatch(text, needle);
    if (hit.start < 0) continue;
    const from = Math.max(0, hit.start - EXCERPT_WINDOW);
    const to = Math.min(text.length, hit.start + needle.length + EXCERPT_WINDOW);
    matches.push({
      itemId: item.id, role: item.role, timestamp: item.timestamp, field: 'text',
      excerpt: (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : ''),
      start: hit.start, occurrences: hit.count,
    });
  }
  return matches;
}
