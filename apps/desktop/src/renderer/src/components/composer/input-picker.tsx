import { useEffect, useState } from 'react';
import { File, Folder, ArrowUp, Check, Terminal, Sparkles } from 'lucide-react';
import type { FileEntry } from '../../../../shared/contracts.ts';
import { type ContextReference, type InputCatalog, type InputCommand, inputCatalogSchema } from '../../../../shared/input-context.ts';
import { tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useContextSelection, type SelectContext } from '../../hooks/use-context-selection.ts';
import { useApp } from '../../state/app.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { Button } from '../primitives/button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { projectDirectories } from '../../../../shared/project-directories.ts';
import { editorCommand } from '../../../../shared/shortcuts.ts';

import { composerCommandLabels as commandLabels } from '../../../../shared/composer-messages.ts';

export function InputPicker({ initial, onSelect, onClose, onCommand }: { initial: 'files' | 'commands' | 'skill' | 'tool'; onSelect: SelectContext; onClose(): void; onCommand?(command: InputCommand): void }) {
  useLocale();
  const { thread, invoke, setView, threadUi, project, directoryId, data } = useApp();
  const [rootId, setRootId] = useState(directoryId);
  const [tab, setTab] = useState<'files' | 'skill' | 'tool' | 'commands'>(initial === 'files' && !thread?.projectId ? 'skill' : initial);
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [catalog, setCatalog] = useState<InputCatalog>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const selection = useContextSelection(onSelect, JSON.stringify([thread?.id, rootId, tab, directory, query]));
  const busy = acting || selection.pending;
  useEffect(() => {
    if (!thread) return;
    let active = true;
    setLoading(true); setError('');
    void Promise.all([invoke({ op: 'input.catalog', threadId: thread.id }),
      thread.projectId ? invoke({ op: 'file.list', threadId: thread.id, directoryId: rootId, path: directory }) : Promise.resolve([])]).then(([raw, entries]) => {
      if (active) { setCatalog(inputCatalogSchema.parse(raw)); setFiles(entries as FileEntry[]); }
    }).catch(reason => { if (active) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [thread?.id, thread?.status, rootId, directory, invoke]);
  if (!thread) return null;
  const roots = project ? projectDirectories(project) : [];
  const root = roots.find(item => item.id === rootId);
  const selected = (kind: ContextReference['kind'], id: string) => threadUi.contextReferences?.some(item => item.kind === kind && item.id === id &&
    (!['file', 'folder'].includes(kind) || (item.directoryId ?? thread.directoryId ?? thread.projectId) === rootId));
  const reference = (kind: 'file' | 'folder', id: string, label: string) => void selection.select({ kind, id, directoryId: rootId, label: (roots.length > 1 ? root?.name + '/' + label : label).slice(0, 300) });
  const command = async (id: InputCommand) => {
    if (busy) return;
    setActing(true);
    try {
      if (id === 'skills') setView('skills');
      else if (id === 'plan') await invoke({ op: 'thread.update', id: thread.id, planMode: !thread.planMode });
      else if (id === 'compact' || id === 'stop') await invoke({ op: id === 'compact' ? 'thread.compact' : 'thread.stop', id: thread.id });
      else onCommand?.(id);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setActing(false); }
  };
  const matches = (text: string) => text.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const segments = directory.replaceAll(String.fromCharCode(92), '/').split('/');
  return <ConfirmDialog title={tr('命令与上下文')} presentation="palette" confirmLabel={tr('关闭')} onConfirm={onClose} onCancel={onClose}
    description={<div className="command-content input-picker">
      <input data-dialog-autofocus aria-label={tr('搜索命令、文件或技能')} placeholder={tr('搜索命令、文件或技能')} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (editorCommand(event.nativeEvent, data.settings.shortcuts) === 'fileNext' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('.input-picker-results button:not(:disabled)')?.focus(); } }} />
      <div className="input-picker-tabs" aria-label={tr('上下文类型')}>
        {([['files', tr('文件与文件夹')], ['skill', 'Skills'], ['tool', tr('工具')], ['commands', tr('命令')]] as const).map(([id, label]) =>
          <Button key={id} size="xs" disabled={id === 'files' && !thread.projectId} aria-pressed={tab === id} onClick={() => { setTab(id); setQuery(''); }}>{label}</Button>)}
      </div>
      {tab === 'files' && roots.length > 1 && <Menu label={tr('浏览目录与仓库')} value={rootId} options={roots.map(item => ({ value: item.id, label: item.name + ' · ' + item.path }))}
        onChange={id => { setRootId(id); setDirectory(''); setQuery(''); }} />}
      {(error || selection.error) && <p role="alert" className="error">{error || selection.error}</p>}
      {selection.pending && <p role="status" className="command-status">{tr('正在添加引用…')}</p>}
      {loading ? <p role="status" className="command-status">{tr('加载中…')}</p> : <div className="command-results input-picker-results" aria-busy={busy}
        onKeyDown={event => {
          const navigation = editorCommand(event.nativeEvent, data.settings.shortcuts);
          if (!['fileNext', 'filePrevious'].includes(navigation ?? '') || event.nativeEvent.isComposing) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (!buttons.length || index < 0) return;
          event.preventDefault(); buttons[(index + (navigation === 'fileNext' ? 1 : buttons.length - 1)) % buttons.length].focus();
        }}>
        {tab === 'files' && <>
          <div className="input-folder-heading"><span title={directory || root?.path || thread.cwd}>{directory || root?.path || thread.cwd}</span>
            {directory && <Button size="xs" aria-label={tr('上一级文件夹')} onClick={() => { setDirectory(segments.slice(0, -1).join('/')); setQuery(''); }}><ArrowUp size={14} /></Button>}
            <Button size="xs" disabled={busy} onClick={() => reference('folder', directory || '.', segments.at(-1) || '.')}>{tr('引用此文件夹')}</Button></div>
          {files.filter(file => matches(file.name)).map(file => <button type="button" className="input-picker-row" key={file.path} disabled={busy}
            onClick={() => file.directory ? (setDirectory(file.path), setQuery('')) : reference('file', file.path, file.name)}>
            {file.directory ? <Folder size={16} /> : <File size={16} />}<span>{file.name}</span>{selected(file.directory ? 'folder' : 'file', file.path) && <Check size={14} />}
          </button>)}
        </>}
        {(tab === 'skill' || tab === 'tool') && catalog?.references.filter(item => item.kind === tab && matches(item.label + ' ' + item.description)).map(item =>
          <button type="button" className="input-picker-row" key={item.kind + item.id} title={item.description} disabled={busy} onClick={() => void selection.select({ kind: item.kind, id: item.id, label: item.label })}>
            {item.kind === 'skill' ? <Sparkles size={16} /> : <Terminal size={16} />}<span>{item.label}<small>{item.description}</small></span>{selected(item.kind, item.id) && <Check size={14} />}
          </button>)}
        {tab === 'commands' && catalog?.commands.filter(item => matches('/' + item.id + ' ' + tr(commandLabels[item.id]))).map(item =>
          <button type="button" className="input-picker-row" key={item.id} disabled={busy || !item.enabled} onClick={() => void command(item.id)}><code>/{item.id}</code><span>{tr(commandLabels[item.id])}</span></button>)}
        {((tab === 'files' && !files.some(item => matches(item.name))) || ((tab === 'skill' || tab === 'tool') && !catalog?.references.some(item => item.kind === tab && matches(item.label + ' ' + item.description)))) &&
          <p className="command-status">{tr('没有可用的匹配项')}</p>}
      </div>}
      <p className="command-status input-picker-note">{tr('引用不会扩大任务权限；文件夹只包含直属文件清单。')}</p>
      <Button size="sm" onClick={onClose}>{tr('完成选择')}</Button>
    </div>} />;
}
