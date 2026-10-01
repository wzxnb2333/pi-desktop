import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import type { Settings } from '../shared/contracts.ts';
import { defaultSkillsDirectory, skillPathKey } from '../shared/skill-paths.ts';

export async function createSharedSkill(input: { name: string; content: string }, persist: (resource: Settings['resources'][number]) => Promise<void>, directory = defaultSkillsDirectory()) {
  await mkdir(directory, { recursive: true });
  const dir = await mkdtemp(join(directory, 'pi-'));
  const path = join(dir, 'SKILL.md');
  const resource = { id: randomUUID(), path, name: input.name, kind: 'skill' as const, enabled: true };
  let owned = false;
  let written = false;
  try {
    const file = await open(path, 'wx');
    owned = true;
    try { await file.writeFile(input.content, 'utf8'); written = true; }
    finally { await file.close(); }
    await persist(resource);
    return resource;
  } catch (error) {
    try {
      if (owned) {
        const current = written ? await readFile(path, 'utf8').catch(reason => { if (reason.code !== 'ENOENT') throw reason; }) : undefined;
        if (current !== undefined && current !== input.content) throw new Error('SKILL.md changed during creation');
        await unlink(path).catch(reason => { if (reason.code !== 'ENOENT') throw reason; });
      }
      // Never recursively delete a directory that another process may have added files to.
      await rmdir(dir);
    } catch (cleanupError) {
      const message = error instanceof Error ? error.message : String(error);
      throw new AggregateError([error, cleanupError], message + '\nSkill cleanup failed; retained files: ' + dir);
    }
    throw error;
  }
}

export function discoverSharedSkills(settings: Settings, directory = defaultSkillsDirectory()): void {
  const known = new Set([
    ...settings.resources.filter((resource) => resource.kind === 'skill').map((resource) => skillPathKey(resource.path)),
    ...settings.ignoredSkillPaths.map(skillPathKey),
  ]);
  for (const skill of loadSkillsFromDir({ dir: directory, source: 'user' }).skills) {
    const key = skillPathKey(skill.filePath);
    if (known.has(key)) continue;
    known.add(key);
    settings.resources.push({ id: randomUUID(), name: skill.name, path: skill.filePath, kind: 'skill', enabled: true });
  }
}

export function updateIgnoredSkills(previous: Settings, next: Settings): void {
  const retained = new Set(next.resources.filter((resource) => resource.kind === 'skill').map((resource) => skillPathKey(resource.path)));
  const ignored = new Map(previous.ignoredSkillPaths.map((path) => [skillPathKey(path), path]));
  for (const resource of previous.resources) {
    if (resource.kind === 'skill' && !retained.has(skillPathKey(resource.path)))
      ignored.set(skillPathKey(resource.path), resource.path);
  }
  for (const key of retained) ignored.delete(key);
  next.ignoredSkillPaths = [...ignored.values()];
}
