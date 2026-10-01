import { useState } from 'react';
import { ArrowUp, ArrowDown, Pencil, X } from 'lucide-react';
import { tr, localizeAppError } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import type { Thread } from '../../../../shared/contracts.ts';
import type { QueueChange } from '../../../../shared/composer.ts';
import { ComposerPanel } from './composer-panels.tsx';
import { Button } from '../primitives/button.tsx';
import { IconButton } from '../primitives/icon-button.tsx';

export function QueueControls() {
  const { thread, invoke } = useApp();
  const [editing, setEditing] = useState<NonNullable<Thread['queue']>[number]>(), [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const change = async (item: NonNullable<Thread['queue']>[number], action: QueueChange['action']) => {
    if (!thread || !item.id || busy) return; setBusy(true); setError('');
    try { await invoke({ op: 'thread.queueChange', threadId: thread.id, change: { id: item.id, revision: item.revision ?? 0, action, ...(action === 'edit' ? { text } : {}) } }); setEditing(undefined); }
    catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); } finally { setBusy(false); }
  };
  if (!thread?.queue?.length && !editing && !error) return null;
  return <div className="composer-queue-controls">{error && !editing && <p role="alert">{error}</p>}
    {thread?.queue?.map((item, index, all) => <div className="composer-queue-row" key={item.id ?? index}><span><small>{tr(item.kind === 'steer' ? '引导' : '排队')}</small><span>{item.text || item.attachments.map(path => path.split(/[\\/]/).pop()).join(', ')}</span></span>
      <IconButton size="sm" disabled={busy || !item.id} label={tr('编辑排队消息')} onClick={() => { setEditing(item); setText(item.text); setError(''); }}><Pencil size={14} /></IconButton>
      <IconButton size="sm" disabled={busy || !item.id || !all.slice(0, index).some(row => row.kind === item.kind)} label={tr('上移消息')} onClick={() => void change(item, 'up')}><ArrowUp size={14} /></IconButton>
      <IconButton size="sm" disabled={busy || !item.id || !all.slice(index + 1).some(row => row.kind === item.kind)} label={tr('下移消息')} onClick={() => void change(item, 'down')}><ArrowDown size={14} /></IconButton>
      <IconButton size="sm" disabled={busy || !item.id} label={tr('删除排队消息')} onClick={() => void change(item, 'remove')}><X size={14} /></IconButton>
    </div>)}
    {editing && <ComposerPanel title={tr('编辑排队消息')} close={() => { if (!busy) setEditing(undefined); }}><p className="hint">{tr('仅在相同类型内排序；已经开始处理的消息不能撤回。')}</p><textarea aria-label={tr('编辑排队消息')} rows={6} value={text} maxLength={100000} onChange={event => setText(event.target.value)} />{error && <p role="alert">{error}</p>}<Button size="sm" disabled={busy || !thread?.queue?.some(item => item.id === editing.id)} onClick={() => void change(editing, 'edit')}>{tr('保存')}</Button></ComposerPanel>}
  </div>;
}
