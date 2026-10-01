import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile, rename, unlink } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FileContent, FileEntry } from '../shared/contracts.ts';
import { safeProjectPath } from './policy.ts';
import { normalizedFileEdit } from '../shared/file-edits.ts';
import { setTimeout as delay } from 'node:timers/promises';

export async function listFiles(cwd: string, path: string): Promise<FileEntry[]> {
  const root = await safeProjectPath(cwd, path);
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.name !== '.git' && entry.name !== 'node_modules')
    .map((entry) => ({ name: entry.name, path: join(path, entry.name), directory: entry.isDirectory() }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}
export async function readProjectFile(cwd: string, path: string): Promise<FileContent> {
  const absolute = await safeProjectPath(cwd, path);
  const metadata = await stat(absolute);
  if (metadata.size > 10 * 1024 * 1024) throw new Error('文件超过 10 MB，请在外部编辑器中打开');
  const bytes = await readFile(absolute);
  const imageTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mime = imageTypes[extname(path).toLowerCase()];
  if (mime)
    return {
      path,
      kind: 'image',
      content: `data:${mime};base64,${bytes.toString('base64')}`,
      truncated: false,
    };
  if (bytes.includes(0))
    return { path, kind: 'binary', content: '二进制文件，请在外部应用中打开。', truncated: false };
  let writable = bytes.length <= 512000;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { writable = false; }
  return {
    path,
    kind: 'text',
    content: bytes.subarray(0, 512000).toString('utf8'),
    truncated: bytes.length > 512000,
    writable,
    version: createHash('sha256').update(bytes).digest('hex'),
  };
}

const pendingWrites = new Map<string, Promise<unknown>>();
export async function writeProjectFile(cwd: string, path: string, content: string, version: string): Promise<FileContent> {
  const absolute = await safeProjectPath(cwd, path);
  const previous = pendingWrites.get(absolute) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const original = await readProjectFile(cwd, path);
    if (!original.writable) throw new Error('此文件仅支持在外部编辑器中修改');
    if (original.version !== version) throw new Error('文件已被其他程序修改，请重新加载并合并后保存');
    const next = normalizedFileEdit(original.content, content);
    const temporary = absolute + '.pi-edit-' + crypto.randomUUID();
    try {
      await writeFile(temporary, next, { encoding: 'utf8', mode: (await stat(absolute)).mode, flag: 'wx' });
      const deadline = Date.now() + 2000;
      for (let attempt = 0; ; attempt++) {
        // Windows scanners and readers may temporarily deny replacement. Recheck the
        // version on every attempt; never delete the destination to bypass a lock.
        if ((await readProjectFile(cwd, path)).version !== version) throw new Error('保存期间文件发生变化，未覆盖原文件');
        try { await rename(temporary, absolute); break; }
        catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
          if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(String(code)) || Date.now() >= deadline) throw error;
          await delay(Math.min(25 * (attempt + 1), 200, Math.max(1, deadline - Date.now())));
        }
      }
    } finally { await unlink(temporary).catch(() => {}); }
    const saved = await readProjectFile(cwd, path);
    if (saved.version !== createHash('sha256').update(next, 'utf8').digest('hex'))
      throw new Error('文件在保存后再次变化，草稿已保留，请比较磁盘内容');
    return saved;
  });
  pendingWrites.set(absolute, operation);
  try { return await operation; } finally { if (pendingWrites.get(absolute) === operation) pendingWrites.delete(absolute); }
}
