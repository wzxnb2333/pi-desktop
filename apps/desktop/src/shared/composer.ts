import { z } from 'zod';
import { contextReferenceSchema } from './input-context.ts';

export const composerPayloadSchema = z.object({
  text: z.string().max(100000), attachments: z.array(z.string()).max(10),
  context: z.array(contextReferenceSchema).max(20).default([]),
  queue: z.enum(['steer', 'followUp']).optional(),
}).strict();
export type ComposerPayload = z.infer<typeof composerPayloadSchema>;
export const draftSnapshotSchema = z.object({
  id: z.string(), at: z.number(), text: z.string().max(1000000),
  attachments: z.array(z.string()).max(1000), context: z.array(contextReferenceSchema).max(1000),
}).strict();
export type DraftSnapshot = z.infer<typeof draftSnapshotSchema>;
export const promptTemplateSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(100000),
}).strict();
export type PromptTemplate = z.infer<typeof promptTemplateSchema>;
export const sendReceiptSchema = z.object({
  id: z.uuid(), fingerprint: z.string(), at: z.number(),
  status: z.enum(['accepted', 'failed', 'uncertain']), error: z.string().optional(),
}).strict();
export type SendReceipt = z.infer<typeof sendReceiptSchema>;
export const queueChangeSchema = z.object({
  id: z.string().min(1), revision: z.number().int().nonnegative(),
  action: z.enum(['edit', 'remove', 'up', 'down']), text: z.string().max(100000).optional(),
}).strict();
export type QueueChange = z.infer<typeof queueChangeSchema>;
export const attachmentInfoSchema = z.object({
  path: z.string(), name: z.string(), bytes: z.number(),
  kind: z.enum(['image', 'text', 'unsupported']), preview: z.string().optional(),
  version: z.string(), truncated: z.boolean(),
}).strict();
export type AttachmentInfo = z.infer<typeof attachmentInfoSchema>;
export const preflightSchema = z.object({
  issues: z.array(z.object({ target: z.string(), message: z.string() })),
  estimatedTokens: z.number(), contextWindow: z.number(), images: z.number(),
}).strict();
export type ComposerPreflight = z.infer<typeof preflightSchema>;
export const contextSearchSchema = z.object({
  matches: z.array(contextReferenceSchema.extend({ description: z.string() })),
  limited: z.boolean(), unreadable: z.number(),
}).strict();
export type ContextSearch = z.infer<typeof contextSearchSchema>;
export const contextDetailSchema = z.object({
  reference: contextReferenceSchema, content: z.string(), stale: z.boolean(),
}).strict();
export const composerRequests = [
  z.object({ op: z.literal('composer.preflight'), threadId: z.string(), payload: composerPayloadSchema }).strict(),
  z.object({ op: z.literal('composer.contextSearch'), threadId: z.string(), query: z.string().max(300) }).strict(),
  z.object({ op: z.literal('composer.contextDetail'), threadId: z.string(), reference: contextReferenceSchema, refresh: z.boolean().optional() }).strict(),
  z.object({ op: z.literal('composer.history'), threadId: z.string(), action: z.enum(['save', 'list', 'restore', 'clear']), snapshotId: z.string().optional() }).strict(),
  z.object({ op: z.literal('composer.template'), action: z.enum(['save', 'remove']), template: promptTemplateSchema.optional(), id: z.string().optional() }).strict(),
  z.object({ op: z.literal('attachment.inspect'), threadId: z.string(), path: z.string() }).strict(),
  z.object({ op: z.literal('thread.queueChange'), threadId: z.string(), change: queueChangeSchema }).strict(),
] as const;

export function referenceKey(reference: z.infer<typeof contextReferenceSchema>): string {
  return JSON.stringify([reference.kind, reference.directoryId, reference.id, reference.range, reference.quote?.start, reference.quote?.end]);
}

/** Bounded snapshots, with one recent revision per editing interval. */
export function rememberDraft(history: DraftSnapshot[], draft: Omit<DraftSnapshot, 'id' | 'at'>, now = Date.now(), force = false): DraftSnapshot[] {
  if (!draft.text && !draft.attachments.length && !draft.context.length) return history;
  const serialized = JSON.stringify(draft);
  if (history[0] && JSON.stringify({ text: history[0].text, attachments: history[0].attachments, context: history[0].context }) === serialized) return history;
  if (!force && history[0] && now - history[0].at < 30000) return history;
  const next = [{ ...draft, id: crypto.randomUUID(), at: now }, ...history].slice(0, 20);
  while (next.length > 1 && JSON.stringify(next).length > 2000000) next.pop();
  return next;
}

export function fuzzyScore(value: string, query: string): number {
  const text = value.toLocaleLowerCase().replaceAll('\\', '/'), needle = query.toLocaleLowerCase().replaceAll('\\', '/').trim();
  if (!needle) return 0;
  const direct = text.indexOf(needle);
  if (direct >= 0) return 1000 - direct - (text.length - needle.length) / 1000;
  let position = 0, gaps = 0;
  for (const char of needle) { const index = text.indexOf(char, position); if (index < 0) return -1; gaps += index - position; position = index + 1; }
  return 100 - gaps - text.length / 1000;
}
