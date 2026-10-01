import { z } from 'zod';

export const mcpSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), enabled: z.boolean(),
  transport: z.enum(['stdio', 'http']), command: z.string().default(''), args: z.array(z.string()).default([]), url: z.string().default(''),
  oauth: z.object({ clientId: z.string().max(1000).default(''), scope: z.string().max(2000).default('') }).strict().optional(),
}).strict();

export const mcpOAuthStatusSchema = z.object({ state: z.enum(['disconnected', 'authorizing', 'connected', 'expired']), expiresAt: z.number().optional() }).strict();
export type McpOAuthStatus = z.infer<typeof mcpOAuthStatusSchema>;
export const mcpSecretStatusSchema = z.object({ configured: z.boolean() }).strict();
