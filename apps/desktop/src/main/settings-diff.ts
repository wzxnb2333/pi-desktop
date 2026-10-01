import type { Settings } from '../shared/contracts.ts';

/**
 * The settings a warm worker keeps depending on. `worker/agent.ts` reads `config.settings.resources`
 * (skill paths), `config.mcp` and `config.provider` + `config.apiKey`, and all four are handed to the
 * process once at `init`, so an edit only reaches a task after its worker is replaced.
 *
 * Everything else is read by the main process at the point of use (`terminal` in `terminal.open`,
 * `editor` in `file.open`, theme/fontSize/sendShortcut/keepInTray in the renderer) or is a default for
 * threads that do not exist yet (`policy`, `thinking`, `providerId` — a live thread carries its own
 * copy, and `thread.update` already drops that one worker).
 */
export const WORKER_SETTING_GROUPS = ['providers', 'resources', 'ignoredSkillPaths', 'mcpServers', 'mcpToolPolicies', 'subtasksEnabled'] as const;
export type WorkerSettingGroup = (typeof WORKER_SETTING_GROUPS)[number];

/**
 * The worker-scoped groups whose saved values actually differ, so a settings save only tears down the
 * agent processes an edit could not reach. `settings.save` compares *after* re-deriving
 * `provider.hasKey` from the vault, so a key written through `provider.key` in the same session does
 * not read as a provider edit here.
 */
export function changedWorkerSettingGroups(previous: Settings, next: Settings): WorkerSettingGroup[] {
  return WORKER_SETTING_GROUPS.filter((group) => !sameValue(previous[group], next[group]));
}

/**
 * Structural equality over the JSON-shaped values the contracts allow: string, number, boolean, null,
 * array, plain object. Object key order is irrelevant; array order is not, so a reordered provider
 * list is reported as a change instead of being assumed harmless.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}
