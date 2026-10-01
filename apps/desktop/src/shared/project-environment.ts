import { z } from 'zod';

export const projectEnvironmentSchema = z.object({
  shell: z.enum(['powershell', 'cmd', 'git-bash']).default('powershell'),
  initialization: z.string().max(8000).default(''),
  cleanup: z.string().max(8000).default(''),
  actions: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(100), command: z.string().trim().min(1).max(8000) }).strict()).max(30).default([]),
}).strict().refine(value => new Set(value.actions.map(action => action.id)).size === value.actions.length, '项目动作标识不能重复');
export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>;

export function projectAction(environment: ProjectEnvironment, kind: 'initialization' | 'cleanup' | 'action', actionId = ''): { name: string; command: string } {
  if (kind === 'action') {
    const action = environment.actions.find(item => item.id === actionId);
    if (!action) throw new Error('项目动作不存在，请刷新配置');
    return action;
  }
  const command = environment[kind];
  if (!command.trim()) throw new Error('尚未配置此项目命令');
  return { name: kind === 'initialization' ? '初始化环境' : '清理环境', command };
}
