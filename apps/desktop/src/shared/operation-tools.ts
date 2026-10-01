import { z } from 'zod';

export const operationToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('operations.list') }).strict(),
  z.object({ action: z.literal('operations.read'), operationId: z.uuid() }).strict(),
  z.object({ action: z.literal('operations.wait'), operationId: z.uuid(), cursor: z.string().min(1).max(1024).optional(),
    timeoutMs: z.number().int().min(0).max(30000).default(30000) }).strict(),
  z.object({ action: z.literal('operations.cancel'), operationId: z.uuid() }).strict(),
]);
export type OperationToolRequest = z.input<typeof operationToolSchema>;
