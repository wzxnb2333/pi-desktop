import { useRef, useState } from 'react';
import { Check, Copy, Pencil, RotateCcw, MessageSquare } from 'lucide-react';
import { z } from 'zod';
import { threadSchema, type TimelineItem } from '../../../../shared/contracts.ts';
import { composerPayloadSchema, referenceKey, sendReceiptSchema } from '../../../../shared/composer.ts';
import { tr, localizeAppError } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { ComposerPanel } from '../composer/composer-panels.tsx';
import { ThreadActions } from '../sidebar/thread-actions.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Button } from '../primitives/button.tsx';

export function MessageActions({ item }: { item: TimelineItem }) {
  useLocale();
  const { thread, invoke, selectThread, updateDraft, updateContextReferences, composerRef, setError: setAppError } = useApp();
  const [editing, setEditing] = useState(false), [text, setText] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false);
  const submitting = useRef(false), request = useRef({ fingerprint: '', id: crypto.randomUUID() });
  const body = item.role === 'user' ? item.input?.text ?? item.text : item.text;
  if (!thread) return null;
  const available = !thread.deletedAt && !thread.archived && !thread.review && !thread.sidechat && !thread.subtaskId && !!thread.sessionFile && !['running', 'waiting'].includes(thread.status);
  const kind = item.role === 'user' ? 'edit' : 'regenerate';
  const title = kind === 'edit' ? tr('编辑并重新发送') : tr('重新生成回答');
  const revise = async (send: boolean) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    const fingerprint = JSON.stringify([item.id, kind, kind === 'edit' ? text : undefined]);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    let opened = false;
    try {
      const result = z.object({ thread: threadSchema, payload: composerPayloadSchema }).parse(await invoke({ op: 'thread.revise', threadId: thread.id, itemId: item.id, requestId: request.current.id, kind, ...(kind === 'edit' ? { text } : {}) }));
      selectThread(result.thread); opened = true;
      if (send) {
        const key = 'pi-composer-send:' + result.thread.id;
        localStorage.setItem(key, JSON.stringify({ requestId: request.current.id, payload: JSON.stringify(result.payload) }));
        const receipt = sendReceiptSchema.parse(await invoke({ op: 'thread.send', id: result.thread.id, requestId: request.current.id, ...result.payload }));
        if (receipt.status === 'uncertain') throw new Error(tr('发送状态未知，请先检查会话；未自动重发。'));
        if (receipt.status !== 'accepted') throw new Error(receipt.error ?? tr('发送失败，内容已保留'));
        localStorage.removeItem(key);
        // The branch did not exist in the originating render. Use current draft state,
        // and preserve anything the user typed while the send was being accepted.
        updateDraft(result.thread.id, draft => ({ text: draft.text === result.payload.text ? '' : draft.text, attachments: draft.attachments.filter(path => !result.payload.attachments.includes(path)) }));
        updateContextReferences(result.thread.id, current => current.filter(item => !result.payload.context.some(sent => referenceKey(sent) === referenceKey(item))));
      }
      setEditing(false); requestAnimationFrame(() => composerRef.current?.focus());
    } catch (reason) {
      const message = localizeAppError(reason instanceof Error ? reason.message : String(reason));
      if (opened) setAppError(message); else setError(message);
    }
    finally { submitting.current = false; setBusy(false); }
  };
  return <><div className="message-actions" role="group" aria-label={tr('消息操作')} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setCopied(false); }}>
    {!!body && <IconButton label={copied ? tr('已复制') : tr('复制消息')} size="sm" onClick={() => { void navigator.clipboard.writeText(body).then(() => { setCopied(true); setError(''); }, reason => setError(localizeAppError(String(reason)))); }}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>}
    {item.role === 'assistant' && <IconButton label={tr('从此处侧聊')} size="sm" disabled={!!thread.deletedAt || !!thread.sidechat?.temporary} onClick={() => { void invoke({ op: 'sidechat.create', threadId: thread.id, anchorItemId: item.id }).catch(reason => setError(localizeAppError(String(reason)))); }}><MessageSquare size={14} /></IconButton>}
    <IconButton label={title} size="sm" disabled={!available || !item.entryId} onClick={() => { setText(body); setError(''); setEditing(true); }}>{kind === 'edit' ? <Pencil size={14} /> : <RotateCcw size={14} />}</IconButton>
    {item.entryId && <ThreadActions thread={thread} entryId={item.entryId} />}
  </div>{error && !editing && <p className="message-action-error" role="alert">{error}</p>}
  {editing && <ComposerPanel title={title} close={() => { if (!busy) setEditing(false); }}>
    <p className="hint">{tr('将在原消息之前创建新分支，保留原会话与草稿。工作区文件不会回滚；发送后工具可能再次执行，沿用当前任务权限。')}</p>
    <p className="hint">{tr('引用会重新校验；来源已变化时，请在分支草稿中刷新引用后发送。')}</p>
    {kind === 'edit' && <label>{tr('消息内容')}<textarea aria-label={tr('消息内容')} data-dialog-autofocus rows={7} value={text} maxLength={100000} disabled={busy} onChange={event => setText(event.target.value)} /></label>}
    {error && <p role="alert">{error}</p>}
    <div className="composer-panel-actions"><Button size="sm" disabled={busy} onClick={() => void revise(false)}>{tr('创建分支草稿')}</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => void revise(true)}>{busy ? tr('正在处理…') : tr('创建分支并发送')}</Button></div>
  </ComposerPanel>}</>;
}
