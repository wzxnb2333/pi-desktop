import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { Minus, Plus, Search, SquareTerminal, Trash2, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { TerminalInfo } from '../../../../shared/contracts.ts';
import { terminalCommand } from '../../../../shared/shortcuts.ts';
import { useApp } from '../../state/app.tsx';
import { TerminalPanel, terminalAction } from '../../TerminalPanel.tsx';
import { Menu } from '../primitives/menu.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Tabs } from '../primitives/tabs.tsx';

/**
 * Which pty is on screen, per task.
 *
 * This is module state on purpose. The shell unmounts the section when the pane is hidden, so hook
 * state would drop the selection and silently land the user on a different terminal when it comes
 * back. `''` is a real value: it means the tab was closed, which is the third state the pane has -
 * hidden pane, closed tab, killed process. The pty survives the first two.
 */
interface TerminalControls {
  shown: string;
  opening: boolean;
  closing?: string;
  findOpen: boolean;
  lastActionId?: string;
  error?: string;
  rename?: { id: string; title: string; saving: boolean; error?: string };
}
const emptyControls: TerminalControls = { shown: '', opening: false, findOpen: false };
const controlsByThread = new Map<string, TerminalControls>();
const controlsListeners = new Set<() => void>();
function controlsFor(id: string): TerminalControls { return controlsByThread.get(id) ?? emptyControls; }
function updateControls(id: string, patch: Partial<TerminalControls>): void {
  controlsByThread.set(id, { ...controlsFor(id), ...patch });
  for (const listener of controlsListeners) listener();
}
function subscribeControls(listener: () => void): () => void {
  controlsListeners.add(listener); return () => { controlsListeners.delete(listener); };
}
const queryByTerminal = new Map<string, string>();
function terminalError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function TerminalFind({ id, shortcuts, open, onClose }: { id: string; shortcuts?: Record<string, string>; open: boolean; onClose(): void }) {
  useLocale();
  const [query, setQuery] = useState(() => queryByTerminal.get(id) ?? '');
  const [feedback, setFeedback] = useState('');
  const find = (previous = false) => {
    void terminalAction(id, previous ? 'findPrevious' : 'find', query).then(value => setFeedback(value ?? ''));
  };
  return <div className="terminal-find row" hidden={!open} role="search" aria-label={tr("终端查找")}>
    <input data-search-terminal aria-label={tr("查找终端内容")} value={query} placeholder={tr("查找终端内容")} onChange={event => { setQuery(event.target.value); queryByTerminal.set(id, event.target.value); setFeedback(''); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      const command = terminalCommand(event.nativeEvent, shortcuts);
      if (!command) return;
      event.preventDefault(); event.stopPropagation();
      if (command === 'terminalFindExit') void terminalAction(id, 'focus');
      else find(command === 'terminalFindPrevious');
    }} />
    <button type="button" onClick={() => find(true)}>{tr("查找上一个")}</button>
    <button type="button" onClick={() => find()}>{tr("查找下一个")}</button>
    <span role="status">{feedback}</span>
    <IconButton label={tr("关闭")} size="sm" onClick={() => { onClose(); void terminalAction(id, 'focus'); }}><X size={14} /></IconButton>
  </div>;
}

export function TerminalSection({ height }: { height?: number }) {
  useLocale();
  const { thread, terminals, data, terminalOpen, setTerminalOpen, upsertTerminal, threadUi } = useApp();
  // IPC may finish after this panel unmounts. Keep progress, errors and rename drafts
  // with their originating task so a reopened panel observes the same operation.
  const controls = useSyncExternalStore(subscribeControls, () => controlsFor(thread?.id ?? ''));
  const newestAction = terminals.findLast(item => item.threadId === thread?.id && item.operationId);
  useEffect(() => {
    if (thread && newestAction && controlsFor(thread.id).lastActionId !== newestAction.id)
      updateControls(thread.id, { shown: newestAction.id, lastActionId: newestAction.id });
  }, [thread?.id, newestAction?.id]);
  useEffect(() => {
    if (!thread || !terminalOpen) return;
    const openFind = () => {
      updateControls(thread.id, { findOpen: true });
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-search-terminal]')?.focus());
    };
    window.addEventListener('pi:terminal-find', openFind);
    return () => window.removeEventListener('pi:terminal-find', openFind);
  }, [thread?.id, terminalOpen]);
  if (!thread || !terminalOpen) return null;
  const current = terminals.filter((item) => item.threadId === thread.id);
  const focused = controls.shown;
  const active = current.find((item) => item.id === focused);
  const live = current.filter((item) => !item.exited);
  const newest = live.at(-1);
  const show = (id: string): void => {
    updateControls(thread.id, { shown: id });
  };
  const open = async (profileId?: string): Promise<void> => {
    if (controlsFor(thread.id).opening) return;
    updateControls(thread.id, { opening: true, error: undefined });
    try {
      const created = (await window.desktop.invoke({ op: 'terminal.open', threadId: thread.id, profileId })) as TerminalInfo;
      upsertTerminal(created);
      updateControls(thread.id, { shown: created.id });
    } catch (error) { updateControls(thread.id, { error: terminalError(error) }); }
    finally { updateControls(thread.id, { opening: false }); }
  };
  const close = async (id: string): Promise<void> => {
    if (controlsFor(thread.id).closing) return;
    updateControls(thread.id, { closing: id, error: undefined });
    try { await window.desktop.invoke({ op: 'terminal.close', id }); }
    catch (error) { updateControls(thread.id, { error: terminalError(error) }); }
    finally { updateControls(thread.id, { closing: undefined }); }
  };
  const rename = async (): Promise<void> => {
    const draft = controlsFor(thread.id).rename;
    if (!draft || draft.saving || !draft.title.trim()) return;
    updateControls(thread.id, { rename: { ...draft, saving: true, error: undefined } });
    try {
      const result = await window.desktop.invoke({ op: 'terminal.rename', id: draft.id, title: draft.title.trim() });
      upsertTerminal(result as TerminalInfo);
      updateControls(thread.id, { rename: undefined });
    } catch (error) { updateControls(thread.id, { rename: { ...draft, saving: false, error: terminalError(error) } }); }
  };
  return (
    <section className="terminal-panel" style={{ height }}>
      <Tabs
        className="terminal-tabs panel-strip"
        ariaLabel={tr("终端页签")}
        value={focused}
        onChange={show}
        items={current.map((item) => ({
          id: item.id,
          label: <><SquareTerminal size={16} aria-hidden="true" /><span className="terminal-tab-title">{item.title}</span></>,
          trailing: item.exited ? (
            <span className="tab-state">  {tr("· 已退出")}</span>
          ) : focused === '' ? (
            <span className="tab-state">  {tr("· 后台运行")}</span>
          ) : undefined,
        }))}
      >
        <IconButton label={tr("新建终端")} size="sm" disabled={controls.opening} onClick={() => void open()}>
          <Plus size={14} />
        </IconButton>
        <span className="flex-spacer" />
        <IconButton label={tr("终端查找")} size="sm" disabled={!active} active={controls.findOpen} onClick={() => {
          if (controls.findOpen) updateControls(thread.id, { findOpen: false });
          else window.dispatchEvent(new Event('pi:terminal-find'));
        }}><Search size={14} /></IconButton>
        <Menu label={tr("终端操作")} kind="action" value="" placeholder={tr("更多")} size="sm" side="top" disabled={!active} options={[{ value: 'rename', label: tr("重命名") }, { value: 'copy', label: tr("复制选中内容或全部输出") }, { value: 'clear', label: tr("清屏") }]} onChange={action => {
          if (!active) return;
          if (action === 'rename') updateControls(thread.id, { rename: { id: active.id, title: active.title, saving: false } });
          else {
            updateControls(thread.id, { error: undefined });
            void terminalAction(active.id, action as 'clear' | 'copy').catch(error => updateControls(thread.id, { error: terminalError(error) }));
          }
        }} />
        {/* Closing a tab only stops showing that pty: the process keeps running and keeps producing
            output. `终止终端` is the only control that reaches the process, and `隐藏终端` only takes
            the pane away. */}
        <IconButton label={tr("关闭页签")} size="sm" disabled={!active} onClick={() => show('')}>
          <X size={14} />
        </IconButton>
        <IconButton
          label={tr("终止终端")}
          size="sm"
          disabled={!active || active.exited || !!controls.closing}
          onClick={() => active && void close(active.id)}
        >
          <Trash2 size={14} />
        </IconButton>
        <IconButton label={tr("隐藏终端")} size="sm" onClick={() => setTerminalOpen(false)}>
          <Minus size={14} />
        </IconButton>
      </Tabs>
      {controls.opening && <p className="terminal-feedback" role="status">{tr("正在启动终端…")}</p>}
      {controls.closing && <p className="terminal-feedback" role="status">{tr("正在终止终端…")}</p>}
      {controls.error && <p className="terminal-feedback" role="alert">{localizeAppError(controls.error)}</p>}
      {active && <TerminalFind key={active.id} id={active.id} shortcuts={data.settings.shortcuts} open={controls.findOpen} onClose={() => updateControls(thread.id, { findOpen: false })} />}
      {controls.rename && <ConfirmDialog title={tr("重命名终端")} description={<>
        <input aria-label={tr("终端名称")} data-dialog-autofocus maxLength={100} disabled={controls.rename.saving} value={controls.rename.title} onChange={event => {
          const draft = controlsFor(thread.id).rename;
          if (draft && !draft.saving) updateControls(thread.id, { rename: { ...draft, title: event.target.value, error: undefined } });
        }} />
        {controls.rename.error && <span className="terminal-feedback" role="alert">{localizeAppError(controls.rename.error)}</span>}
      </>} pending={controls.rename.saving} confirmDisabled={!controls.rename.title.trim()} confirmLabel={controls.rename.saving ? tr("正在保存…") : tr("保存")}
        onCancel={() => { if (!controlsFor(thread.id).rename?.saving) updateControls(thread.id, { rename: undefined }); }} onConfirm={() => void rename()} />}
      {active ? (
        <TerminalPanel terminal={active} />
      ) : (
        <div className="terminal-empty">
          {(threadUi.terminalProfiles ?? []).filter(profile => !current.some(item => item.profileId === profile.id && !item.exited)).map(profile => <button key={profile.id} disabled={controls.opening} onClick={() => void open(profile.id)}>{tr("重新启动")} {profile.title} · {profile.shell}{tr("（新进程）")}</button>)}
          {newest ? (
            <>
              <p>{tr("{p0} 个终端在后台运行，输出仍在累积。", { p0: live.length })}</p>
              <button onClick={() => show(newest.id)}>{tr("显示")} {newest.title}</button>
            </>
          ) : (
            <button disabled={controls.opening} onClick={() => void open()}>{tr("在当前项目启动")} {data.settings.terminal}</button>
          )}
        </div>
      )}
    </section>
  );
}
