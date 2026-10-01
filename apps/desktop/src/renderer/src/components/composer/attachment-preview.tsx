import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { attachmentInfoSchema, type AttachmentInfo } from '../../../../shared/composer.ts';
import { tr, localizeAppError } from '../../../../shared/localization.ts';
import { useApp } from '../../state/app.tsx';
import { filename } from '../../lib/labels.ts';
import { ComposerPanel } from './composer-panels.tsx';
import { Button } from '../primitives/button.tsx';

export function AttachmentPreview({ path, remove, disabled }: { path: string; remove(): void; disabled: boolean }) {
  const { invoke, thread } = useApp(); const [info, setInfo] = useState<AttachmentInfo>(), [error, setError] = useState(''), [retry, setRetry] = useState(0), [open, setOpen] = useState(false);
  useEffect(() => { if (!thread) return; let active = true; setError('');
    void invoke({ op: 'attachment.inspect', threadId: thread.id, path }).then(raw => { if (active) setInfo(attachmentInfoSchema.parse(raw)); }).catch(reason => { if (active) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); });
    return () => { active = false; };
  }, [thread?.id, invoke, path, retry]);
  return <div className="composer-attachment">
    <button type="button" className="composer-attachment-open" onClick={() => setOpen(true)} aria-label={tr('附件预览') + ' ' + filename(path)}>
      {info?.kind === 'image' ? <img src={info.preview} alt={filename(path)} /> : <FileText size={16} />}
      <span><span className="attachment-name">{filename(path)}</span><small>{error ? tr('附件导入失败') : info ? (info.bytes / 1024).toFixed(1) + ' KB · ' + tr(info.kind === 'image' ? '图片附件' : info.kind === 'text' ? '文本附件' : '不支持的附件') : tr('加载中…')}</small></span>
    </button><button type="button" className="icon-button btn-icon btn-2xs" disabled={disabled} aria-label={tr('移除附件 {p0}', { p0: filename(path) ?? path })} onClick={remove}><X size={12} /></button>
    {open && <ComposerPanel title={filename(path) ?? path} close={() => setOpen(false)}>{error ? <><p role="alert">{error}</p><Button size="sm" onClick={() => setRetry(value => value + 1)}>{tr('重试')}</Button></> : info?.kind === 'image' ? <img className="composer-full-image" src={info.preview} alt={info.name} /> : <pre className="composer-context-preview">{info?.preview ?? tr('不支持的附件')}</pre>}{info?.truncated && <p className="hint">{tr('已截断')}</p>}</ComposerPanel>}
  </div>;
}
