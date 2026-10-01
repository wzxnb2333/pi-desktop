import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { thinkingSchema, type ModelProvider, type ProviderModel } from './contracts.ts';

/**
 * Register one configured model on a pi runtime. A custom provider owns its endpoint and protocol;
 * a built-in one only overrides the endpoint when the user set a Base URL (proxy or gateway).
 */
export async function registerConfiguredModel(
  runtime: ModelRuntime,
  provider: ModelProvider,
  model: ProviderModel,
  apiKey: string | undefined,
  input: ('text' | 'image')[] = ['text', 'image'],
): Promise<void> {
  if (provider.kind === 'custom') {
    if (!provider.baseUrl) throw new Error('自定义提供商必须填写 Base URL');
    const url = new URL(provider.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 必须使用 HTTP(S)');
    runtime.registerProvider(provider.namespace, {
      baseUrl: provider.baseUrl,
      api: provider.api,
      apiKey: 'desktop-runtime',
      models: [{
        id: model.model,
        name: model.name,
        reasoning: model.reasoning,
        thinkingLevelMap: model.thinkingLevels ? Object.fromEntries(
          thinkingSchema.options.map((level) => [level,
            model.thinkingLevels?.includes(level) ? (level === 'off' ? undefined : level) : null]),
        ) : undefined,
        input,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
  } else if (provider.baseUrl)
    runtime.registerProvider(provider.namespace, { baseUrl: provider.baseUrl });
  if (apiKey) await runtime.setRuntimeApiKey(provider.namespace, apiKey);
}
