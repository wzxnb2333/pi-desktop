import { DATA_VERSION, dataSchema, type DesktopData } from '../shared/contracts.ts';

export class UnsupportedDataVersionError extends Error {
  constructor(readonly version: number) {
    super('数据由更新版本的 Pi Desktop 创建，请使用相应版本打开。');
  }
}

/** Legacy (`version` < 3) entry: connection and model lived in one record, keyed by the model id. */
type LegacyModel = Record<string, unknown>;
export interface ProviderKeyMove {
  /** Legacy vault id (`provider:<legacy model id>`). */
  from: string;
  /** Provider that inherits the credential. */
  to: string;
}
export interface MigrationOptions {
  /**
   * Vault id (`provider:<legacy model id>`) -> opaque fingerprint of the stored API key. Migrated
   * entries merge only when connection *and* key match, so two keys never collapse into one
   * credential. Absent when the vault cannot be read (fresh install, tests), where grouping falls
   * back to the connection alone.
   */
  providerKeyFingerprints?: Record<string, string>;
}
export interface MigrationResult {
  data: DesktopData;
  fromVersion?: number;
  /** Vault ids that have to follow their model into a merged provider. */
  providerKeyMoves?: ProviderKeyMove[];
}

/** Migrations run before strict current-schema validation, and never mutate their input. */
export function migrateDesktopData(input: unknown, options: MigrationOptions = {}): MigrationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('version' in input))
    throw new Error('桌面数据缺少版本信息');
  const version = input.version;
  if (typeof version === 'number' && version > DATA_VERSION) throw new UnsupportedDataVersionError(version);
  if (version !== 1 && version !== 2 && version !== DATA_VERSION) throw new Error('无法识别桌面数据版本');
  const source = structuredClone(input) as Record<string, unknown>;
  // v3 splits the flat model list into providers (connection + credential) and the models under them.
  const moves = version === DATA_VERSION ? [] : splitModels(source, options);
  const data = dataSchema.parse({ ...source, version: DATA_VERSION });
  return {
    data,
    ...(version !== DATA_VERSION ? { fromVersion: version } : {}),
    ...(moves.length ? { providerKeyMoves: moves } : {}),
  };
}

/**
 * Rewrite `settings.providers` into `settings.modelProviders` + `settings.models` in place.
 * Model ids survive, so every existing task keeps pointing at the same model.
 */
function splitModels(data: Record<string, unknown>, options: MigrationOptions): ProviderKeyMove[] {
  const settings = asRecord(data.settings);
  if (!settings) return [];
  const legacy = Array.isArray(settings.providers) ? settings.providers.filter(isRecord) : [];
  const moves: ProviderKeyMove[] = [];
  const providers: Record<string, unknown>[] = [];
  const models: Record<string, unknown>[] = [];
  const groups = new Map<string, { id: string; name: string; used: number; namespace: string; custom: boolean; baseUrl: string; api: string }>();
  const names = new Set<string>();
  for (const entry of legacy) {
    const id = text(entry.id);
    const upstream = text(entry.model);
    if (!id) continue;
    const custom = entry.custom === true;
    const namespace = text(entry.provider) || 'openai';
    const baseUrl = text(entry.baseUrl);
    const api = text(entry.api) || 'openai-completions';
    const fingerprint = options.providerKeyFingerprints?.[`provider:${id}`] ?? '';
    // Custom namespaces are generated per provider id, so they never discriminate a connection.
    const key = [custom ? 'custom' : 'builtin', custom ? '' : namespace, baseUrl, api, fingerprint].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      const created = { id, name: text(entry.name) || namespace, used: 0, namespace: custom ? 'desktop-' + id : namespace, custom, baseUrl, api };
      groups.set(key, created);
      group = created;
      providers.push({
        id: created.id, name: uniqueName(names, created.name, () => ++created.used), kind: custom ? 'custom' : 'builtin',
        namespace: created.namespace, baseUrl, api,
      });
    } else if (id !== group.id) moves.push({ from: `provider:${id}`, to: `provider:${group.id}` });
    models.push({
      id, provider: group.id, name: text(entry.name) || upstream || id, model: upstream,
      reasoning: entry.reasoning !== false,
      ...(Array.isArray(entry.thinkingLevels) && entry.thinkingLevels.length ? { thinkingLevels: entry.thinkingLevels } : {}),
      ...(typeof entry.contextWindow === 'number' ? { contextWindow: entry.contextWindow } : {}),
      ...(typeof entry.maxTokens === 'number' ? { maxTokens: entry.maxTokens } : {}),
    });
  }
  settings.modelProviders = providers;
  settings.models = models;
  // The default model survives id-for-id; the legacy field name pointed at the same entry.
  settings.modelId = text(settings.providerId);
  delete settings.providers;
  delete settings.providerId;
  for (const thread of records(data.threads)) rename(thread, 'providerId', 'modelId');
  for (const automation of records(data.automations)) renameExecution(automation);
  for (const run of records(data.automationRuns)) renameExecution(asRecord(run.configuration));
  return moves;
}

function renameExecution(automation: Record<string, unknown> | undefined): void {
  const execution = automation ? asRecord(automation.execution) : undefined;
  if (execution) rename(execution, 'providerId', 'modelId');
}

function rename(target: Record<string, unknown>, from: string, to: string): void {
  if (target[from] === undefined) return;
  target[to] = target[from];
  delete target[from];
}

function uniqueName(names: Set<string>, preferred: string, next: () => number): string {
  let name = preferred;
  while (names.has(name)) name = `${preferred} ${next() + 1}`;
  names.add(name);
  return name;
}

function isRecord(value: unknown): value is LegacyModel {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
