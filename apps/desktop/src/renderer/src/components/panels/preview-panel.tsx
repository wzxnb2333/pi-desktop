import { localizeAppError, tr } from "../../../../shared/localization.ts";
import { useLocale } from "../../hooks/use-locale.ts";
import { ArrowLeft, ArrowRight, MoreVertical, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { browserAddress } from '../../../../shared/browser-address.ts';
import type { DesktopEvent, DesktopRequest } from '../../../../shared/contracts.ts';
import { useApp } from '../../state/app.tsx';
import { IconButton } from '../primitives/icon-button.tsx';
import { Menu } from '../primitives/menu.tsx';
import { BrowserFindBar } from './browser-find.tsx';
import { BrowserSites } from './browser-sites.tsx';
import { BrowserAnnotationsPanel } from './browser-annotations.tsx';
import { BrowserHistoryPanel } from './browser-history.tsx';
import { BrowserAddressInput } from './browser-address-input.tsx';
type PageState = Extract<DesktopEvent, { type: 'browser' }>;
type Download = Extract<DesktopEvent, { type: 'download' }>;
const findOpenByThread = new Set<string>();
export function PreviewPanel({ active = true, pending = false, launcher }: { active?: boolean; pending?: boolean; launcher?: ReactNode }) {
  useLocale();
  const { act, invoke, activeId, threadUi, patchThread, approvals } = useApp();
  const api = useRef(act); api.current = act;
  const surfaceRef = useRef<HTMLDivElement>(null);
  const tabs = threadUi.browserTabs ?? [];
  const selected = threadUi.activeBrowserTab ? tabs.find(tab => tab.id === threadUi.activeBrowserTab) : tabs[0];
  const identity = activeId + '/' + (selected?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, { text: string; dirty: boolean; error?: string }>>({});
  const [states, setStates] = useState<Record<string, PageState>>({});
  const [downloads, setDownloads] = useState<Record<string, Download>>({});
  const [feedback, setFeedback] = useState<{ identity: string; text: string }>();
  const composing = useRef(false);
  const changingTab = useRef(false);
  const [tabPending, setTabPending] = useState(false);
  const busy = pending || tabPending;
  const [snapshot, setSnapshot] = useState<{ identity: string; image: string }>();
  const errorId = useId();
  const [findOpen, setFindOpen] = useState(() => findOpenByThread.has(activeId));
  const [sitesOpen, setSitesOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState<'create' | 'list'>();
  const [historyOpen, setHistoryOpen] = useState<'history' | 'clear'>();
  useEffect(() => { setAnnotationsOpen(undefined); }, [activeId]);
  const state = selected && states[identity];
  const currentUrl = state?.url && state.url !== 'about:blank' ? state.url : selected?.url ?? '';
  const draft = drafts[identity];
  const address = draft?.text ?? currentUrl;
  const resetAddress = () => setDrafts(previous => { const next = { ...previous }; delete next[identity]; return next; });
  useEffect(() => { let current = true; void invoke({ op: 'browser.downloads' }).then(value => { if (current) setDownloads(previous => ({ ...Object.fromEntries((value as Download[]).map(item => [item.id, item])), ...previous })); }).catch(error => { if (current) setFeedback({ identity, text: tr("无法读取下载记录：") + String(error) }); }); return () => { current = false; }; }, [invoke]);
  useEffect(() => window.desktop.onEvent(event => {
    if (event.type === 'browser') setStates(previous => ({ ...previous, [event.threadId + '/' + event.tabId]: event }));
    if (event.type === 'download') setDownloads(previous => ({ ...previous, [event.id]: event }));
    if (event.type === 'preview.snapshot') setSnapshot({ identity: event.threadId + '/' + event.tabId, image: event.image });
  }), []);
  useEffect(() => { composing.current = false; }, [identity]);
  useEffect(() => { setDrafts(previous => { if (!previous[identity] || previous[identity].dirty) return previous; const next = { ...previous }; delete next[identity]; return next; }); }, [currentUrl, identity]);
  useEffect(() => {
    if (active && selected) api.current({ op: 'browser.select', threadId: activeId, tabId: selected.id });
    else api.current({ op: 'preview.close' });
  }, [activeId, selected?.id, active]);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !active) return;
    let previous = '';
    const sync = () => {
      const blocked = !!document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') || approvals.length > 0;
      const box = surface.getBoundingClientRect();
      const bounds = { x: Math.max(0, Math.round(box.x)), y: Math.max(0, Math.round(box.y)), width: Math.max(0, Math.round(box.width)), height: Math.max(0, Math.round(box.height)), occluded: blocked };
      const value = JSON.stringify(bounds);
      if (value !== previous) { previous = value; api.current({ op: 'preview.bounds', bounds }); }
    };
    const observer = new ResizeObserver(sync);
    const mutations = new MutationObserver(sync);
    observer.observe(surface);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'hidden'] });
    window.addEventListener('resize', sync);
    sync();
    return () => { observer.disconnect(); mutations.disconnect(); window.removeEventListener('resize', sync); api.current({ op: 'preview.close' }); };
  }, [active, activeId, selected?.id, approvals.length]);
  const action = (action: Extract<DesktopRequest, { op: 'browser.action' }>['action']) => { if (selected) act({ op: 'browser.action', threadId: activeId, tabId: selected.id, action }); };
  const changeTab = (action: Extract<DesktopRequest, { op: 'browser.tab' }>['action'], tabId?: string) => {
    if (changingTab.current || pending) return;
    changingTab.current = true;
    setTabPending(true);
    // The authoritative tab identity arrives with the IPC response. Do not route new input to the old tab meanwhile.
    void invoke({ op: 'browser.tab', threadId: activeId, action, tabId }).catch(() => {}).finally(() => {
      changingTab.current = false;
      setTabPending(false);
    });
  };
  const open = (raw = address) => {
    if (changingTab.current || pending) return;
    try {
      const url = browserAddress(raw);
      const id = selected?.id ?? crypto.randomUUID();
      setDrafts(previous => ({ ...previous, [identity]: { text: url, dirty: false } }));
      if (!selected) patchThread({ activeBrowserTab: id });
      act({ op: 'browser.open', threadId: activeId, tabId: id, url });
    } catch (error) {
      setDrafts(previous => ({ ...previous, [identity]: { text: address, dirty: true, error: error instanceof Error ? error.message : String(error) } }));
    }
  };
  return <div className="preview-panel" hidden={!active}>
    <form className="preview-toolbar panel-strip" aria-busy={busy} onSubmit={event => { event.preventDefault(); if (!composing.current && address.trim()) { event.currentTarget.querySelector('input')?.blur(); open(); } }}>
      <IconButton label={tr("后退")} size="sm" disabled={!state?.back} onClick={() => action('back')}><ArrowLeft size={14} /></IconButton>
      <IconButton label={tr("前进")} size="sm" disabled={!state?.forward} onClick={() => action('forward')}><ArrowRight size={14} /></IconButton>
      <IconButton label={state?.loading ? tr("停止加载") : tr("刷新预览")} size="sm" disabled={!selected?.url} onClick={() => action(state?.loading ? 'stop' : 'reload')}><RefreshCw size={14} /></IconButton>
      <BrowserAddressInput key={identity} value={address} error={!!draft?.error} errorId={errorId} composing={composing} disabled={busy} onChange={text => setDrafts(previous => ({ ...previous, [identity]: { text, dirty: true } }))} onOpen={open} onReset={resetAddress} />
      {draft?.dirty && <button className="browser-submit" type="submit" aria-label={tr("打开")} disabled={!address.trim() || busy}><ArrowRight size={16} /></button>}
      {state?.zoom !== undefined && state.zoom !== 1 && <output aria-label={tr("网页缩放")}>{Math.round(state.zoom * 100)}%</output>}
      <Menu label={tr("浏览器操作")} kind="action" value="" className="browser-overflow" size="sm" placeholder={<MoreVertical size={16} />} align="end" options={[
        { value: 'find', label: tr("网页内查找"), disabled: !selected?.url },
        { value: 'copy', label: tr("复制地址"), disabled: !currentUrl },
        { value: 'external', label: tr("外部打开"), disabled: !currentUrl },
        { value: 'restore', label: tr("恢复关闭标签"), disabled: busy },
        { value: 'zoomIn', label: tr("放大"), disabled: !selected?.url },
        { value: 'zoomOut', label: tr("缩小"), disabled: !selected?.url },
        { value: 'zoomReset', label: tr("恢复 100%"), disabled: !selected?.url },
        { value: 'permissions', label: tr("站点权限"), disabled: !selected?.url },
        { value: 'agentSites', label: tr('智能体网站访问') },
        { value: 'annotate', label: tr('标注当前网页'), disabled: !selected?.url },
        { value: 'annotations', label: tr('已保存的标注') },
        { value: 'history', label: tr('浏览历史') },
        { value: 'clearSite', label: tr("清除此站点数据"), disabled: !selected?.url },
        { value: 'clearData', label: tr('清除浏览数据') },
      ]} onChange={value => {
        if (value === 'find') { findOpenByThread.add(activeId); setFindOpen(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.browser-find input')?.focus()); }
        else if (value === 'agentSites') setSitesOpen(true);
        else if (value === 'annotate' || value === 'annotations') setAnnotationsOpen(value === 'annotate' ? 'create' : 'list');
        else if (value === 'history' || value === 'clearData') setHistoryOpen(value === 'history' ? 'history' : 'clear');
        else if (value === 'copy') void navigator.clipboard.writeText(currentUrl).then(() => setFeedback({ identity, text: tr("已复制当前网页地址") }), () => setFeedback({ identity, text: tr("复制失败，请在地址栏复制") }));
        else if (value === 'external') act({ op: 'external.open', url: currentUrl });
        else if (value === 'restore') changeTab('restore');
        else action(value as Extract<DesktopRequest, { op: 'browser.action' }>['action']);
      }} />
    </form>
    {draft?.error && <p id={errorId} className="browser-error" role="alert">{localizeAppError(draft.error)}</p>}
    {sitesOpen && <BrowserSites url={currentUrl} onClose={() => setSitesOpen(false)} />}
    {annotationsOpen && <BrowserAnnotationsPanel key={activeId} threadId={activeId} tabId={selected?.id ?? ''} create={annotationsOpen === 'create'} onClose={() => setAnnotationsOpen(undefined)} />}
    {historyOpen && <BrowserHistoryPanel key={activeId} threadId={activeId} tabId={selected?.id ?? ''} clear={historyOpen === 'clear'} onClose={() => setHistoryOpen(undefined)} />}
    <BrowserFindBar key={identity} threadId={activeId} tabId={selected?.id ?? ''} state={state?.find} enabled={!!selected?.url} open={findOpen || !!state?.find?.text} onClose={() => { findOpenByThread.delete(activeId); setFindOpen(false); }} />
    {feedback?.identity === identity && <p className="browser-feedback" role="status">{feedback.text}</p>}
    {state?.error && <p className="browser-error" role="alert">{state.error}<button onClick={() => action('reload')}>{tr("重试")}</button></p>}
    {Object.values(downloads).map(item => <div className="browser-download" key={item.id}><span>{item.name} · {item.received} / {item.total}  {tr("字节 ·")} {{ progressing: tr("下载中"), completed: tr("完成"), cancelled: tr("已取消"), interrupted: tr("下载中断") }[item.state]}</span>{(item.state === 'completed' || item.state === 'progressing') && <button onClick={() => act({ op: 'browser.download', id: item.id, action: item.state === 'completed' ? 'reveal' : 'cancel' })}>{item.state === 'completed' ? tr("打开所在目录") : tr("取消")}</button>}</div>)}
    <div ref={surfaceRef} className="preview-surface">{selected?.url
      ? <p>{state?.loading ? tr("正在加载…") : ''}</p>
      : launcher}
      {active && selected?.url && snapshot?.identity === identity && snapshot.image && <img className="preview-snapshot" src={snapshot.image} alt="" aria-hidden="true" draggable={false} />}
    </div>
  </div>;
}

