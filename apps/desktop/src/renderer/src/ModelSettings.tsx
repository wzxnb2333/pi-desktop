import { Check, Eye, EyeOff, KeyRound, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  type DesktopRequest,
  type ModelApi,
  type ModelCatalog,
  type ModelProvider,
  type ProviderModel,
  thinkingSchema,
} from '../../shared/contracts.ts';
import { getLocale, localizeAppError, tr } from '../../shared/localization.ts';
import {
  MODEL_APIS,
  builtinProvider,
  catalogModel,
  catalogProvider,
  customModel,
  customProvider,
  modelFromCatalog,
  providerModels,
  validateProvider,
} from '../../shared/model-configuration.ts';
import { thinkingLabels } from './lib/labels.ts';
import { useLocale } from './hooks/use-locale.ts';
import { useContentMotion } from './hooks/use-content-motion.ts';
import { Button } from './components/primitives/button.tsx';
import { ConfirmDialog } from './components/primitives/dialog.tsx';
import { Drawer } from './components/primitives/drawer.tsx';
import { FieldRow } from './components/primitives/field-row.tsx';
import { IconButton } from './components/primitives/icon-button.tsx';
import { Menu } from './components/primitives/menu.tsx';
import { Tabs } from './components/primitives/tabs.tsx';
import { API_LABELS, ModelConnection } from './ModelConnection.tsx';
import { ProviderAuth } from './ProviderAuth.tsx';
import { SettingsSection } from './SettingsSection.tsx';

function compactTokens(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(value % 1000000 ? 1 : 0) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'K';
  return String(value);
}

interface ProviderDraft {
  mode: ModelProvider['kind'];
  name: string;
  namespace: string;
  baseUrl: string;
  api: ModelApi;
}
const PROVIDER_DRAFT: ProviderDraft = {
  mode: 'builtin',
  name: '',
  namespace: '',
  baseUrl: '',
  api: 'openai-completions',
};
type ModelDrawer = { kind: 'edit'; id: string } | { kind: 'add'; mode: ModelProvider['kind'] } | null;

export function ModelSettings({
  providers,
  savedProviderIds,
  models,
  defaultId,
  selected,
  keys,
  catalog,
  catalogError,
  error,
  invoke,
  persist,
  onSelect,
  onAddProvider,
  onChange,
  onRetry,
  onKey,
  onAddModel,
  onModelChange,
  onModelDelete,
  onDeleteProvider,
}: {
  providers: ModelProvider[];
  savedProviderIds: string[];
  models: ProviderModel[];
  defaultId: string;
  selected: string;
  keys: Record<string, string>;
  catalog: ModelCatalog | null;
  catalogError: string;
  error?: string;
  invoke(request: DesktopRequest): Promise<unknown>;
  persist(): Promise<boolean>;
  onSelect(id: string): void;
  onAddProvider(provider: ModelProvider): void;
  onChange(patch: Partial<ModelProvider>): void;
  onRetry(): void;
  onKey(id: string, value: string): void;
  onAddModel(models: ProviderModel[]): void;
  onModelChange(id: string, patch: Partial<ProviderModel>): void;
  onModelDelete(id: string): void;
  onDeleteProvider(id: string): void;
}) {
  useLocale();
  const locale = getLocale();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [deleting, setDeleting] = useState<ModelProvider | null>(null);
  const [deletingModel, setDeletingModel] = useState<ProviderModel | null>(null);
  const [modelDrawer, setModelDrawer] = useState<ModelDrawer>(null);
  const [catalogPicks, setCatalogPicks] = useState<string[]>([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [customId, setCustomId] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const collection = useRef<HTMLElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const addProviderButton = useRef<HTMLButtonElement>(null);
  useContentMotion(editor, selected + '/' + (draft ? 'new' : 'edit'));

  const provider = providers.find((item) => item.id === selected);
  const modelsOf = (id: string) => providerModels(models, id);
  const catalogAuth = provider?.kind === 'builtin' ? catalogProvider(catalog, provider.namespace)?.auth : undefined;
  const oauth = catalogAuth?.oauth;
  const apiKeyAvailable = provider?.kind === 'custom' || catalogAuth?.apiKey !== false;
  const authMethod =
    provider && (provider.kind === 'custom' || !oauth || provider.authMethod !== 'oauth' ? 'api_key' : 'oauth');
  const visible = providers.filter((item) =>
    [item.name, item.namespace, ...modelsOf(item.id).flatMap((model) => [model.name, model.model])]
      .join(' ')
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const editingModel = modelDrawer?.kind === 'edit' ? models.find((model) => model.id === modelDrawer.id) : undefined;
  const catalogCandidates =
    provider?.kind === 'builtin'
      ? (catalogProvider(catalog, provider.namespace)?.models ?? []).filter(
          (entry) => !modelsOf(provider.id).some((model) => model.model === entry.id),
        )
      : [];
  const matchingCandidates = catalogCandidates.filter((entry) =>
    [entry.name, entry.id].join(' ').toLocaleLowerCase().includes(catalogQuery.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    if (!error) return;
    setQuery('');
    const input = editor.current?.querySelector<HTMLInputElement>('input:invalid, input[aria-invalid=true]');
    input?.closest('details')?.setAttribute('open', '');
    input?.focus();
  }, [error, selected]);
  useEffect(() => {
    setModelDrawer(null);
    setCatalogPicks([]);
    setCatalogQuery('');
    setCustomId('');
    setShowKey(false);
  }, [selected]);

  const openDraft = (mode: ModelProvider['kind']) => {
    setQuery('');
    setDraftError('');
    setDraft({ ...PROVIDER_DRAFT, mode, namespace: mode === 'builtin' ? (catalog?.[0]?.id ?? '') : '' });
    setDeleting(null);
  };
  const commitDraft = () => {
    if (!draft) return;
    try {
      const id = crypto.randomUUID();
      if (draft.mode === 'builtin') {
        if (!draft.namespace) throw new Error(tr('请选择内置供应商'));
        const created: ModelProvider = {
          ...builtinProvider(id, draft.namespace, catalog),
          name: draft.name.trim() || draft.namespace,
        };
        validateProvider(created, catalog);
        onAddProvider(created);
      } else {
        const created: ModelProvider = {
          ...customProvider(id, draft.name.trim() || tr('自定义提供商')),
          baseUrl: draft.baseUrl.trim(),
          api: draft.api,
        };
        validateProvider(created, catalog);
        onAddProvider(created);
      }
      setDraft(null);
      requestAnimationFrame(() => editor.current?.querySelector<HTMLInputElement>('input')?.focus());
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const openAddModel = (mode: ModelProvider['kind']) => {
    setCatalogPicks([]);
    setCatalogQuery('');
    setCustomId('');
    setModelDrawer({ kind: 'add', mode });
  };
  const closeModelDrawer = () => {
    setModelDrawer(null);
    setCatalogPicks([]);
    setCatalogQuery('');
    setCustomId('');
  };
  const addCustom = () => {
    if (!provider || !customId.trim()) return;
    onAddModel([customModel(provider.id, customId.trim())]);
    closeModelDrawer();
  };
  const addCatalogModels = () => {
    if (!provider || provider.kind !== 'builtin') return;
    const group = catalogProvider(catalog, provider.namespace);
    onAddModel(
      (group?.models ?? [])
        .filter((entry) => catalogPicks.includes(entry.id))
        .map((entry) => modelFromCatalog(provider.id, entry)),
    );
    closeModelDrawer();
  };
  const deleteModel = (model: ProviderModel) => {
    setDeletingModel(model);
  };

  return (
    <div className="model-settings">
      <aside ref={collection} className="model-collection" aria-label={tr('供应商与模型')}>
        <div className="model-collection-compact">
          <label htmlFor="settings-model-selection">{tr('提供商')}</label>
          <Menu
            id="settings-model-selection"
            label={tr('提供商')}
            value={selected}
            matchTriggerWidth
            className="settings-select"
            disabled={!providers.length}
            options={
              providers.length
                ? providers.map((item) => ({ value: item.id, label: item.name || tr('新提供商') }))
                : [{ value: '', label: tr('还没有提供商') }]
            }
            onChange={onSelect}
          />
        </div>
        <div className="model-collection-heading">
          <div>
            <h2>{tr('提供商')}</h2>
            <p className="hint">{tr('{p0} 个连接', { p0: providers.length })}</p>
          </div>
          <span className="model-count">{providers.length}</span>
        </div>
        <div className="settings-search model-search">
          <Search size={14} aria-hidden="true" />
          <input
            aria-label={tr('搜索名称、供应商或模型 ID')}
            placeholder={tr('搜索名称、供应商或模型 ID')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {!!visible.length && (
          <Tabs
            orientation="vertical"
            ariaLabel={tr('提供商')}
            className="model-tabs"
            value={selected}
            onChange={onSelect}
            items={visible.map((item) => {
              const owned = modelsOf(item.id);
              const itemAuth = item.kind === 'builtin' ? catalogProvider(catalog, item.namespace)?.auth : undefined;
              const usesOAuth = item.authMethod === 'oauth' && !!itemAuth?.oauth;
              return {
                id: item.id,
                label: (
                  <span className="model-option-text">
                    <span>{item.name || tr('新提供商')}</span>
                    <small aria-hidden="true">
                      {item.kind === 'builtin' ? tr('内置供应商') : tr('自定义接口')} ·{' '}
                      {tr('{p0} 个模型', { p0: owned.length })}
                    </small>
                    <small aria-hidden="true">
                      {usesOAuth
                        ? locale === 'en-US'
                          ? 'OAuth mode'
                          : 'OAuth 模式'
                        : item.hasKey
                          ? tr('已保存密钥')
                          : tr('尚未设置密钥')}
                    </small>
                  </span>
                ),
                trailing: (
                  <span className="model-option-status" aria-hidden="true">
                    {owned.some((model) => model.id === defaultId) ? tr('当前默认') : null}
                  </span>
                ),
              };
            })}
          />
        )}
        {!!providers.length && !visible.length && (
          <div className="model-search-empty">
            <p>{tr('没有匹配的提供商')}</p>
            <Button size="sm" variant="ghost" onClick={() => setQuery('')}>
              {tr('清除搜索')}
            </Button>
          </div>
        )}
        <Button
          ref={addProviderButton}
          className="model-add"
          size="sm"
          onClick={() => openDraft(catalog?.length ? 'builtin' : 'custom')}
        >
          <Plus size={14} aria-hidden="true" />
          {tr('添加提供商')}
        </Button>
      </aside>

      <div className="model-editor" ref={editor} data-validation-error={!!error}>
        {error && (
          <p id="model-config-error" className="form-feedback" data-error="true" role="alert">
            {localizeAppError(error)}
          </p>
        )}
        {draft ? (
          <SettingsSection
            title={tr('新建提供商')}
            description={
              locale === 'en-US'
                ? 'One provider holds one connection and an authentication credential (API Key or OAuth). Add its models afterwards.'
                : '一个提供商对应一个连接和一份认证凭据（API Key 或 OAuth）；创建后可在其下添加模型。'
            }
          >
            <fieldset className="connection-modes">
              <legend>{tr('连接方式')}</legend>
              {(
                [
                  ['builtin', tr('内置供应商')],
                  ['custom', tr('自定义接口')],
                ] as const
              ).map(([value, title]) => (
                <label key={value} className="connection-mode" data-selected={draft.mode === value}>
                  <input
                    type="radio"
                    name="provider-kind"
                    value={value}
                    checked={draft.mode === value}
                    aria-label={title}
                    onChange={() =>
                      setDraft(
                        (previous) =>
                          previous && {
                            ...previous,
                            mode: value,
                            namespace: value === 'builtin' ? (catalog?.[0]?.id ?? '') : previous.namespace,
                          },
                      )
                    }
                  />
                  <span>{title}</span>
                </label>
              ))}
            </fieldset>
            <p className="hint connection-mode-help">
              {draft.mode === 'builtin'
                ? tr('从 Pi 目录选择供应商，模型从内置目录挑选。')
                : tr('填写接口地址与协议，适用于中转服务和本地模型。')}
            </p>
            <FieldRow label={tr('显示名称')} htmlFor="provider-draft-name">
              <input
                id="provider-draft-name"
                aria-label={tr('显示名称')}
                aria-invalid={(!!draftError && !draft.name.trim()) || undefined}
                aria-describedby={draftError ? 'provider-draft-error' : undefined}
                placeholder={draft.mode === 'builtin' ? draft.namespace : tr('例如：本地推理服务')}
                value={draft.name}
                onChange={(event) => setDraft((previous) => previous && { ...previous, name: event.target.value })}
              />
            </FieldRow>
            {draft.mode === 'builtin' ? (
              <FieldRow label={tr('供应商')} description={tr('Pi 内置目录的供应商标识，不是域名或网址')}>
                <Menu
                  id="provider-draft-namespace"
                  label={tr('供应商')}
                  value={draft.namespace}
                  matchTriggerWidth
                  className="settings-select"
                  disabled={!catalog?.length}
                  options={
                    catalog?.length
                      ? catalog.map(({ id }) => ({ value: id, label: id }))
                      : [{ value: '', label: tr('内置模型目录尚未加载') }]
                  }
                  onChange={(value) => setDraft((previous) => previous && { ...previous, namespace: value })}
                />
              </FieldRow>
            ) : (
              <>
                <FieldRow
                  label="Base URL"
                  htmlFor="provider-draft-url"
                  description={tr('必填，包含服务要求的路径，例如 /v1')}
                >
                  <input
                    id="provider-draft-url"
                    aria-label="Base URL"
                    type="url"
                    required
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://api.example.com/v1"
                    value={draft.baseUrl}
                    onChange={(event) =>
                      setDraft((previous) => previous && { ...previous, baseUrl: event.target.value })
                    }
                  />
                </FieldRow>
                <FieldRow label={tr('API 协议')} description={tr('按接口文档选择协议，与供应商品牌无关')}>
                  <Menu
                    id="provider-draft-api"
                    label={tr('API 协议')}
                    value={draft.api}
                    matchTriggerWidth
                    className="settings-select"
                    options={MODEL_APIS.map((api) => ({ value: api, label: API_LABELS[api] }))}
                    onChange={(value) => setDraft((previous) => previous && { ...previous, api: value as ModelApi })}
                  />
                </FieldRow>
              </>
            )}
            <div className="row model-draft-actions">
              <Button size="sm" variant="primary" onClick={commitDraft}>
                {tr('创建提供商')}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setDraft(null);
                  requestAnimationFrame(() => addProviderButton.current?.focus());
                }}
              >
                {tr('取消')}
              </Button>
            </div>
            {draftError && (
              <p id="provider-draft-error" className="form-feedback" data-error="true" role="alert">
                {localizeAppError(draftError)}
              </p>
            )}
          </SettingsSection>
        ) : !provider ? (
          <div className="empty-card">
            <h3>{tr('还没有提供商')}</h3>
            <p>{tr('先添加一个提供商，再为其添加模型。')}</p>
          </div>
        ) : (
          <>
            <header className="model-provider-heading">
              <div>
                <p className="model-kicker">{provider.kind === 'builtin' ? tr('内置供应商') : tr('自定义接口')}</p>
                <h2>{provider.name || tr('新提供商')}</h2>
                <p className="hint">
                  {provider.kind === 'builtin' ? provider.namespace : provider.baseUrl || tr('尚未设置 Base URL')} ·{' '}
                  {tr('{p0} 个模型', { p0: modelsOf(provider.id).length })}
                </p>
              </div>
              <div className="model-provider-actions">
                {authMethod === 'oauth' && <span className="model-auth-badge">OAuth</span>}
                {!savedProviderIds.includes(provider.id) && (
                  <span className="model-draft-badge">{locale === 'en-US' ? 'Not saved' : '未保存'}</span>
                )}
              </div>
            </header>
            <SettingsSection title={tr('连接与凭据')}>
              <FieldRow label={tr('显示名称')} htmlFor={'provider-' + provider.id + '-name'}>
                <input
                  id={'provider-' + provider.id + '-name'}
                  aria-label={tr('显示名称')}
                  aria-invalid={(!!error && !provider.name.trim()) || undefined}
                  aria-describedby={error ? 'model-config-error' : undefined}
                  required
                  value={provider.name}
                  onChange={(event) => onChange({ name: event.target.value })}
                />
              </FieldRow>
              <ModelConnection
                key={provider.id}
                provider={provider}
                catalog={catalog}
                catalogError={catalogError}
                authMethod={authMethod ?? provider.authMethod}
                authBusy={authBusy}
                onRetry={onRetry}
                onChange={onChange}
                credentials={
                  <>
                    {oauth && (
                      <ProviderAuth
                        key={JSON.stringify([provider.id, provider.namespace, provider.baseUrl.trim(), authMethod])}
                        id={provider.id}
                        name={provider.name}
                        oauth={oauth}
                        authMethod={authMethod ?? provider.authMethod}
                        persisted={savedProviderIds.includes(provider.id)}
                        apiKeyAvailable={apiKeyAvailable}
                        baseUrl={provider.baseUrl}
                        invoke={invoke}
                        persist={persist}
                        onAuthMethodChange={(method) => onChange({ authMethod: method })}
                        onBusyChange={setAuthBusy}
                      />
                    )}
                    {apiKeyAvailable && authMethod !== 'oauth' && (
                      <FieldRow
                        label="API Key"
                        htmlFor={'provider-' + provider.id + '-key'}
                        description={tr('密钥使用系统加密保存；更新后从下一次运行生效。')}
                      >
                        <div className="model-key-control">
                          <div className="model-key-input">
                            <input
                              id={'provider-' + provider.id + '-key'}
                              type={showKey ? 'text' : 'password'}
                              autoComplete="off"
                              value={keys[provider.id] ?? ''}
                              onChange={(event) => onKey(provider.id, event.target.value)}
                              placeholder={provider.hasKey ? tr('已加密保存；留空保持不变') : tr('输入 API Key')}
                            />
                            <IconButton
                              label={tr(showKey ? '隐藏密钥' : '显示密钥')}
                              size="sm"
                              onClick={() => setShowKey(!showKey)}
                            >
                              {showKey ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                            </IconButton>
                          </div>
                          <span className="model-key-status">
                            <KeyRound size={12} aria-hidden="true" />
                            {keys[provider.id]
                              ? tr('密钥待保存')
                              : provider.hasKey
                                ? tr('已保存密钥')
                                : tr('尚未设置密钥')}
                          </span>
                        </div>
                      </FieldRow>
                    )}
                  </>
                }
              />
            </SettingsSection>
            <SettingsSection
              title={tr('模型')}
              description={tr('模型共享上面的连接与认证凭据。')}
              action={
                <Button size="sm" onClick={() => openAddModel(provider.kind)}>
                  <Plus size={14} aria-hidden="true" />
                  {tr('添加模型')}
                </Button>
              }
            >
              <div className="model-models">
                {!modelsOf(provider.id).length && <p className="hint model-empty">{tr('还没有模型')}</p>}
                <ul className="model-list">
                  {modelsOf(provider.id).map((model) => {
                    const entry = catalogModel(provider, model, catalog);
                    const levels = model.thinkingLevels ?? thinkingSchema.options;
                    return (
                      <li key={model.id} className="model-row">
                        <div className="model-row-heading">
                          <button
                            type="button"
                            className="model-row-toggle"
                            aria-label={tr('编辑模型 {p0}', { p0: model.name || model.model })}
                            onClick={() => setModelDrawer({ kind: 'edit', id: model.id })}
                          >
                            <span className="model-row-name">{model.name || tr('新模型')}</span>
                            <small className="model-row-id">{model.model}</small>
                          </button>
                          <span
                            className="model-row-capabilities"
                            title={model.contextWindow.toLocaleString() + ' · ' + model.maxTokens.toLocaleString()}
                          >
                            {compactTokens(model.contextWindow)} · {compactTokens(model.maxTokens)}
                            {model.reasoning ? ' · ' + tr('支持思考') : ''}
                          </span>
                          {defaultId === model.id && <span className="model-default-badge">{tr('当前默认')}</span>}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setModelDrawer({ kind: 'edit', id: model.id })}
                          >
                            {tr('编辑')}
                          </Button>
                          <IconButton
                            label={tr('删除模型 {p0}', { p0: model.name })}
                            size="sm"
                            onClick={() => deleteModel(model)}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </IconButton>
                        </div>
                        <div className="model-row-summary">
                          <span>{provider.kind === 'builtin' && entry ? entry.name : tr('自定义模型')}</span>
                          <span>
                            {levels.length} {tr('个思考档位')}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </SettingsSection>
            <SettingsSection title={tr('提供商偏好')}>
              <FieldRow
                label={tr('删除该提供商')}
                description={
                  locale === 'en-US'
                    ? 'Saving removes this provider’s models and locally stored authentication credential (API Key or OAuth).'
                    : '保存后移除该提供商的模型与本机保存的认证凭据（API Key 或 OAuth）。'
                }
              >
                <Button
                  size="sm"
                  variant="ghost"
                  className="model-remove provider-remove"
                  onClick={() => setDeleting(provider)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  {tr('删除提供商')}
                </Button>
              </FieldRow>
            </SettingsSection>
            <p className="hint model-privacy-note">
              {tr('凭据以当前 Windows 用户账户加密后保存在本机，不会写入配置文件。')}
            </p>
          </>
        )}
      </div>

      <Drawer
        open={!!modelDrawer}
        title={modelDrawer?.kind === 'edit' ? tr('编辑模型') : tr('添加模型')}
        description={provider?.name}
        onClose={closeModelDrawer}
      >
        {modelDrawer?.kind === 'edit' && editingModel && provider && (
          <div className="model-drawer-form">
            <FieldRow label={tr('显示名称')} htmlFor={'drawer-model-' + editingModel.id + '-name'}>
              <input
                data-drawer-autofocus
                id={'drawer-model-' + editingModel.id + '-name'}
                aria-label={tr('显示名称')}
                value={editingModel.name}
                onChange={(event) => onModelChange(editingModel.id, { name: event.target.value })}
              />
            </FieldRow>
            {provider.kind === 'builtin' ? (
              <FieldRow label={tr('模型 ID')} description={tr('由内置目录提供，不可修改')}>
                <span className="model-metadata">{editingModel.model}</span>
              </FieldRow>
            ) : (
              <>
                <FieldRow
                  label={tr('模型 ID')}
                  htmlFor={'drawer-model-' + editingModel.id + '-id'}
                  description={tr('接口服务实际接受的模型名称')}
                >
                  <input
                    id={'drawer-model-' + editingModel.id + '-id'}
                    aria-label={tr('模型 ID')}
                    required
                    spellCheck={false}
                    value={editingModel.model}
                    onChange={(event) => onModelChange(editingModel.id, { model: event.target.value })}
                  />
                </FieldRow>
                <FieldRow label={tr('上下文窗口')} htmlFor={'drawer-model-' + editingModel.id + '-context'}>
                  <input
                    id={'drawer-model-' + editingModel.id + '-context'}
                    aria-label={tr('上下文窗口')}
                    type="number"
                    min={1024}
                    max={10000000}
                    step={1}
                    value={editingModel.contextWindow}
                    onChange={(event) => onModelChange(editingModel.id, { contextWindow: Number(event.target.value) })}
                  />
                </FieldRow>
                <FieldRow label={tr('最大输出 Token')} htmlFor={'drawer-model-' + editingModel.id + '-max'}>
                  <input
                    id={'drawer-model-' + editingModel.id + '-max'}
                    aria-label={tr('最大输出 Token')}
                    type="number"
                    min={256}
                    max={1000000}
                    step={1}
                    value={editingModel.maxTokens}
                    onChange={(event) => onModelChange(editingModel.id, { maxTokens: Number(event.target.value) })}
                  />
                </FieldRow>
                <FieldRow
                  label={tr('支持思考')}
                  htmlFor={'drawer-model-' + editingModel.id + '-reasoning'}
                  description={tr('仅在接口支持时启用推理强度选项')}
                >
                  <input
                    id={'drawer-model-' + editingModel.id + '-reasoning'}
                    type="checkbox"
                    checked={editingModel.reasoning}
                    onChange={(event) => onModelChange(editingModel.id, { reasoning: event.target.checked })}
                  />
                </FieldRow>
              </>
            )}
            <ThinkingLevels
              model={editingModel}
              catalogLevels={
                provider.kind === 'builtin' ? catalogModel(provider, editingModel, catalog)?.thinkingLevels : undefined
              }
              onChange={(patch) => onModelChange(editingModel.id, patch)}
            />
            {provider.kind === 'builtin' && !catalogModel(provider, editingModel, catalog) && catalog && (
              <p className="form-feedback" role="alert" data-error="true">
                {tr('当前模型不在内置目录中。请重新选择目录模型，或改用自定义提供商。')}
              </p>
            )}
            <div className="drawer-actions">
              <Button onClick={closeModelDrawer}>{tr('完成')}</Button>
              <Button variant="ghost" className="model-remove" onClick={() => deleteModel(editingModel)}>
                <Trash2 size={14} aria-hidden="true" />
                {tr('删除模型')}
              </Button>
            </div>
          </div>
        )}
        {modelDrawer?.kind === 'add' && provider?.kind === 'builtin' && (
          <div className="model-drawer-form">
            <p className="hint">{tr('从内置目录选择要添加的模型，能力随目录一并复制。')}</p>
            <div className="settings-search model-catalog-search">
              <Search size={14} aria-hidden="true" />
              <input
                data-drawer-autofocus
                aria-label={locale === 'en-US' ? 'Search available models' : '搜索可用模型'}
                placeholder={locale === 'en-US' ? 'Search model name or ID' : '搜索模型名称或 ID'}
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
              />
            </div>
            <ul className="model-catalog-options" aria-label={tr('内置模型')}>
              {matchingCandidates.map((entry) => (
                <li key={entry.id}>
                  <label className="model-catalog-option">
                    <input
                      type="checkbox"
                      value={entry.id}
                      checked={catalogPicks.includes(entry.id)}
                      onChange={(event) =>
                        setCatalogPicks((previous) =>
                          event.target.checked ? [...previous, entry.id] : previous.filter((id) => id !== entry.id),
                        )
                      }
                    />
                    <span>
                      {entry.name}
                      <small>
                        {entry.id}
                        {' · ' + entry.contextWindow.toLocaleString()}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {!catalogCandidates.length && <p className="hint">{tr('该供应商的目录模型都已添加。')}</p>}
            {!!catalogCandidates.length && !matchingCandidates.length && (
              <p className="hint" role="status">
                {locale === 'en-US' ? 'No matching models' : '没有匹配的模型'}
              </p>
            )}
            <div className="drawer-actions">
              <Button size="sm" variant="primary" disabled={!catalogPicks.length} onClick={addCatalogModels}>
                {tr('添加所选模型')}
                {catalogPicks.length > 0 && <span aria-hidden="true">（{catalogPicks.length}）</span>}
              </Button>
              <Button size="sm" onClick={closeModelDrawer}>
                {tr('取消')}
              </Button>
            </div>
          </div>
        )}
        {modelDrawer?.kind === 'add' && provider?.kind === 'custom' && (
          <div className="model-drawer-form">
            <FieldRow
              label={tr('模型 ID')}
              htmlFor="model-new-id"
              description={tr('接口服务实际接受的模型名称，不查询 Pi 内置目录')}
            >
              <input
                data-drawer-autofocus
                id="model-new-id"
                aria-label={tr('模型 ID')}
                required
                spellCheck={false}
                placeholder={tr('填写服务方提供的模型 ID')}
                value={customId}
                onChange={(event) => setCustomId(event.target.value)}
              />
            </FieldRow>
            <div className="drawer-actions">
              <Button size="sm" variant="primary" disabled={!customId.trim()} onClick={addCustom}>
                {tr('添加模型')}
              </Button>
              <Button size="sm" onClick={closeModelDrawer}>
                {tr('取消')}
              </Button>
            </div>
          </div>
        )}
      </Drawer>
      {deleting && (
        <ConfirmDialog
          title={tr('删除提供商「{p0}」？', { p0: deleting.name })}
          description={
            locale === 'en-US'
              ? `Saving removes this provider, its ${modelsOf(deleting.id).length} models, and locally stored authentication credentials (API Key or OAuth). Existing task history stays.`
              : `保存设置后移除该提供商、它的 ${modelsOf(deleting.id).length} 个模型和本机保存的认证凭据（API Key 或 OAuth）。已有任务的历史记录会保留。`
          }
          confirmLabel={tr('删除提供商')}
          danger
          initialFocus="cancel"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            onDeleteProvider(deleting.id);
            setDeleting(null);
            requestAnimationFrame(() => addProviderButton.current?.focus());
          }}
        />
      )}
      {deletingModel && (
        <ConfirmDialog
          title={tr('删除模型「{p0}」？', { p0: deletingModel.name })}
          description={tr('保存设置后移除该模型；提供商的连接与密钥保持不变。')}
          confirmLabel={tr('删除模型')}
          danger
          initialFocus="cancel"
          onCancel={() => setDeletingModel(null)}
          onConfirm={() => {
            onModelDelete(deletingModel.id);
            setDeletingModel(null);
            setModelDrawer(null);
          }}
        />
      )}
    </div>
  );
}

function ThinkingLevels({
  model,
  catalogLevels,
  onChange,
}: {
  model: ProviderModel;
  catalogLevels?: ProviderModel['thinkingLevels'];
  onChange(patch: Partial<ProviderModel>): void;
}) {
  const levels = model.thinkingLevels ?? thinkingSchema.options;
  const hint = catalogLevels?.length
    ? tr('内置目录把 {p0} 列为此模型支持的程度；可自行增减，任务中的思考菜单只显示勾选项。', {
        p0: catalogLevels.map((level) => thinkingLabels[level]).join('、'),
      })
    : tr('仅勾选接口实际支持的程度；任务中的思考菜单只显示勾选项。');
  return (
    <fieldset className="thinking-levels" aria-describedby={'drawer-model-' + model.id + '-thinking-help'}>
      <legend>{tr('允许的思考程度')}</legend>
      <p id={'drawer-model-' + model.id + '-thinking-help'} className="hint">
        {hint}
      </p>
      <div className="thinking-level-options">
        {thinkingSchema.options.map((level) => (
          <label key={level} className="thinking-level-option">
            <input
              type="checkbox"
              value={level}
              checked={levels.includes(level)}
              onChange={(event) =>
                onChange({
                  thinkingLevels: thinkingSchema.options.filter((candidate) =>
                    candidate === level ? event.target.checked : levels.includes(candidate),
                  ),
                })
              }
            />
            <span>
              <Check size={14} aria-hidden="true" />
              {thinkingLabels[level]}
            </span>
          </label>
        ))}
      </div>
      {!levels.length && (
        <p className="form-feedback" role="alert" data-error="true">
          {tr('请至少选择一个允许的思考程度。')}
        </p>
      )}
    </fieldset>
  );
}
