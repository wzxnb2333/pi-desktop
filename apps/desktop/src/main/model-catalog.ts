import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { builtinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ModelCatalog } from '../shared/contracts.ts';

/** Static SDK data only: no credentials, endpoint URLs or provider discovery requests. */
export function modelCatalog(): ModelCatalog {
  return builtinProviders().sort((a, b) => a.id.localeCompare(b.id)).map((provider) => ({
    id: provider.id,
    auth: { apiKey: !!provider.auth.apiKey, ...(provider.auth.oauth ? { oauth: {
      name: provider.auth.oauth.name, loginLabel: provider.auth.oauth.loginLabel, isSubscription: provider.auth.oauth.isSubscription,
    } } : {}) },
    models: provider.getModels().map((model) => ({
      id: model.id, name: model.name, api: model.api, reasoning: model.reasoning,
      imageInput: model.input.includes('image'),
      contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      thinkingLevels: getSupportedThinkingLevels(model),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).filter(({ models }) => models.length > 0);
}
