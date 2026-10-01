import type { ModelCatalog, Provider } from './contracts.ts';

export type ConnectionMode = 'builtin' | 'custom';
export type ConnectionValues = Omit<Provider, 'id' | 'name' | 'hasKey'>;
export const CUSTOM_APIS: Provider['api'][] = [
  'openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai',
];

export function connectionMode(provider: Provider): ConnectionMode {
  return provider.custom || provider.baseUrl ? 'custom' : 'builtin';
}

export function connectionValues(provider: Provider): ConnectionValues {
  const { provider: namespace, model, baseUrl, api, custom, reasoning, thinkingLevels, contextWindow, maxTokens } = provider;
  return { provider: namespace, model, baseUrl, api, custom, reasoning, thinkingLevels, contextWindow, maxTokens };
}

export function builtinConnection(catalog: ModelCatalog, providerId?: string, modelId?: string): ConnectionValues {
  const provider = catalog.find(({ id }) => id === (providerId ?? 'openai')) ?? catalog[0];
  const model = provider?.models.find(({ id }) => id === (modelId ?? 'gpt-4.1')) ?? provider?.models[0];
  if (!provider || !model) throw new Error('内置模型目录为空，请使用自定义接口');
  return {
    provider: provider.id, model: model.id, baseUrl: '', custom: false,
    api: CUSTOM_APIS.find((api) => api === model.api) ?? 'openai-completions',
    reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
    thinkingLevels: model.thinkingLevels,
  };
}

export function customConnection(id: string): ConnectionValues {
  return {
    provider: 'desktop-' + id, model: '', baseUrl: '', api: 'openai-completions', custom: true,
    reasoning: false, contextWindow: 128000, maxTokens: 8192,
    thinkingLevels: ['low', 'high', 'xhigh', 'max'],
  };
}

export function convertEndpointOverride(provider: Provider, catalog: ModelCatalog): ConnectionValues {
  const model = catalog.find(({ id }) => id === provider.provider)?.models.find(({ id }) => id === provider.model);
  const api = CUSTOM_APIS.find((api) => api === model?.api);
  if (!model || !api) throw new Error('此内置模型不能自动转换，请新建自定义接口');
  return {
    ...connectionValues(provider), provider: 'desktop-' + provider.id, custom: true, api,
    reasoning: model.reasoning, contextWindow: model.contextWindow, maxTokens: model.maxTokens,
    thinkingLevels: provider.thinkingLevels ?? model.thinkingLevels,
  };
}

export function validateModelConfiguration(provider: Provider, catalog: ModelCatalog | null, mode: ConnectionMode): void {
  const label = provider.name.trim() || '未命名模型';
  if (!provider.name.trim()) throw new Error('请填写模型的显示名称');
  if (!provider.model.trim()) throw new Error(label + '：请填写接口服务提供的模型 ID');
  if (provider.reasoning && provider.thinkingLevels?.length === 0)
    throw new Error(label + '：请至少选择一个允许的思考程度');
  if (provider.custom && (!Number.isInteger(provider.contextWindow) || provider.contextWindow < 1024 || provider.contextWindow > 10000000))
    throw new Error(label + '：上下文窗口需为 1,024–10,000,000 之间的整数');
  if (provider.custom && (!Number.isInteger(provider.maxTokens) || provider.maxTokens < 256 || provider.maxTokens > 1000000))
    throw new Error(label + '：最大输出 Token 需为 256–1,000,000 之间的整数');
  if (mode === 'custom') {
    let url: URL;
    try { url = new URL(provider.baseUrl); } catch { throw new Error(label + '：请填写有效的 Base URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error(label + '：Base URL 必须是 HTTP(S) 地址，密钥请填入 API Key');
  }
  if (!provider.custom) {
    if (!catalog) throw new Error('内置模型目录尚未加载，请重试或选择自定义接口');
    if (!catalog.find(({ id }) => id === provider.provider)?.models.some(({ id }) => id === provider.model))
      throw new Error(label + '：当前模型不在该供应商的内置目录中，请重新选择或改用自定义接口');
    const model = catalog.find(({ id }) => id === provider.provider)?.models.find(({ id }) => id === provider.model);
    if (provider.thinkingLevels?.some((level) => !model?.thinkingLevels.includes(level)))
      throw new Error(label + '：所选思考程度不在此内置模型支持的范围内');
  }
}
