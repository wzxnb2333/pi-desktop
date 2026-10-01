import { tr } from "../../../shared/localization.ts";
import { webUrlSchema } from '../../../shared/contracts.ts';

export type MessageLink = { kind: 'web'; url: string } | { kind: 'file'; path: string; line?: number; column?: number } | { kind: 'unavailable'; reason: string };

function segments(path: string): string[] | undefined {
  const result: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!result.length) return; result.pop(); }
    else result.push(part);
  }
  return result;
}

/** Classify model-authored links without navigating the renderer or bypassing file.read policy. */
export function messageLink(href: string | undefined, cwd: string): MessageLink {
  let value = href?.trim() ?? '';
  if (!value || /[\u0000-\u001f\u007f]/u.test(value)) return { kind: 'unavailable', reason: tr("无效链接") };
  if (/^(https?:)?\/\//i.test(value)) {
    const url = value.startsWith('//') ? 'https:' + value : value;
    return webUrlSchema.safeParse(url).success ? { kind: 'web', url: new URL(url).href } : { kind: 'unavailable', reason: tr("不支持包含登录凭据的网页地址") };
  }
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      if (url.hostname && url.hostname !== 'localhost' || url.search || url.username || url.password) return { kind: 'unavailable', reason: tr("不支持此文件地址") };
      value = url.pathname + url.hash;
    } catch { return { kind: 'unavailable', reason: tr("无效文件地址") }; }
  }
  const suffix = /(?:#L?(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?|:(\d+)(?::(\d+))?)$/i.exec(value);
  const line = suffix ? Number(suffix[1] ?? suffix[3]) : undefined;
  const column = suffix?.[2] || suffix?.[4] ? Number(suffix[2] ?? suffix[4]) : undefined;
  if (line !== undefined && (!Number.isSafeInteger(line) || line < 1) || column !== undefined && (!Number.isSafeInteger(column) || column < 1)) return { kind: 'unavailable', reason: tr("无效文件行列号") };
  if (suffix) value = value.slice(0, suffix.index);
  try { value = decodeURIComponent(value); } catch { return { kind: 'unavailable', reason: tr("无效文件地址编码") }; }
  if (/^\/[a-z]:[\\/]/i.test(value)) value = value.slice(1);
  if (!value || value.startsWith('#') || /[\u0000-\u001f\u007f]/u.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return { kind: 'unavailable', reason: tr("此链接类型无法在工作台中打开") };
  const windows = /^[a-z]:[\\/]|^\\\\/i.test(cwd);
  const normalized = value.replace(/\\/g, '/');
  const base = cwd.replace(/\\/g, '/');
  const pathParts = segments(normalized);
  if (!pathParts) return { kind: 'unavailable', reason: tr("文件不在当前任务目录中") };
  if (/^(?:[a-z]:)?\//i.test(normalized)) {
    const baseParts = segments(base);
    if (!baseParts || baseParts.length >= pathParts.length || baseParts.some((part, index) => (windows ? part.toLowerCase() : part) !== (windows ? pathParts[index]?.toLowerCase() : pathParts[index]))) return { kind: 'unavailable', reason: tr("文件不在当前任务目录中") };
    pathParts.splice(0, baseParts.length);
  }
  const path = pathParts.join('/');
  return path && path.length <= 2000 ? { kind: 'file', path, ...(line === undefined ? {} : { line }), ...(column === undefined ? {} : { column }) } : { kind: 'unavailable', reason: tr("无效文件路径") };
}

export function filePosition(text: string, line: number, column = 1): { offset: number; line: number; column: number } {
  const lines = text.split('\n');
  const row = Math.min(lines.length, Math.max(1, Number.isFinite(line) ? Math.floor(line) : 1));
  const col = Math.min(lines[row - 1].length + 1, Math.max(1, Number.isFinite(column) ? Math.floor(column) : 1));
  return { offset: lines.slice(0, row - 1).reduce((sum, value) => sum + value.length + 1, 0) + col - 1, line: row, column: col };
}
