import { z } from 'zod';
import { contextReferenceSchema } from './input-context.ts';

export const messageInputPartSchema = z.object({
  label: z.string().max(4000), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
  reference: contextReferenceSchema.optional(), path: z.string().optional(),
  mime: z.string().optional(), bytes: z.number().int().nonnegative().optional(),
}).strict().refine(part => part.end >= part.start);
export const messageInputSchema = z.object({
  text: z.string().max(100000), parts: z.array(messageInputPartSchema).max(30),
}).strict();
export type MessageInput = z.infer<typeof messageInputSchema>;
export type MessageInputPart = z.infer<typeof messageInputPartSchema>;
export const storedMessageInputSchema = z.object({ itemId: z.string(), hash: z.string(), input: messageInputSchema }).strict();
export const MESSAGE_INPUT_ENTRY = 'pi-desktop-input-v1';

/** Only metadata recorded by the send pipeline may split a message; never parse prose markers. */
export function validMessageInput(text: string, input: MessageInput): boolean {
  return text.startsWith(input.text) && input.parts.every(part => part.end <= text.length && (part.start >= input.text.length || part.start === part.end));
}
