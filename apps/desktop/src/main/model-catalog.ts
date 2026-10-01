import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all';
import type { ModelCatalog } from '../shared/contracts.ts';

/** Static SDK data only: no credentials, endpoint URLs or provider discovery requests. */
export function modelCatalog(): ModelCatalog {
  return getBuiltinProviders().sort().map((id) => ({
    id,
    models: getBuiltinModels(id).map((model) => ({
      id: model.id, name: model.name, api: model.api, reasoning: model.reasoning,
      imageInput: model.input.includes('image'),
      contextWindow: model.contextWindow, maxTokens: model.maxTokens,
      thinkingLevels: getSupportedThinkingLevels(model),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  })).filter(({ models }) => models.length > 0);
}
