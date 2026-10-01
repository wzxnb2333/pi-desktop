import { useEffect, useRef, useState } from 'react';
import type { View } from '../../../shared/contracts.ts';
import type { AppState } from '../state/app.tsx';

type Location = { view: View; threadId: string; projectId: string };
const same = (a: Location | undefined, b: Location) => a?.view === b.view && a.threadId === b.threadId && a.projectId === b.projectId;

/** Session navigation records Pi routes; browser history does not track renderer state. */
export function useWorkspaceHistory(app: AppState) {
  const location: Location = { view: app.view, threadId: app.view === 'thread' ? app.activeId : '', projectId: app.view === 'thread' ? app.project?.id ?? '' : '' };
  const [history, setHistory] = useState({ entries: [location], index: 0 });
  const requested = useRef<number | undefined>(undefined);
  useEffect(() => {
    const index = requested.current;
    requested.current = undefined;
    setHistory(previous => {
      if (index !== undefined && same(previous.entries[index], location)) return { ...previous, index };
      return same(previous.entries[previous.index], location) ? previous : {
        entries: [...previous.entries.slice(0, previous.index + 1), location], index: previous.index + 1,
      };
    });
  }, [location.view, location.threadId, location.projectId]);

  const valid = (entry: Location) => entry.view !== 'thread' || (entry.threadId
    ? app.data.threads.some(thread => thread.id === entry.threadId && !thread.deletedAt)
    : !entry.projectId || app.data.projects.some(project => project.id === entry.projectId));
  const destination = (direction: number) => {
    for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction)
      if (valid(history.entries[index])) return index;
    return -1;
  };
  const backIndex = destination(-1);
  const forwardIndex = destination(1);
  const visit = (index: number) => {
    const entry = history.entries[index];
    if (!entry || !valid(entry)) return;
    // A form guard can cancel navigation. Move the cursor only when the destination actually opens.
    requested.current = index;
    if (entry.view !== 'thread') app.setView(entry.view);
    else if (entry.threadId) {
      const thread = app.data.threads.find(thread => thread.id === entry.threadId);
      if (thread) app.selectThread(thread);
    } else app.selectProject(entry.projectId);
  };
  return { canBack: backIndex >= 0, canForward: forwardIndex >= 0, back: () => visit(backIndex), forward: () => visit(forwardIndex) };
}
