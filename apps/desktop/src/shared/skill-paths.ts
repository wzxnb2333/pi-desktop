import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function defaultSkillsDirectory(home = homedir()): string {
  return join(home, '.agents', 'skills');
}

export function skillPathKey(path: string): string {
  let canonical = resolve(path);
  try {
    canonical = realpathSync(canonical);
  } catch {
    // Keep exclusions stable while a skill is temporarily absent.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}
