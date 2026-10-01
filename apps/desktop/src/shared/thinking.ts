import { type Provider, type Thread, thinkingSchema } from './contracts.ts';

export type ThinkingLevel = Thread['thinking'];

export function allowedThinkingLevels(provider: Provider): ThinkingLevel[] {
  if (!provider.reasoning) return ['off'];
  const configured = provider.thinkingLevels ?? ['off', 'minimal', 'low', 'medium', 'high'];
  return thinkingSchema.options.filter((level) => configured.includes(level));
}

export function resolveThinkingLevel(provider: Provider | undefined, requested: ThinkingLevel): ThinkingLevel {
  if (!provider) return requested;
  const allowed = allowedThinkingLevels(provider);
  if (allowed.includes(requested)) return requested;
  const index = thinkingSchema.options.indexOf(requested);
  return thinkingSchema.options.slice(index).find((level) => allowed.includes(level))
    ?? thinkingSchema.options.slice(0, index).reverse().find((level) => allowed.includes(level))
    ?? 'off';
}
