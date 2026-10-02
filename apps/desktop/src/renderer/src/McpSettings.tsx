import { localizeAppError, localizeLabel, tr } from "../../shared/localization.ts";
import { useLocale } from "./hooks/use-locale.ts";
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type DesktopData, type DesktopRequest, type McpConfig, type Thread, mcpStateSchema, mcpToolSchema } from '../../shared/contracts.ts';
import { type McpConfigurationErrors, mcpConfigurationErrors, parseMcpSecrets } from '../../shared/mcp-configuration.ts';
import { Button } from './components/primitives/button.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { McpOAuthControls } from './components/management/mcp-oauth-controls.tsx';
import { McpToolPolicies } from './components/management/mcp-tool-policies.tsx';
import { McpTestProgress, useMcpTest } from './components/management/mcp-test-controls.tsx';
import type { OperationRecord } from '../../shared/operations.ts';

type Tools = NonNullable<Thread['mcp']>[number]['tools'];
type Result = { state: 'pending' | 'success' | 'error' | 'cancelled'; text: string; tools?: Tools };
type Invoke = (request: DesktopRequest) => Promise<unknown>;

function ToolList({ tools }: { tools: Tools }) {
  useLocale();
  return <div className="mcp-tools">{tools.map(tool => <details key={tool.name}>
    <summary>{tool.label ?? tool.name}</summary>
    <p>{tool.description}</p>
    {tool.label && <p className="hint">{tr("调用标识：")}<code>{tool.name}</code></p>}
  </details>)}</div>;
}

function TaskConnection({ thread, serverId, invoke, blocked, operations }: {
  thread: Thread; serverId: string; invoke: Invoke; blocked: boolean; operations: OperationRecord[];
}) {
  useLocale();
  const connection = thread.mcp?.find(item => item.id === serverId);
  const [result, setResult] = useState<Result | null>(null);
  const [requestId, setRequestId] = useState<string>();
  const [observedId, setObservedId] = useState<string>();
  const [cancelling, setCancelling] = useState(false), [cancelError, setCancelError] = useState('');
  const cancelPending = useRef(false);
  const records = operations.filter(item => item.kind === 'mcp.retry' && item.threadId === thread.id);
  const operation = records.findLast(item => item.status === 'running') ?? records.find(item => item.id === (requestId ?? observedId))
    ?? (!requestId && records.at(-1)?.status === 'interrupted' ? records.at(-1) : undefined);
  const reconnecting = !!requestId || operation?.status === 'running';
  const trigger = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { generation.current++; setResult(null); }, [blocked]);
  useEffect(() => { if (operation) { setObservedId(operation.id); setCancelError(''); } }, [operation?.id]);
  useEffect(() => {
    if (!reconnecting && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) trigger.current?.focus();
    }
  }, [reconnecting]);
  const retry = async () => {
    if (pending.current || reconnecting || blocked || ['running', 'waiting'].includes(thread.status)) return;
    pending.current = true;
    const id = crypto.randomUUID(); setRequestId(id); setCancelError('');
    const request = ++generation.current;
    setResult({ state: 'pending', text: '正在重新连接任务工具…' });
    try {
      const response = await invoke({ op: 'mcp.retry', threadId: thread.id, requestId: id });
      if (response === null) {
        if (alive.current && request === generation.current) setResult({ state: 'cancelled', text: '已取消任务工具重连' });
        return;
      }
      const connections = mcpStateSchema.array().parse(response);
      const updated = connections.find(item => item.id === serverId);
      if (alive.current && request === generation.current) setResult(updated?.state === 'connected'
        ? { state: 'success', text: '任务工具已重新连接' }
        : { state: 'error', text: updated?.error || '此服务未连接；请检查项目可信度、计划模式、执行策略及服务开关。' });
    } catch (error) {
      if (alive.current && request === generation.current) setResult({ state: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally { pending.current = false; if (alive.current) setRequestId(undefined); }
  };
  const cancel = async () => {
    const id = operation?.status === 'running' ? operation.id : requestId;
    if (!id || cancelPending.current) return;
    cancelPending.current = true; setCancelling(true); setCancelError(''); restoreFocus.current = true;
    try { await invoke({ op: 'operation.cancel', threadId: thread.id, requestId: id }); }
    catch (error) { if (alive.current) setCancelError(error instanceof Error ? error.message : String(error)); }
    finally { cancelPending.current = false; if (alive.current) setCancelling(false); }
  };
  if (!connection) return null;
  return <details className="mcp-connection">
    <summary>{thread.title} · {{ connecting: tr("正在连接"), connected: tr("已连接"), error: tr("连接异常"), disconnected: tr("未连接") }[connection.state]}</summary>
    {connection.error && <p className="form-feedback" data-error="true">{connection.error}</p>}
    <ToolList tools={connection.tools} />
    {!!connection.tools.length && connection.state !== 'connected' && <p className="hint">{tr("上次加载的工具；当前连接不可用。")}</p>}
    <div className="row"><Button ref={trigger} size="sm" disabled={blocked || ['running', 'waiting'].includes(thread.status)} aria-disabled={reconnecting || undefined} onClick={() => void retry()}>
      {reconnecting ? tr("正在重新连接…") : tr("重新连接任务工具")}
    </Button>{reconnecting && <Button size="sm" aria-disabled={cancelling || undefined} onClick={() => void cancel()}>{tr('取消任务工具重连')}</Button>}</div>
    {reconnecting && <p role="status" className="hint">{localizeLabel(operation?.stage ?? '正在重新连接任务工具…')}</p>}
    {cancelError && <p role="alert" className="form-feedback" data-error>{localizeAppError(cancelError)}</p>}
    {!reconnecting && !blocked && !result && operation?.status === 'interrupted' && <p role="status" className="hint">{tr('任务工具重连已中断，可以重新连接')}</p>}
    {!reconnecting && !blocked && !result && operation?.status === 'cancelled' && <p role="status" className="hint">{tr('已取消任务工具重连')}</p>}
    {!reconnecting && !blocked && !result && operation?.status === 'failed' && <p role="alert" className="form-feedback" data-error>{localizeAppError(operation.error ?? '任务工具重连失败，请重试')}</p>}
    {blocked && <p className="hint">{tr("先保存或撤回此服务的配置改动，再重新连接任务工具。")}</p>}
    {result && result.state !== 'pending' && (result.state !== 'success' || connection.state === 'connected') && <p role={result.state === 'error' ? 'alert' : 'status'} className="form-feedback" data-error={result.state === 'error' || undefined}>{localizeAppError(result.text)}</p>}
  </details>;
}

function McpServerCard({ server, saved, threads, secret, onSecret, onChange, onRemove, persist, invoke, onFeedback, running, operations, settings, policies, onPoliciesChange }: {
  server: McpConfig; saved?: McpConfig; threads: Thread[]; secret: string;
  onSecret(value: string): void; onChange(value: McpConfig): void; onRemove(): void;
  persist(): Promise<boolean>; invoke: Invoke; onFeedback(text: string, error: boolean): void; running: boolean;
  operations: OperationRecord[];
  settings: DesktopData['settings'];
  policies?: DesktopData['settings']['mcpToolPolicies'][string]; onPoliciesChange?: (policies: DesktopData['settings']['mcpToolPolicies'][string]) => void;
}) {
  useLocale();
  const [result, setResult] = useState<Result | null>(null);
  const [errors, setErrors] = useState<McpConfigurationErrors>({});
  const [busy, setBusy] = useState(false);
  const configurationRevision = useRef(0);
  const connection = useMcpTest(server, operations, invoke, configurationRevision.current);
  const generation = useRef(0);
  const pending = useRef(false);
  const alive = useRef(true);
  const card = useRef<HTMLElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  const invalidate = () => { configurationRevision.current++; generation.current++; setResult(null); setErrors({}); };
  const patch = (value: Partial<McpConfig>) => { invalidate(); onChange({ ...server, ...value }); };
  const inputId = (field: keyof McpConfigurationErrors) => 'mcp-' + server.id + '-' + field;
  const fieldError = (field: keyof McpConfigurationErrors) => errors[field]
    ? <span id={inputId(field) + '-error'} className="mcp-field-error">{errors[field]}</span> : null;
  const validity = (field: keyof McpConfigurationErrors) => ({ 'aria-invalid': !!errors[field], 'aria-describedby': errors[field] ? inputId(field) + '-error' : undefined });
  const test = async () => {
    if (pending.current || connection.busy || running) return;
    const nextErrors = mcpConfigurationErrors(server, true);
    try { parseMcpSecrets(secret); } catch (error) { nextErrors.secret = (error as Error).message; }
    setErrors(nextErrors);
    const first = Object.keys(nextErrors)[0] as keyof McpConfigurationErrors | undefined;
    if (first) {
      card.current?.querySelector<HTMLInputElement>('[id="' + inputId(first) + '"]')?.focus();
      setResult({ state: 'error', text: tr("请先修正服务配置。") });
      return;
    }
    const request = ++generation.current;
    const current = () => alive.current && request === generation.current;
    pending.current = true;
    setBusy(true);
    setResult({ state: 'pending', text: tr("连接测试中…") });
    try {
      if (!await persist()) {
        if (current()) setResult({ state: 'cancelled', text: tr("设置正在保存，请稍后重试。") });
        return;
      }
      if (!current()) return;
      const response = await connection.run();
      if (!current()) return;
      if (response === null) { setResult({ state: 'cancelled', text: tr("已取消连接测试") }); onFeedback(tr("已取消"), false); }
      else {
        const parsed = mcpToolSchema.array().safeParse(response);
        if (!parsed.success) throw new Error(tr("MCP 测试返回的数据格式无效，请重试连接"));
        setResult({ state: 'success', text: tr("连接测试成功（测试连接已关闭）"), tools: parsed.data });
        onFeedback(tr("连接成功：") + parsed.data.length + tr(" 个工具（测试连接已关闭）"), false);
      }
    } catch (error) {
      if (current()) {
        const text = error instanceof Error ? error.message : String(error);
        setResult({ state: 'error', text: tr("连接失败：") + text });
        onFeedback(text, true);
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const dirty = !saved || JSON.stringify(server) !== JSON.stringify(saved) || !!secret.trim();
  return <section ref={card} className="config-card mcp-server" aria-label={tr("MCP 服务 ") + (server.name || tr("未命名"))}>
    <h3>{server.name || tr("未命名服务")}<span className="badge">{server.transport === 'stdio' ? 'stdio' : 'Streamable HTTP'}</span></h3>
    <div className="field-stack">
      <h4 className="settings-subheading">{tr('服务连接')}</h4>
      <FieldRow label={tr("名称")} htmlFor={inputId('name')}><input id={inputId('name')} value={server.name} onChange={e => patch({ name: e.target.value })} {...validity('name')} />{fieldError('name')}</FieldRow>
      <FieldRow label={tr("传输")} description={tr("本地进程或远程端点")}>
        <Menu id={'mcp-' + server.id + '-transport'} label={tr("传输")} value={server.transport} matchTriggerWidth className="settings-select"
          options={[{ value: 'stdio', label: 'stdio' }, { value: 'http', label: 'Streamable HTTP' }]}
          onChange={value => patch({ transport: value as McpConfig['transport'] })} />
      </FieldRow>
      {server.transport === 'stdio' ? <>
        <FieldRow label={tr("命令")} htmlFor={inputId('command')} description={tr("在启动时执行的程序")}>
          <input id={inputId('command')} value={server.command} onChange={e => patch({ command: e.target.value })} {...validity('command')} />{fieldError('command')}
        </FieldRow>
        <div className="field-block"><label htmlFor={'mcp-' + server.id + '-args'}>{tr("参数")}<small>{tr("每行一个")}</small></label>
          <textarea id={'mcp-' + server.id + '-args'} className="code-input" rows={3} value={server.args.join('\n')}
            onChange={e => patch({ args: e.target.value ? e.target.value.split('\n') : [] })} />
        </div>
      </> : <FieldRow label="URL" htmlFor={inputId('url')} description={tr("Streamable HTTP 端点")}>
        <input id={inputId('url')} value={server.url} onChange={e => patch({ url: e.target.value })} {...validity('url')} />{fieldError('url')}
      </FieldRow>}
      <h4 className="settings-subheading">{tr('授权与凭据')}</h4>
      {server.transport === 'http' && <>
        <FieldRow label={tr('使用 OAuth 登录')} htmlFor={'mcp-' + server.id + '-oauth'}><input id={'mcp-' + server.id + '-oauth'} type="checkbox" checked={!!server.oauth} onChange={event => patch({ oauth: event.target.checked ? { clientId: '', scope: '' } : undefined })} /></FieldRow>
        {server.oauth && <>
          <FieldRow label={tr('OAuth 客户端 ID')} htmlFor={'mcp-' + server.id + '-client'} description={tr('留空使用服务端动态注册')}><input id={'mcp-' + server.id + '-client'} value={server.oauth.clientId} onChange={event => patch({ oauth: { ...server.oauth!, clientId: event.target.value } })} /></FieldRow>
          <FieldRow label={tr('授权范围')} htmlFor={'mcp-' + server.id + '-scope'}><input id={'mcp-' + server.id + '-scope'} value={server.oauth.scope} onChange={event => patch({ oauth: { ...server.oauth!, scope: event.target.value } })} /></FieldRow>
        </>}
      </>}
      <FieldRow label={tr("启用")} htmlFor={'mcp-' + server.id + '-enabled'} description={tr("只在信任项目中连接")}>
        <input id={'mcp-' + server.id + '-enabled'} type="checkbox" checked={server.enabled} onChange={e => patch({ enabled: e.target.checked })} />
      </FieldRow>
      <FieldRow label={tr("加密环境变量 / HTTP 请求头（JSON）")} htmlFor={inputId('secret')} description={tr("以 Windows 用户账户加密保存，留空保持不变；填 {} 清空")}>
        <input id={inputId('secret')} type="password" autoComplete="off" value={secret} onChange={e => { invalidate(); onSecret(e.target.value); }} placeholder={'{"TOKEN":"…"}'} {...validity('secret')} />{fieldError('secret')}
      </FieldRow>
    </div>
    <div className="row">
      <Button ref={connection.trigger} size="sm" disabled={running} aria-disabled={busy || connection.busy || undefined} onClick={() => void test()}>
        {busy || connection.busy ? tr("连接测试中…") : result?.state === 'error' ? tr("重试连接") : tr("保存并测试")}
      </Button>
      <Button size="sm" variant="danger" onClick={onRemove}><Trash2 size={14} />{tr("删除")}</Button>
    </div>
    <McpTestProgress connection={connection} showResult={!result || result.state === 'pending'} />
    {server.transport === 'http' && server.oauth && <McpOAuthControls server={server} operations={operations} invoke={invoke} persist={persist} dirty={dirty} />}
    <McpToolPolicies server={server} settings={settings} operations={operations} value={policies} onChange={onPoliciesChange} tools={[...(result?.tools ?? []), ...threads.flatMap(thread => thread.mcp?.find(item => item.id === server.id)?.tools ?? [])]} invoke={invoke} persist={persist} configurationRevision={configurationRevision.current} />
    {busy && !result && <p className="hint">{tr("配置已修改，旧测试结果不会应用；当前测试结束后可重新测试。")}</p>}
    {result && !(result.state === 'pending' && connection.busy) && <div role="region" aria-label={tr("MCP 测试结果 ") + server.name} aria-live="polite" aria-busy={result.state === 'pending'}>
      <p className="form-feedback" data-error={result.state === 'error' || undefined}>{result.text}</p>
      {result.tools && <><p className="hint">{tr("已发现")} {result.tools.length}  {tr("个工具")}</p><ToolList tools={result.tools} /></>}
    </div>}
    {threads.filter(thread => !thread.deletedAt && thread.mcp?.some(item => item.id === server.id)).map(thread =>
      <TaskConnection key={thread.id} thread={thread} serverId={server.id} invoke={invoke} blocked={dirty} operations={operations} />)}
  </section>;
}

export function McpSettings({ data, servers, secrets, onChange, onSecret, persist, invoke, onFeedback, policies, onPoliciesChange }: {
  data: DesktopData; servers: McpConfig[]; secrets: Record<string, string>;
  onChange(servers: McpConfig[]): void; onSecret(id: string, value: string): void;
  persist(): Promise<boolean>; invoke: Invoke; onFeedback(text: string, error: boolean): void;
  policies?: DesktopData['settings']['mcpToolPolicies']; onPoliciesChange?: (policies: DesktopData['settings']['mcpToolPolicies']) => void;
}) {
  useLocale();
  const running = data.threads.some(thread => ['running', 'waiting'].includes(thread.status));
  const add = useRef<HTMLButtonElement>(null);
  return <div className="mcp-settings">
    <div className="section-heading"><div><h2>{tr("MCP 服务")}</h2><p className="hint">{tr("服务工具会映射到 Pi。仅在信任项目并允许执行时连接；配置改变将在空闲会话下次运行时加载，运行中需先停止任务。")}</p></div>
      <Button ref={add} onClick={() => onChange([...servers, { id: crypto.randomUUID(), name: tr("新服务"), enabled: false, transport: 'stdio', command: '', args: [], url: '' }])}><Plus size={15} />{tr("添加")}</Button>
    </div>
    {!servers.length && <div className="empty-card"><Plus size={26} /><h3>{tr("没有 MCP 服务")}</h3><p>{tr("添加 stdio 或 Streamable HTTP 服务，再测试连接。")}</p></div>}
    {servers.map(server => <McpServerCard key={server.id} server={server} saved={data.settings.mcpServers.find(item => item.id === server.id)} threads={data.threads}
      secret={secrets[server.id] ?? ''} onSecret={value => onSecret(server.id, value)}
      onChange={value => onChange(servers.map(item => item.id === server.id ? value : item))}
      onRemove={() => { onChange(servers.filter(item => item.id !== server.id)); onSecret(server.id, ''); add.current?.focus(); }}
      persist={persist} invoke={invoke} onFeedback={onFeedback} running={running} operations={data.operations} settings={data.settings}
      policies={policies?.[server.id] ?? (onPoliciesChange ? {} : undefined)} onPoliciesChange={onPoliciesChange ? value => onPoliciesChange({ ...policies, [server.id]: value }) : undefined} />)}
  </div>;
}
