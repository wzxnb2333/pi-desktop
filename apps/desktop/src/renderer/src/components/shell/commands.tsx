import { tr, localizeLabel } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Command, Copy, Eraser, FileSearch, Globe, ListTodo, PanelRightClose, RotateCcw, Search, Settings, SquarePen, Terminal, type LucideIcon } from 'lucide-react';
import { DEFAULT_APP_KEYBINDINGS, keyboardShortcut, panelCommand, type AppCommand, type PanelCommand } from '../../../../shared/shortcuts.ts';
import type { PanelActions } from '../../hooks/use-panel-actions.ts';
import { conversationSources, findConversation, type ConversationMatch } from '../../lib/conversation-search.ts';
import { clearConversationHighlight, focusConversationMatch } from '../../lib/conversation-search-dom.ts';
import { useApp } from '../../state/app.tsx';
import { terminalAction } from '../../TerminalPanel.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

const commandIcons: Record<AppCommand, LucideIcon> = {
  newThread: SquarePen, searchThreads: Search, settings: Settings, terminal: Terminal,
  commands: Command, find: Search, summary: ListTodo, reopen: RotateCcw,
  terminalFind: Search, terminalClear: Eraser, terminalCopy: Copy, closeBrowser: PanelRightClose,
  openBrowser: Globe, openReview: FileSearch,
};
type CommandEntry = {
  id: string; label: string; group: 'threads' | 'actions' | 'matches';
  detail?: string; icon?: LucideIcon; match?: ConversationMatch; keys?: string; action: () => void;
};

export function WorkbenchCommands({ panels }: { panels: PanelActions }) {
  const locale = useLocale();
  const app = useApp();
  const [mode, setMode] = useState<'commands' | 'find' | undefined>();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [resultPage, setResultPage] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{ kind: 'terminal' | 'browser' | 'panel'; threadId?: string }>();
  const currentThread = useRef(app.activeId);
  currentThread.current = app.activeId;
  const [pending, setPending] = useState<{ threadId: string; match: ConversationMatch; query: string }>();
  const [navigationError, setNavigationError] = useState('');
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const sources = useMemo(() => conversationSources(app.thread?.items ?? [], app.running), [app.thread?.items, app.running, locale]);
  const found = useMemo(() => findConversation(sources, mode === 'find' ? query : '', 200, resultPage * 200), [sources, mode, query, resultPage]);
  useEffect(() => { if (resultPage > 0 && resultPage * 200 >= found.total) setResultPage(Math.max(0, Math.ceil(found.total / 200) - 1)); }, [resultPage, found.total]);
  const close = () => { setMode(undefined); setNavigationError(''); };
  const executePanel = (id: PanelCommand) => {
    if (app.view !== 'thread' || !app.thread || panels.pending) return;
    const threadId = app.activeId;
    const focusPanel = (kind: 'browser' | 'panel') => {
      if (currentThread.current === threadId) setFocusRequest({ kind, threadId });
    };
    if (id === 'openBrowser' || id === 'openReview') {
      if (id === 'openReview' && !app.project) return;
      void (id === 'openBrowser' ? panels.openBrowser() : panels.openTool('review')).then(changed => {
        if (changed && currentThread.current === threadId) { app.setReviewOpen(true); focusPanel(id === 'openBrowser' ? 'browser' : 'panel'); }
      });
    } else if (app.reviewOpen) {
      if (id === 'closePanelTab') void panels.close(panels.selected.id).then(changed => { if (changed) focusPanel('panel'); });
      else {
        const index = panels.visibleTabs.findIndex(tab => tab.id === panels.selected.id);
        const next = (index + (id === 'nextPanelTab' ? 1 : panels.visibleTabs.length - 1)) % panels.visibleTabs.length;
        panels.select(panels.visibleTabs[next].id); focusPanel('panel');
      }
    }
  };
  const execute = (id: AppCommand) => {
    close();
    if (id === 'openBrowser' || id === 'openReview') executePanel(id);
    if (id === 'commands' || id === 'searchThreads' || id === 'find') { setQuery(''); setSelected(''); setResultPage(0); setMode(id === 'find' ? 'find' : 'commands'); requestAnimationFrame(() => input.current?.focus()); }
    if (id === 'newThread') void (app.project ? app.createThread(app.project.id) : app.addProject()).catch(() => {});
    if (id === 'settings') app.setView('settings');
    if (id === 'terminal') { app.setView('thread'); app.setTerminalOpen(!app.terminalOpen); }
    if (id === 'summary') { app.patchUi({ view: 'thread', summaryOpen: true }); }
    if (id === 'closeBrowser' && app.reviewTab === 'browser') app.setReviewOpen(false);
    if (id === 'reopen') {
      const closed = [...(app.ui.closedThreads ?? [])];
      let thread;
      while (closed.length && !thread) { const id = closed.pop(); thread = app.data.threads.find(item => item.id === id && !item.subtaskId && !item.deletedAt); }
      app.patchUi({ closedThreads: closed });
      if (thread) app.selectThread(thread);
    }
    if (id === 'terminalFind') { app.setView('thread'); app.setTerminalOpen(true); window.dispatchEvent(new Event('pi:terminal-find')); setFocusRequest({ kind: 'terminal' }); }
    if (id === 'terminalClear' || id === 'terminalCopy') {
      const terminal = app.terminals.find(item => item.id === document.querySelector<HTMLElement>('.terminal-panel [data-terminal-id]')?.dataset.terminalId);
      if (terminal) void terminalAction(terminal.id, id === 'terminalClear' ? 'clear' : 'copy');
    }
  };
  const enabled = (id: AppCommand) => {
    if (id === 'openBrowser' || id === 'openReview') return app.view === 'thread' && !!app.thread && !panels.pending && (id === 'openBrowser' || !!app.project);
    if (id === 'find') return sources.length > 0;
    if (id === 'summary') return !!app.thread;
    if (id === 'terminal') return !!app.thread && !!app.project;
    if (id === 'closeBrowser') return app.view === 'thread' && app.ui.reviewOpen && app.reviewTab === 'browser';
    if (id === 'reopen') return app.ui.closedThreads?.some(id => app.data.threads.some(thread => thread.id === id && !thread.deletedAt)) ?? false;
    if (id === 'terminalClear' || id === 'terminalCopy' || id === 'terminalFind') return app.view === 'thread' && app.terminalOpen && !!document.querySelector('.terminal-panel [data-terminal-id]');
    return true;
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      if (event.target instanceof Element && event.target.closest('.shortcut-list input')) return;
      const panelId = panelCommand(event, app.data.settings.shortcuts);
      if (panelId && panelId !== 'openBrowser' && panelId !== 'openReview' && app.view === 'thread' && app.reviewOpen && event.target instanceof Element && event.target.closest('.review-pane') && !event.target.closest('.terminal-panel')) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) executePanel(panelId);
        return;
      }
      const key = keyboardShortcut(event).toLowerCase();
      if (!key) return;
      const id = (Object.keys(DEFAULT_APP_KEYBINDINGS) as AppCommand[]).find(id => (app.data.settings.shortcuts?.[id] ?? DEFAULT_APP_KEYBINDINGS[id].keys).toLowerCase() === key);
      if (!id || !enabled(id)) return;
      if (id === 'closeBrowser' && event.target instanceof Element && event.target.closest('.terminal-panel, .browser-find, .preview-toolbar input')) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat) execute(id);
    };
    const open = () => execute('commands');
    const command = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string' || !Object.hasOwn(DEFAULT_APP_KEYBINDINGS, event.detail)) return;
      const id = event.detail as AppCommand;
      if (enabled(id)) execute(id);
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('pi:commands', open);
    window.addEventListener('pi:command', command);
    const unsubscribe = window.desktop.onEvent(event => {
      if (event.type !== 'panel.command' || event.threadId !== app.activeId || event.tabId !== app.threadUi.activeBrowserTab || app.reviewTab !== 'browser' || !app.reviewOpen || document.querySelector('[role=dialog], [role=menu]')) return;
      executePanel(event.command);
    });
    return () => { unsubscribe(); window.removeEventListener('keydown', handler, true); window.removeEventListener('pi:commands', open); window.removeEventListener('pi:command', command); };
  });
  useEffect(() => {
    if (!focusRequest) return;
    const frame = requestAnimationFrame(() => {
      if (!focusRequest.threadId || focusRequest.threadId === app.activeId) {
        const selector = { terminal: '[data-search-terminal]', browser: '.review-pane .preview-toolbar input', panel: '.review-pane [role=tab][aria-selected=true]' }[focusRequest.kind];
        document.querySelector<HTMLElement>(selector)?.focus();
      }
      setFocusRequest(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, app.activeId, app.view, app.ui.sidebarOpen, app.terminalOpen, app.reviewOpen]);
  useEffect(() => { clearConversationHighlight(); return clearConversationHighlight; }, [app.activeId, mode]);
  useEffect(() => {
    if (!pending) return;
    if (pending.threadId !== app.activeId) { setPending(undefined); return; }
    if (app.view !== 'thread' || !app.timelineRef.current) return;
    const controller = new AbortController();
    const interrupt = (event: Event) => { if (!event.defaultPrevented) { controller.abort(); setPending(undefined); } };
    window.addEventListener('wheel', interrupt, { passive: true });
    window.addEventListener('pointerdown', interrupt);
    window.addEventListener('keydown', interrupt);
    void focusConversationMatch(app.timelineRef.current, pending.match, pending.query, controller.signal).then(found => {
      if (controller.signal.aborted) return;
      setPending(undefined);
      if (!found) { setMode('find'); setNavigationError(tr("这条内容已更新，请重新选择搜索结果。")); }
    });
    return () => { controller.abort(); window.removeEventListener('wheel', interrupt); window.removeEventListener('pointerdown', interrupt); window.removeEventListener('keydown', interrupt); };
  }, [pending, app.activeId, app.view, app.timelineRef]);
  const jump = (match: ConversationMatch) => {
    close(); app.setView('thread'); app.followRef.current = false;
    app.patchThread({ folds: Object.fromEntries(match.folds.map(key => [key, true])) });
    setPending({ threadId: app.activeId, match, query });
  };
  const entries: CommandEntry[] = mode === 'find' ? found.matches.map(match => ({
    id: match.key, label: match.label, group: 'matches', match, action: () => jump(match),
  })) : [
    ...app.data.threads.filter(thread => !thread.subtaskId && !thread.review && !thread.sidechat?.temporary && !thread.deletedAt && thread.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12).map((thread): CommandEntry => ({ id: 'thread:' + thread.id, label: thread.title, group: 'threads', detail: app.data.projects.find(project => project.id === thread.projectId)?.name, action: () => { app.selectThread(thread); close(); } })),
    ...(Object.entries(DEFAULT_APP_KEYBINDINGS) as Array<[AppCommand, { label: string; keys: string }]>).filter(([id, command]) => enabled(id) && localizeLabel(command.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(([id, command]): CommandEntry => ({ id: 'command:' + id, label: localizeLabel(command.label), group: 'actions', icon: commandIcons[id], keys: app.data.settings.shortcuts?.[id] ?? command.keys, action: () => execute(id) })),
  ];
  const groups = mode === 'find' ? [{ id: 'matches', label: tr("对话搜索结果") }] : [{ id: 'threads', label: tr("聊天记录") }, { id: 'actions', label: tr("快捷操作") }];
  const selectedIndex = Math.max(0, entries.findIndex(entry => entry.id === selected));
  const selectedEntry = entries[selectedIndex];
  useEffect(() => {
    if (mode && selectedEntry) document.getElementById(listId + '-' + selectedIndex)?.scrollIntoView({ block: 'nearest' });
  }, [mode, selectedEntry?.id, selectedIndex, listId]);
  if (!mode) return null;
  return <ConfirmDialog presentation="palette" title={mode === 'commands' ? tr("命令面板") : tr("查找当前对话")} confirmLabel={tr("关闭")} onCancel={close} onConfirm={close} description={<span className={'command-content command-' + mode}>
    <input ref={input} placeholder={mode === 'commands' ? tr("搜索命令或最近任务…") : tr("查找当前对话…")} data-dialog-autofocus role="combobox" aria-expanded={true} aria-autocomplete="list" aria-controls={listId} aria-activedescendant={selectedEntry ? listId + '-' + selectedIndex : undefined} aria-label={mode === 'commands' ? tr("搜索命令或最近任务") : tr("当前对话查找")} value={query} onChange={event => { setQuery(event.target.value); setSelected(''); setResultPage(0); setNavigationError(''); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && entries.length) { event.preventDefault(); setSelected(entries[(selectedIndex + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length].id); }
      if (event.key === 'Enter') { event.preventDefault(); selectedEntry?.action(); }
    }} />
    <span role="status" className="command-status">{mode === 'find' ? !query.trim() ? tr("搜索正文、思考、工具参数、输出和差异") : found.total > 200 ? tr("共 ") + found.total + tr(" 处，显示 ") + (resultPage * 200 + 1) + '–' + (resultPage * 200 + found.matches.length) : tr("共 ") + found.total + tr(" 处") : tr("↑ ↓ 选择 · Enter 打开 · Esc 关闭")}</span>
    {navigationError && <span role="alert">{navigationError}</span>}
    <span id={listId} className="command-results" role="listbox" aria-label={mode === 'find' ? tr("对话搜索结果") : tr("命令与最近任务")}>
      {groups.filter(group => entries.some(entry => entry.group === group.id)).map(group => <span className="command-group" role="group" aria-label={group.label} key={group.id}>
        {mode === 'commands' && <span className="command-group-label" aria-hidden="true">{group.label}</span>}
        {entries.map((entry, index) => {
          if (entry.group !== group.id) return null;
          const Icon = entry.icon;
          return <button type="button" role="option" tabIndex={-1} id={listId + '-' + index} aria-selected={index === selectedIndex} key={entry.id} onMouseMove={() => setSelected(entry.id)} onClick={entry.action}>
            {mode === 'commands' && <span className="command-entry-icon" aria-hidden="true">{Icon && <Icon size={16} />}</span>}
            <span className="command-result-text"><span>{entry.label}</span>{entry.match && <span className="command-snippet">{entry.match.start > 40 ? '…' : ''}{entry.match.text.slice(Math.max(0, entry.match.start - 40), entry.match.start)}<mark>{entry.match.text.slice(entry.match.start, entry.match.end)}</mark>{entry.match.text.slice(entry.match.end, entry.match.end + 100)}{entry.match.end + 100 < entry.match.text.length ? '…' : ''}</span>}</span>
            {entry.detail && <span className="command-entry-detail">{entry.detail}</span>}
            {entry.keys && <kbd>{entry.keys}</kbd>}
          </button>;
        })}
      </span>)}
    </span>
    {mode === 'find' && found.total > 200 && <span className="command-pagination"><button type="button" disabled={resultPage === 0} onClick={() => { setResultPage(resultPage - 1); setSelected(''); }}>{tr("上一页结果")}</button><button type="button" disabled={(resultPage + 1) * 200 >= found.total} onClick={() => { setResultPage(resultPage + 1); setSelected(''); }}>{tr("下一页结果")}</button></span>}
    {entries.length === 0 && (mode !== 'find' || query.trim()) && <span className="command-status">{tr("没有匹配结果")}</span>}
  </span>} />;
}
