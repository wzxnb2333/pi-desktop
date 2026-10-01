import { Check, KeyRound, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type ModelApi, type ModelCatalog, type ModelProvider, type ProviderModel, thinkingSchema } from '../../shared/contracts.ts';
import { localizeAppError, tr } from '../../shared/localization.ts';
import {
  MODEL_APIS, builtinProvider, catalogModel, catalogProvider, customModel, customProvider,
  modelFromCatalog, providerModels, validateProvider,
} from '../../shared/model-configuration.ts';
import { allowedThinkingLevels } from '../../shared/thinking.ts';
import { thinkingLabels } from './lib/labels.ts';
import { useLocale } from './hooks/use-locale.ts';
import { Button } from './components/primitives/button.tsx';
import { ConfirmDialog } from './components/primitives/dialog.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { Tabs } from './components/primitives/tabs.tsx';
import { API_LABELS, ModelConnection } from './ModelConnection.tsx';
import { SettingsSection } from './SettingsSection.tsx';

interface ProviderDraft {
  mode: ModelProvider['kind'];
  name: string;
  namespace: string;
  baseUrl: string;
  api: ModelApi;
}

const PROVIDER_DRAFT: ProviderDraft = { mode: 'builtin', name: '', namespace: '', baseUrl: '', api: 'openai-completions' };

/**
 * Two levels: a connection plus one credential per provider, then any number of models under it.
 * The left pane selects a provider, the right pane edits its connection and its models.
 */
export function ModelSettings({ providers, models, defaultId, selected, keys, catalog, catalogError, error, onSelect, onAddProvider, onChange, onRetry, onKey, onAddModel, onModelChange, onModelDelete, onDefault, onDeleteProvider }: {
  providers: ModelProvider[];
  models: ProviderModel[];
  defaultId: string;
  selected: string;
  keys: Record<string, string>;
  catalog: ModelCatalog | null;
  catalogError: string;
  error?: string;
  onSelect(id: string): void;
  onAddProvider(provider: ModelProvider): void;
  onChange(patch: Partial<ModelProvider>): void;
  onRetry(): void;
  onKey(id: string, value: string): void;
  onAddModel(model: ProviderModel): void;
  onModelChange(id: string, patch: Partial<ProviderModel>): void;
  onModelDelete(id: string): void;
  onDefault(id: string): void;
  onDeleteProvider(id: string): void;
}) {
  useLocale();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [deleting, setDeleting] = useState<ModelProvider | null>(null);
  const [deletingModel, setDeletingModel] = useState<ProviderModel | null>(null);
  const [editingModel, setEditingModel] = useState('');
  const [addingModel, setAddingModel] = useState<'builtin' | 'custom' | ''>('');
  const [catalogPicks, setCatalogPicks] = useState<string[]>([]);
  const [customId, setCustomId] = useState('');
  const collection = useRef<HTMLElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!error) return;
    setQuery('');
    const input = editor.current?.querySelector<HTMLInputElement>('input:invalid, input[aria-invalid=true]');
    input?.closest('details')?.setAttribute('open', '');
    input?.focus();
  }, [error, selected]);
  useEffect(() => { setEditingModel(''); setAddingModel(''); setCatalogPicks([]); setCustomId(''); }, [selected]);
  const provider = providers.find(item => item.id === selected);
  const modelsOf = (id: string) => providerModels(models, id);
  const visible = providers.filter(item => [item.name, item.namespace, ...modelsOf(item.id).flatMap(model => [model.name, model.model])]
    .join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const openDraft = (mode: ModelProvider['kind']) => {
    setQuery('');
    setDraftError('');
    setDraft({ ...PROVIDER_DRAFT, mode, namespace: mode === 'builtin' ? catalog?.[0]?.id ?? '' : '' });
    setDeleting(null);
  };
  const commitDraft = () => {
    if (!draft) return;
    try {
      const id = crypto.randomUUID();
      if (draft.mode === 'builtin') {
        if (!draft.namespace) throw new Error(tr('请选择内置供应商'));
        const created: ModelProvider = { ...builtinProvider(id, draft.namespace), name: draft.name.trim() || draft.namespace };
        validateProvider(created, catalog);
        onAddProvider(created);
      } else {
        const created: ModelProvider = { ...customProvider(id, draft.name.trim() || tr('自定义提供商')), baseUrl: draft.baseUrl.trim(), api: draft.api };
        validateProvider(created, catalog);
        onAddProvider(created);
      }
      setDraft(null);
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const addCustomModel = () => {
    if (!provider) return;
    const upstream = customId.trim();
    if (!upstream) return;
    const created = customModel(provider.id, upstream);
    onAddModel(created);
    setEditingModel(created.id);
    setCustomId('');
    setAddingModel('');
  };
  const catalogCandidates = provider?.kind === 'builtin'
    ? (catalogProvider(catalog, provider.namespace)?.models ?? []).filter(entry => !modelsOf(provider.id).some(model => model.model === entry.id))
    : [];
  return <div className="model-settings">
    <aside ref={collection} className="model-collection" aria-label={tr('供应商与模型')}>
      <div className="model-collection-compact"><label htmlFor="settings-model-selection">{tr('提供商')}</label>
        <select id="settings-model-selection" value={selected} disabled={!providers.length} onChange={event => onSelect(event.target.value)}>
          {!providers.length && <option value="">{tr('还没有提供商')}</option>}
          {providers.map(item => <option key={item.id} value={item.id}>{item.name || tr('新提供商')}</option>)}
        </select>
      </div>
      <div className="model-collection-heading"><h2>{tr('提供商')}</h2><span className="model-count">{providers.length}</span></div>
      <div className="settings-search model-search"><Search size={14} aria-hidden="true" /><input aria-label={tr('搜索名称、供应商或模型 ID')} placeholder={tr('搜索名称、供应商或模型 ID')} value={query} onChange={event => setQuery(event.target.value)} /></div>
      {!!visible.length && <Tabs orientation="vertical" ariaLabel={tr('提供商')} className="model-tabs" value={selected} onChange={onSelect}
        items={visible.map(item => {
          const owned = modelsOf(item.id);
          const isDefault = owned.some(model => model.id === defaultId);
          return { id: item.id, label: <span className="model-option-text"><span>{item.name || tr('新提供商')}</span>
            <small aria-hidden="true">{item.kind === 'builtin' ? tr('内置供应商') : tr('自定义接口')} · {tr('{p0} 个模型', { p0: owned.length })} · {item.hasKey ? tr('已保存密钥') : tr('尚未设置密钥')}</small></span>,
            trailing: <span className="model-option-status" aria-hidden="true">{isDefault ? tr('当前默认') : null}</span> };
        })} />}
      {!!providers.length && !visible.length && <div className="model-search-empty"><p>{tr('没有匹配的提供商')}</p><Button size="sm" variant="ghost" onClick={() => setQuery('')}>{tr('清除搜索')}</Button></div>}
      <Button className="model-add" size="sm" onClick={() => openDraft(catalog?.length ? 'builtin' : 'custom')}><Plus size={14} aria-hidden="true" />{tr('添加提供商')}</Button>
    </aside>
    <div className="model-editor" ref={editor} data-validation-error={!!error}>
      {error && <p id="model-config-error" className="form-feedback" data-error="true" role="alert">{localizeAppError(error)}</p>}
      {draft ? <SettingsSection title={tr('新建提供商')} description={tr('一个提供商对应一个连接和一份密钥；创建后可在其下添加模型。')}>
        <fieldset className="connection-modes">
          <legend>{tr("连接方式")}</legend>
          {([
            ['builtin', tr("内置供应商")],
            ['custom', tr("自定义接口")],
          ] as const).map(([value, title]) => (
            <label key={value} className="connection-mode" data-selected={draft.mode === value}>
              <input type="radio" name="provider-kind" value={value} checked={draft.mode === value} aria-label={title}
                onChange={() => setDraft(previous => previous && { ...previous, mode: value, namespace: value === 'builtin' ? catalog?.[0]?.id ?? '' : previous.namespace })} />
              <span>{title}</span>
            </label>
          ))}
        </fieldset>
        <p className="hint connection-mode-help">{draft.mode === 'builtin' ? tr('从 Pi 目录选择供应商，模型从内置目录挑选。') : tr('填写接口地址与协议，适用于中转服务和本地模型。')}</p>
        <FieldRow label={tr('显示名称')} htmlFor="provider-draft-name">
          <input id="provider-draft-name" aria-label={tr('显示名称')} aria-invalid={!!draftError && !draft.name.trim() || undefined} aria-describedby={draftError ? 'provider-draft-error' : undefined}
            placeholder={draft.mode === 'builtin' ? draft.namespace : tr('例如：本地推理服务')} value={draft.name}
            onChange={event => setDraft(previous => previous && { ...previous, name: event.target.value })} />
        </FieldRow>
        {draft.mode === 'builtin' ? <FieldRow label={tr('供应商')} htmlFor="provider-draft-namespace" description={tr("Pi 内置目录的供应商标识，不是域名或网址")}>
          <select id="provider-draft-namespace" aria-label={tr('供应商')} value={draft.namespace} disabled={!catalog?.length}
            onChange={event => setDraft(previous => previous && { ...previous, namespace: event.target.value })}>
            {!catalog?.length && <option value="">{tr('内置模型目录尚未加载')}</option>}
            {catalog?.map(({ id }) => <option key={id} value={id}>{id}</option>)}
          </select>
        </FieldRow> : <>
          <FieldRow label="Base URL" htmlFor="provider-draft-url" description={tr("必填，包含服务要求的路径，例如 /v1")}>
            <input id="provider-draft-url" aria-label="Base URL" type="url" required autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1"
              value={draft.baseUrl} onChange={event => setDraft(previous => previous && { ...previous, baseUrl: event.target.value })} />
          </FieldRow>
          <FieldRow label={tr('API 协议')} htmlFor="provider-draft-api" description={tr("按接口文档选择协议，与供应商品牌无关")}>
            <select id="provider-draft-api" aria-label={tr('API 协议')} value={draft.api} onChange={event => setDraft(previous => previous && { ...previous, api: event.target.value as ModelApi })}>
              {MODEL_APIS.map(api => <option key={api} value={api}>{API_LABELS[api]}</option>)}
            </select>
          </FieldRow>
        </>}
        <div className="row"><Button size="sm" variant="primary" onClick={commitDraft}>{tr('创建提供商')}</Button><Button size="sm" onClick={() => setDraft(null)}>{tr('取消')}</Button></div>
        {draftError && <p id="provider-draft-error" className="form-feedback" data-error="true" role="alert">{localizeAppError(draftError)}</p>}
        <p className="hint">{tr('创建后填写 API Key，并在「模型」中添加该提供商可用的模型。')}</p>
      </SettingsSection> : !provider ? <div className="empty-card"><h3>{tr('还没有提供商')}</h3><p>{tr('先添加一个提供商，再为其添加模型。')}</p></div> : <>
        <SettingsSection title={tr('连接与凭据')}>
          <FieldRow label={tr('显示名称')} htmlFor={'provider-' + provider.id + '-name'}>
            <input id={'provider-' + provider.id + '-name'} aria-label={tr('显示名称')} aria-invalid={!!error && !provider.name.trim() || undefined} aria-describedby={error ? 'model-config-error' : undefined} required value={provider.name} onChange={event => onChange({ name: event.target.value })} />
          </FieldRow>
          <ModelConnection key={provider.id} provider={provider} catalog={catalog} catalogError={catalogError} onRetry={onRetry} onChange={onChange}
            credentials={<FieldRow label="API Key" htmlFor={'provider-' + provider.id + '-key'} description={tr('密钥使用系统加密保存；更新后从下一次运行生效。')}>
              <div className="model-key-control"><input id={'provider-' + provider.id + '-key'} type="password" autoComplete="off" value={keys[provider.id] ?? ''}
                onChange={event => onKey(provider.id, event.target.value)} placeholder={provider.hasKey ? tr('已加密保存；留空保持不变') : tr('输入 API Key')} />
                <span className="model-key-status"><KeyRound size={12} aria-hidden="true" />{keys[provider.id] ? tr('密钥待保存') : provider.hasKey ? tr('已保存密钥') : tr('尚未设置密钥')}</span>
              </div>
            </FieldRow>} />
        </SettingsSection>
        <SettingsSection title={tr('模型')} description={tr('该提供商下的模型共享上面的连接与密钥。')}>
          {!modelsOf(provider.id).length && <p className="hint model-empty">{tr('还没有模型')}</p>}
          <ul className="model-list">
            {modelsOf(provider.id).map(model => {
              const entry = catalogModel(provider, model, catalog);
              const open = editingModel === model.id;
              const available = provider.kind === 'builtin' ? entry?.thinkingLevels ?? [] : thinkingSchema.options;
              const levels = model.thinkingLevels ?? available;
              return <li key={model.id} className="model-row" data-open={open || undefined}>
                <div className="model-row-heading">
                  <button type="button" className="model-row-toggle" aria-expanded={open} aria-controls={'model-editor-' + model.id} onClick={() => setEditingModel(open ? '' : model.id)}>
                    <span className="model-row-name">{model.name || tr('新模型')}</span>
                    <small className="model-row-id">{model.model}</small>
                  </button>
                  <span className="model-row-capabilities" aria-hidden="true">{model.contextWindow.toLocaleString()} · {model.maxTokens.toLocaleString()}{model.reasoning ? ' · ' + tr('支持思考') : ''}</span>
                  <Button size="sm" disabled={defaultId === model.id} onClick={() => onDefault(model.id)}>{defaultId === model.id ? tr('当前默认') : tr('设为默认')}</Button>
                  <Button size="sm" variant="ghost" className="model-remove" aria-label={tr('删除模型 {p0}', { p0: model.name })} onClick={() => setDeletingModel(model)}><Trash2 size={14} aria-hidden="true" /></Button>
                </div>
                {open && <div className="model-row-editor" id={'model-editor-' + model.id}>
                  <FieldRow label={tr('显示名称')} htmlFor={'model-' + model.id + '-name'}>
                    <input id={'model-' + model.id + '-name'} aria-label={tr('显示名称')} value={model.name} onChange={event => onModelChange(model.id, { name: event.target.value })} />
                  </FieldRow>
                  {provider.kind === 'builtin' ? <FieldRow label={tr('模型 ID')} description={tr("由内置目录提供，不可修改")}>
                    <span className="model-metadata">{model.model}</span>
                  </FieldRow> : <>
                    <FieldRow label={tr('模型 ID')} htmlFor={'model-' + model.id + '-id'} description={tr("接口服务实际接受的模型名称，不查询 Pi 内置目录")}>
                      <input id={'model-' + model.id + '-id'} aria-label={tr('模型 ID')} required spellCheck={false} value={model.model} onChange={event => onModelChange(model.id, { model: event.target.value })} />
                    </FieldRow>
                    <FieldRow label={tr('上下文窗口')} htmlFor={'model-' + model.id + '-context'}>
                      <input id={'model-' + model.id + '-context'} aria-label={tr('上下文窗口')} type="number" min={1024} max={10000000} step={1} value={model.contextWindow} onChange={event => onModelChange(model.id, { contextWindow: Number(event.target.value) })} />
                    </FieldRow>
                    <FieldRow label={tr('最大输出 Token')} htmlFor={'model-' + model.id + '-max'}>
                      <input id={'model-' + model.id + '-max'} aria-label={tr('最大输出 Token')} type="number" min={256} max={1000000} step={1} value={model.maxTokens} onChange={event => onModelChange(model.id, { maxTokens: Number(event.target.value) })} />
                    </FieldRow>
                    <FieldRow label={tr('支持思考')} htmlFor={'model-' + model.id + '-reasoning'} description={tr("仅在接口支持时启用推理强度选项")}>
                      <input id={'model-' + model.id + '-reasoning'} type="checkbox" checked={model.reasoning} onChange={event => onModelChange(model.id, { reasoning: event.target.checked })} />
                    </FieldRow>
                  </>}
                  {!!available.length && <fieldset className="thinking-levels" aria-describedby={'model-' + model.id + '-thinking-help'}>
                    <legend>{tr('允许的思考程度')}</legend>
                    <p id={'model-' + model.id + '-thinking-help'} className="hint">{provider.kind === 'builtin'
                      ? tr('从内置模型支持的程度中选择；任务中的思考菜单只显示勾选项。')
                      : tr('仅勾选接口实际支持的程度；任务中的思考菜单只显示勾选项。')}</p>
                    <div className="thinking-level-options">
                      {available.map(level => <label key={level} className="thinking-level-option">
                        <input type="checkbox" value={level} checked={levels.includes(level)} onChange={event => onModelChange(model.id, {
                          thinkingLevels: thinkingSchema.options.filter(candidate => candidate === level ? event.target.checked : levels.includes(candidate)),
                        })} />
                        <span><Check size={14} aria-hidden="true" />{thinkingLabels[level]}</span>
                      </label>)}
                    </div>
                    {!levels.length && <p className="form-feedback" role="alert" data-error="true">{tr('请至少选择一个允许的思考程度。')}</p>}
                  </fieldset>}
                  {provider.kind === 'builtin' && !entry && catalog && <p className="form-feedback" role="alert" data-error="true">{tr("当前模型不在内置目录中。请重新选择目录模型，或改用自定义提供商。")}</p>}
                  {provider.kind === 'builtin' && <FieldRow label={tr('支持的思考程度')}><span className="model-metadata">{allowedThinkingLevels(model).map(level => thinkingLabels[level]).join(' · ')}</span></FieldRow>}
                </div>}
              </li>;
            })}
          </ul>
          {addingModel === 'builtin' ? <div className="model-add-panel">
            <p className="hint">{tr('从内置目录选择要添加的模型，能力随目录一并复制。')}</p>
            <ul className="model-catalog-options" aria-label={tr('内置模型')}>
              {catalogCandidates.map(entry => <li key={entry.id}>
                <label className="model-catalog-option"><input type="checkbox" value={entry.id} checked={catalogPicks.includes(entry.id)}
                  onChange={event => setCatalogPicks(previous => event.target.checked ? [...previous, entry.id] : previous.filter(id => id !== entry.id))} />
                  <span>{entry.name}<small>{entry.id}{' · ' + entry.contextWindow.toLocaleString()}</small></span></label>
              </li>)}
            </ul>
            {!catalogCandidates.length && <p className="hint">{tr('该供应商的目录模型都已添加。')}</p>}
            <div className="row"><Button size="sm" variant="primary" disabled={!catalogPicks.length} onClick={() => {
              const group = catalogProvider(catalog, provider.namespace);
              for (const id of catalogPicks) {
                const picked = group?.models.find(entry => entry.id === id);
                if (picked) onAddModel(modelFromCatalog(provider.id, picked));
              }
              setCatalogPicks([]); setAddingModel('');
            }}>{tr('添加所选模型')}</Button><Button size="sm" onClick={() => { setCatalogPicks([]); setAddingModel(''); }}>{tr('取消')}</Button></div>
          </div> : addingModel === 'custom' ? <div className="model-add-panel">
            <FieldRow label={tr('模型 ID')} htmlFor="model-new-id" description={tr("接口服务实际接受的模型名称，不查询 Pi 内置目录")}>
              <input id="model-new-id" aria-label={tr('模型 ID')} required spellCheck={false} placeholder={tr("填写服务方提供的模型 ID")} value={customId} onChange={event => setCustomId(event.target.value)} />
            </FieldRow>
            <div className="row"><Button size="sm" variant="primary" disabled={!customId.trim()} onClick={addCustomModel}>{tr('添加模型')}</Button><Button size="sm" onClick={() => { setCustomId(''); setAddingModel(''); }}>{tr('取消')}</Button></div>
          </div> : <Button className="model-add-model" size="sm" onClick={() => setAddingModel(provider.kind)}><Plus size={14} aria-hidden="true" />{tr('添加模型')}</Button>}
        </SettingsSection>
        <SettingsSection title={tr('提供商偏好')}>
          <FieldRow label={tr('删除该提供商')} description={tr('保存后移除该提供商的模型与本机保存的 API Key')}>
            <Button size="sm" variant="ghost" className="model-remove provider-remove" onClick={() => setDeleting(provider)}><Trash2 size={14} aria-hidden="true" />{tr('删除提供商')}</Button>
          </FieldRow>
        </SettingsSection>
        <p className="hint model-privacy-note">{tr('凭据以当前 Windows 用户账户加密后保存在本机，不会写入配置文件。')}</p>
      </>}
    </div>
    {deleting && <ConfirmDialog title={tr('删除提供商「{p0}」？', { p0: deleting.name })} description={tr('保存设置后移除该提供商、它的 {p0} 个模型和本机保存的 API Key。已有任务的历史记录会保留。', { p0: modelsOf(deleting.id).length })} confirmLabel={tr('删除提供商')} danger initialFocus="cancel" onCancel={() => setDeleting(null)} onConfirm={() => {
      onDeleteProvider(deleting.id); setDeleting(null);
      requestAnimationFrame(() => collection.current?.querySelector<HTMLButtonElement>('.model-add')?.focus());
    }} />}
    {deletingModel && <ConfirmDialog title={tr('删除模型「{p0}」？', { p0: deletingModel.name })} description={tr('保存设置后移除该模型；提供商的连接与密钥保持不变。')} confirmLabel={tr('删除模型')} danger initialFocus="cancel" onCancel={() => setDeletingModel(null)} onConfirm={() => {
      onModelDelete(deletingModel.id); setDeletingModel(null);
    }} />}
  </div>;
}
