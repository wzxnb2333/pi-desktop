import { useCallback, useEffect, useRef, useState } from 'react';
import type { DesktopData, DesktopRequest } from '../../shared/contracts.ts';
import type { ChromeBridgeStatus } from '../../shared/browser-bridge.ts';
import { tr } from '../../shared/localization.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { SettingsSection } from './SettingsSection.tsx';

type Invoke = (request: DesktopRequest) => Promise<unknown>;
function statusOf(value: unknown): ChromeBridgeStatus {
  if (!value || typeof value !== 'object') throw new Error('Chrome 桥接状态无效');
  return value as ChromeBridgeStatus;
}

export function BrowserSettings({ data, invoke, initialThreadId = data.ui.activeThreadId }: { data: DesktopData; invoke: Invoke; initialThreadId?: string }) {
  const [status, setStatus] = useState<ChromeBridgeStatus | null>(null);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const threads = data.threads.filter(thread => !thread.deletedAt && !thread.archived && !thread.subtaskId && !thread.review && !thread.sidechat);
  const [threadId, setThreadId] = useState(threads.find(thread => thread.id === initialThreadId)?.id ?? threads[0]?.id ?? '');
  const selectedThread = threads.find(thread => thread.id === threadId);
  const selectedThreadBlocksBrowser = Boolean(selectedThread?.planMode || selectedThread?.policy === 'deny');
  const [pending, setPending] = useState(false);
  const statusRevision = useRef(0);
  const readStatus = useCallback(async () => {
    const revision = ++statusRevision.current;
    try {
      const value = await invoke({ op: 'browser.bridge.status' });
      if (revision === statusRevision.current) setStatus(statusOf(value));
    } catch (reason) {
      if (revision === statusRevision.current) throw reason;
    }
  }, [invoke]);
  const refresh = () => void readStatus().catch(reason => setError(reason instanceof Error ? reason.message : String(reason)));
  useEffect(() => {
    let active = true;
    const update = () => void readStatus().catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    update();
    const unsubscribe = typeof window.desktop?.onEvent === 'function' ? window.desktop.onEvent(event => { if (event.type === 'browser.bridge') update(); }) : undefined;
    const timer = window.setInterval(update, 3000);
    return () => { active = false; ++statusRevision.current; unsubscribe?.(); window.clearInterval(timer); };
  }, [readStatus]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const perform = async (request: DesktopRequest) => {
    setPending(true); setError('');
    try { await invoke(request); await readStatus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  };
  return <>
    <SettingsSection title={tr('Chrome 浏览器连接')} description={tr('通过本机 Loopback 桥接控制已授权的 Chrome 标签；不会读取 Cookie、密码或浏览器私密存储。')}>
      <FieldRow label={tr('连接状态')} description={status?.running ? `127.0.0.1:${status.port}` : tr('桥接服务未运行')}>
        <Button size="sm" disabled={pending} onClick={() => void perform({ op: 'browser.bridge.pair' })}>{tr('生成配对码')}</Button>
      </FieldRow>
      {status?.pairing && status.pairing.expiresAt > now && <FieldRow label={tr('一次性配对码')} description={tr('在 Pi Desktop Browser Bridge 扩展中输入，五分钟后过期。') + ' ' + tr('配对码剩余 {p0} 秒', { p0: Math.max(0, Math.ceil((status.pairing.expiresAt - now) / 1000)) })}>
        <code className="settings-secret-value">{status.pairing.code}</code>
      </FieldRow>}
      {status?.sessions.map(session => <FieldRow key={session.id} label={`Chrome · ${session.version}`} description={tr('已连接浏览器标签')}>
        <Button size="sm" disabled={pending} onClick={() => void perform({ op: 'browser.bridge.disconnect', sessionId: session.id })}>{tr('断开')}</Button>
      </FieldRow>)}
      {status?.sessions.flatMap(session => session.tabs.map(tab => {
        const ownedBySelectedThread = tab.ownerThreadId === threadId;
        const grantDisabled = pending || !selectedThread || (selectedThreadBlocksBrowser && !ownedBySelectedThread) || Boolean(tab.ownerThreadId && !ownedBySelectedThread);
        return <FieldRow key={session.id + tab.tabId} label={tab.title || tr('未命名标签')} description={tab.url}>
        <Button size="sm" onClick={() => void invoke({ op: 'browser.bridge.focus', sessionId: session.id, tabId: tab.tabId }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))}>{tr('打开浏览器查看')}</Button>
        <Button size="sm" title={selectedThreadBlocksBrowser && !ownedBySelectedThread ? tr('当前任务权限禁止浏览器操作') : undefined} disabled={grantDisabled} onClick={() => void perform({ op: 'browser.bridge.grant', threadId, tabId: tab.tabId, allowed: !ownedBySelectedThread })}>
          {tab.ownerThreadId === threadId ? tr('撤销任务授权') : tab.ownerThreadId ? tr('已授权给其他任务') : tr('授权给当前任务')}
        </Button>
      </FieldRow>;
      }))}
      {!status?.sessions.length && <p className="hint">{tr('尚未连接 Chrome 扩展。')}</p>}
      {Boolean(status?.sessions.length) && <Button size="sm" disabled={pending} onClick={() => void perform({ op: 'browser.bridge.disconnect' })}>{tr('断开全部连接')}</Button>}
      {status && <p className="hint">{tr('扩展协议版本 {p0}', { p0: status.protocol })}</p>}
    </SettingsSection>
    <SettingsSection title={tr('任务授权')} description={tr('Chrome 标签必须逐任务授权；切换任务不会继承其他任务的标签权限。')}>
      <FieldRow label={tr('当前任务')} description={selectedThreadBlocksBrowser ? tr('当前任务权限禁止浏览器操作') : undefined}>
        <Menu id="settings-browser-thread" label={tr('当前任务')} value={threadId} matchTriggerWidth className="settings-select" options={threads.map(thread => ({ value: thread.id, label: thread.title }))} onChange={setThreadId} />
      </FieldRow>
    </SettingsSection>
    {error && <p role="alert" className="form-feedback" data-error="true">{error} <Button size="sm" disabled={pending} onClick={refresh}>{tr('重试读取连接状态')}</Button></p>}
  </>;
}
