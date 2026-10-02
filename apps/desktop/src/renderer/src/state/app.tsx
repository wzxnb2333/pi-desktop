import { tr, setLocale } from "../../../shared/localization.ts";
import { useLocale } from "../hooks/use-locale.ts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type Approval,
  bootstrapSchema,
  type DesktopData,
  type DesktopRequest,
  defaultData,
  type Project,
  type ReviewTab,
  type TerminalInfo,
  type Thread,
  type UiState,
  uiSchema,
  type UiThread,
  type View,
} from '../../../shared/contracts.ts';
import type { ResizeKey } from '../lib/layout.ts';
import type { TimelineFocusRequest, TimelineFocusTarget } from '../hooks/use-timeline-focus.ts';
import { applyUiPatch, type UiPatch } from '../../../shared/ui-patches.ts';
import { fileSelectionPatch, panelSelectionPatch, panelUiState } from '../../../shared/panel-tabs.ts';
import { appendTerminalOutput, mergeTerminalSnapshot } from '../../../shared/terminal-output.ts';
import { receiveTerminalOutput } from '../TerminalPanel.tsx';
import { fileBuffers } from '../lib/file-buffers.ts';
import { appearanceFromSettings, appearanceProperties } from '../../../shared/appearance.ts';
import type { RegisterViewGuard } from '../components/primitives/unsaved-navigation.tsx';
import type { ContextReference } from '../../../shared/input-context.ts';
import { type ProjectDirectory, projectDirectories, primaryDirectory, taskDirectory, directoryThreadUi, directoryUiPatch } from '../../../shared/project-directories.ts';

const emptyThreadUi: UiThread = { reviewTab: 'changes', terminalOpen: false, selectedPath: '', folds: {} };

/**
 * Shared renderer state. Frame layout and per-task layout both live in `data.ui`, which the main
 * process persists; the renderer never keeps a second copy of them.
 */
export interface AppState {
  data: DesktopData;
  ui: UiState;
  ready: boolean;
  approvals: Approval[];
  terminals: TerminalInfo[];
  /**
   * `terminal.open` answers with the real title; the event stream only carries '终端'. Without this
   * upsert a new tab is mislabelled until its first output, and the id match keeps it stable after.
   */
  upsertTerminal(terminal: TerminalInfo): void;
  error: string;
  setError(error: string): void;
  invoke(request: DesktopRequest): Promise<unknown>;
  act(request: DesktopRequest): void;
  thread?: Thread;
  project?: Project;
  directory?: ProjectDirectory;
  directoryId: string;
  fileScopeId: string;
  selectDirectory(id: string): void;
  activeId: string;
  /** Session-scoped project selection, independent of the active task. */
  projectId: string;
  setProjectId(id: string): void;
  selectProject(id: string): void;
  running: boolean;
  selectThread(thread: Thread): void;
  createThread(projectId?: string, worktree?: boolean): Promise<Thread | undefined>;
  addProject(): Promise<void>;
  view: View;
  setView(view: View): void;
  registerViewGuard: RegisterViewGuard;
  sidebarOpen: boolean;
  setSidebarOpen(open: boolean): void;
  reviewOpen: boolean;
  setReviewOpen(open: boolean): void;
  showArchived: boolean;
  setShowArchived(open: boolean): void;
  diffSplit: boolean;
  setDiffSplit(split: boolean): void;
  setActiveThread(id: string): void;
  setLayoutSize(key: ResizeKey, value: number): void;
  threadUi: UiThread;
  setFold(key: string, expanded: boolean): void;
  reviewTab: ReviewTab;
  setReviewTab(tab: ReviewTab): void;
  terminalOpen: boolean;
  setTerminalOpen(open: boolean): void;
  selectedPath: string;
  setSelectedPath(path: string): void;
  /** Records the file and selects its own panel tab; optional location jumps to a line after load. */
  openFileTab(path: string, location?: { line: number; column?: number }, directoryId?: string): void;
  patchThread(patch: Partial<UiThread>, threadId?: string): void;
  updateDraft(threadId: string, update: (draft: NonNullable<UiThread['draft']>) => NonNullable<UiThread['draft']>): void;
  updateContextReferences(threadId: string, update: (references: ContextReference[]) => ContextReference[]): void;
  patchUi(patch: Partial<UiState>): void;
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
  timelineRef: React.RefObject<HTMLDivElement | null>;
  timelineFocus?: TimelineFocusRequest;
  focusTimeline(target: TimelineFocusTarget): void;
  finishTimelineFocus(request: TimelineFocusRequest): void;
  previewSurfaceRef: React.RefObject<HTMLDivElement | null>;
  /** Shared with the composer so sending re-pins follow-scroll, as before the split. */
  followRef: React.MutableRefObject<boolean>;
  text: string;
  setText(text: string): void;
  attachments: string[];
  setAttachments(attachments: string[]): void;
}

const Context = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [data, setData] = useState(() => {
    const initial = defaultData();
    // Startup hint only; bootstrap and ui.update remain authoritative. No task state is cached.
    try {
      const cached = localStorage.getItem('pi.desktop.locale');
      if (cached === 'en-US' || cached === 'zh-CN') initial.ui.locale = cached;
    } catch { /* Storage may be unavailable; the schema defaults to Chinese. */ }
    return initial;
  });
  const [ready, setReady] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [error, setError] = useState('');
  const [projectId, setProjectId] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState<TimelineFocusRequest>();
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const pendingUi = useRef<UiState | null>(null);
  const pendingWrites = useRef(new Map<number, UiPatch>());
  const nextWrite = useRef(0);
  const writeChain = useRef(Promise.resolve());
  const taskCreations = useRef(new Map<string, { requestId: string; pending?: Promise<Thread | undefined> }>());
  const navigationRevision = useRef(0);
  const viewGuard = useRef<Parameters<RegisterViewGuard>[0] | undefined>(undefined);
  const viewGuards = useRef(new Set<Parameters<RegisterViewGuard>[0]>());
  const registerViewGuard = useCallback<RegisterViewGuard>((guard) => {
    const refresh = () => {
      const guards = [...viewGuards.current];
      viewGuard.current = guards.length ? (proceed, cancel) => {
        const next = (index: number) => {
          if (index >= guards.length) proceed();
          else if (viewGuards.current.has(guards[index])) guards[index](() => next(index + 1), cancel);
          else next(index + 1);
        };
        next(0);
      } : undefined;
    };
    viewGuards.current.add(guard); refresh();
    return () => { viewGuards.current.delete(guard); refresh(); };
  }, []);

  const invoke = useCallback(async (request: DesktopRequest): Promise<unknown> => {
    try {
      if (request.op === 'browser.tab' || request.op === 'browser.open' || request.op === 'thread.queueClear' || request.op === 'composer.history' || request.op === 'thread.send' || request.op === 'sidechat.append' || request.op === 'window.open' || request.op === 'window' && request.action === 'close') await writeChain.current;
      const response = await window.desktop.invoke(request);
      if (request.op === 'browser.tab' || request.op === 'thread.queueClear' || request.op === 'sidechat.append') {
        const next = [...pendingWrites.current.values()].reduce(applyUiPatch, uiSchema.parse(response));
        pendingUi.current = next;
        setData(previous => ({ ...previous, ui: next }));
      }
      return response;
    } catch (reason) {
      if (!request.op.startsWith('composer.') && request.op !== 'attachment.inspect' && request.op !== 'thread.queueChange' && !(request.op === 'thread.send' && request.requestId)) setError(
        reason instanceof Error
          ? reason.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(reason),
      );
      throw reason;
    }
  }, []);
  const act = useCallback(
    (request: DesktopRequest) => {
      void invoke(request).catch(() => {});
    },
    [invoke],
  );

  useEffect(() => {
    let lastDirty: boolean | undefined;
    const synchronize = () => {
      const dirty = fileBuffers.hasUnsaved();
      if (dirty !== lastDirty) {
        lastDirty = dirty;
        void invoke({ op: 'file.dirty', dirty }).catch(() => {});
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (fileBuffers.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; }
    };
    const unsubscribe = fileBuffers.subscribe(synchronize);
    synchronize();
    window.addEventListener('beforeunload', beforeUnload);
    return () => { unsubscribe(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [invoke]);

  useEffect(() => {
    const onFailure = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      setError(event.reason instanceof Error ? event.reason.message : String(event.reason));
    };
    window.addEventListener('unhandledrejection', onFailure);
    return () => window.removeEventListener('unhandledrejection', onFailure);
  }, []);

  useEffect(() => {
    const unsubscribe = window.desktop.onEvent((event) => {
      if (event.type === 'state') {
        const next = [...pendingWrites.current.values()].reduce(applyUiPatch, event.data.ui);
        pendingUi.current = next;
        setData({ ...event.data, ui: next });
      } else if (event.type === 'approvals') setApprovals(event.approvals);
      else if (event.type === 'timeline.focus') {
        if (event.target.kind === 'composer') composerRef.current?.focus();
        else setTimelineFocus({ threadId: event.threadId, target: event.target });
      }
      else if (event.type === 'error') setError(event.message);
      else if (event.type === 'terminal.created') setTerminals(previous => [...previous.filter(item => item.id !== event.terminal.id), event.terminal]);
      else if (event.type === 'terminal') {
        receiveTerminalOutput(event.id, event.data, event.offset, event.exited);
        setTerminals((prev) => {
          const existing = prev.find((item) => item.id === event.id);
          return existing
            ? prev.map((item) =>
                item.id === event.id
                  ? { ...appendTerminalOutput(item, event.data, event.offset), exited: event.exited ?? item.exited }
                  : item,
              )
            : [
                ...prev,
                {
                  id: event.id,
                  threadId: event.threadId,
                  title: tr("终端"),
                  ...appendTerminalOutput({ output: '', outputOffset: event.offset ?? 0 }, event.data, event.offset),
                  exited: event.exited || false,
                },
              ];
        });
      }
    });
    void invoke({ op: 'bootstrap' })
      .then((value) => {
        const result = bootstrapSchema.parse(value);
        setData(result.data);
        setApprovals(result.approvals);
        setTerminals(previous => [
          ...result.terminals.map(snapshot => mergeTerminalSnapshot(previous.find(item => item.id === snapshot.id), snapshot)),
          ...previous.filter(item => !result.terminals.some(snapshot => snapshot.id === item.id)),
        ]);
        setProjectId(result.data.projects[0]?.id || '');
        setReady(true);
      })
      .catch(() => {});
    return unsubscribe;
  }, [invoke]);

  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
    for (const [property, value] of Object.entries(appearanceProperties(appearanceFromSettings(data.settings)))) {
      if (value) document.documentElement.style.setProperty(property, value);
      else document.documentElement.style.removeProperty(property);
    }
  }, [data.settings]);

  useLayoutEffect(() => {
    setLocale(data.ui.locale);
    document.documentElement.lang = data.ui.locale;
    if (ready) {
      try { localStorage.setItem('pi.desktop.locale', data.ui.locale); } catch { /* Main-process persistence still applies. */ }
    }
  }, [data.ui.locale, ready]);

  const upsertTerminal = useCallback((terminal: TerminalInfo) => {
    setTerminals(previous => previous.some(item => item.id === terminal.id)
      ? previous.map(item => item.id === terminal.id ? mergeTerminalSnapshot(item, terminal) : item)
      : [...previous, mergeTerminalSnapshot(undefined, terminal)]);
  }, []);

  const ui = data.ui;
  const selectedChild = data.threads.find(item => item.id === ui.activeThreadId && item.subtaskId);
  const activeId = selectedChild ? data.subtasks.find(record => record.id === selectedChild.subtaskId)?.parentThreadId ?? '' : ui.activeThreadId;
  const thread = data.threads.find((item) => item.id === activeId);
  const project = thread ? data.projects.find(item => item.id === thread.projectId) : data.projects.find(item => item.id === projectId) || data.projects[0];
  const running = !!thread && ['running', 'waiting'].includes(thread.status);
  const rawThreadUi = ui.threads[activeId] || emptyThreadUi;
  const executionDirectoryId = thread?.directoryId ?? thread?.projectId ?? '';
  const directoryId = project && projectDirectories(project).some(item => item.id === rawThreadUi.directoryId)
    ? rawThreadUi.directoryId! : executionDirectoryId;
  const directory = project ? thread ? taskDirectory(project, thread, directoryId) : primaryDirectory(project) : undefined;
  const threadUi = directoryThreadUi(rawThreadUi, directoryId, executionDirectoryId);
  const scopedInvoke = useCallback((request: DesktopRequest) => {
    if ('threadId' in request && (request.op.startsWith('file.') || request.op.startsWith('git.'))) {
      return invoke({ ...request, directoryId: ('directoryId' in request ? request.directoryId : undefined) ??
        (request.threadId === activeId ? directoryId : undefined) } as DesktopRequest);
    }
    return invoke(request);
  }, [invoke, activeId, directoryId]);
  const text = threadUi.draft?.text ?? '';
  const attachments = threadUi.draft?.attachments ?? [];

  // Apply sparse patches optimistically and replay pending writes over every server response.
  // This preserves fields updated by workers while independent renderer changes are in flight.
  const baseUi = (): UiState => pendingUi.current ?? ui;
  const saveUi = (patch: UiPatch) => {
    const id = ++nextWrite.current;
    pendingWrites.current.set(id, patch);
    const next = applyUiPatch(baseUi(), patch);
    pendingUi.current = next;
    setData(previous => ({ ...previous, ui: next }));
    writeChain.current = writeChain.current.then(async () => {
      const response = await invoke('frame' in patch
        ? { op: 'ui.update', ui: applyUiPatch(pendingUi.current ?? next, patch), frame: patch.frame }
        : { op: 'ui.threadPatch', threadId: patch.threadId, patch: patch.thread });
      pendingWrites.current.delete(id);
      const result = [...pendingWrites.current.values()].reduce(applyUiPatch, uiSchema.parse(response));
      pendingUi.current = result;
      setData(previous => ({ ...previous, ui: result }));
    }).catch(() => { pendingWrites.current.delete(id); });
  };
  const commitUi = useCallback(
    (patch: Partial<UiState>, afterCommit?: () => void, confirmed = false) => {
      const apply = () => { if (patch.activeThreadId !== undefined || patch.view !== undefined) navigationRevision.current++; saveUi({ frame: patch }); afterCommit?.(); };
      if (!confirmed && patch.view && patch.view !== baseUi().view && viewGuard.current) {
        viewGuard.current(apply, () => {});
        return;
      }
      apply();
    },
    [act, ui],
  );
  const commitThreadUi = useCallback(
    (patch: Partial<UiThread>, targetId = activeId) => {
      const target = data.threads.find(thread => thread.id === targetId);
      if (!targetId || !target) return;
      const raw = baseUi().threads[targetId] ?? emptyThreadUi;
      const execution = target.directoryId ?? target.projectId;
      saveUi({ threadId: targetId, thread: directoryUiPatch(raw, panelSelectionPatch(raw, patch), patch.directoryId ?? raw.directoryId ?? execution, execution) });
    },
    [activeId, act, ui, data.threads],
  );

  const previousPanelUi = useRef<UiState | undefined>(undefined);
  useEffect(() => {
    const normalized = panelUiState(ui, previousPanelUi.current);
    previousPanelUi.current = ui;
    if (normalized === ui) return;
    // Persist the migration/request acknowledgement. Re-normalizing only renderer snapshots
    // would let the old main-process flag reopen a pane the user just hid.
    for (const [id, next] of Object.entries(normalized.threads)) if (next !== ui.threads[id])
      commitThreadUi({ reviewTab: next.reviewTab, terminalOpen: next.terminalOpen, panelTabs: next.panelTabs }, id);
    if (normalized.reviewOpen !== ui.reviewOpen) commitUi({ reviewOpen: normalized.reviewOpen });
  }, [ui, commitThreadUi, commitUi]);

  useEffect(() => {
    if (ui.activeThreadId !== activeId) commitUi({ activeThreadId: activeId, openThreads: ui.openThreads?.filter(id => !data.threads.some(thread => thread.id === id && thread.subtaskId)) });
  }, [activeId, ui.activeThreadId, commitUi]);

  const selectThread = useCallback(
    (selected: Thread, confirmed = false) => {
      if (selected.subtaskId) return;
      // Route and selection effects must either all happen or all remain unchanged on cancellation.
      commitUi({ activeThreadId: selected.id, view: 'thread', openThreads: [...new Set([...(baseUi().openThreads ?? []), selected.id])] }, () => {
        setProjectId(selected.projectId);
        followRef.current = baseUi().threads[selected.id]?.scroll?.follow ?? true;
        act({ op: 'thread.update', id: selected.id, readAt: Date.now() });
      }, confirmed);
    },
    [commitUi],
  );

  const selectProject = useCallback((id: string) => {
    commitUi({ view: 'thread', activeThreadId: '' }, () => setProjectId(id));
  }, [commitUi]);

  const createThread = useCallback(
    (id?: string, worktree = false): Promise<Thread | undefined> => {
      const target = id ?? project?.id ?? '';
      const key = JSON.stringify([target, worktree]);
      const entry = taskCreations.current.get(key) ?? { requestId: crypto.randomUUID() };
      if (entry.pending) return entry.pending;
      taskCreations.current.set(key, entry);
      const create = async () => {
        const origin = baseUi().view, active = baseUi().activeThreadId;
        const guard = origin === 'thread' ? undefined : viewGuard.current;
        if (guard) {
          const accepted = await new Promise<boolean>(resolve => guard(() => resolve(true), () => resolve(false)));
          if (!accepted) return undefined;
        }
        const revision = navigationRevision.current;
        const created = (await invoke(target || worktree
          ? { op: 'thread.create', projectId: target, worktree, requestId: entry.requestId }
          : { op: 'chat.create', requestId: entry.requestId })) as Thread;
        if (taskCreations.current.get(key) === entry) taskCreations.current.delete(key);
        setData((prev) => ({ ...prev, threads: [created, ...prev.threads.filter((t) => t.id !== created.id)] }));
        if (revision === navigationRevision.current && baseUi().view === origin && baseUi().activeThreadId === active) {
          selectThread(created, guard !== undefined && viewGuard.current === guard);
          commitUi({ reviewOpen: false }); composerRef.current?.focus();
        }
        return created;
      };
      const operation = create().finally(() => { if (entry.pending === operation) entry.pending = undefined; });
      entry.pending = operation;
      return operation;
    },
    [invoke, project?.id, selectThread, commitUi],
  );

  const addProject = useCallback(async () => {
    const created = (await invoke({ op: 'project.add' })) as Project | null;
    if (created) await createThread(created.id);
  }, [createThread, invoke]);

  const value = useMemo<AppState>(
    () => ({
      data,
      ui,
      ready,
      approvals,
      terminals,
      upsertTerminal,
      error,
      setError,
      invoke: scopedInvoke,
      act: request => { void scopedInvoke(request).catch(() => {}); },
      thread,
      project,
      directory,
      directoryId,
      fileScopeId: activeId + '/' + directoryId + (thread?.workspaceRevision ? '/' + thread.workspaceRevision : ''),
      selectDirectory: directoryId => commitThreadUi({ directoryId }),
      activeId,
      projectId,
      setProjectId,
      selectProject,
      running,
      selectThread,
      createThread,
      addProject,
      view: ui.view,
      setView: (view: View) => commitUi({ view }),
      registerViewGuard,
      sidebarOpen: ui.sidebarOpen,
      setSidebarOpen: (sidebarOpen: boolean) => commitUi({ sidebarOpen }),
      reviewOpen: ui.reviewOpen,
      setReviewOpen: (reviewOpen: boolean) => commitUi({ reviewOpen }),
      showArchived: ui.showArchived,
      setShowArchived: (showArchived: boolean) => commitUi({ showArchived }),
      diffSplit: ui.diffSplit,
      setDiffSplit: (diffSplit: boolean) => commitUi({ diffSplit }),
      setActiveThread: (activeThreadId: string) => commitUi({ activeThreadId }),
      setLayoutSize: (key: ResizeKey, value: number) => commitUi({ [key]: value }),
      threadUi,
      patchThread: commitThreadUi,
      updateDraft: (threadId, update) => saveUi({ threadId, thread: { draft: update(baseUi().threads[threadId]?.draft ?? { text: '', attachments: [] }) } }),
      updateContextReferences: (threadId, update) => saveUi({ threadId, thread: { contextReferences: update(baseUi().threads[threadId]?.contextReferences ?? []) } }),
      patchUi: commitUi,
      setFold: (key: string, expanded: boolean) => commitThreadUi({ folds: { ...(baseUi().threads[activeId]?.folds ?? {}), [key]: expanded } }),
      reviewTab: threadUi.reviewTab,
      setReviewTab: (reviewTab: ReviewTab) => commitThreadUi({ reviewTab }),
      terminalOpen: ui.reviewOpen && threadUi.reviewTab === 'terminal',
      setTerminalOpen: (terminalOpen: boolean) => {
        if (terminalOpen) commitThreadUi({ terminalOpen: true, reviewTab: 'terminal' });
        commitUi({ reviewOpen: terminalOpen });
      },
      selectedPath: threadUi.selectedPath,
      // Recording which file the reader inspects (Git diff, summary links) never opens a tab; only openFileTab does.
      setSelectedPath: (selectedPath: string) => {
        commitThreadUi({ selectedPath });
      },
      openFileTab: (path, location, targetDirectory) => {
        const scope = targetDirectory ?? directoryId;
        const selectedUi = directoryThreadUi(baseUi().threads[activeId] ?? emptyThreadUi, scope, executionDirectoryId);
        commitThreadUi({
          ...(targetDirectory ? { directoryId: scope } : {}),
          ...fileSelectionPatch(selectedUi, path, location
            ? { fileLocation: { id: crypto.randomUUID(), path, line: location.line, ...(location.column === undefined ? {} : { column: location.column }) } }
            : {}),
        });
      },
      composerRef,
      timelineRef,
      timelineFocus,
      focusTimeline: (target: TimelineFocusTarget) => {
        if (!thread) return;
        followRef.current = false;
        if (target.kind === 'plan') commitThreadUi({ folds: { ['plan:' + target.turnKey]: true } });
        commitUi({ view: 'thread', ...(window.innerWidth < 1100 ? { reviewOpen: false, summaryOpen: false } : {}) });
        setTimelineFocus({ threadId: activeId, target });
      },
      finishTimelineFocus: (request: TimelineFocusRequest) => setTimelineFocus(current => current === request ? undefined : current),
      previewSurfaceRef,
      followRef,
      text,
      setText: (text: string) => commitThreadUi({ draft: { text, attachments: baseUi().threads[activeId]?.draft?.attachments ?? [] } }),
      attachments,
      setAttachments: (attachments: string[]) => commitThreadUi({ draft: { text: baseUi().threads[activeId]?.draft?.text ?? '', attachments } }),
    }),
    [
      act,
      addProject,
      approvals,
      attachments,
      commitThreadUi,
      commitUi,
      createThread,
      data,
      error,
      invoke,
      scopedInvoke,
      directory,
      directoryId,
      executionDirectoryId,
      projectId,
      project,
      ready,
      running,
      selectThread,
      selectProject,
      terminals,
      text,
      thread,
      threadUi,
      timelineFocus,
      ui,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
