import { useEffect, useRef, useState } from 'react';
import type { BrowserClearOptions, BrowserDataRange, BrowserHistoryPage } from '../../../../shared/browser-history.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { Menu } from '../primitives/menu.tsx';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';

function historyErrorText(reason: unknown): string {
  return (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': Error: /, '');
}

export function BrowserHistoryPanel({ threadId, tabId, clear, onClose }: { threadId: string; tabId: string; clear: boolean; onClose(): void }) {
  useLocale(); const { data, invoke } = useApp(); const api = useRef(invoke); api.current = invoke;
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0);
  const [historyResult, setHistoryResult] = useState<{ key: string; value?: BrowserHistoryPage; error?: string }>();
  const [options, setOptions] = useState<BrowserClearOptions>({ range: 'hour', history: true, siteData: false, cache: false });
  const [clearing, setClearing] = useState(clear); const [error, setError] = useState(''), [requestId, setRequestId] = useState(() => data.operations.findLast(item => item.kind === 'browser.clear')?.id ?? '');
  const [detailsResult, setDetailsResult] = useState<{ key: string; value?: { count: number; origins: string[]; cacheBytes: number }; error?: string }>();
  const mounted = useRef(true), starting = useRef(false), cancelling = useRef(false), opening = useRef(false);
  const [openingPending, setOpeningPending] = useState(false), [cancelPending, setCancelPending] = useState(false);
  const identity = threadId + '/' + tabId, activeIdentity = useRef(identity); activeIdentity.current = identity;
  const historyKey = JSON.stringify([query, offset, refresh]), detailsKey = options.range + '/' + refresh;
  const historyLoading = historyResult?.key !== historyKey, detailsLoading = detailsResult?.key !== detailsKey;
  const history = !historyLoading ? historyResult?.value : undefined, details = !detailsLoading ? detailsResult?.value : undefined;
  const historyError = !historyLoading ? historyResult?.error : undefined, detailsError = !detailsLoading ? detailsResult?.error : undefined;
  const operation = data.operations.find(item => item.id === requestId);
  const pending = !!requestId && (!operation || operation.status === 'running');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let current = true; const timer = setTimeout(() => {
      void api.current({ op: 'browser.history', query, offset, limit: 50 }).then(value => {
        if (!current) return; const page = value as BrowserHistoryPage;
        if (offset > 0 && offset >= page.total) { setOffset(Math.max(0, Math.floor((page.total - 1) / 50) * 50)); return; }
        setHistoryResult({ key: historyKey, value: page });
      }).catch(reason => { if (current) setHistoryResult({ key: historyKey, error: historyErrorText(reason) }); });
    }, 100);
    return () => { current = false; clearTimeout(timer); };
  }, [query, offset, historyKey]);
  useEffect(() => {
    if (!clearing) return; let current = true;
    void api.current({ op: 'browser.data', range: options.range }).then(value => { if (current) setDetailsResult({ key: detailsKey, value: value as NonNullable<typeof details> }); }).catch(reason => { if (current) setDetailsResult({ key: detailsKey, error: historyErrorText(reason) }); });
    return () => { current = false; };
  }, [clearing, options.range, detailsKey]);
  useEffect(() => { if (operation && operation.status !== 'running') { setRefresh(value => value + 1); setOffset(0); } }, [operation?.status]);
  return <ConfirmDialog presentation="panel" title={tr('浏览历史')} confirmLabel={tr('关闭')} onConfirm={onClose} onCancel={onClose} description={<div className="browser-history">
    <div className="row"><input data-dialog-autofocus aria-label={tr('搜索浏览历史')} maxLength={1000} placeholder={tr('搜索标题或网址')} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /><Button onClick={() => setClearing(value => !value)}>{tr('清除浏览数据')}</Button></div>
    {history?.error && <p role="alert">{localizeAppError(history.error)}</p>}
    {error && <p role="alert">{localizeAppError(error)}</p>}
    {clearing && <section className="browser-data-settings">
      <label>{tr('清理时间范围')}<Menu label={tr('清理时间范围')} value={options.range} disabled={pending} matchTriggerWidth
        options={[{ value: 'hour', label: tr('最近一小时') }, { value: 'day', label: tr('最近一天') }, { value: 'week', label: tr('最近一周') }, { value: 'all', label: tr('全部时间') }]}
        onChange={range => setOptions(current => ({ ...current, range: range as BrowserDataRange }))} /></label>
      <label><input type="checkbox" checked={options.history} disabled={pending} onChange={event => setOptions(current => ({ ...current, history: event.target.checked }))} />{tr('浏览历史记录')}</label>
      <label><input type="checkbox" checked={options.siteData} disabled={pending} onChange={event => setOptions(current => ({ ...current, siteData: event.target.checked }))} />{tr('网站 Cookie 和存储')}</label>
      <label><input type="checkbox" checked={options.cache} disabled={pending} onChange={event => setOptions(current => ({ ...current, cache: event.target.checked }))} />{tr('全部浏览器缓存')}</label>
      {details && <p>{tr('{p0} 条历史 · {p1} 个网站 · 缓存 {p2} MB', { p0: details.count, p1: details.origins.length, p2: (details.cacheBytes / 1048576).toFixed(1) })}</p>}
      {detailsLoading && <p role="status">{tr('正在读取清理范围…')}</p>}
      {detailsError && <div><p role="alert">{localizeAppError(detailsError)}</p><Button onClick={() => setRefresh(value => value + 1)}>{tr('重试读取清理范围')}</Button></div>}
      <p>{tr('历史记录按时间筛选。网站数据按该时段访问的网站清除，包含较早数据及同一主域名的 Cookie。缓存始终全部清除。')}</p>
      <Button disabled={pending || !details || !options.history && !options.siteData && !options.cache} onClick={() => {
        if (starting.current || pending || !details) return;
        starting.current = true; const id = crypto.randomUUID(); setRequestId(id); setError('');
        void api.current({ op: 'browser.clear', requestId: id, options }).catch(reason => { if (mounted.current) { setRequestId(''); setError(historyErrorText(reason)); } }).finally(() => { starting.current = false; });
      }}>{tr('清除选定数据')}</Button>
      {pending && operation?.stage === '等待清理确认' && <Button disabled={cancelPending} onClick={() => {
        if (cancelling.current) return; cancelling.current = true; setCancelPending(true); setError('');
        void api.current({ op: 'browser.clearCancel', requestId }).catch(reason => { if (mounted.current) setError(historyErrorText(reason)); }).finally(() => { cancelling.current = false; if (mounted.current) setCancelPending(false); });
      }}>{tr('取消')}</Button>}
      {operation && <p role={operation.status === 'failed' ? 'alert' : 'status'}>{operation.status === 'succeeded' ? operation.result && typeof operation.result === 'object' && 'cancelled' in operation.result ? tr('已取消清理') : tr('浏览数据已清理') : operation.error ? localizeAppError(operation.error) : localizeLabel(operation.stage)}</p>}
      {operation?.status === 'failed' && <p>{tr('清理失败前已完成的部分不会撤销；可重试所选操作。')}</p>}
    </section>}
    {historyLoading && <p role="status">{tr('正在读取浏览历史…')}</p>}
    {historyError && <div><p role="alert">{localizeAppError(historyError)}</p><Button onClick={() => setRefresh(value => value + 1)}>{tr('重试读取浏览历史')}</Button></div>}
    <ul aria-busy={historyLoading || openingPending}>{history?.entries.map(item => <li key={item.id}><button disabled={openingPending} onClick={() => {
      if (opening.current) return; opening.current = true; setOpeningPending(true); setError('');
      void api.current({ op: 'browser.open', threadId, tabId: tabId || crypto.randomUUID(), url: item.url }).then(() => { if (mounted.current && activeIdentity.current === identity) onClose(); }).catch(reason => { if (mounted.current && activeIdentity.current === identity) setError(historyErrorText(reason)); }).finally(() => { opening.current = false; if (mounted.current) setOpeningPending(false); });
    }}><strong>{item.title || item.url}</strong><span>{item.url}</span><small>{new Date(item.visitedAt).toLocaleString(data.ui.locale)}</small></button></li>)}</ul>
    {openingPending && <p role="status">{tr('正在打开历史页面…')}</p>}
    {history && !history.entries.length && <p>{tr('没有匹配的浏览历史')}</p>}
    <div className="row"><Button disabled={!history || openingPending || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{tr('上一页')}</Button><span>{history && tr('{p0} 条记录', { p0: history.total })}</span><Button disabled={!history || openingPending || offset + 50 >= history.total} onClick={() => setOffset(value => value + 50)}>{tr('下一页')}</Button><Button onClick={onClose}>{tr('关闭')}</Button></div>
  </div>} />;
}
