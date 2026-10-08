import { z } from 'zod';

export const providerAuthStatusSchema = z.object({
  id: z.string(), connected: z.boolean(), phase: z.enum(['idle', 'logging_in', 'error']),
  operationId: z.uuid().optional(), error: z.string().optional(), link: z.string().optional(),
  instructions: z.string().optional(), userCode: z.string().optional(),
  prompt: z.object({
    id: z.uuid(), type: z.enum(['text', 'secret', 'select', 'manual_code']), message: z.string(),
    placeholder: z.string().optional(), options: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  }).strict().optional(),
}).strict();
export type ProviderAuthStatus = z.infer<typeof providerAuthStatusSchema>;

// Private main/worker protocol. Never place this snapshot in desktop state or tool results.
export const runtimeOAuthSnapshotSchema = z.object({
  credential: z.object({
    type: z.literal('oauth'), refresh: z.literal(''), access: z.string(), expires: z.number(),
    accountId: z.string().optional(), enterpriseUrl: z.string().optional(),
    availableModelIds: z.array(z.string()).optional(),
  }).strict(),
  auth: z.object({ apiKey: z.string().optional(), headers: z.record(z.string(), z.string()).optional(), baseUrl: z.string().optional() }).strict(),
}).strict();
export type RuntimeOAuthSnapshot = z.infer<typeof runtimeOAuthSnapshotSchema>;
export type ModelAuthResolver = (signal?: AbortSignal) => Promise<RuntimeOAuthSnapshot>;
