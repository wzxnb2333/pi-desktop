import { z } from 'zod';

export const contextReferenceSchema = z.object({
  kind: z.enum(['file', 'folder', 'skill', 'tool', 'quote']),
  id: z.string().min(1).max(2000),
  label: z.string().min(1).max(300),
  directoryId: z.string().min(1).max(200).optional(),
  version: z.string().max(100).optional(),
  range: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict().refine(value => value.end >= value.start).optional(),
  quote: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive(), text: z.string().min(1).max(40000) }).strict().refine(value => value.end > value.start).optional(),
}).strict();
export const inputCommandSchema = z.enum(['compact', 'plan', 'stop', 'skills', 'goal', 'review', 'help', 'templates', 'history', 'expand']);
export const inputCatalogSchema = z.object({
  commands: z.array(z.object({ id: inputCommandSchema, enabled: z.boolean() }).strict()),
  references: z.array(contextReferenceSchema.extend({ description: z.string() }).strict()),
}).strict();
export type ContextReference = z.infer<typeof contextReferenceSchema>;
export type InputCatalog = z.infer<typeof inputCatalogSchema>;
export type InputCommand = z.infer<typeof inputCommandSchema>;
export function mergeContextReferences(...groups: ContextReference[][]): ContextReference[] {
  return [...new Map(groups.flat().map(item => [JSON.stringify([item.directoryId, item.kind, item.id, item.range, item.quote?.start, item.quote?.end]), item])).values()];
}
