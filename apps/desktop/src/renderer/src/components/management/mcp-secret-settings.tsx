import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { DesktopRequest, McpConfig } from '../../../../shared/contracts.ts';
import { mcpSecretEntries } from '../../../../shared/mcp-configuration.ts';
import { mcpSecretStatusSchema } from '../../../../shared/mcp-schema.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button, IconButton } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { UnsavedNavigation, type RegisterViewGuard } from '../primitives/unsaved-navigation.tsx';

type CredentialRow = { id: string; name: string; value: string };
const emptyRow = (): CredentialRow => ({ id: crypto.randomUUID(), name: '', value: '' });

export function McpSecretSettings({ server, invoke, disabled = false, registerViewGuard }: {
  server: McpConfig; invoke: (request: DesktopRequest) => Promise<unknown>; disabled?: boolean; registerViewGuard?: RegisterViewGuard;
}) {
  useLocale();
  const [open, setOpen] = useState(false), [rows, setRows] = useState<CredentialRow[]>(() => [emptyRow()]);
  const [base, setBase] = useState(server), [configured, setConfigured] = useState<boolean>();
  const [reading, setReading] = useState(false), [saving, setSaving] = useState(false);
  const [readError, setReadError] = useState(''), [error, setError] = useState(''), [feedback, setFeedback] = useState<'连接凭据已保存' | '连接凭据已清除'>();
  const [confirm, setConfirm] = useState<'clear' | 'rebase'>();
  const pending = useRef(false), readPending = useRef(false), generation = useRef(0), alive = useRef(true);
  const configuration = JSON.stringify(server), current = useRef(configuration); current.current = configuration;
  const dirty = rows.some(row => row.name !== '' || row.value !== '');
  const conflict = dirty && JSON.stringify(base) !== configuration;
  const registerDraftGuard = useCallback<RegisterViewGuard>(guard => registerViewGuard?.((proceed, cancel) => guard(() => {
    setRows([emptyRow()]); setError(''); setFeedback(undefined); proceed();
  }, cancel)) ?? (() => {}), [registerViewGuard]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const readStatus = async () => {
    if (disabled || readPending.current || pending.current) return;
    readPending.current = true; setReading(true); const request = ++generation.current;
    try {
      const parsed = mcpSecretStatusSchema.safeParse(await invoke({ op: 'mcp.secretStatus', id: server.id, base: server }));
      if (!parsed.success) throw new Error('凭据状态无效，请重试');
      const result = parsed.data;
      if (alive.current && request === generation.current && current.current === configuration) { setConfigured(result.configured); setReadError(''); }
    } catch (reason) {
      if (alive.current && request === generation.current) setReadError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (alive.current && request === generation.current) { readPending.current = false; setReading(false); } }
  };
  useEffect(() => {
    setConfigured(undefined); setReadError(''); setFeedback(undefined); setReading(false); setConfirm(undefined);
    if (open && !disabled) void readStatus();
    return () => { generation.current++; readPending.current = false; };
  }, [configuration, open, disabled]);
  const edit = (id: string, patch: Partial<CredentialRow>) => {
    if (!dirty) setBase(server);
    setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row)); setError(''); setFeedback(undefined);
  };
  const save = async (clear = false) => {
    if (disabled || pending.current || (!clear && (!dirty || conflict))) return;
    pending.current = true; setSaving(true); setError(''); setFeedback(undefined); setConfirm(undefined);
    generation.current++; readPending.current = false; setReading(false);
    try {
      const value = clear ? {} : mcpSecretEntries(rows.filter(row => row.name !== '' || row.value !== '').map(row => [row.name, row.value]), server.transport);
      await invoke({ op: 'mcp.secret', id: server.id, value, base: clear ? server : base });
      if (alive.current && current.current === configuration) {
        setRows([emptyRow()]); setBase(server); setConfigured(!clear); setReadError('');
        setFeedback(clear ? '连接凭据已清除' : '连接凭据已保存');
      }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { pending.current = false; if (alive.current) setSaving(false); }
  };
  return <details className="mcp-secret-settings" onToggle={event => setOpen(event.currentTarget.open)} aria-busy={saving || reading || undefined}>
    <summary>{tr('连接凭据')}</summary>
    <UnsavedNavigation register={registerDraftGuard} dirty={dirty} busy={saving} />
    <p className="hint">{tr('保存会替换该服务的全部连接凭据。已保存的值不会回显；留空不修改。')}</p>
    {disabled && <p className="hint">{tr('启用插件后可管理连接凭据')}</p>}
    <div className="row mcp-secret-status">
      <span className="hint">{reading ? tr('读取凭据状态…') : configured === undefined ? '' : configured ? tr('已保存连接凭据') : tr('未保存连接凭据')}</span>
      <Button size="sm" disabled={disabled || saving || reading} onClick={() => void readStatus()}>{tr('刷新凭据状态')}</Button>
    </div>
    {readError && <p role="alert" className="form-feedback" data-error>{localizeAppError(readError)}</p>}
    <fieldset className="mcp-secret-fields" disabled={disabled || saving}>
      <legend className="sr-only">{tr('连接凭据')}</legend>
      {rows.map((row, index) => <div className="mcp-secret-row" key={row.id}>
        <input aria-label={tr('凭据名称 {p0}', { p0: index + 1 })} placeholder={tr(server.transport === 'stdio' ? '环境变量名称' : '请求头名称')} value={row.name}
          maxLength={256} autoComplete="off" spellCheck={false} onChange={event => edit(row.id, { name: event.target.value })} />
        <input aria-label={tr('凭据值 {p0}', { p0: index + 1 })} placeholder={tr('凭据值')} type="password" value={row.value}
          maxLength={16000} autoComplete="new-password" spellCheck={false} onChange={event => edit(row.id, { value: event.target.value })} />
        <IconButton size="sm" label={tr('移除凭据 {p0}', { p0: index + 1 })} onClick={() => { setRows(previous => previous.length === 1 ? [emptyRow()] : previous.filter(item => item.id !== row.id)); setError(''); }}>
          <X size={14} aria-hidden="true" />
        </IconButton>
      </div>)}
      <div className="row">
        <Button size="sm" disabled={rows.length >= 100} onClick={() => setRows(previous => [...previous, emptyRow()])}>{tr('添加凭据')}</Button>
        <Button size="sm" disabled={!dirty || conflict} onClick={() => void save()}>{tr('保存连接凭据')}</Button>
        <Button size="sm" disabled={!configured || dirty} onClick={() => setConfirm('clear')}>{tr('清除连接凭据')}</Button>
      </div>
    </fieldset>
    {conflict && <div><p role="alert" className="form-feedback" data-error>{tr('连接配置已变化，草稿已保留。请核对新配置后再保存。')}</p>
      <Button size="sm" disabled={disabled || saving} onClick={() => setConfirm('rebase')}>{tr('使用当前连接配置')}</Button></div>}
    <p className="hint">{tr('凭据仅由主进程加密保存，下次任务运行生效。')}</p>
    {feedback && <p role="status" className="form-feedback">{tr(feedback)}</p>}
    {error && <p role="alert" className="form-feedback" data-error>{localizeAppError(error)}</p>}
    {confirm && <ConfirmDialog title={tr(confirm === 'clear' ? '清除已保存的连接凭据？' : '将当前草稿用于此连接？')}
      description={confirm === 'clear' ? tr('清除仅影响该服务的请求头或环境变量，不撤销 OAuth。运行中的任务保留原凭据。') : server.name + ' · ' + (server.transport === 'http' ? server.url : server.command + ' ' + server.args.join(' '))}
      confirmLabel={tr(confirm === 'clear' ? '清除连接凭据' : '使用当前连接配置')} danger initialFocus="cancel" onCancel={() => setConfirm(undefined)}
      onConfirm={() => { if (confirm === 'clear') void save(true); else { setBase(server); setError(''); setConfirm(undefined); } }} />}
  </details>;
}
