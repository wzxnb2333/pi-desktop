import { loadSkills } from '@earendil-works/pi-coding-agent';
import type { Settings, Thread } from '../shared/contracts.ts';
import type { InputCatalog } from '../shared/input-context.ts';
import { skillPathKey } from '../shared/skill-paths.ts';

/** Inspect only metadata. Opening the picker must never launch extensions or MCP processes. */
export function inputCatalog(thread: Thread, settings: Settings, agentDir: string, multiDirectory = false): InputCatalog {
  const skills = loadSkills({ cwd: thread.cwd, agentDir, includeDefaults: false,
    skillPaths: settings.resources.filter(item => item.kind === 'skill' && item.enabled).map(item => item.path) }).skills;
  const readonly = thread.planMode || thread.policy === 'deny';
  const tools = ['read', 'grep', 'find', 'ls', 'update_plan', ...(readonly ? [] : ['powershell', 'edit', 'write'])];
  if (multiDirectory) tools.push('project_read', 'project_list', ...(readonly ? [] : ['project_write']));
  if (!thread.projectId) tools.splice(0, tools.length, 'update_plan');
  const busy = ['running', 'waiting'].includes(thread.status);
  return {
    commands: [{ id: 'compact', enabled: !busy && !!thread.modelId }, { id: 'plan', enabled: !busy },
      { id: 'stop', enabled: busy }, { id: 'skills', enabled: true },
      { id: 'goal', enabled: !thread.review && !thread.sidechat?.temporary }, { id: 'review', enabled: !!thread.projectId && !busy },
      { id: 'help', enabled: true }, { id: 'templates', enabled: true }, { id: 'history', enabled: true }, { id: 'expand', enabled: true }],
    references: [
      ...skills.filter(skill => !settings.ignoredSkillPaths.some(path => skillPathKey(path) === skillPathKey(skill.filePath)))
        .map(skill => ({ kind: 'skill' as const, id: skill.filePath, label: skill.name, description: skill.description })),
      ...tools.map(name => ({ kind: 'tool' as const, id: name, label: name, description: '' })),
      ...(readonly ? [] : (thread.mcp ?? []).filter(server => server.state === 'connected').flatMap(server => server.tools
        .map(tool => ({ kind: 'tool' as const, id: tool.name, label: tool.label || tool.name, description: tool.description })))),
    ],
  };
}
