import { messageLink } from '../lib/message-links.ts';
import { useApp } from '../state/app.tsx';

export function useOpenLink() {
  const { thread, activeId, act, setError, openFileTab, patchThread, setReviewOpen } = useApp();
  return (href: string | undefined, external = false) => {
    if (!thread) return;
    const link = messageLink(href, thread.cwd);
    if (link.kind === 'unavailable') { setError(link.reason); return; }
    if (external) {
      act(link.kind === 'web' ? { op: 'external.open', url: link.url } : { op: 'file.open', threadId: activeId, directoryId: thread.directoryId ?? thread.projectId, path: link.path });
      return;
    }
    if (link.kind === 'file') {
      // Always record a location: it focuses the editor on the opened tab even without a line anchor.
      openFileTab(link.path, { line: link.line ?? 1, ...(link.column === undefined ? {} : { column: link.column }) },
        thread.directoryId ?? thread.projectId);
    } else {
      const tabId = crypto.randomUUID();
      // The main process appends native browser tabs atomically; never replace its list from a render snapshot.
      act({ op: 'browser.open', threadId: activeId, tabId, url: link.url });
      patchThread({ reviewTab: 'browser', activeBrowserTab: tabId });
    }
    setReviewOpen(true);
  };
}
