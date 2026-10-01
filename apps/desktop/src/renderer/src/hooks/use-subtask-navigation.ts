import { panelTabs, selectPanelTab } from '../../../shared/panel-tabs.ts';
import type { PanelTab } from '../../../shared/contracts.ts';
import { useApp } from '../state/app.tsx';

export function useSubtaskNavigation() {
  const { thread, threadUi, data, patchThread, setReviewOpen } = useApp();
  return (id?: string) => {
    if (!thread || id && !data.subtasks.some(record => record.id === id && record.parentThreadId === thread.id)) return;
    const tab: PanelTab = id ? { id: 'subtask:' + id, kind: 'subtask' } : { id: 'tool:subtasks', kind: 'subtasks' };
    const tabs = panelTabs(threadUi);
    patchThread({ ...selectPanelTab(tab), panelTabs: tabs.some(item => item.id === tab.id) ? tabs : [...tabs, tab] });
    setReviewOpen(true);
  };
}
