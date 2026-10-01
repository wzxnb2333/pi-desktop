import type { TimelineItem } from '../../../shared/contracts.ts';

/**
 * Grouping adapter from the flat `thread.items` timeline to per-request turns. Pure and
 * React-free so `node:test` can import it directly.
 *
 * A `user` item is the only turn boundary we can trust: `entryId` is set only for history items
 * (`worker/timeline.ts` passes it from the session branch, the live path calls `messageItem()`
 * without it), and item ids are per-message (`${role}-${timestamp}`, or the `toolCallId`), so they
 * prove merge stability but say nothing about which request a message answered. Pi's own session
 * model is user-message-delimited, so deriving turns from user items is the same rule, applied late.
 */
export type TurnEntry =
  | { kind: 'prose'; items: TimelineItem[] }
  | { kind: 'tools'; items: TimelineItem[]; toolNames: string[] }
  | { kind: 'notice'; items: TimelineItem[] };

export type Turn = {
  key: string;
  user?: TimelineItem;
  entries: TurnEntry[];
  /** Completed assistant message with a confirmed end reason and no pending tool calls. */
  result?: TimelineItem;
  state: 'running' | 'done' | 'error';
  startedAt: number;
};

/** Ordered render blocks: prose and notices remain boundaries between consecutive tools. */
export type TurnBlock =
  | { kind: 'thinking'; key: string; item: TimelineItem; text: string; startedAt?: number; completedAt?: number }
  | { kind: 'prose'; key: string; items: TimelineItem[] }
  | { kind: 'answer'; key: string; items: TimelineItem[] }
  | { kind: 'activity'; key: string; preamble: TimelineItem[]; tools: TimelineItem[]; toolNames: string[] }
  | { kind: 'notice'; key: string; items: TimelineItem[] };

const PROLOGUE = 'prologue';

function entryKind(item: TimelineItem): TurnEntry['kind'] {
  if (item.role === 'tool') return 'tools';
  if (item.role === 'notice') return 'notice';
  return 'prose';
}

function distinctToolNames(items: TimelineItem[]): string[] {
  return [...new Set(items.map((item) => item.toolName).filter((name): name is string => !!name))];
}

/** Item ids are unique per message, so they double as React keys; duplicates get a stable suffix. */
function uniqueKey(base: string, used: Set<string>): string {
  let key = base;
  let suffix = 2;
  while (used.has(key)) key = `${base}#${suffix++}`;
  used.add(key);
  return key;
}

function appendEntry(turn: Turn, item: TimelineItem): void {
  const kind = entryKind(item);
  const last = turn.entries.at(-1);
  if (last?.kind === kind) {
    last.items.push(item);
    if (last.kind === 'tools') last.toolNames = distinctToolNames(last.items);
    return;
  }
  turn.entries.push(
    kind === 'tools' ? { kind, items: [item], toolNames: distinctToolNames([item]) } : { kind, items: [item] },
  );
}

function finishTurn(turn: Turn, live: boolean): void {
  const last = turn.entries.flatMap((entry) => entry.items).findLast((item) => item.role !== 'notice');
  if (last?.role === 'assistant' && last.state === 'done' && last.text.trim() &&
      !last.blocks?.some((block) => block.type === 'toolCall') &&
      (last.stopReason === 'stop' || last.stopReason === 'length' || (!live && !last.stopReason))) turn.result = last;
  const items = turn.entries.flatMap((entry) => entry.items);
  if (live || items.some((item) => item.state === 'running')) turn.state = 'running';
  // A failed tool inside a recovered turn stays 'done': the tool card carries its own error state.
  else if (turn.result) turn.state = turn.result.state === 'error' ? 'error' : 'done';
  else turn.state = items.some((item) => item.state === 'error') ? 'error' : 'done';
}

export function groupTurns(items: TimelineItem[], running: boolean): Turn[] {
  const turns: Turn[] = [];
  const used = new Set<string>();
  let turn: Turn | undefined;
  for (const item of items) {
    if (item.role === 'user') {
      turn = { key: uniqueKey(item.id, used), user: item, entries: [], state: 'done', startedAt: item.timestamp };
      turns.push(turn);
      continue;
    }
    if (!turn) {
      // A restored session can start with assistant or notice items ahead of the first request.
      turn = { key: uniqueKey(PROLOGUE, used), entries: [], state: 'done', startedAt: item.timestamp };
      turns.push(turn);
    }
    appendEntry(turn, item);
  }
  turns.forEach((item, index) => finishTurn(item, index === turns.length - 1 && running));
  return turns;
}

export function turnBlocks(turn: Turn): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  turn.entries.forEach((entry, index) => {
    const key = entry.items[0]?.id ?? `${turn.key}-entry-${index}`;
    if (entry.kind === 'notice') {
      blocks.push({ kind: 'notice', key, items: entry.items });
      return;
    }
    if (entry.kind === 'tools') {
      blocks.push({ kind: 'activity', key, preamble: [], tools: entry.items, toolNames: entry.toolNames });
      return;
    }
    for (const item of entry.items) {
      const parts = item.blocks ?? [
        ...(item.thinking ? [{ type: 'thinking' as const, text: item.thinking }] : []),
        ...(item.text ? [{ type: 'text' as const, text: item.text }] : []),
      ];
      const lastText = parts.findLastIndex((part) => part.type === 'text');
      parts.forEach((part, partIndex) => {
        const partKey = `${item.id}:${partIndex}`;
        if (part.type === 'thinking' && part.text) blocks.push({ kind: 'thinking', key: partKey, item, ...part });
        if (part.type === 'text' && part.text) blocks.push({ kind: item === turn.result && partIndex === lastText ? 'answer' : 'prose', key: partKey, items: [{ ...item, text: part.text, thinking: '', blocks: undefined }] });
      });
      if (item.state === 'error' && item.text && !parts.some((part) => part.type === 'text' && part.text === item.text))
        blocks.push({ kind: 'notice', key: `${item.id}:error`, items: [{ ...item, role: 'notice' }] });
    }
  });
  return blocks;
}

/**
 * File hints come from validated JSON arguments reconstructed from tool-call ids when available.
 * Legacy histories without the originating call remain incomplete; this is not a file-change count.
 * Artifacts are thread-level (`thread.artifacts[]`) and deliberately not attributed to a turn.
 */
export function turnFiles(turn: Turn): string[] {
  const files = new Set<string>();
  for (const entry of turn.entries) {
    if (entry.kind !== 'tools') continue;
    for (const item of entry.items) {
      if (!item.args) continue;
      try {
        const args: unknown = JSON.parse(item.args);
        const path = typeof args === 'object' && args !== null ? (args as { path?: unknown }).path : undefined;
        if (typeof path === 'string' && path) files.add(path);
      } catch {
        // Truncated or non-JSON arguments: the file list stays approximate by design.
      }
    }
  }
  return [...files];
}

export interface TurnArtifact { key: string; path: string; directoryId?: string; }
export function turnArtifacts(turn: Turn): TurnArtifact[] {
  const artifacts = new Map<string, TurnArtifact>();
  for (const entry of turn.entries) for (const item of entry.items) {
    if (item.role !== 'tool' || item.state !== 'done' || !['write', 'edit', 'project_write'].includes(item.toolName ?? '') || !item.args) continue;
    try {
      const value: unknown = JSON.parse(item.args);
      if (!value || typeof value !== 'object') continue;
      const args = value as Record<string, unknown>;
      if (typeof args.path !== 'string' || !args.path || args.path.length > 2000) continue;
      const directoryId = item.toolName === 'project_write' && typeof args.directoryId === 'string' ? args.directoryId : undefined;
      if (item.toolName === 'project_write' && !directoryId) continue;
      const key = JSON.stringify([directoryId, args.path]); artifacts.set(key, { key, path: args.path, directoryId });
    } catch { /* An incomplete tool call is not evidence of a produced file. */ }
  }
  return [...artifacts.values()];
}
