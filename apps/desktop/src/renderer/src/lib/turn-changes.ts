import { parseUnifiedDiff } from './diff.ts';
import type { Turn } from './timeline-groups.ts';

export type EditRecord = { id: string; kind: 'patch' | 'write' | 'legacy' | 'unavailable'; text: string; additions?: number; deletions?: number };
export type TurnChange = { key: string; path: string; directoryId?: string; records: EditRecord[]; additions: number; deletions: number; partial: boolean };

/** Only successful tool results are evidence. Never substitute a later workspace diff. */
export function recordedTurnChanges(turn: Turn): TurnChange[] {
  const files = new Map<string, TurnChange>();
  for (const entry of turn.entries) for (const item of entry.items) {
    if (item.role !== 'tool' || item.state !== 'done' || !['write', 'edit', 'project_write'].includes(item.toolName ?? '') || !item.args) continue;
    let args: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(item.args);
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      args = value as Record<string, unknown>;
    } catch { continue; }
    if (typeof args.path !== 'string' || !args.path.trim() || args.path.length > 2000) continue;
    const directoryId = item.toolName === 'project_write' && typeof args.directoryId === 'string' ? args.directoryId : undefined;
    if (item.toolName === 'project_write' && !directoryId) continue;
    const key = JSON.stringify([directoryId, args.path]);
    const file = files.get(key) ?? { key, path: args.path, directoryId, records: [], additions: 0, deletions: 0, partial: false };
    let record: EditRecord = { id: item.id, kind: 'unavailable', text: '' };
    if (item.toolName === 'edit' && item.details?.patch) {
      // The edit tool stores standard ---/+++ patches; the shared viewer expects a Git section.
      const patch = item.details.patch.startsWith('diff --git ') ? item.details.patch : 'diff --git ' + JSON.stringify('a/' + args.path) + ' ' + JSON.stringify('b/' + args.path) + '\n' + item.details.patch;
      const parsed = parseUnifiedDiff(patch);
      const lines = parsed.flatMap(file => file.hunks.flatMap(hunk => hunk.lines));
      record = { id: item.id, kind: 'patch', text: patch };
      if (parsed.length && parsed.every(file => file.kind !== 'binary' && file.warnings.length === 0)) {
        record.additions = lines.filter(line => line.kind === 'add').length;
        record.deletions = lines.filter(line => line.kind === 'del').length;
      }
    } else if (item.toolName === 'edit' && item.details?.diff) record = { id: item.id, kind: 'legacy', text: item.details.diff };
    else if (item.toolName !== 'edit' && typeof args.content === 'string') record = { id: item.id, kind: 'write', text: args.content };
    file.records.push(record);
    file.additions += record.additions ?? 0; file.deletions += record.deletions ?? 0;
    file.partial ||= record.additions === undefined;
    files.set(key, file);
  }
  return [...files.values()];
}
