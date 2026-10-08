/**
 * Two derived numbers shown in the context-usage tooltip. Both are pure so the boundaries (missing provider
 * fields, a zero-length run, no output) stay testable instead of hiding inside the worker.
 */

/** Share of prompt tokens served from the provider cache, as a percentage. Undefined when nothing is cached. */
export function cacheHitPercent(cacheRead: number | undefined, input: number | undefined): number | undefined {
  if (typeof cacheRead !== 'number' || typeof input !== 'number') return undefined;
  const total = input + cacheRead;
  if (!(cacheRead > 0) || !(total > 0)) return undefined;
  return cacheRead / total * 100;
}

/** Output tokens per second across one run. Undefined while a run has no measurable output or no duration. */
export function outputPerSecond(outputTokens: number | undefined, elapsedMs: number | undefined): number | undefined {
  if (typeof outputTokens !== 'number' || typeof elapsedMs !== 'number') return undefined;
  if (!(outputTokens > 0) || !(elapsedMs > 0)) return undefined;
  return Math.round(outputTokens / (elapsedMs / 1000) * 10) / 10;
}
