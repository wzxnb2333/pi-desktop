import type { Project, Thread, UiThread } from './contracts.ts';

export interface ProjectDirectory { id: string; name: string; path: string; trusted: boolean; }

export function projectDirectories(project: Project): ProjectDirectory[] {
  return [{ id: project.id, name: project.name, path: project.path, trusted: project.trusted }, ...(project.directories ?? [])];
}

export function primaryDirectory(project: Project): ProjectDirectory {
  const directory = projectDirectories(project).find(item => item.id === (project.primaryDirectoryId ?? project.id));
  if (!directory) throw new Error('项目主目录不存在，请重新选择');
  return directory;
}

export function taskDirectory(project: Project, thread: Thread, id = thread.directoryId ?? project.id): ProjectDirectory {
  const directory = projectDirectories(project).find(item => item.id === id);
  if (!directory) throw new Error('目录不属于此项目或已被移除');
  return id === (thread.directoryId ?? project.id) ? { ...directory, path: thread.cwd } : directory;
}

export const fileViewFields = ['selectedPath', 'fileDirectory', 'expandedDirectories', 'fileTreeFocus', 'fileLocation', 'openFiles'] as const;

export function directoryThreadUi(ui: UiThread, id: string, executionId: string): UiThread {
  if (id === executionId) return ui;
  const cleared = { ...ui, selectedPath: '', fileDirectory: '', expandedDirectories: [], fileTreeFocus: '', fileLocation: undefined, openFiles: [] };
  return { ...cleared, ...ui.directoryViews?.[id] };
}

export function directoryUiPatch(ui: UiThread, patch: Partial<UiThread>, id: string, executionId: string): Partial<UiThread> {
  if (id === executionId) return patch;
  const view = { ...(ui.directoryViews?.[id] ?? {}) };
  const rest = { ...patch };
  for (const field of fileViewFields) {
    if (field in patch) { Object.assign(view, { [field]: patch[field] }); delete rest[field]; }
  }
  return { ...rest, directoryViews: { ...ui.directoryViews, [id]: view } };
}
