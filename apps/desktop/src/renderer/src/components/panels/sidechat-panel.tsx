import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Thread } from '../../../../shared/contracts.ts';
import { getLocale, localizeAppError, tr } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button } from '../primitives/button.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Message } from '../timeline/message.tsx';
import '../../styles/sidechat.css';

export function SidechatPanel() {
  const { thread } = useApp();
  return thread ? <SidechatPanelContent key={thread.id} /> : null;
}

function SidechatPanelContent() {
  useLocale();
  const { thread: parent, data, threadUi, ui, invoke, updateDraft, patchThread, setReviewOpen, selectThread } = useApp();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(false);
  const current = useRef(true), selected = useRef(threadUi.sidechatId);
  const creationId = useRef(crypto.randomUUID()), sendRequest = useRef<{ text: string; id: string } | undefined>(undefined);
  selected.current = threadUi.sidechatId;
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  const transcript = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const chats = data.threads.filter(thread => thread.sidechat?.temporary && thread.sidechat.parentThreadId === parent?.id && !thread.deletedAt);
  const thread = chats.find(thread => thread.id === threadUi.sidechatId);
  const draft = thread ? ui.threads[thread.id]?.draft?.text ?? '' : '';
  const running = !!thread && ['running', 'waiting'].includes(thread.status);
  useEffect(() => { if (follow.current && transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [thread?.items]);
  const perform = async (action: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError(''); setFeedback(false);
    try { await action(); } catch (error) { if (current.current) setError(error instanceof Error ? error.message : String(error)); }
    finally { if (current.current) { submitting.current = false; setPending(false); } }
  };
  const create = () => perform(async () => {
    if (!parent) return;
    await invoke({ op: 'sidechat.create', threadId: parent.id, requestId: creationId.current });
    if (current.current) { creationId.current = crypto.randomUUID(); follow.current = true; }
  });
  const send = () => perform(async () => {
    if (!thread || !draft.trim() || running) return;
    if (sendRequest.current?.text !== draft) sendRequest.current = { text: draft, id: crypto.randomUUID() };
    await invoke({ op: 'thread.send', id: thread.id, requestId: sendRequest.current.id, text: draft, attachments: [] });
    updateDraft(thread.id, current => ({ ...current, text: current.text === draft ? '' : current.text }));
    if (current.current) { follow.current = true; sendRequest.current = undefined; }
  });
  return <section className="sidechat-panel">
    <header className="panel-strip"><h2>{tr('侧聊')}</h2>
      <IconButton size="sm" label={tr('新建侧聊')} disabled={pending || !parent} onClick={() => void create()}><Plus size={15} /></IconButton>
      <IconButton size="sm" label={tr('关闭侧聊')} onClick={() => setReviewOpen(false)}><X size={15} /></IconButton>
    </header>
    <p className="sidechat-description">{tr('只读问答，主任务继续运行。关闭面板保留草稿，退出应用后清除临时侧聊。')}</p>
    {chats.length > 0 && <select aria-label={tr('选择侧聊')} disabled={pending} value={thread?.id ?? ''} onChange={event => { patchThread({ sidechatId: event.target.value }); follow.current = true; sendRequest.current = undefined; setError(''); setFeedback(false); }}>
      {!thread && <option value="">{tr('选择侧聊')}</option>}
      {chats.map(chat => <option key={chat.id} value={chat.id}>{new Date(chat.sidechat!.capturedAt).toLocaleTimeString(getLocale())} · {chat.items.find(item => item.role === 'user')?.text.slice(0, 30) || tr('新建侧聊')}</option>)}
    </select>}
    {!thread ? <div className="panel-empty"><p>{tr('从当前进度创建侧聊，或在消息操作中选择起点。')}</p><Button disabled={pending || !parent} onClick={() => void create()}>{tr('创建只读侧聊')}</Button></div> : <>
      <div className="sidechat-source"><span>{tr('上下文截取于：')}{new Date(thread.sidechat!.capturedAt).toLocaleString(getLocale())}</span>
        <Button size="xs" disabled={pending} onClick={() => void perform(async () => {
          const kept = await invoke({ op: 'sidechat.keep', threadId: thread.id }) as Thread;
          if (current.current && (!selected.current || selected.current === thread.id)) { setReviewOpen(false); selectThread(kept); }
        })}>{tr('保留为普通聊天')}</Button>
      </div>
      <div className="sidechat-transcript" ref={transcript} onScroll={event => { const node = event.currentTarget; follow.current = node.scrollHeight - node.clientHeight - node.scrollTop < 60; }}>
        {thread.items.map(item => <div key={item.id}><Message item={item} actions={false} />
          {item.role === 'assistant' && item.state === 'done' && !!item.text && <Button size="xs" disabled={pending || thread.sidechat?.appendedItemIds?.includes(item.id)} onClick={() => void perform(async () => { await invoke({ op: 'sidechat.append', threadId: thread.id, itemId: item.id }); if (current.current) setFeedback(true); })}>{tr(thread.sidechat?.appendedItemIds?.includes(item.id) ? '已追加到主任务草稿' : '追加到主任务草稿')}</Button>}
        </div>)}
      </div>
      {thread.error && <p className="sidechat-error" role="alert">{localizeAppError(thread.error)}</p>}
      <form className="sidechat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <textarea aria-label={tr('侧聊消息')} placeholder={tr('针对这段上下文提问…')} value={draft} rows={3} maxLength={100000}
          onChange={event => updateDraft(thread.id, current => ({ ...current, text: event.target.value }))}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !event.shiftKey && (data.settings.sendShortcut === 'enter' || event.ctrlKey)) { event.preventDefault(); if (!running) void send(); } }} />
        <div><span>{data.settings.providers.find(provider => provider.id === thread.providerId)?.name ?? tr('选择模型')}</span>
          {running ? <Button type="button" size="sm" disabled={pending} onClick={() => void perform(async () => { await invoke({ op: 'thread.stop', id: thread.id }); })}>{tr('停止侧聊')}</Button> : <Button type="submit" size="sm" disabled={pending || !draft.trim() || !thread.providerId}>{tr('发送侧聊')}</Button>}
        </div>
      </form>
    </>}
    {error && <p className="sidechat-error" role="alert">{localizeAppError(error)}</p>}
    {feedback && <p className="sidechat-description" role="status">{tr('已追加到主任务草稿，尚未发送')}</p>}
  </section>;
}
