import { z } from 'zod';

// The public TS type stays non-recursive so Electron/Playwright serialization types
// remain tractable. Runtime validation still requires JSON at the result boundary.
const jsonObject = z.record(z.string(), z.unknown());
// Keep extension blocks and metadata instead of coercing the wire result to text.
export const mcpResultSchema = z.object({
  content: z.array(jsonObject).max(256).default([]),
  structuredContent: jsonObject.optional(),
  isError: z.boolean().optional(),
}).catchall(z.unknown()).refine(value => z.json().safeParse(value).success, 'Invalid JSON tool result');
export const mcpResourceResultSchema = z.object({ contents: z.array(jsonObject).max(256) }).catchall(z.unknown()).refine(value => z.json().safeParse(value).success, 'Invalid JSON resource result');
export const toolResultSchema = z.object({
  origin: z.object({ serverId: z.string(), toolName: z.string(), configuration: z.string() }).strict().optional(),
  result: mcpResultSchema,
}).strict();
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ResultBlock = z.infer<typeof jsonObject>;

export function validateResultSize(value: unknown): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 16 * 1024 * 1024)
    throw new Error('工具结果超过 16 MB，未保存不完整内容');
}
export function resultImage(block: ResultBlock): { type: 'image'; mimeType: string; data: string } | undefined {
  if (block.type !== 'image' || typeof block.mimeType !== 'string' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(block.mimeType) ||
    typeof block.data !== 'string' || !block.data.length || block.data.length > 14 * 1024 * 1024 || block.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(block.data)) return;
  return { type: 'image', mimeType: block.mimeType, data: block.data };
}
export function modelResultContent(result: ToolResult['result']): ({ type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string })[] {
  const content = result.content.map(block => {
    const image = resultImage(block);
    if (image) return image;
    return { type: 'text' as const, text: block.type === 'text' && typeof block.text === 'string' ? block.text : JSON.stringify(block) };
  });
  if (result.structuredContent) content.push({ type: 'text', text: JSON.stringify(result.structuredContent) });
  return content.length ? content : [{ type: 'text', text: JSON.stringify(result) }];
}
export function storedToolResult(details: unknown, content?: unknown): ToolResult | undefined {
  const candidate = details && typeof details === 'object' && 'toolResult' in details ? details.toolResult : undefined;
  const parsed = toolResultSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(content) || !content.some(block => block && typeof block === 'object' && block.type !== 'text')) return;
  const fallback = toolResultSchema.safeParse({ result: { content } });
  if (fallback.success) return fallback.data;
}
export function resourceUri(block: ResultBlock | undefined): string | undefined {
  if (block?.type !== 'resource_link' || typeof block.uri !== 'string' || !block.uri || block.uri.length > 4000) return;
  return block.uri;
}
