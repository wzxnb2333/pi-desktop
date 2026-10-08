import { useState } from 'react';
import type { TimelineItem } from '../../../../shared/contracts.ts';
import { browserToolSchema, browserUrlSchema, type BrowserToolRequest } from '../../../../shared/browser-tools.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { resultImage } from '../../../../shared/tool-results.ts';
import { selectPanelTab } from '../../../../shared/panel-tabs.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';

export function BrowserActivityResult({ item }: { item: TimelineItem }) {
  const { activeId, invoke, patchThread, patchUi } = useApp();
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const rawProgress = item.toolResult?.result.structuredContent?.browser;
  const progress = rawProgress && typeof rawProgress === 'object' ? rawProgress as Record<string, unknown> : undefined;
  let request: BrowserToolRequest | undefined;
  if (item.args) try { request = browserToolSchema.safeParse(JSON.parse(item.args)).data; } catch { /* Incomplete streamed arguments are not actionable. */ }
  let result: Record<string, unknown> = {};
  let decoded: unknown;
  const text = item.toolResult?.result.content.find(block => block.type === 'text' && typeof block.text === 'string')?.text;
  if (typeof text === 'string') try {
    decoded = JSON.parse(text.slice(text.search(/[\[{]/)));
    if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) result = decoded as Record<string, unknown>;
  } catch { /* Progress and errors remain plain text. */ }
  const page = result.page && typeof result.page === 'object' ? result.page as Record<string, unknown> : result;
  const backend = progress?.backend === 'chrome' || result.backend === 'chrome' || request?.backend === 'chrome' ? 'chrome' : 'in-app';
  const tabId = typeof result.tabId === 'string' ? result.tabId : typeof progress?.tabId === 'string' ? progress.tabId : request?.tabId;
  const listedTabs = request?.action === 'tabs' && Array.isArray(decoded) ? decoded.flatMap((tab: unknown) => {
    if (!tab || typeof tab !== 'object' || !('tabId' in tab) || typeof tab.tabId !== 'string' || !tab.tabId || tab.tabId.length > 200) return [];
    return [{ tabId: tab.tabId, backend: 'backend' in tab && tab.backend === 'chrome' ? 'chrome' as const : backend,
      title: 'title' in tab && typeof tab.title === 'string' ? tab.title : '',
      url: 'url' in tab && typeof tab.url === 'string' && browserUrlSchema.safeParse(tab.url).success ? tab.url : undefined }];
  }) : undefined;
  const url = typeof page.url === 'string' && browserUrlSchema.safeParse(page.url).success ? page.url : undefined;
  const closed = item.state === 'done' && result.status === 'closed';
  const stage = item.state === 'running' ? typeof progress?.stage === 'string' ? localizeLabel(progress.stage) : tr('正在处理…') : item.state === 'error' ? localizeAppError(item.text) : closed ? tr('标签已关闭') : tr('操作完成');
  const waitLabels = { url: '等待网址包含：{p0}', text: '等待文本出现：{p0}', role: '等待控件出现：{p0}', ref: '等待页面引用：{p0}' } as const;
  const waiting = request?.action === 'wait' ? request.condition ? request.condition.kind === 'load' ? tr('等待页面加载完成') : tr(waitLabels[request.condition.kind], { p0: request.condition.value ?? '' }) : tr('等待 {p0} 毫秒', { p0: request.milliseconds ?? 0 }) : undefined;
  const show = async (targetId = tabId, targetBackend = backend) => {
    if (!targetId) return;
    setPending(true); setError('');
    try {
      if (targetBackend === 'chrome') await invoke({ op: 'browser.bridge.focus', sessionId: targetId.split('/')[0], tabId: targetId });
      else { await invoke({ op: 'browser.select', threadId: activeId, tabId: targetId }); patchThread(selectPanelTab({ id: targetId, kind: 'browser' })); patchUi({ reviewOpen: true }); }
    } catch (reason) { setError(localizeAppError(String(reason))); }
    finally { setPending(false); }
  };
  return <section className="browser-tool-feedback structured-tool-result" aria-label={tr('浏览器操作结果')}>
    <div className="row"><span>{backend === 'chrome' ? 'Chrome' : tr('内置浏览器')}</span>{tabId && !closed && <Button size="sm" disabled={pending} onClick={() => void show()}>{tr('打开浏览器查看')}</Button>}</div>
    {typeof page.title === 'string' && <strong>{page.title}</strong>}
    {url && <p className="hint">{url}</p>}
    <p role="status">{stage}</p>
    {waiting && <p className="hint">{waiting}</p>}
    {error && <p role="alert">{error}</p>}
    {listedTabs && <div aria-label={tr('浏览器标签列表')} className="structured-tool-result">
      {listedTabs.length ? listedTabs.map(tab => <div className="tool-resource" key={tab.backend + '/' + tab.tabId}>
        <div className="row"><strong>{tab.title || tr('未命名标签')}</strong><Button size="sm" disabled={pending} onClick={() => void show(tab.tabId, tab.backend)}>{tr('打开浏览器查看')}</Button></div>
        {tab.url && <p className="hint">{tab.url}</p>}
      </div>) : <p className="hint">{tr('当前任务没有可用的浏览器标签')}</p>}
    </div>}
    {typeof page.text === 'string' && <details><summary>{tr('页面检查结果')}</summary><pre>{page.text}</pre></details>}
    {Array.isArray(page.elements) && <details><summary>{tr('可交互元素 {p0}', { p0: page.elements.length })}</summary><pre>{JSON.stringify(page.elements, null, 2)}</pre></details>}
    {item.toolResult?.result.content.map((block, index) => { const image = resultImage(block); return image && <figure key={index}><img src={'data:' + image.mimeType + ';base64,' + image.data} alt={tr('浏览器截图')} loading="lazy" /></figure>; })}
  </section>;
}
