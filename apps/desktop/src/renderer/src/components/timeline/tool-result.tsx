import { useState } from 'react';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { resourceUri, resultImage, toolResultSchema, type ResultBlock, type ToolResult } from '../../../../shared/tool-results.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useOpenLink } from '../../hooks/use-open-link.ts';
import { messageLink } from '../../lib/message-links.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';

function ToolResource({ block, index, itemId }: { block: ResultBlock; index: number; itemId?: string }) {
  const { activeId, data, invoke, thread } = useApp();
  const open = useOpenLink();
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const uri = resourceUri(block)!;
  const operation = data.operations.filter(record => record.threadId === activeId && record.kind === 'mcp.resource:' + itemId + ':' + index).at(-1);
  const parsed = toolResultSchema.safeParse(operation?.result);
  const busy = pending || operation?.status === 'running';
  const link = messageLink(uri, thread?.cwd ?? '');
  return <section className="tool-resource" aria-label={tr('工具资源')}>
    <strong>{typeof block.title === 'string' ? block.title : typeof block.name === 'string' ? block.name : uri}</strong>
    <code>{uri}</code>
    {typeof block.description === 'string' && <p>{block.description}</p>}
    <div className="row">
      {itemId && <Button size="sm" disabled={busy} onClick={() => {
        setPending(true); setError('');
        void invoke({ op: 'mcp.resource', threadId: activeId, itemId, index, requestId: crypto.randomUUID() }).catch(reason => setError(localizeAppError(String(reason)))).finally(() => setPending(false));
      }}>{tr('读取资源')}</Button>}
      {link.kind === 'web' && <Button size="sm" onClick={() => open(uri)}>{tr('在浏览器中打开')}</Button>}
      {link.kind === 'file' && !itemId && <Button size="sm" onClick={() => open(uri)}>{tr('打开文件')}</Button>}
      {operation?.status === 'running' && <Button size="sm" onClick={() => void invoke({ op: 'operation.cancel', threadId: activeId, requestId: operation.id }).catch(reason => setError(localizeAppError(String(reason))))}>{tr('取消')}</Button>}
    </div>
    {operation && <p role="status">{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', cancelled: '操作已取消', failed: '操作失败', interrupted: '操作已中断' } as const)[operation.status])}</p>}
    {(error || operation?.error) && <p role="alert">{error || localizeAppError(operation?.error ?? '')}</p>}
    {parsed.success && <StructuredToolResult value={parsed.data} />}
  </section>;
}

export function StructuredToolResult({ value, itemId }: { value: ToolResult; itemId?: string }) {
  useLocale();
  return <div className="structured-tool-result" aria-label={tr('结构化工具结果')}>
    {value.result.content.map((block, index) => {
      const image = resultImage(block);
      if (image) return <figure key={index}><img src={'data:' + image.mimeType + ';base64,' + image.data} alt={tr('工具返回的图片')} loading="lazy" /><figcaption>{image.mimeType}</figcaption></figure>;
      if (block.type === 'text' && typeof block.text === 'string') return <pre key={index}>{block.text}</pre>;
      if (resourceUri(block)) return <ToolResource key={index} block={block} index={index} itemId={value.origin ? itemId : undefined} />;
      if (block.type === 'resource' && block.resource && typeof block.resource === 'object' && !Array.isArray(block.resource)) {
        const resource = block.resource as ResultBlock;
        const embedded = resultImage({ type: 'image', mimeType: resource.mimeType, data: resource.blob });
        return <section className="tool-resource" key={index}><code>{typeof resource.uri === 'string' ? resource.uri : ''}</code>
          {typeof resource.text === 'string' ? <pre>{resource.text}</pre> : embedded ? <img alt={tr('工具返回的图片')} src={'data:' + embedded.mimeType + ';base64,' + embedded.data} loading="lazy" /> : <details><summary>{tr('原始资源内容')}</summary><pre>{JSON.stringify(resource, null, 2)}</pre></details>}
        </section>;
      }
      return <details className="tool-unknown" key={index}><summary>{tr('未识别内容')} · {typeof block.type === 'string' ? block.type : '?'}</summary><pre>{JSON.stringify(block, null, 2)}</pre></details>;
    })}
    {value.result.structuredContent && <details className="tool-structured-data"><summary>{tr('结构化数据')}</summary><pre>{JSON.stringify(value.result.structuredContent, null, 2)}</pre></details>}
    <details className="tool-raw-result"><summary>{tr('完整工具结果')}</summary><pre>{JSON.stringify(value.result, null, 2)}</pre></details>
  </div>;
}
