import { DATA_VERSION, dataSchema, type DesktopData } from '../shared/contracts.ts';

export class UnsupportedDataVersionError extends Error {
  constructor(readonly version: number) {
    super('数据由更新版本的 Pi Desktop 创建，请使用相应版本打开。');
  }
}

/** Migrations run before strict current-schema validation, and never mutate their input. */
export function migrateDesktopData(input: unknown): { data: DesktopData; fromVersion?: number } {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !('version' in input))
    throw new Error('桌面数据缺少版本信息');
  const version = input.version;
  if (typeof version === 'number' && version > DATA_VERSION) throw new UnsupportedDataVersionError(version);
  if (version !== 1 && version !== DATA_VERSION) throw new Error('无法识别桌面数据版本');
  // v2 establishes an explicit migration boundary. New settings use schema defaults.
  const data = dataSchema.parse({ ...input, version: DATA_VERSION });
  return { data, ...(version !== DATA_VERSION ? { fromVersion: version } : {}) };
}
