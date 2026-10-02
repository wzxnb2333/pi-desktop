import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { usePanelActions } from '../../hooks/use-panel-actions.ts';
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Settings, SettingsNavigation, type SettingsCategory } from '../../Settings.tsx';
import { Composer } from '../composer/composer.tsx';
import { AutomationsPage, InboxPage, SkillsPage } from '../management/pages.tsx';
import { ReviewPanel } from '../panels/review-panel.tsx';
import { TaskSummaryCard } from '../panels/task-summary.tsx';
import { Resizer } from './resizer.tsx';
import { Sidebar } from '../sidebar/sidebar.tsx';
import { Timeline } from '../timeline/timeline.tsx';
import { ApprovalCard } from '../timeline/message.tsx';
import { ErrorBanner } from './status-bar.tsx';
import { Toolbar } from './toolbar.tsx';
import { WorkbenchCommands } from './commands.tsx';
import { useApp } from '../../state/app.tsx';
import { clampLayout, summaryPlacement, workspaceSizes, type ResizeKey } from '../../lib/layout.ts';

type Drag = { key: ResizeKey; value: number } | undefined;

export function Workspace() {
  useLocale();
  const panels = usePanelActions();
  const {
    ui, patchUi,
    data,
    view,
    setView,
    sidebarOpen,
    reviewOpen,
    thread,
    approvals,
    invoke,
    registerViewGuard,
    setLayoutSize,
    reviewTab, setReviewTab, setReviewOpen,
  } = useApp();
  const [drag, setDrag] = useState<Drag>(undefined);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('models');
  const home = view === 'thread' && !thread?.items.length;
  const panelOpen = reviewOpen && ['changes', 'files', 'file', 'browser', 'sidechat', 'review', 'terminal', 'subtasks', 'subtask'].includes(reviewTab);
  const summaryOpen = ui.summaryOpen !== false && (!home || ui.summaryOpen === true);
  const previewOpen = reviewOpen && reviewTab === 'browser';
  const setPreviewOpen = (open: boolean) => { setReviewTab('browser'); setReviewOpen(open); };
  // The reference clamps the sidebar against the live viewport, so a persisted width that was legal
  // in a wide window must still shrink when the window does. Clamping only on commit left the load
  // path unclamped: a stored 520 rendered 520 in a 500px-wide window.
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const requested = (key: ResizeKey, persisted: number) =>
    clampLayout(key, drag?.key === key ? drag.value : persisted, viewport.width);
  const sizes = workspaceSizes(
    viewport.width,
    viewport.height,
    sidebarOpen ? requested('sidebarWidth', ui.sidebarWidth) : 0,
    panelOpen && view === 'thread' && thread ? requested('reviewWidth', ui.reviewWidth) : 0,
    requested('terminalHeight', ui.terminalHeight),
    summaryOpen,
  );
  const summary = summaryPlacement(viewport.width - sizes.sidebarWidth - 1, sizes.reviewWidth, sizes.reviewOverlay);
  const layout = useRef<HTMLDivElement>(null);
  const [summaryHeight, setSummaryHeight] = useState(0);
  const [composerClearance, setComposerClearance] = useState(140);
  useLayoutEffect(() => {
    const container = layout.current;
    if (!container) return;
    const rail = container.querySelector('.task-summary-rail');
    const composer = container.querySelector('.composer');
    const measure = () => {
      if (rail) setSummaryHeight(rail.getBoundingClientRect().height);
      if (composer) setComposerClearance(Math.max(0, container.getBoundingClientRect().bottom - composer.getBoundingClientRect().top + 12));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (rail) observer.observe(rail);
    if (composer) observer.observe(composer);
    return () => observer.disconnect();
  }, [summaryOpen, summary.stacked, thread?.id, home, view]);
  // Preview visibility is session-only, so leaving the task view has to drop it.
  return (
    <div className="workspace">
      <WorkbenchCommands panels={panels} />
      {sidebarOpen && (
        <>
          {view === 'settings' ? (
            <SettingsNavigation
              width={sizes.sidebarWidth}
              category={settingsCategory}
              onChange={setSettingsCategory}
              onBack={() => setView('thread')}
            />
          ) : (
            <Sidebar width={sizes.sidebarWidth} />
          )}
          <Resizer
            label={tr("调整侧栏宽度")}
            axis="horizontal"
            keyName="sidebarWidth"
            value={sizes.sidebarWidth}
            onDrag={(value) => setDrag({ key: 'sidebarWidth', value })}
            onCommit={(value) => {
              setDrag(undefined);
              setLayoutSize('sidebarWidth', value);
            }}
          />
        </>
      )}
      <main className="main" data-home={home || undefined} data-review-docked={view === 'thread' && panelOpen && !sizes.reviewOverlay || undefined} style={{ '--review-pane-width': sizes.reviewWidth + 'px' } as CSSProperties}>
        {view !== 'settings' && <Toolbar key={thread?.id ?? view} previewOpen={previewOpen} setPreviewOpen={setPreviewOpen} />}
        <ErrorBanner />
        {view !== 'thread' && approvals.filter(approval => approval.threadId === thread?.id && approval.scope === 'external-tools').map(approval => <ApprovalCard key={approval.id} approval={approval} />)}
        {view === 'settings' && (
          <Settings
            data={data}
            invoke={invoke}
            registerViewGuard={registerViewGuard}
            category={settingsCategory}
            onCategoryChange={setSettingsCategory}
            onLocaleChange={locale => patchUi({ locale })}
          />
        )}
        {view === 'inbox' && <InboxPage />}
        {view === 'skills' && <SkillsPage />}
        {view === 'automations' && <AutomationsPage />}
        {view === 'thread' && (
          <>
            <div ref={layout} className={"conversation-layout" + (sizes.reviewOverlay ? ' auxiliary-overlay' : '') + (summary.overlay ? ' summary-overlay' : '') + (summaryOpen && summary.stacked ? ' summary-stacked' : '')}
              style={{ '--summary-right': summary.right + 'px', '--summary-stack-height': summaryHeight + 32 + 'px',
                '--tool-overlay-top': summaryOpen && summary.stacked ? summaryHeight + 32 + 'px' : '0px',
                '--tool-overlay-bottom': summaryOpen && sizes.reviewOverlay ? composerClearance + 'px' : '0px' } as CSSProperties}>
              <section className="conversation">
                <Timeline />
                {thread && thread.items.length > 0 && <Composer />}
              </section>
              {summaryOpen && thread && <TaskSummaryCard key={thread.id} />}
              {panelOpen && thread && (
                <>
                  <Resizer
                    label={tr("调整辅助栏宽度")}
                    axis="horizontal"
                    keyName="reviewWidth"
                    value={sizes.reviewWidth}
                    overlayOffset={sizes.reviewOverlay ? sizes.reviewWidth : undefined}
                    invert
                    onDrag={(value) => setDrag({ key: 'reviewWidth', value })}
                    onCommit={(value) => {
                      setDrag(undefined);
                      setLayoutSize('reviewWidth', value);
                    }}
                  />
                  <ReviewPanel width={sizes.reviewWidth} actions={panels} />
                </>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
