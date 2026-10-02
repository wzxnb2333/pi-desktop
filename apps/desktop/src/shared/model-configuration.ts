import type { ModelApi, ModelCatalog, ModelProvider, ProviderModel, Settings } from './contracts.ts';

export type CatalogProvider = ModelCatalog[number];
export type CatalogModel = CatalogProvider['models'][number];
export const MODEL_APIS: readonly ModelApi[] = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];

/** A provider that talks to a user-supplied endpoint and carries its own protocol. */
export function customProvider(id: string, name: string): ModelProvider {
  return { id, name, kind: 'custom', namespace: 'desktop-' + id, baseUrl: '', api: 'openai-completions', hasKey: false };
}

/** A provider that uses one namespace from the SDK catalog; the endpoint stays optional. */
export function builtinProvider(id: string, namespace: string): ModelProvider {
  return { id, name: namespace, kind: 'builtin', namespace, baseUrl: '', api: 'openai-completions', hasKey: false };
}

export function catalogProvider(catalog: ModelCatalog | null, namespace: string): CatalogProvider | undefined {
  return catalog?.find((entry) => entry.id === namespace);
}

export function providerModels(models: readonly ProviderModel[], providerId: string): ProviderModel[] {
  return models.filter((model) => model.provider === providerId);
}

export function findModel(settings: Settings, modelId: string): ProviderModel | undefined {
  return settings.models.find((model) => model.id === modelId);
}

export function findModelProvider(settings: Settings, model: ProviderModel | undefined): ModelProvider | undefined {
  return model ? settings.modelProviders.find((provider) => provider.id === model.provider) : undefined;
}

/** Catalog entry behind a built-in model, or undefined for custom providers and unknown ids. */
export function catalogModel(provider: ModelProvider | undefined, model: ProviderModel | undefined, catalog: ModelCatalog | null): CatalogModel | undefined {
  if (!provider || !model || provider.kind !== 'builtin') return undefined;
  return catalogProvider(catalog, provider.namespace)?.models.find((entry) => entry.id === model.model);
}

/** A model created from a catalog entry copies the capabilities the SDK reports for it. */
export function modelFromCatalog(providerId: string, entry: CatalogModel): ProviderModel {
  return {
    id: crypto.randomUUID(),
    provider: providerId,
    name: entry.name,
    model: entry.id,
    reasoning: entry.reasoning,
    thinkingLevels: [...entry.thinkingLevels],
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
  };
}

/** Capabilities a custom model starts from; every value stays editable. */
export function customModel(providerId: string, model: string): ProviderModel {
  return {
    id: crypto.randomUUID(),
    provider: providerId,
    name: model,
    model,
    reasoning: true,
    thinkingLevels: ['low', 'high', 'xhigh', 'max'],
    contextWindow: 128000,
    maxTokens: 8192,
  };
}

export function validateProvider(provider: ModelProvider, catalog: ModelCatalog | null): void {
  const label = provider.name.trim() || '未命名提供商';
  if (!provider.name.trim()) throw new Error('请填写提供商的显示名称');
  if (provider.kind === 'builtin') {
    if (!catalog) throw new Error('内置模型目录尚未加载，请重试或改用自定义提供商');
    if (!catalogProvider(catalog, provider.namespace)) throw new Error(label + '：内置供应商已不存在，请重新选择');
  }
  const endpoint = provider.baseUrl.trim();
  if (provider.kind === 'custom' && !endpoint) throw new Error(label + '：请填写接口服务地址');
  if (endpoint) checkEndpoint(label, endpoint);
}

export function validateModel(model: ProviderModel, provider: ModelProvider | undefined, catalog: ModelCatalog | null): void {
  const label = model.name.trim() || '未命名模型';
  if (!provider) throw new Error(label + '：所属提供商已不存在，请重新选择');
  if (!model.name.trim()) throw new Error('请填写模型的显示名称');
  if (!model.model.trim()) throw new Error(label + '：请填写接口服务提供的模型 ID');
  if (model.reasoning && model.thinkingLevels?.length === 0) throw new Error(label + '：请至少选择一个允许的思考程度');
  if (provider.kind === 'custom') {
    if (!Number.isInteger(model.contextWindow) || model.contextWindow < 1024 || model.contextWindow > 10000000)
      throw new Error(label + '：上下文窗口需为 1,024–10,000,000 之间的整数');
    if (!Number.isInteger(model.maxTokens) || model.maxTokens < 256 || model.maxTokens > 1000000)
      throw new Error(label + '：最大输出 Token 需为 256–1,000,000 之间的整数');
    return;
  }
  const entry = catalogModel(provider, model, catalog);
  if (!catalog) throw new Error('内置模型目录尚未加载，请重试或改用自定义提供商');
  if (!entry) throw new Error(label + '：当前模型不在该提供商的内置目录中，请重新选择或改用自定义提供商');
  // The catalogue's levels are a default, not a fence: a gateway or a newer model revision can accept
  // levels the pinned catalogue does not list, and the settings page lets the user own that list.
}

function checkEndpoint(label: string, endpoint: string): void {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error(label + '：请填写有效的 Base URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(label + '：Base URL 必须是 HTTP(S) 地址，密钥请填入 API Key');
}
