import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { z } from 'zod';
import { listFiles, readProjectFile, writeProjectFile } from '../main/files.ts';
import type { ProjectDirectory } from '../shared/project-directories.ts';

/** Directory IDs are selected from the main-process snapshot, never arbitrary root paths. */
export function projectFileTools(directories: readonly ProjectDirectory[]): ToolDefinition[] {
  const roots = directories.map(item => item.id + ': ' + item.name + ' (' + item.path + ')').join('; ');
  const parameters = Type.Object({ directoryId: Type.String(), path: Type.String() });
  const readArguments = z.object({ directoryId: z.string(), path: z.string() }).strict();
  const writeArguments = readArguments.extend({ content: z.string().max(1000000), version: z.string() });
  const root = (id: string) => {
    const directory = directories.find(item => item.id === id);
    if (!directory) throw new Error('目录不属于此项目或已被移除');
    return directory.path;
  };
  return [
    { name: 'project_read', label: '读取项目目录文件', description: 'Read a file using an explicit directory ID. Roots: ' + roots, parameters,
      execute: async (_id, raw) => { const params = readArguments.parse(raw); return { content: [{ type: 'text', text: JSON.stringify(await readProjectFile(root(params.directoryId), params.path)) }], details: {} }; } },
    { name: 'project_list', label: '列出项目目录', description: 'List a folder using an explicit directory ID. Roots: ' + roots, parameters,
      execute: async (_id, raw) => { const params = readArguments.parse(raw); return { content: [{ type: 'text', text: JSON.stringify(await listFiles(root(params.directoryId), params.path)) }], details: {} }; } },
    { name: 'project_write', label: '保存项目目录文件', description: 'Update an existing UTF-8 file with its SHA256 version from project_read. Roots: ' + roots,
      parameters: Type.Object({ directoryId: Type.String(), path: Type.String(), content: Type.String({ maxLength: 1000000 }), version: Type.String() }),
      execute: async (_id, raw) => { const params = writeArguments.parse(raw); return { content: [{ type: 'text', text: JSON.stringify(await writeProjectFile(root(params.directoryId), params.path, params.content, params.version)) }], details: {} }; } },
  ];
}
