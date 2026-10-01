import { useEffect, useRef, useState } from 'react';
import { bootstrapSchema, mcpToolSchema, type DesktopRequest, type McpConfig, type Settings, type Thread } from '../../../../shared/contracts.ts';
import { mcpToolPolicySchema, type McpToolPolicy } from '../../../../shared/mcp-tool-policy.ts';
import { sameSetting } from '../../../../shared/settings-updates.ts';
import { localizeAppError, tr } from '../../../../shared/localization.ts';
import { useLocale } from '../../hooks/use-locale.ts';
import { Button } from '../primitives/button.tsx';
import { FieldRow } from '../primitives/field-row.tsx';
import { UnsavedNavigation, type RegisterViewGuard } from '../primitives/unsaved-navigation.tsx';
import type { OperationRecord } from '../../../../shared/operations.ts';
import { McpTestProgress, useMcpTest } from './mcp-test-controls.tsx';

export function McpToolPolicies({ server, settings, operations, tools = [], invoke, persist, value, onChange, registerViewGuard, configurationRevision = 0 }: {
  server: McpConfig; settings: Settings; tools?: NonNullable<Thread['mcp']>[number]['tools']; invoke: (request: DesktopRequest) => Promise<unknown>; persist?: () => Promise<boolean>;
  value?: Record<string, McpToolPolicy>; onChange?: (value: Record<string, McpToolPolicy>) => void; registerViewGuard?: RegisterViewGuard; configurationRevision?: number;
  operations: OperationRecord[];
}) {
  useLocale();
  const connection = useMcpTest(server, operations, invoke, configurationRevision);
  const [localDraft, setLocalDraft] = useState<Record<string, McpToolPolicy>>(() => settings.mcpToolPolicies[server.id] ?? {});
  const draft = value ?? localDraft;
  const setDraft = (update: Record<string, McpToolPolicy> | ((previous: Record<string, McpToolPolicy>) => Record<string, McpToolPolicy>)) => {
    const next = typeof update === 'function' ? update(draft) : update;
    if (onChange) onChange(next); else setLocalDraft(next);
  };
  const baseline = useRef(draft); const [query, setQuery] = useState(''); const [name, setName] = useState('');
  const [found, setFound] = useState<typeof tools>([]); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState(''); const [error, setError] = useState(false);
  const pending = useRef(false), generation = useRef(0), alive = useRef(true);
  const configuration = JSON.stringify([server, configurationRevision]);
  const currentConfiguration = useRef(configuration); currentConfiguration.current = configuration;
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  useEffect(() => { generation.current++; setFound([]); setFeedback(''); setError(false); }, [configuration]);
  const source = JSON.stringify(settings.mcpToolPolicies[server.id] ?? {});
  useEffect(() => {
    const updated = settings.mcpToolPolicies[server.id] ?? {};
    if (!onChange && sameSetting(draft, baseline.current)) { baseline.current = updated; setLocalDraft(updated); }
  }, [source]);
  const patch = (name: string, value: Partial<McpToolPolicy>) => { setDraft(previous => ({ ...previous, [name]: { ...mcpToolPolicySchema.parse({}), ...previous[name], ...value } })); setFeedback(''); };
  const perform = async (action: 'discover' | 'save') => {
    if (pending.current || connection.busy) return;
    pending.current = true; setBusy(true); setFeedback(action === 'discover' ? tr('连接测试中…') : ''); setError(false);
    const request = ++generation.current;
    const current = () => alive.current && request === generation.current && currentConfiguration.current === configuration;
    try {
      if (action === 'save') for (const policy of Object.values(draft)) mcpToolPolicySchema.parse(policy);
      if (persist && !await persist()) { if (current()) setFeedback(tr('设置正在保存，请稍后重试。')); return; }
      if (!current()) return;
      if (action === 'discover') {
        const result = await connection.run();
        if (!current()) return;
        if (result === null) setFeedback(tr('已取消连接测试'));
        else {
          const parsed = mcpToolSchema.array().safeParse(result);
          if (!parsed.success) throw new Error(tr('MCP 测试返回的数据格式无效，请重试连接'));
          setFound(parsed.data); setFeedback(tr('已发现') + ' ' + parsed.data.length + ' ' + tr('个工具'));
        }
      } else {
        if (!onChange) {
          const currentPolicies = bootstrapSchema.parse(await invoke({ op: 'bootstrap' })).data.settings.mcpToolPolicies;
          if (!current()) return;
          if (!sameSetting(currentPolicies[server.id] ?? {}, baseline.current)) throw new Error(tr('工具策略已在其他窗口修改，请重新打开此页面'));
          await invoke({ op: 'settings.patch', patch: { mcpToolPolicies: { ...currentPolicies, [server.id]: draft } }, base: { mcpToolPolicies: currentPolicies } });
        }
        if (!current()) return;
        baseline.current = draft; setFeedback(tr('工具策略已保存，下次任务运行生效'));
      }
    } catch (reason) { if (current()) { setError(true); setFeedback(localizeAppError(reason instanceof Error ? reason.message : String(reason))); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const names = [...new Set([...tools, ...found].flatMap(tool => tool.sourceName ? [tool.sourceName] : []).concat(Object.keys(draft)))].sort();
  const dirty = !sameSetting(draft, onChange ? settings.mcpToolPolicies[server.id] ?? {} : baseline.current);
  return <details className="mcp-tool-policies" aria-busy={busy || undefined}><summary>{tr('工具策略')} · {names.length}</summary>
    {!onChange && <UnsavedNavigation register={registerViewGuard} dirty={dirty} busy={busy} />}
    <p className="hint">{tr('工具策略只能收紧任务权限。运行中的任务保留原策略，下次运行加载修改。')}</p>
    <div className="row"><input aria-label={tr('搜索工具')} placeholder={tr('搜索工具')} value={query} onChange={event => setQuery(event.target.value)} />
      <Button ref={connection.trigger} size="sm" disabled={busy || connection.busy} onClick={() => void perform('discover')}>{tr('读取工具列表')}</Button></div>
    {!persist && <McpTestProgress connection={connection} showResult={!feedback} />}
    {names.filter(name => name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(name => {
      const policy = draft[name] ?? mcpToolPolicySchema.parse({});
      return <fieldset disabled={busy} className="config-card" key={name}><legend>{name}</legend>
        <FieldRow label={tr('启用工具')}><input type="checkbox" aria-label={tr('启用工具') + ' ' + name} checked={policy.enabled} onChange={event => patch(name, { enabled: event.target.checked })} /></FieldRow>
        <FieldRow label={tr('工具审批')}><select aria-label={tr('工具审批') + ' ' + name} value={policy.approval} onChange={event => patch(name, { approval: event.target.value as McpToolPolicy['approval'] })}>
          <option value="inherit">{tr('沿用任务权限')}</option><option value="ask">{tr('每次询问')}</option><option value="deny">{tr('禁止调用')}</option></select></FieldRow>
        <FieldRow label={tr('工具超时（秒）')}><input type="number" min={1} max={600} step={1} aria-label={tr('工具超时（秒）') + ' ' + name} value={policy.timeoutMs / 1000} onChange={event => patch(name, { timeoutMs: Number(event.target.value) * 1000 })} /></FieldRow>
        {draft[name] && <Button size="sm" onClick={() => { setDraft(previous => { const next = { ...previous }; delete next[name]; return next; }); setFeedback(''); }}>{tr('恢复工具默认值')}</Button>}
      </fieldset>;
    })}
    <div className="row"><input aria-label={tr('原始工具名称')} value={name} onChange={event => setName(event.target.value)} maxLength={300} />
      <Button size="sm" disabled={busy || !name.trim()} onClick={() => { patch(name.trim(), {}); setName(''); }}>{tr('添加工具规则')}</Button>
      <Button size="sm" disabled={busy || !dirty} onClick={() => void perform('save')}>{tr('保存工具策略')}</Button></div>
    {feedback && <p role={error ? 'alert' : 'status'} className="form-feedback" data-error={error || undefined}>{feedback}</p>}
  </details>;
}
