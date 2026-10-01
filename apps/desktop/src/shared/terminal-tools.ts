import { z } from 'zod';

export const terminalReadParametersSchema = z.object({
  terminalId: z.uuid().optional(), cursor: z.string().min(1).max(1024).optional(),
  maxChars: z.number().int().min(256).max(20000).default(8000), timeoutMs: z.number().int().min(0).max(30000).default(0),
}).strict();
export const terminalToolSchema = terminalReadParametersSchema.extend({ action: z.literal('terminal.inspect') })
  .refine(value => (!value.cursor || !!value.terminalId) && (!value.timeoutMs || !!value.cursor), 'Waiting requires a terminal and cursor');
export type TerminalReadRequest = z.input<typeof terminalToolSchema>;
