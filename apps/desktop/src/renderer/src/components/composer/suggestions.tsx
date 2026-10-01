import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Check, File, Folder, ListChecks, Sparkles, Terminal } from 'lucide-react';
import { contextSearchSchema, type ContextSearch } from '../../../../shared/composer.ts';
import { composerCommandLabels } from '../../../../shared/composer-messages.ts';
import { type ContextReference, type InputCatalog, type InputCommand, inputCatalogSchema } from '../../../../shared/input-context.ts';
import { tr } from '../../../../shared/localization.ts';
import { composerCommand } from '../../../../shared/shortcuts.ts';
import type { ComposerTrigger } from '../../lib/composer-trigger.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useContextSelection, type SelectContext } from '../../hooks/use-context-selection.ts';
import { useApp } from '../../state/app.tsx';

export interface SuggestionsHandle { keyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean; }
interface Choice { id: string; label: string; detail?: string; group: string; disabled?: boolean; reference?: ContextReference; command?: InputCommand; template?: string; browse?: boolean; retry?: boolean; }
const commandLabels = composerCommandLabels;

export function ComposerSuggestions({ trigger, draftText, controller, listId, onActiveId, onReference, onComplete, onDismiss, onBrowse, onCommand, onTemplate }: {
  trigger: ComposerTrigger; draftText: string; controller: Ref<SuggestionsHandle>; listId: string; onActiveId(id: string | undefined): void;
  onReference: SelectContext; onComplete(): void; onDismiss(): void; onBrowse(): void;
  onCommand(command: InputCommand): void; onTemplate(text: string): void;
}) {
  useLocale();
  const { thread, directoryId, composerRef, invoke, data, setView, running, threadUi } = useApp();
  const prefix = useId(), list = useRef<HTMLDivElement>(null), alive = useRef(true);
  const [catalog, setCatalog] = useState<InputCatalog>(), [files, setFiles] = useState<ContextSearch>({ matches: [], limited: false, unreadable: 0 });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0), [acting, setActing] = useState(false);
  const [active, setActive] = useState('');
  const selection = useContextSelection(onReference, JSON.stringify([thread?.id, draftText, trigger.kind, trigger.start, trigger.end]));
  const [position, setPosition] = useState({ left: 8, bottom: 8, width: 320, maxHeight: 300 });
  const normalized = trigger.query.replaceAll(String.fromCharCode(92), '/');
  const split = trigger.kind === '@' ? normalized.lastIndexOf('/') : -1;
  const directory = split < 0 ? '' : normalized.slice(0, split);
  const query = (split < 0 ? normalized : normalized.slice(split + 1)).toLocaleLowerCase();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!thread) return;
    let current = true; setLoading(true); setError('');
    const timer = setTimeout(() => { void Promise.all([invoke({ op: 'input.catalog', threadId: thread.id }), trigger.kind === '@' && thread.projectId
      ? invoke({ op: 'composer.contextSearch', threadId: thread.id, query: normalized }) : Promise.resolve({ matches: [], limited: false, unreadable: 0 })])
      .then(([raw, entries]) => { if (current) { setCatalog(inputCatalogSchema.parse(raw)); setFiles(contextSearchSchema.parse(entries)); } })
      .catch(reason => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (current) setLoading(false); }); }, 100);
    return () => { current = false; clearTimeout(timer); };
  }, [thread?.id, running, directoryId, normalized, trigger.kind, retry, invoke]);
  useLayoutEffect(() => {
    const anchor = composerRef.current?.closest('.composer');
    if (!anchor) return;
    const place = () => { const rect = anchor.getBoundingClientRect(); setPosition({ left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 6), width: Math.min(rect.width, window.innerWidth - 16), maxHeight: Math.max(0, Math.min(320, rect.top - 14)) }); };
    place(); const observer = new ResizeObserver(place); observer.observe(anchor);
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [composerRef]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('button:disabled, [aria-disabled=true]')) {
        if (selection.pending) event.preventDefault();
        return;
      }
      if (!list.current?.contains(event.target as Node) && event.target !== composerRef.current) onDismiss();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [onDismiss, composerRef, selection.pending]);
  const choices: Choice[] = [];
  if (error && !loading) choices.push({ id: 'retry', label: tr('重试'), group: tr('输入建议'), retry: true });
  const matches = (value: string) => value.toLocaleLowerCase().includes(query);
  if (!loading && !error) {
    if (trigger.kind === '/') for (const item of catalog?.commands ?? []) {
      const label = item.id === 'plan' ? tr(thread?.planMode ? '关闭计划模式' : '开启计划模式') : tr(commandLabels[item.id]);
      if (matches(item.id + ' ' + label)) choices.push({ id: 'command:' + item.id, label, detail: '/' + item.id, group: tr('命令'), command: item.id, disabled: !item.enabled });
    }
    if (trigger.kind === '@' && thread?.projectId) {
      for (const { description, ...file } of files.matches) choices.push({ id: 'file:' + file.directoryId + ':' + file.id, label: file.label, detail: description, group: tr('文件与文件夹'), reference: file });
    }
    for (const item of catalog?.references ?? []) if ((trigger.kind === '@' || item.kind === 'skill') && matches(item.label + ' ' + item.description))
      choices.push({ id: item.kind + ':' + item.id, label: item.label, detail: item.description, group: item.kind === 'skill' ? 'Skills' : tr('工具'), reference: { kind: item.kind, id: item.id, label: item.label } });
    if (trigger.kind === '@' && thread?.projectId) choices.push({ id: 'browse', label: tr('浏览项目文件'), detail: tr('文件与文件夹'), group: tr('添加'), browse: true });
    if (trigger.kind === '/') for (const template of data.settings.promptTemplates ?? []) if (matches(template.name)) choices.push({ id: 'template:' + template.id, label: template.name, detail: template.text.slice(0, 60), group: tr('提示词模板'), template: template.text });
  }
  const enabled = choices.filter(item => !item.disabled);
  const highlighted = enabled.find(item => item.id === active) ?? enabled[0];
  const activeId = highlighted ? prefix + '-' + choices.indexOf(highlighted) : undefined;
  useEffect(() => { onActiveId(activeId); if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' }); return () => onActiveId(undefined); }, [activeId, onActiveId]);
  const choose = async (item: Choice) => {
    if (acting || selection.pending || item.disabled || !thread) return;
    if (item.retry) { setRetry(value => value + 1); return; }
    if (item.browse) { onBrowse(); return; }
    if (item.reference) { await selection.select(item.reference, onComplete); return; }
    if (item.template) { onTemplate(item.template); return; }
    if (item.command && !['compact', 'plan', 'stop', 'skills'].includes(item.command)) { onComplete(); onCommand(item.command); return; }
    setActing(true); setError('');
    try {
      if (item.command === 'skills') { onComplete(); setView('skills'); return; }
      if (item.command === 'plan') await invoke({ op: 'thread.update', id: thread.id, planMode: !thread.planMode });
      else await invoke({ op: item.command === 'compact' ? 'thread.compact' : 'thread.stop', id: thread.id });
      if (alive.current) onComplete();
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (alive.current) setActing(false); }
  };
  useImperativeHandle(controller, () => ({ keyDown(event) {
    if (event.nativeEvent.isComposing) return false;
    const command = composerCommand(event.nativeEvent, data.settings.shortcuts);
    if (command === 'composerDismiss') { event.preventDefault(); event.stopPropagation(); onDismiss(); return true; }
    if (command === 'composerChoose' && (choices.length || loading || acting || selection.pending)) { event.preventDefault(); event.stopPropagation(); if (highlighted) void choose(highlighted); return true; }
    if ((command === 'composerNext' || command === 'composerPrevious') && enabled.length) {
      event.preventDefault(); event.stopPropagation(); const index = highlighted ? enabled.indexOf(highlighted) : 0;
      setActive(enabled[(index + (command === 'composerNext' ? 1 : enabled.length - 1)) % enabled.length].id); return true;
    }
    return false;
  } }));
  return createPortal(<div ref={list} className="menu-list composer-suggestions" style={{ position: 'fixed', ...position }}
    onPointerDown={event => event.preventDefault()}>
    <div className="composer-suggestion-heading">{trigger.kind === '/' ? tr('输入命令') : tr('引用上下文')}</div>
    {loading && <p className="command-status" role="status">{tr('加载中…')}</p>}
    {(error || selection.error) && <div className="composer-suggestion-error"><p role="alert">{error || selection.error}</p></div>}
    {files.limited && <p className="hint">{tr('结果较多，请输入更具体的路径；已排除生成目录和依赖。')}</p>}
    {!!files.unreadable && <p className="hint">{tr('部分目录无法读取')} · {files.unreadable}</p>}
    <div id={listId} role="listbox" aria-label={tr('输入建议')} aria-busy={loading || acting || selection.pending}>
      {choices.map((item, index) => <div key={item.id}>
        {item.group !== choices[index - 1]?.group && <div className="composer-suggestion-group">{item.group}</div>}
        <button type="button" role="option" id={prefix + '-' + index} aria-selected={item.id === highlighted?.id} aria-disabled={item.disabled || acting || selection.pending || undefined}
          tabIndex={-1} className="composer-suggestion-row" onPointerMove={() => { if (!item.disabled) setActive(item.id); }} onClick={() => void choose(item)}>
          {item.reference?.kind === 'folder' || item.browse ? <Folder size={16} /> : item.reference?.kind === 'file' ? <File size={16} /> : item.reference?.kind === 'skill' ? <Sparkles size={16} /> : item.reference?.kind === 'tool' ? <Terminal size={16} /> : <ListChecks size={16} />}
          <span className="composer-suggestion-label">{item.label}</span><span className="composer-suggestion-detail">{item.detail}</span>
          {item.reference && threadUi.contextReferences?.some(reference => reference.kind === item.reference?.kind && reference.id === item.reference.id && reference.directoryId === item.reference.directoryId) && <Check size={14} />}
        </button>
      </div>)}
      {!loading && !error && !choices.length && <p className="command-status">{tr('没有可用的匹配项')}</p>}
    </div>
  </div>, document.body);
}
