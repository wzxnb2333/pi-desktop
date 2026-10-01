import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative } from 'node:path';
import { safeProjectPath } from './policy.ts';

export const artifactHash = (value: Uint8Array | string): string => createHash('sha256').update(value).digest('hex');
export async function artifactFile(root: string, requested: string, limit = 50 * 1024 * 1024) {
  const path = await safeProjectPath(root, requested), info = await stat(path);
  if (!info.isFile() || info.size > limit) throw new Error('预览文件不存在或超过 50 MB');
  const bytes = await readFile(path); if (bytes.length > limit) throw new Error('预览文件不存在或超过 50 MB');
  return { path: relative(root, path).replaceAll('\\', '/'), bytes, version: artifactHash(bytes) };
}
export function artifactKind(path: string): 'pdf' | 'html' {
  const extension = extname(path).toLowerCase();
  if (extension === '.pdf') return 'pdf';
  if (extension === '.html' || extension === '.htm') return 'html';
  throw new Error('内置产物预览仅支持 PDF 和 HTML');
}
export function artifactMime(path: string): string | undefined {
  return ({ '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.wasm': 'application/wasm' } as Record<string, string>)[extname(path).toLowerCase()];
}
