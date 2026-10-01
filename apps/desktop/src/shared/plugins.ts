import { z } from 'zod';
import { mcpSchema } from './mcp-schema.ts';

export const pluginPathSchema = z.string().min(1).max(2000).refine(path =>
  !path.startsWith('/') && !path.startsWith('\\') && !path.includes('\\') && !/[\x00-\x1f:*?"<>|]/.test(path) &&
  path.split('/').every(part => part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), '插件路径必须位于包内');
const resource = z.object({ name: z.string().min(1).max(100), path: pluginPathSchema }).strict();
export const pluginManifestSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9.-]{0,99}$/), name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/), description: z.string().max(5000).default(''),
  skills: z.array(resource).max(100).default([]), extensions: z.array(resource).max(100).default([]),
  mcp: z.array(mcpSchema).max(30).default([]),
}).strict().superRefine((value, context) => {
  if (new Set(value.mcp.map(item => item.id)).size !== value.mcp.length) context.addIssue({ code: 'custom', message: '插件 MCP 标识不能重复' });
  if (new Set([...value.skills, ...value.extensions].map(item => item.path.toLowerCase())).size !== value.skills.length + value.extensions.length) context.addIssue({ code: 'custom', message: '插件资源路径不能重复' });
});
export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export const pluginRevisionSchema = z.object({
  revision: z.uuid(), path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), manifest: pluginManifestSchema,
  installedAt: z.number(), approved: z.boolean().default(false),
}).strict();
export type PluginRevision = z.infer<typeof pluginRevisionSchema>;
export const pluginSchema = z.object({
  id: z.string(), source: z.string(), enabled: z.boolean(), current: pluginRevisionSchema,
  candidate: pluginRevisionSchema.optional(), previous: pluginRevisionSchema.optional(), error: z.string().optional(),
}).strict();
export type Plugin = z.infer<typeof pluginSchema>;
export function resolvePluginMcpServer(plugin: Plugin, server: z.infer<typeof mcpSchema>): z.infer<typeof mcpSchema> {
  return { ...server, id: 'plugin:' + plugin.id + ':' + server.id,
    command: server.command.replaceAll('{pluginRoot}', plugin.current.path),
    args: server.args.map(arg => arg.replaceAll('{pluginRoot}', plugin.current.path)) };
}
export const pluginSourceSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(100), path: z.string().min(1).max(3000) }).strict();
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export const pluginCatalogSchema = z.array(z.object({ sourceId: z.string(), path: z.string(), manifest: pluginManifestSchema.optional(), error: z.string().optional() }));
