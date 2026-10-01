import { tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BrowserFindState } from '../../../../shared/contracts.ts';
import { browserCommand } from '../../../../shared/shortcuts.ts';
import { useApp } from '../../state/app.tsx';
import { IconButton } from '../primitives/icon-button.tsx';

export function BrowserFindBar({ threadId, tabId, state, enabled, open, onClose }: { threadId: string; tabId: string; state?: BrowserFindState; enabled: boolean; open: boolean; onClose(): void }) {
  useLocale();
  const { act, data } = useApp();
  const [draft, setDraft] = useState<string>();
  const composing = useRef(false);
  const lastEdit = useRef(state?.text ?? '');
  const statusId = useId();
  const text = draft ?? state?.text ?? '';
  useEffect(() => { if (!composing.current && draft === state?.text) setDraft(undefined); }, [draft, state?.text, state?.requestId]);
  useEffect(() => { if (draft === undefined) lastEdit.current = state?.text ?? ''; }, [draft, state?.text]);
  const search = (value: string, forward = true) => {
    if (enabled) act({ op: 'browser.find', threadId, tabId, text: value, forward });
  };
  const edit = (value: string) => {
    setDraft(value);
    if (composing.current || lastEdit.current === value) return;
    lastEdit.current = value;
    search(value);
  };
  const clear = () => {
    lastEdit.current = ''; setDraft(''); search('');
    act({ op: 'browser.action', threadId, tabId, action: 'focus' });
  };
  const pending = !!text && (composing.current || state?.text !== text || state.pending);
  return <div className="browser-find" hidden={!open} role="search" aria-label={tr("网页查找")} onKeyDown={event => {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const command = browserCommand(event, 'find', data.settings.shortcuts);
    if (!command || (!(event.target instanceof HTMLInputElement) && command !== 'browserFindExit')) return;
    event.preventDefault(); event.stopPropagation();
    if (command === 'browserFindExit') clear();
    else if (text && enabled && !pending) search(text, command === 'browserFindNext');
  }}>
    <input aria-label={tr("网页内查找")} aria-describedby={statusId} placeholder={tr("页内查找")} maxLength={1000} disabled={!enabled} value={text}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={event => { composing.current = false; edit(event.currentTarget.value); }}
      onChange={event => edit(event.target.value)} />
    <button type="button" disabled={!enabled || !text} aria-disabled={pending || undefined} onClick={() => { if (!pending) search(text, false); }}>{tr("上一处")}</button>
    <button type="button" disabled={!enabled || !text} aria-disabled={pending || undefined} onClick={() => { if (!pending) search(text); }}>{tr("下一处")}</button>
    <button type="button" disabled={!enabled || !text} onClick={clear}>{tr("清除查找")}</button>
    <IconButton label={tr("关闭")} size="sm" onClick={() => { clear(); onClose(); }}><X size={14} /></IconButton>
    <span id={statusId} role="status" aria-live="polite">{!text ? '' : pending ? tr("查找中…") : !state?.matches ? tr("没有匹配结果") : tr("第 ") + state.active + '/' + state.matches + tr(" 处")}</span>
  </div>;
}
