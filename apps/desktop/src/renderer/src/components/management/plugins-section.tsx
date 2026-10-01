import { useCallback, useRef, useState } from 'react';
import { localizeAppError, localizeLabel, tr } from '../../../../shared/localization.ts';
import { pluginCatalogSchema, resolvePluginMcpServer, type Plugin } from '../../../../shared/plugins.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { useApp } from '../../state/app.tsx';
import { Button } from '../primitives/button.tsx';
import { ConfirmDialog } from '../primitives/dialog.tsx';
import { ManagementSearch } from './chrome.tsx';
import { McpOAuthControls } from './mcp-oauth-controls.tsx';
import { McpToolPolicies } from './mcp-tool-policies.tsx';
import { McpSecretSettings } from './mcp-secret-settings.tsx';
import type { RegisterViewGuard } from '../primitives/unsaved-navigation.tsx';

export function PluginsSection() {
  useLocale();
  const { data, invoke, registerViewGuard } = useApp();
  const draftGuards = useRef(new Set<Parameters<RegisterViewGuard>[0]>());
  const registerDraftGuard = useCallback<RegisterViewGuard>(guard => {
    draftGuards.current.add(guard); const unregister = registerViewGuard(guard);
    return () => { draftGuards.current.delete(guard); unregister(); };
  }, [registerViewGuard]);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRequest = useRef(false), cancelRequests = useRef(new Set<string>());
  const [cancelling, setCancelling] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [uninstall, setUninstall] = useState<Plugin>();
  const [catalog, setCatalog] = useState<ReturnType<typeof pluginCatalogSchema.parse>>([]);
  const history = data.operations.filter(item => item.kind.startsWith('plugin.'));
  // Bound completed history, but never hide an operation that still needs cancellation.
  const operations = history.filter((item, index) => item.status === 'running' || index >= history.length - 10).reverse();
  const busy = pending || operations.some(item => item.status === 'running');
  const run = async (action: () => Promise<unknown>) => {
    if (pendingRequest.current || busy) return;
    pendingRequest.current = true; setPending(true); setError('');
    try { await action(); }
    catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { pendingRequest.current = false; setPending(false); }
  };
  const start = (action: 'install' | 'update' | 'enable' | 'disable' | 'rollback' | 'uninstall', plugin?: Plugin, source = '') =>
    invoke({ op: 'plugin.start', requestId: crypto.randomUUID(), action, pluginId: plugin?.id ?? '', source, hash: (plugin?.candidate ?? plugin?.current)?.hash ?? '' });
  const perform = (action: Parameters<typeof start>[0], plugin?: Plugin, source = '') => {
    setUninstall(undefined);
    const guards = ['enable', 'disable', 'rollback', 'uninstall'].includes(action) ? [...draftGuards.current] : [];
    const next = (index: number) => {
      if (index >= guards.length) void run(() => start(action, plugin, source));
      else if (draftGuards.current.has(guards[index])) guards[index](() => next(index + 1), () => {});
      else next(index + 1);
    };
    next(0);
  };
  const pick = (kind: 'directory' | 'archive' | 'source') => run(async () => {
      const path = await invoke({ op: 'plugin.pick', kind }); if (typeof path !== 'string') return;
      if (kind === 'source') {
        const sources = data.settings.pluginSources;
        if (!sources.some(item => item.path.toLowerCase() === path.toLowerCase()))
          await invoke({ op: 'settings.patch', patch: { pluginSources: [...sources, { id: crypto.randomUUID(), name: path.split(/[\\/]/).at(-1) || path, path }] }, base: { pluginSources: sources } });
        setCatalog(pluginCatalogSchema.parse(await invoke({ op: 'plugin.catalog' })));
      } else await start('install', undefined, path);
  });
  const refresh = () => run(async () => { setCatalog(pluginCatalogSchema.parse(await invoke({ op: 'plugin.catalog' }))); });
  const removeSource = (id: string) => run(async () => {
    await invoke({ op: 'settings.patch', patch: { pluginSources: data.settings.pluginSources.filter(item => item.id !== id) }, base: { pluginSources: data.settings.pluginSources } });
    setCatalog(items => items.filter(item => item.sourceId !== id));
  });
  const cancel = async (id: string) => {
    if (cancelRequests.current.has(id) || !operations.some(item => item.id === id && item.status === 'running')) return;
    cancelRequests.current.add(id); setCancelling([...cancelRequests.current]); setError('');
    try { await invoke({ op: 'plugin.cancel', requestId: id }); }
    catch (reason) { setError(localizeAppError(reason instanceof Error ? reason.message : String(reason))); }
    finally { cancelRequests.current.delete(id); setCancelling([...cancelRequests.current]); }
  };
  const query = search.trim().toLocaleLowerCase();
  const records = data.plugins.filter(item => [item.id, item.current.manifest.name, item.current.manifest.description, item.source].join(' ').toLocaleLowerCase().includes(query));
  return <section className="plugins-section" aria-label={tr('插件管理')}>
    <div className="section-heading"><div><h2>{tr('插件管理')}</h2><p className="hint">{tr('安装、授权与启用分别管理。更新先准备候选版本，授权成功后替换当前版本；运行中的任务保留原配置。')}</p></div></div>
    <ManagementSearch label={tr('搜索插件')} placeholder={tr('插件名称、说明或来源')} value={search} onChange={setSearch}>
      <Button size="sm" disabled={busy} onClick={() => void pick('directory')}>{tr('从目录安装插件')}</Button><Button size="sm" disabled={busy} onClick={() => void pick('archive')}>{tr('从 ZIP 安装插件')}</Button>
    </ManagementSearch>
    {pending && <p role="status" className="hint">{tr('正在处理插件请求…')}</p>}
    {!records.length && <p className="hint">{tr('暂无已安装插件')}</p>}
    <div className="field-stack">
      {data.plugins.map(record => <article className="config-card plugin-card" key={record.id} hidden={!records.includes(record)}>
        <h3>{record.current.manifest.name} <span className="badge">{record.current.manifest.version}</span></h3>
        <p>{record.current.manifest.description}</p><p className="hint">{record.enabled ? tr('已启用') : tr('已停用')} · {record.current.approved ? tr('已授权') : tr('未授权')}</p>
        <p className="resource-path">{tr('插件来源')} · {record.source}</p>
        {record.candidate && <p role="status">{tr('待授权更新')} · {record.candidate.manifest.version}</p>}
        <details><summary>{tr('详情')}</summary><p>{record.id}</p><code className="resource-path">{(record.candidate ?? record.current).hash}</code>
          {(record.candidate ?? record.current).manifest.skills.map(item => <p key={'skill:' + item.path}>Skill · {item.name} · {item.path}</p>)}
          {(record.candidate ?? record.current).manifest.extensions.map(item => <p key={'extension:' + item.path}>{tr('扩展')} · {item.name} · {item.path}</p>)}
          {(record.candidate ?? record.current).manifest.mcp.map(item => <p key={'mcp:' + item.id}>MCP · {item.name} · {item.transport} · {item.command || item.url}</p>)}
        </details>
        <div className="row">
          {(!record.enabled || record.candidate) && <Button size="sm" disabled={busy} onClick={() => void perform('enable', record)}>{tr('授权并启用')}</Button>}
          {record.enabled && <Button size="sm" disabled={busy} onClick={() => void perform('disable', record)}>{tr('停用插件')}</Button>}
          <Button size="sm" disabled={busy} onClick={() => void perform('update', record)}>{tr('检查并准备更新')}</Button>
          {record.previous && <Button size="sm" disabled={busy} onClick={() => void perform('rollback', record)}>{tr('回退上一版本')}</Button>}
          <Button size="sm" disabled={busy} onClick={() => setUninstall(record)}>{tr('卸载插件')}</Button>
        </div>{record.error && <p className="form-feedback" data-error role="alert">{localizeAppError(record.error)}</p>}
        {record.current.approved && record.current.manifest.mcp.map(manifestServer => {
          const server = resolvePluginMcpServer(record, manifestServer);
          return <section className="plugin-mcp-settings" key={server.id} aria-label={'MCP · ' + server.name}>
            <h4>{server.name}</h4><p className="hint resource-path">{server.transport === 'http' ? server.url : server.command + ' ' + server.args.join(' ')}</p>
            <McpSecretSettings server={server} disabled={!record.enabled} invoke={invoke} registerViewGuard={registerDraftGuard} />
            {record.enabled && server.transport === 'http' && server.oauth && <McpOAuthControls server={server} operations={data.operations} invoke={invoke} />}
            {record.enabled && <McpToolPolicies server={server} settings={data.settings} operations={data.operations} invoke={invoke} registerViewGuard={registerDraftGuard} />}
          </section>;
        })}
      </article>)}
    </div>
    <details className="plugin-catalogs"><summary>{tr('本地目录源')} · {data.settings.pluginSources.length}</summary>
      <p className="hint">{tr('目录源只索引本机子目录和 ZIP，不自动安装或授权。')}</p>
      <div className="row"><Button size="sm" disabled={busy} onClick={() => void pick('source')}>{tr('添加插件目录源')}</Button><Button size="sm" disabled={busy} onClick={() => void refresh()}>{tr('刷新插件目录源')}</Button></div>
      {data.settings.pluginSources.map(item => <div className="row" key={item.id}><span className="resource-path">{item.name} · {item.path}</span><Button size="sm" disabled={busy} onClick={() => void removeSource(item.id)}>{tr('移除目录源')}</Button></div>)}
      {catalog.map(item => <article className="config-card" key={item.path}><h4>{item.manifest?.name || item.path}</h4><p className="resource-path">{item.path}</p>{item.error ? <p role="alert">{localizeAppError(item.error)}</p> : <Button size="sm" disabled={busy} onClick={() => void perform('install', undefined, item.path)}>{tr('安装此插件')}</Button>}</article>)}
    </details>
    {!!operations.length && <details open={operations.some(item => item.status === 'running' || item.status === 'failed')}><summary>{tr('插件操作记录')}</summary>{operations.map(operation => <article key={operation.id}>
      <p>{localizeLabel(operation.stage)} · {localizeLabel(({ running: '正在运行', succeeded: '操作完成', failed: '操作失败', cancelled: '操作已取消', interrupted: '操作已中断' } as const)[operation.status])}</p>
      {operation.error && <p role="alert">{localizeAppError(operation.error)}</p>}
      {operation.status === 'running' && <Button size="sm" aria-disabled={cancelling.includes(operation.id) || undefined} onClick={() => void cancel(operation.id)}>{tr('取消插件操作')}</Button>}
    </article>)}</details>}
    {error && <p role="alert" className="form-feedback" data-error>{error}</p>}
    {data.pluginCleanupErrors.map((message, index) => <p role="alert" className="form-feedback" data-error key={index}>{localizeAppError(message)}</p>)}
    {uninstall && <ConfirmDialog title={tr('卸载插件')} description={tr('卸载仅移除 Pi 的安装记录，来源文件保持不变。运行中的任务继续使用原版本，旧文件在下次启动回收。')} confirmLabel={tr('卸载插件')} danger onConfirm={() => void perform('uninstall', uninstall)} onCancel={() => setUninstall(undefined)} />}
  </section>;
}
