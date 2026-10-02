import { z } from 'zod';

/**
 * Wave 4c: browser data, resources, MCP and pull requests. These families touch things the user can see in
 * the Browser and resources panels. Two deliberate omissions live here as comments instead of code: site
 * policies (`browser.site`) and browsing-data clearing (`browser.clear`, `browser.action.clearSite/clearAll`)
 * stay user decisions, and credentials (`mcp.secret*`, `mcp.oauth*`, `resource.pick`) are never reachable.
 */

const directoryId = z.string().min(1).max(200);
const tabId = z.string().min(1).max(200);

export const browserDataToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('browser.history'), query: z.string().max(1000).default(''),
    offset: z.number().int().min(0).max(10000).default(0), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  z.object({ action: z.literal('browser.downloads') }).strict(),
  z.object({ action: z.literal('browser.download'), downloadId: z.string().min(1).max(200),
    operation: z.enum(['cancel', 'reveal']) }).strict(),
  z.object({ action: z.literal('browser.find'), text: z.string().max(1000), forward: z.boolean().default(true),
    tabId: tabId.optional() }).strict(),
  z.object({ action: z.literal('browser.annotation'), annotationId: z.uuid(),
    operation: z.enum(['read', 'remove', 'attach']) }).strict(),
]);

export const prToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pr.status'), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('pr.start'), operation: z.enum(['view', 'create']), selector: z.string().max(2000).default(''),
    title: z.string().max(1000).default(''), body: z.string().max(50000).default(''), base: z.string().max(300).default(''),
    draft: z.boolean().default(true), directoryId: directoryId.optional() }).strict()
    .superRefine((value, context) => {
      if (value.operation === 'create' && !value.title.trim()) context.addIssue({ code: 'custom', path: ['title'], message: '创建 PR 需要标题' });
    }),
]);

export const resourceToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resources.inspect') }).strict(),
  z.object({ action: z.literal('resources.refresh') }).strict(),
  z.object({ action: z.literal('resources.open'), resourceId: z.string().min(1).max(200), reveal: z.boolean().default(false) }).strict(),
]);

export const mcpToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mcp.list') }).strict(),
  z.object({ action: z.literal('mcp.test'), serverId: z.string().min(1).max(200), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('mcp.testCancel'), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal('mcp.retry'), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('mcp.resource'), itemId: z.string().min(1).max(200), index: z.number().int().min(0).max(255),
    requestId: z.uuid().optional() }).strict(),
]);

export type BrowserDataToolRequest = z.infer<typeof browserDataToolSchema>;
export type PrToolRequest = z.infer<typeof prToolSchema>;
export type ResourceToolRequest = z.infer<typeof resourceToolSchema>;
export type McpToolRequest = z.infer<typeof mcpToolSchema>;
export type ServiceToolRequest = BrowserDataToolRequest | PrToolRequest | ResourceToolRequest | McpToolRequest;

/** Action ids owned by the service families; the dispatcher uses this list instead of a prefix so it can never
 *  swallow an op request that happens to share a prefix. */
export const serviceToolActions: readonly string[] = [
  ...browserDataToolSchema.options.map(option => option.shape.action.value),
  ...prToolSchema.options.map(option => option.shape.action.value),
  ...resourceToolSchema.options.map(option => option.shape.action.value),
  ...mcpToolSchema.options.map(option => option.shape.action.value),
];
