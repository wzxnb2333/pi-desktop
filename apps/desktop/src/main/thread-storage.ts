import { readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { safeProjectPath } from './policy.ts';

/** Purge only this application's owned files; forks and imported sessions retain their data. */
export async function purgeThreadFiles(storage: string, thread: { id: string; sessionFile?: string }, retained: unknown): Promise<void> {
  if (!thread.id || ['.', '..'].includes(thread.id) || thread.id.includes('/') || thread.id.includes('\\')) throw new Error('任务存储标识无效');
  const root = await realpath(storage);
  const referenced: string[] = [];
  const normalize = (value: string) => {
    const path = value.replaceAll('\\', '/');
    return process.platform === 'win32' ? path.toLowerCase() : path;
  };
  const visit = (value: unknown): void => {
    if (typeof value === 'string') referenced.push(normalize(value));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(retained);
  const remove = async (path: string) => {
    if (referenced.some(value => value.includes(normalize(path)))) return;
    await unlink(await safeProjectPath(root, path)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  };
  if (thread.sessionFile) {
    const target = resolve(thread.sessionFile);
    const rel = relative(join(root, 'agent', 'sessions'), target);
    if (rel && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) await remove(target);
  }
  const directory = await safeProjectPath(root, join(root, 'attachments', thread.id));
  const collect = async (folder: string): Promise<void> => {
    const entries = await readdir(folder, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await collect(await safeProjectPath(root, path));
      else if (entry.isFile()) await remove(path);
    }
  };
  await collect(directory);
  // A standalone chat owns only an empty sandbox. Never recursively remove it:
  // forks can still use this directory, and unexpected contents require inspection.
  const workspace = await safeProjectPath(root, join(root, 'chat-workspaces', thread.id));
  if (!referenced.some(value => value.includes(normalize(workspace)))) {
    await rmdir(workspace).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code ?? '')) throw error;
    });
  }
}
