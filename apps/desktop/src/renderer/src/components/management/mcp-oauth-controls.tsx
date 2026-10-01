import { useEffect, useRef, useState } from 'react';
import type { DesktopRequest, McpConfig } from '../../../../shared/contracts.ts';
import type { OperationRecord } from '../../../../shared/operations.ts';
import { mcpOAuthStatusSchema, type McpOAuthStatus } from '../../../../shared/mcp-schema.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button } from '../primitives/button.tsx';

export function McpOAuthControls({ server, operations, invoke, persist, dirty = false }: {
  server: McpConfig; operations: OperationRecord[]; invoke: (request: DesktopRequest) => Promise<unknown>; persist?: () => Promise<boolean>; dirty?: boolean;
}) {
  useLocale();
  const [status, setStatus] = useState<McpOAuthStatus>(); const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [statusError, setStatusError] = useState(''), [reading, setReading] = useState(false), [cancelling, setCancelling] = useState(false);
  const acting = useRef(false), cancelPending = useRef(false), readPending = useRef(false), readGeneration = useRef(0), alive = useRef(true);
  const loginButton = useRef<HTMLButtonElement>(null), retryButton = useRef<HTMLButtonElement>(null);
  const restoreStatusFocus = useRef(false);
  const identity = JSON.stringify([server.id, server.url, server.oauth]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const records = operations.filter(item => item.directoryId === server.id && item.kind.startsWith('mcp.oauth.'));
  // A failed concurrent attempt must not hide the login that still needs cancellation.
  const operation = records.findLast(item => item.status === 'running') ?? records.at(-1);
  const busy = pending || cancelling || operation?.status === 'running';
  const key = JSON.stringify([identity, dirty, operation?.id, operation?.status]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!statusError && restoreStatusFocus.current) {
      restoreStatusFocus.current = false;
      if (document.activeElement === document.body) loginButton.current?.focus();
    }
  }, [statusError]);
  const readStatus = async () => {
    if (readPending.current || dirty) return;
    readPending.current = true; setReading(true);
    const generation = ++readGeneration.current;
    const current = () => alive.current && generation === readGeneration.current;
    try {
      const value = mcpOAuthStatusSchema.parse(await invoke({ op: 'mcp.oauthStatus', id: server.id }));
      if (current()) {
        restoreStatusFocus.current = document.activeElement === retryButton.current;
        setStatus(value); setStatusError('');
      }
    } catch (reason) { if (current()) setStatusError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { if (current()) { readPending.current = false; setReading(false); } }
  };
  useEffect(() => {
    setStatus(undefined); setStatusError(''); setReading(false);
    if (!dirty) void readStatus();
    return () => { readGeneration.current++; readPending.current = false; };
  }, [key]);
  const action = async (action: 'login' | 'refresh' | 'revoke') => {
    if (busy || acting.current) return; acting.current = true; setPending(true); setError('');
    const current = () => alive.current && currentIdentity.current === identity;
    try {
      if (persist && !await persist()) return;
      if (!current()) return;
      await invoke({ op: 'mcp.oauthStart', id: server.id, action, requestId: crypto.randomUUID(), base: server });
    } catch (reason) { if (current()) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { acting.current = false; if (alive.current) setPending(false); }
  };
  const cancel = async () => {
    if (operation?.status !== 'running' || cancelPending.current) return;
    cancelPending.current = true; setCancelling(true); setError('');
    try { await invoke({ op: 'mcp.oauthCancel', requestId: operation.id }); }
    catch (reason) { if (alive.current && currentIdentity.current === identity) setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { cancelPending.current = false; if (alive.current) setCancelling(false); }
  };
  return <section className="mcp-oauth" aria-label={'OAuth · ' + server.name}>
    <p className="hint">{tr('仅主进程保存授权；运行中的任务不会因登录而重启。')}</p>
    {dirty && <p className="hint">{tr('请先保存 OAuth 配置')}</p>}
    {reading && <p role="status">{tr('读取授权状态…')}</p>}
    {status && <p role="status">OAuth · {{ disconnected: tr('未连接'), authorizing: tr('等待浏览器授权'), connected: tr('已授权'), expired: tr('授权已过期') }[status.state]}{status.expiresAt ? ' · ' + new Date(status.expiresAt).toLocaleString() : ''}</p>}
    <div className="row"><Button ref={loginButton} size="sm" disabled={busy} onClick={() => void action('login')}>{tr('保存并登录')}</Button>
      <Button size="sm" disabled={busy || dirty || !status || status.state === 'disconnected'} onClick={() => void action('refresh')}>{tr('刷新授权')}</Button>
      <Button size="sm" disabled={busy || dirty || !status || status.state === 'disconnected'} onClick={() => void action('revoke')}>{tr('撤销授权')}</Button>
      {operation?.status === 'running' && <Button size="sm" aria-disabled={cancelling || undefined} onClick={() => void cancel()}>{tr('取消授权')}</Button>}
    </div>
    {operation && <p role="status">{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[operation.status])}</p>}
    {statusError && <div><p role="alert" className="form-feedback" data-error>{statusError}</p><Button ref={retryButton} size="sm" aria-disabled={reading || busy || dirty || undefined}
      onClick={() => { if (!busy && !dirty) void readStatus(); }}>{tr('重试读取授权状态')}</Button></div>}
    {(error || operation?.error) && <p role="alert" className="form-feedback" data-error>{error || localizeAppError(operation?.error ?? '')}</p>}
  </section>;
}
