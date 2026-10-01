import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverSharedSkills, updateIgnoredSkills } from '../src/main/skills.ts';
import { settingsSchema } from '../src/shared/contracts.ts';
import { defaultSkillsDirectory } from '../src/shared/skill-paths.ts';

test('default skills directory follows the current user home', () => {
  assert.equal(defaultSkillsDirectory(), join(homedir(), '.agents', 'skills'));
  assert.equal(defaultSkillsDirectory(join(tmpdir(), 'another user')), join(tmpdir(), 'another user', '.agents', 'skills'));
});

test('shared discovery preserves disabled entries and deduplicates symlinked imports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-shared-skills-'));
  try {
    const directory = defaultSkillsDirectory(root);
    const skillDirectory = join(directory, 'shared-workflow');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, 'SKILL.md'), '---\nname: shared-workflow\ndescription: Shared workflow\n---\nBody');
    const alias = join(root, 'imported-alias');
    await symlink(skillDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const settings = settingsSchema.parse({ resources: [{ id: 'saved', name: 'Saved name', path: join(alias, 'SKILL.md'), kind: 'skill', enabled: false }] });
    discoverSharedSkills(settings, directory);
    discoverSharedSkills(settings, directory);
    assert.equal(settings.resources.length, 1);
    assert.equal(settings.resources[0].name, 'Saved name');
    assert.equal(settings.resources[0].enabled, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('removal survives rediscovery without deleting shared files and reimport clears the exclusion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-skill-removal-'));
  try {
    const directory = defaultSkillsDirectory(root);
    const skillDirectory = join(directory, 'workflow');
    const path = join(skillDirectory, 'SKILL.md');
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path, '---\nname: workflow\ndescription: Shared workflow\n---\nSHARED_BODY');
    const previous = settingsSchema.parse({});
    discoverSharedSkills(previous, directory);
    assert.equal(previous.resources.length, 1);
    const removed = settingsSchema.parse({ ...previous, resources: [] });
    updateIgnoredSkills(previous, removed);
    assert.deepEqual(removed.ignoredSkillPaths, [path]);
    discoverSharedSkills(removed, directory);
    assert.equal(removed.resources.length, 0);
    assert.match(await readFile(path, 'utf8'), /SHARED_BODY/);
    const imported = settingsSchema.parse({ ...removed, resources: previous.resources });
    updateIgnoredSkills(removed, imported);
    discoverSharedSkills(imported, directory);
    assert.deepEqual(imported.ignoredSkillPaths, []);
    assert.equal(imported.resources.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing shared directory preserves existing imported resources', () => {
  const settings = settingsSchema.parse({ resources: [{ id: 'legacy', name: 'Existing', path: join(tmpdir(), 'legacy', 'SKILL.md'), kind: 'skill', enabled: true }] });
  const before = structuredClone(settings);
  discoverSharedSkills(settings, join(tmpdir(), 'missing-skills-' + crypto.randomUUID()));
  assert.deepEqual(settings, before);
});
