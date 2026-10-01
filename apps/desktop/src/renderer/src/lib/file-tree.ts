import type { FileEntry } from '../../../shared/contracts.ts';

export interface DirectoryListing {
  state: 'loading' | 'ready' | 'error';
  entries: FileEntry[];
  error?: string;
}
export interface FileTreeRow extends FileEntry {
  parent: string;
  level: number;
  position: number;
  siblings: number;
}

export function fileTreeRows(root: string, listings: ReadonlyMap<string, DirectoryListing>, expanded: ReadonlySet<string>): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visited = new Set<string>();
  const visit = (parent: string, level: number) => {
    if (visited.has(parent)) return;
    visited.add(parent);
    const entries = listings.get(parent)?.entries ?? [];
    entries.forEach((entry, index) => {
      rows.push({ ...entry, parent, level, position: index + 1, siblings: entries.length });
      if (entry.directory && expanded.has(entry.path)) visit(entry.path, level + 1);
    });
  };
  visit(root, 1);
  return rows;
}

export function fileTreeFocus(rows: readonly FileTreeRow[], preferred: string, selected: string): string {
  const available = new Set(rows.map(row => row.path));
  let path = preferred;
  while (path) {
    if (available.has(path)) return path;
    const slash = path.lastIndexOf('/');
    path = slash < 0 ? '' : path.slice(0, slash);
  }
  return available.has(selected) ? selected : rows[0]?.path ?? '';
}

export function fileTreePrefix(rows: readonly FileTreeRow[], current: string, prefix: string): string | undefined {
  const start = rows.findIndex(row => row.path === current);
  for (let offset = 1; offset <= rows.length; offset++) {
    const row = rows[(start + offset) % rows.length];
    if (row.name.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) return row.path;
  }
}
