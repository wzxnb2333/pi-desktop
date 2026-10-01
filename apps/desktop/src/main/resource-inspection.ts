import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { loadSkills, loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { type ResourceDiagnostic, type ResourceInspection, type Settings, resourceInspectionSchema } from '../shared/contracts.ts';
import { defaultSkillsDirectory, skillPathKey } from '../shared/skill-paths.ts';

/** Source checks never import extensions or restart a task. Runtime failures come from the worker. */
export function inspectResources(settings: Settings, directory = defaultSkillsDirectory()): ResourceInspection {
  const diagnostics: ResourceDiagnostic[] = [];
  const descriptions: Record<string, string> = {};
  const ignored = new Set(settings.ignoredSkillPaths.map(skillPathKey));
  try {
    readdirSync(directory);
    diagnostics.push(...loadSkillsFromDir({ dir: directory, source: 'user' }).diagnostics
      .filter(item => !item.path || !ignored.has(skillPathKey(item.path)))
      .map(item => ({ kind: 'skill' as const, type: item.type, path: item.path, message: item.message })));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      diagnostics.push({ kind: 'skill', type: 'error', path: directory, message: error instanceof Error ? error.message : String(error) });
  }
  const options = { cwd: directory, agentDir: directory, includeDefaults: false };
  for (const resource of settings.resources) {
    if (resource.kind === 'skill') {
      const result = loadSkills({ ...options, skillPaths: [resource.path] });
      diagnostics.push(...result.diagnostics.map(item => ({ kind: 'skill' as const, type: item.type, path: item.path, message: item.message })));
      if (result.skills.length) descriptions[resource.id] = result.skills.map(skill => skill.description).join('\n');
      else if (!result.diagnostics.length)
        diagnostics.push({ kind: 'skill', type: 'error', path: resource.path, message: '未发现有效 Skill，请检查 SKILL.md 的 front matter 与 description。' });
    } else {
      try {
        if (!statSync(resource.path).isFile()) throw new Error('扩展路径不是普通文件');
        accessSync(resource.path, constants.R_OK);
      } catch (error) {
        diagnostics.push({ kind: 'extension', type: 'error', path: resource.path, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  const enabled = settings.resources.filter(item => item.kind === 'skill' && item.enabled).map(item => item.path);
  diagnostics.push(...loadSkills({ ...options, skillPaths: enabled }).diagnostics
    .filter(item => item.type === 'collision')
    .map(item => ({ kind: 'skill' as const, type: item.type, path: item.path, message: item.message + (item.collision ? '；实际使用：' + item.collision.winnerPath : '') })));
  const unique = new Map(diagnostics.map(item => [JSON.stringify([item.kind, item.type, item.path ? skillPathKey(item.path) : '', item.message]), item]));
  return resourceInspectionSchema.parse({ directory, checkedAt: Date.now(), descriptions, diagnostics: [...unique.values()] });
}
