import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { TimelineItem } from '../../../../shared/contracts.ts';
import type { MessageInputPart } from '../../../../shared/message-input.ts';
import { attachmentInfoSchema, type AttachmentInfo } from '../../../../shared/composer.ts';
import { tr, localizeAppError } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { conversationTarget } from '../../lib/conversation-search.ts';
import { Disclosure } from './disclosure.tsx';
import { Button } from '../primitives/button.tsx';

function CapturedPart({ item, part, index }: { item: TimelineItem; part: MessageInputPart; index: number }) {
  const { thread, invoke, patchThread, selectDirectory, setReviewOpen, focusTimeline } = useApp();
  const [image, setImage] = useState<AttachmentInfo>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!part.mime || !part.path || !thread) return;
    let current = true; setError('');
    void invoke({ op: 'attachment.inspect', threadId: thread.id, path: part.path }).then(value => { if (current) setImage(attachmentInfoSchema.parse(value)); })
      .catch(reason => { if (current) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); });
    return () => { current = false; };
  }, [thread?.id, invoke, part.path, part.mime, retry]);
  const reference = part.reference;
  const source = () => {
    if (!reference) return;
    if (reference.kind === 'quote') focusTimeline({ kind: 'message', id: reference.id });
    else if (reference.kind === 'file' || reference.kind === 'folder') {
      if (reference.directoryId) selectDirectory(reference.directoryId);
      patchThread({ directoryId: reference.directoryId, reviewTab: 'files', ...(reference.kind === 'folder' ? { fileDirectory: reference.id }
        : { selectedPath: reference.id, fileLocation: { id: crypto.randomUUID(), path: reference.id, line: reference.range?.start ?? 1 } }) });
      setReviewOpen(true);
    }
  };
  return <div className="message-context-content" data-search-target={conversationTarget(item.id, 'input:' + index)} tabIndex={-1}>
    <p className="hint" data-markdown-copy="exclude">{tr('发送时的上下文快照；打开来源查看当前版本。')}</p>
    {reference && ['file', 'folder', 'quote'].includes(reference.kind) && <Button size="xs" data-markdown-copy="exclude" onClick={source}>{tr('打开来源')}</Button>}
    {part.mime ? error ? <p role="alert">{error} <Button size="xs" onClick={() => setRetry(value => value + 1)}>{tr('重试')}</Button></p>
      : image?.preview ? <img className="message-context-image" src={image.preview} alt={part.label} /> : <p role="status">{tr('加载中…')}</p>
      : <pre>{item.text.slice(part.start, part.end)}</pre>}
  </div>;
}

export function MessageContext({ item }: { item: TimelineItem }) {
  return <div className="message-context-cards">{item.input?.parts.map((part, index) =>
    <Disclosure key={index} foldKey={'input:' + item.id + ':' + index} label={tr('查看上下文 {p0}', { p0: part.label })}
      icon={part.mime ? <ImageIcon size={14} /> : <FileText size={14} />}
      summary={<span title={part.label}>{part.label}{part.bytes !== undefined && <small> · {(part.bytes / 1024).toFixed(1)} KB</small>}</span>}>
      <CapturedPart item={item} part={part} index={index} />
    </Disclosure>)} </div>;
}
