import { z } from 'zod';
import { automationSchema } from './contracts.ts';

export const automationToolConfiguration = automationSchema.omit({ id: true, projectId: true, nextRunAt: true, lastRunAt: true, lastThreadId: true, targetThreadId: true }).extend({ id: z.string().min(1).max(200).optional(), destination: z.enum(['current', 'new']) }).strict();
export const automationToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('automations.list') }).strict(),
  z.object({ action: z.literal('automations.save'), configuration: automationToolConfiguration }).strict(),
  z.object({ action: z.literal('automations.remove'), id: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('automations.run'), id: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('automations.cancel'), id: z.uuid() }).strict(),
]);
export type AutomationToolRequest = z.infer<typeof automationToolSchema>;
