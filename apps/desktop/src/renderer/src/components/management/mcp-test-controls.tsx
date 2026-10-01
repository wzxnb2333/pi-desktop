import { useEffect, useRef, useState } from 'react';
import type { DesktopRequest, McpConfig } from '../../../../shared/contracts.ts';
import type { OperationRecord } from '../../../../shared/operations.ts';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button } from '../primitives/button.tsx';

export function useMcpTest(server: McpConfig, operations: OperationRecord[], invoke: (request: DesktopRequest) => Promise<unknown>, revision = 0) {
  const [requestId, setRequestId] = useState<string>();
  const [observed, setObserved] = useState<{ id: string; configuration: string }>();
  const configuration = JSON.stringify([server, revision]);
  const [cancelling, setCancelling] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), cancelPending = useRef(false), alive = useRef(true);
  const records = operations.filter(item => item.kind === 'mcp.test' && item.directoryId === server.id && !item.threadId);
  const operation = records.findLast(item => item.status === 'running') ?? records.find(item => item.id === (requestId ?? observed?.id))
    ?? (!requestId && records.at(-1)?.status === 'interrupted' ? records.at(-1) : undefined);
  const busy = !!requestId || operation?.status === 'running';
  const trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (operation) { setObserved({ id: operation.id, configuration }); setError(''); } }, [operation?.id]);
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) trigger.current?.focus();
    }
  }, [busy]);
  const run = async () => {
    if (pending.current || busy) throw new Error(tr('此操作正在运行'));
    pending.current = true;
    const id = crypto.randomUUID(); setRequestId(id); setError('');
    try {
      return await invoke({ op: 'mcp.test', id: server.id, requestId: id,
        base: { ...server, name: server.name.trim(), command: server.command.trim(), url: server.url.trim() } });
    } finally { pending.current = false; if (alive.current) setRequestId(undefined); }
  };
  const cancel = async () => {
    const id = operation?.status === 'running' ? operation.id : requestId;
    if (!id || cancelPending.current) return;
    cancelPending.current = true; setCancelling(true); setError(''); restoreFocus.current = true;
    try { await invoke({ op: 'mcp.testCancel', requestId: id }); }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { cancelPending.current = false; if (alive.current) setCancelling(false); }
  };
  return { run, cancel, busy, cancelling, error, operation, trigger, current: observed?.configuration === configuration };
}

export function McpTestProgress({ connection, showResult = true }: { connection: ReturnType<typeof useMcpTest>; showResult?: boolean }) {
  useLocale();
  const { operation, busy, error, cancelling } = connection;
  const completed = !busy && connection.current && showResult ? operation : undefined;
  if (!busy && !completed && !error) return null;
  return <div className="mcp-test-progress">
    {busy && <div className="row"><span role="status" className="hint">{operation ? localizeLabel(operation.stage) : tr('连接测试中…')}</span>
      <Button size="sm" aria-disabled={cancelling || undefined} onClick={() => void connection.cancel()}>{tr('取消连接测试')}</Button></div>}
    {completed?.status === 'interrupted' && <p role="status" className="hint">{tr('连接测试已中断，可以重新测试')}</p>}
    {completed?.status === 'cancelled' && <p role="status" className="hint">{tr('已取消连接测试')}</p>}
    {completed?.status === 'succeeded' && <p role="status" className="hint">{tr('连接测试成功（测试连接已关闭）')}</p>}
    {completed?.status === 'failed' && <p role="alert" className="form-feedback" data-error>{localizeAppError(completed.error ?? '连接测试失败，请重试')}</p>}
    {error && <p role="alert" className="form-feedback" data-error>{localizeAppError(error)}</p>}
  </div>;
}
