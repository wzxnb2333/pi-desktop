import { z } from 'zod';

export const operationSchema = z.object({
  id: z.uuid(), threadId: z.string(), directoryId: z.string(), kind: z.string(),
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  stage: z.string(), startedAt: z.number(), endedAt: z.number().optional(),
  result: z.json().optional(), error: z.string().optional(),
}).strict();
export type OperationRecord = z.infer<typeof operationSchema>;
export type OperationResult = OperationRecord['result'];

export const pullRequestSchema = z.object({
  number: z.number().int().positive(), title: z.string(), body: z.string(),
  url: z.url().refine(value => new URL(value).protocol === 'https:' && !new URL(value).username && !new URL(value).password),
  state: z.string(), isDraft: z.boolean(), baseRefName: z.string(), headRefName: z.string(),
  comments: z.array(z.object({ body: z.string(), createdAt: z.string(), author: z.object({ login: z.string() }).nullable() })),
  reviews: z.array(z.object({ body: z.string(), state: z.string(), submittedAt: z.string().nullable(), author: z.object({ login: z.string() }).nullable() })),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;
export interface GhStatus { available: boolean; authenticated: boolean; message: string; }
