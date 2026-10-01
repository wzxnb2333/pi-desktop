import { z } from 'zod';

export const memoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  z.object({ kind: z.literal('project'), projectId: z.string().min(1).max(200) }).strict(),
]);
export const memorySourceSchema = z.object({
  kind: z.enum(['manual', 'generated']), threadId: z.string().optional(),
  messageIds: z.array(z.string()).max(100).default([]), fingerprint: z.string().optional(),
  providerId: z.string().optional(), createdAt: z.number(),
}).strict();
export const memoryEntrySchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), scope: memoryScopeSchema,
  text: z.string().trim().min(1).max(6000), enabled: z.boolean(),
  status: z.enum(['candidate', 'approved']), source: memorySourceSchema,
  createdAt: z.number(), updatedAt: z.number(),
}).strict();
export const memoryPreferencesSchema = z.object({ enabled: z.boolean().default(false), autoGenerate: z.boolean().default(false) }).strict();
export const memoryDocumentSchema = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(),
  entries: z.array(memoryEntrySchema).max(1000),
  processed: z.record(z.string(), z.string()),
  suppressed: z.array(z.string()).default([]),
  forgottenSources: z.array(z.string()).default([]),
}).strict();
export const memorySnapshotSchema = z.object({ revision: z.number(), entries: z.array(memoryEntrySchema), error: z.string().optional() }).strict();
export const memoryGenerationSchema = z.object({
  memories: z.array(z.object({ text: z.string().trim().min(1).max(6000), messageIds: z.array(z.string()).min(1).max(100) }).strict()).max(12),
}).strict();
export const memoryRequests = [
  z.object({ op: z.literal('memory.list'), scope: memoryScopeSchema.optional() }).strict(),
  z.object({ op: z.literal('memory.save'), id: z.uuid().optional(), revision: z.number().int().positive().optional(), scope: memoryScopeSchema, text: z.string().trim().min(1).max(6000), enabled: z.boolean() }).strict(),
  z.object({ op: z.literal('memory.delete'), id: z.uuid(), revision: z.number().int().positive() }).strict(),
  z.object({ op: z.literal('memory.clear'), revision: z.number().int().nonnegative() }).strict(),
  z.object({ op: z.literal('memory.generate'), threadId: z.string(), scope: memoryScopeSchema, requestId: z.uuid() }).strict(),
] as const;
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type MemoryDocument = z.infer<typeof memoryDocumentSchema>;
export type MemorySnapshot = z.infer<typeof memorySnapshotSchema>;
export type MemoryGeneration = z.infer<typeof memoryGenerationSchema>;
export const memoryScopeKey = (scope: MemoryScope) => scope.kind === 'user' ? 'user' : 'project:' + scope.projectId;

/** Deliberately drops whole credential-bearing lines, code blocks and high-entropy tokens. */
export function memorySafeText(input: string, secrets: readonly string[] = []): string {
  return input.replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/g, '').replace(/~~~[\s\S]*?~~~/g, '')
    .split(/\r?\n/).filter(line => !/(?:api[ _-]?key|authorization|bearer\s|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password|passwd|密钥|令牌|密码|私钥|sk-[\w-]{8,}|gh[pousr]_[\w]+|AKIA[0-9A-Z]{16}|https?:\/\/[^\s/]+:[^\s/]+@|[?&](?:key|token|secret)=)/i.test(line)
      && !/[A-Za-z0-9_+\/=.-]{48,}/.test(line) && !secrets.some(secret => secret.length >= 4 && line.includes(secret)))
    .join('\n').trim();
}
