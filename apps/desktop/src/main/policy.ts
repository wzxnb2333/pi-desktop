import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Policy } from '../shared/contracts.ts';

const readOnlyTools = new Set(['read', 'grep', 'find', 'ls', 'project_read', 'project_list', 'list_project_actions']);
export function evaluateAction(policy: Policy, planMode: boolean, tool: string): 'allow' | 'ask' | 'review' | 'deny' {
  if (readOnlyTools.has(tool)) return 'allow';
  if (planMode || policy === 'deny') return 'deny';
  return policy === 'auto' ? 'review' : policy === 'full' ? 'allow' : 'ask';
}

export async function safeProjectPath(root: string, requested: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const target = resolve(root, requested);
  const inside = (path: string) => {
    const rel = relative(canonicalRoot, path);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (!inside(target)) throw new Error('路径超出项目目录');
  let current = target;
  while (true) {
    try {
      if (!inside(await realpath(current))) throw new Error('链接目标超出项目目录');
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw new Error('无法确认项目路径');
      current = parent;
    }
  }
}

// Match Pi's tool path aliases before checking the filesystem boundary.
export async function resolveAgentFile(
  root: string,
  requested: string,
  allowedReads: string[] = [],
  unrestricted = false,
): Promise<string> {
  let path = requested.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ').replace(/^@/, '');
  if (process.platform === 'win32' && !path.includes('\\')) {
    const drive = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive) path = `${drive[1].toUpperCase()}:\\${(drive[2] || '').replaceAll('/', '\\')}`;
  }
  if (path === '~') path = homedir();
  else if (/^~[\\/]/.test(path)) path = resolve(homedir(), path.slice(2));
  else if (path.startsWith('file://')) path = fileURLToPath(path);
  const target = resolve(root, path);
  if (unrestricted) return target;
  for (const allowed of allowedReads) {
    try {
      if ((await realpath(target)) === (await realpath(allowed))) return target;
    } catch {
      /* Missing resources must still pass the normal project boundary. */
    }
  }
  return safeProjectPath(root, target);
}
