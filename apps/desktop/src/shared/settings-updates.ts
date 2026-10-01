import { settingsSchema, settingsPatchSchema, type Settings } from './contracts.ts';

export function sameSetting(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameSetting(value, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameSetting(a[key], b[key]));
}

export function settingsChanges(previous: Settings, next: Settings): Partial<Settings> {
  return Object.fromEntries((Object.keys(settingsSchema.shape) as (keyof Settings)[])
    .filter(key => !sameSetting(previous[key], next[key])).map(key => [key, next[key]]));
}

export function applySettingsPatch(current: Settings, patch: Partial<Settings>, base?: Partial<Settings>): Settings {
  const validated = settingsPatchSchema.parse(patch);
  if (base) for (const key of Object.keys(validated) as (keyof Settings)[]) {
    if (!Object.hasOwn(base, key) || (!sameSetting(current[key], base[key]) && !sameSetting(current[key], validated[key])))
      throw new Error('设置已在其他位置修改，当前草稿已保留。请重新打开设置后重试。');
  }
  return settingsSchema.parse({ ...current, ...validated });
}
