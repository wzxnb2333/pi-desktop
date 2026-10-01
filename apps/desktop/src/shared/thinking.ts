import { type ProviderModel, type Thread, thinkingSchema } from './contracts.ts';

export type ThinkingLevel = Thread['thinking'];

export function allowedThinkingLevels(model: ProviderModel): ThinkingLevel[] {
  if (!model.reasoning) return ['off'];
  const configured = model.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high'];
  return thinkingSchema.options.filter((level) => configured.includes(level));
}

export function resolveThinkingLevel(model: ProviderModel | undefined, requested: ThinkingLevel): ThinkingLevel {
  if (!model) return requested;
  const allowed = allowedThinkingLevels(model);
  if (allowed.includes(requested)) return requested;
  const index = thinkingSchema.options.indexOf(requested);
  return thinkingSchema.options.slice(index).find((level) => allowed.includes(level))
    ?? thinkingSchema.options.slice(0, index).reverse().find((level) => allowed.includes(level))
    ?? 'off';
}
