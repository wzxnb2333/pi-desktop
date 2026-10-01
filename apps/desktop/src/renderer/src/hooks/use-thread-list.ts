import type { Project, Thread } from '../../../shared/contracts.ts';
import { itemSearchTexts } from '../lib/conversation-search.ts';

/*
 * Lives under `hooks/` because the sidebar calls it from `useMemo`, but it deliberately imports no
 * React: grouping, sorting and filtering are the sidebar's only real logic, and a pure module is
 * regressible with `node --test` instead of a browser.
 */

export interface ThreadGroup {
  project: Project;
  threads: Thread[];
}

export interface ThreadListInput {
  projects: Project[];
  threads: Thread[];
  /** Active and archived tasks are a partition, not an add-on: the flag swaps which half is listed. */
  showArchived: boolean;
  search: string;
}

/** Most recently touched first, matching the reference's task list ordering. */
export const byUpdatedDesc = (left: Thread, right: Thread): number => Number(!!right.pinned) - Number(!!left.pinned) || right.updatedAt - left.updatedAt;

/** Whitespace-only input is "not searching": trimming must not turn `' '` into a substring that matches nothing. */
export function matchesSearch(thread: Thread, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return thread.title.toLowerCase().includes(needle) || thread.items.some(item => itemSearchTexts(item).some(text => text.toLowerCase().includes(needle)));
}

export function groupThreadList({
  projects,
  threads,
  showArchived,
  search,
}: ThreadListInput): ThreadGroup[] {
  const visible = threads
    .filter((thread) => !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && !thread.deletedAt && thread.archived === showArchived && matchesSearch(thread, search))
    .sort(byUpdatedDesc);
  const filtering = !!search.trim();
  return projects
    .map((project) => ({ project, threads: visible.filter((thread) => thread.projectId === project.id) }))
    // An empty project keeps its row because that row is the only way to start a task inside it.
    // While searching, the visible groups are the matches, so a project with no hits is dead weight.
    .filter((group) => !filtering || group.threads.length > 0);
}
