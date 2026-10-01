import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { FileEntry } from '../../../../shared/contracts.ts';
import { editorCommand } from '../../../../shared/shortcuts.ts';
import { fileTreeFocus, fileTreePrefix, fileTreeRows, type DirectoryListing, type FileTreeRow } from '../../lib/file-tree.ts';
import { useApp } from '../../state/app.tsx';
import { FileSearchResults } from './file-search-results.tsx';

export function FileNavigator({ selectedPath, onOpen, onRefresh }: {
  selectedPath: string;
  onOpen(path: string, line?: number): void;
  onRefresh(): void;
}) {
  useLocale();
  const { activeId, directoryId, invoke, threadUi, patchThread, data } = useApp();
  const root = threadUi.fileDirectory ?? '';
  const expanded = new Set(threadUi.expandedDirectories ?? []);
  const expandedRef = useRef(expanded); expandedRef.current = expanded;
  const [listings, setListings] = useState(new Map<string, DirectoryListing>());
  const cache = useRef(listings);
  const generation = useRef(0);
  const tree = useRef<HTMLUListElement>(null);
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const treeOwnedFocus = useRef(false);
  const prefix = useRef({ text: '', time: 0 });
  const id = useId();
  const [query, setQuery] = useState('');
  const [searchContent, setSearchContent] = useState(false);
  const [composing, setComposing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const searching = !!query.trim();
  const rows = fileTreeRows(root, listings, expanded);
  const focused = fileTreeFocus(rows, threadUi.fileTreeFocus ?? '', selectedPath.replaceAll('\\', '/'));
  const visibleDirectories = [root, ...rows.filter(row => row.directory && expanded.has(row.path)).map(row => row.path)];
  const directoriesSettled = visibleDirectories.every(path => listings.has(path) && listings.get(path)?.state !== 'loading');

  const load = useCallback((path: string, retry = false) => {
    if (!retry && cache.current.has(path)) return;
    const current = generation.current;
    const pending = { state: 'loading' as const, entries: cache.current.get(path)?.entries ?? [] };
    cache.current = new Map(cache.current).set(path, pending);
    setListings(cache.current);
    void invoke({ op: 'file.list', threadId: activeId, path }).then(value => {
      if (current !== generation.current || cache.current.get(path) !== pending) return;
      const entries = (value as FileEntry[]).map(entry => ({ ...entry, path: entry.path.replaceAll('\\', '/') }));
      cache.current = new Map(cache.current).set(path, { state: 'ready', entries });
      setListings(cache.current);
    }).catch(reason => {
      if (current !== generation.current || cache.current.get(path) !== pending) return;
      cache.current = new Map(cache.current).set(path, { state: 'error', entries: [], error: String(reason) });
      setListings(cache.current);
    });
  }, [activeId, invoke]);
  useEffect(() => () => { generation.current++; cache.current = new Map(); }, []);
  useEffect(() => { for (const path of visibleDirectories) load(path); });
  useEffect(() => { setQuery(''); }, [root]);
  useEffect(() => {
    const update = (event: FocusEvent) => { treeOwnedFocus.current = !!tree.current?.contains(event.target as Node); };
    document.addEventListener('focusin', update);
    return () => document.removeEventListener('focusin', update);
  }, []);
  useEffect(() => {
    // Replacing a refreshed row can move focus to body. Restore only if the tree owned it.
    if (directoriesSettled && !searching && treeOwnedFocus.current && (!tree.current?.contains(document.activeElement) || document.activeElement === tree.current)) {
      (nodes.current.get(focused) ?? tree.current)?.focus({ preventScroll: true });
    }
  }, [focused, listings, directoriesSettled, searching]);

  const focus = (path: string) => {
    if (!path) return;
    nodes.current.get(path)?.focus({ preventScroll: true });
    nodes.current.get(path)?.querySelector('.file-tree-row')?.scrollIntoView({ block: 'nearest' });
  };
  const toggle = (path: string) => {
    const next = new Set(expandedRef.current);
    if (next.has(path)) next.delete(path); else next.add(path);
    expandedRef.current = next;
    patchThread({ expandedDirectories: [...next] });
  };
  const activate = (row: FileTreeRow) => { if (row.directory) toggle(row.path); else onOpen(row.path); };
  const keyDown = (event: KeyboardEvent<HTMLLIElement>, row: FileTreeRow) => {
    if (event.target !== event.currentTarget || event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const command = editorCommand(event.nativeEvent, data.settings.shortcuts);
    if (command) {
      event.preventDefault(); event.stopPropagation(); prefix.current.text = '';
      const index = rows.findIndex(item => item.path === row.path);
      switch (command) {
        case 'filePrevious': focus(rows[Math.max(0, index - 1)].path); break;
        case 'fileNext': focus(rows[Math.min(rows.length - 1, index + 1)].path); break;
        case 'fileFirst': focus(rows[0].path); break;
        case 'fileLast': focus(rows[rows.length - 1].path); break;
        case 'fileParent':
          if (row.directory && expandedRef.current.has(row.path)) toggle(row.path);
          else if (row.parent !== root) focus(row.parent);
          break;
        case 'fileChild':
          if (row.directory && !expandedRef.current.has(row.path)) toggle(row.path);
          else if (rows[index + 1]?.parent === row.path) focus(rows[index + 1].path);
          break;
        case 'fileActivate': case 'fileToggle': activate(row); break;
      }
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && event.key !== ' ') {
      const now = Date.now();
      const previous = now - prefix.current.time < 1000 ? prefix.current.text : '';
      const text = previous.toLocaleLowerCase() === event.key.toLocaleLowerCase() ? event.key : previous + event.key;
      prefix.current = { text, time: now };
      const match = fileTreePrefix(rows, row.path, text);
      if (match) { event.preventDefault(); event.stopPropagation(); focus(match); }
    }
  };
  const renderRows = (parent: string): ReactNode => rows.filter(row => row.parent === parent).map(row => {
    const opened = row.directory && expanded.has(row.path);
    const listing = listings.get(row.path);
    const groupId = id + '-group-' + encodeURIComponent(row.path);
    const note = listing?.state === 'error' ? tr("加载失败") : !listing || listing.state === 'loading' ? tr("加载中…") : !listing.entries.length ? tr("空目录") : '';
    return <li key={row.path} ref={node => { if (node) nodes.current.set(row.path, node); else nodes.current.delete(row.path); }}
      role="treeitem" aria-label={row.name} aria-level={row.level} aria-posinset={row.position} aria-setsize={row.siblings}
      aria-selected={!row.directory && row.path === selectedPath.replaceAll('\\', '/')}
      aria-expanded={row.directory ? opened : undefined} aria-controls={opened ? groupId : undefined}
      aria-describedby={opened && note ? groupId + '-status' : undefined}
      aria-busy={opened && listing?.state === 'loading' ? true : undefined}
      tabIndex={focused === row.path ? 0 : -1} data-path={row.path}
      onFocus={event => { if (event.target === event.currentTarget && threadUi.fileTreeFocus !== row.path) patchThread({ fileTreeFocus: row.path }); }}
      onClick={event => { if ((event.target as Element).closest('[role="treeitem"]') !== event.currentTarget) return; event.stopPropagation(); focus(row.path); activate(row); }}
      onKeyDown={event => keyDown(event, row)}>
      <span className="file-tree-row" style={{ paddingInlineStart: 10 + (row.level - 1) * 14 }}>
        {row.directory ? opened ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" /> : <span className="file-tree-chevron" />}
        {row.directory ? <Folder size={14} aria-hidden="true" /> : <File size={14} aria-hidden="true" />}
        <span className="file-tree-name" title={row.path}>{row.name}</span>
        {opened && <span className="file-tree-note" id={groupId + '-status'}>{note}</span>}
      </span>
      {opened && <ul role="group" id={groupId}>{renderRows(row.path)}</ul>}
    </li>;
  });

  return <div className="file-navigator">
    <div className="file-search"><input aria-label={tr("搜索项目文件")} value={query} maxLength={500} onChange={event => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder={tr("搜索项目文件")} /><label><input type="checkbox" checked={searchContent} onChange={event => setSearchContent(event.target.checked)} />{tr("内容")}</label></div>
    <nav className="file-toolbar" aria-label={tr("文件目录")}><button aria-current={!root ? 'location' : undefined} onClick={() => patchThread({ fileDirectory: '' })}>{tr("项目")}</button>{root.split('/').filter(Boolean).map((part, index, parts) => <button key={index} aria-current={index === parts.length - 1 ? 'location' : undefined} onClick={() => patchThread({ fileDirectory: parts.slice(0, index + 1).join('/') })}>{part}</button>)}<button aria-label={tr("刷新文件列表")} onClick={() => {
      generation.current++; cache.current = new Map(); setListings(cache.current); setAttempt(value => value + 1); onRefresh();
    }}>{tr("刷新")}</button></nav>
    <div className="file-tree">
      {searching ? <FileSearchResults directoryId={directoryId} threadId={activeId} query={query} content={searchContent} composing={composing} revision={attempt} onRetry={() => setAttempt(value => value + 1)} onOpen={onOpen} /> : <>
        <ul ref={tree} className="project-file-tree" role="tree" aria-label={tr("项目文件")} tabIndex={rows.length ? -1 : 0} aria-busy={!listings.has(root) || listings.get(root)?.state === 'loading'}>{renderRows(root)}</ul>
        {(!listings.has(root) || listings.get(root)?.state === 'loading') && <p className="hint" role="status">{tr("正在加载目录…")}</p>}
        {listings.get(root)?.state === 'ready' && !rows.length && <p className="hint" role="status">{tr("此目录为空")}</p>}
        {visibleDirectories.filter(path => listings.get(path)?.state === 'error').map(path => <div key={path} className="file-navigation-error" role="alert"><p>{path || tr("项目")}  {tr("加载失败：")}{listings.get(path)?.error}</p><button aria-label={tr("重试目录 ") + (path || tr("项目"))} onClick={() => load(path, true)}>{tr("重试")}</button></div>)}
      </>}
    </div>
  </div>;
}
