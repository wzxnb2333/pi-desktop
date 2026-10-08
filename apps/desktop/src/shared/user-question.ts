import { z } from 'zod';

/**
 * A question the model asks the user when a decision is genuinely ambiguous. The answer travels through the
 * existing approval channel, so the renderer needs no new card and the user's choice stays validated there.
 */
export const askUserToolSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  /** Short one-click choices. Omitted or forced to free text when the answer must be open. */
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(8).optional(),
  freeText: z.boolean().optional(),
}).strict();
export type AskUserRequest = z.infer<typeof askUserToolSchema>;

/** `select` when the model offered choices, `input` when the user has to type the answer. */
export function questionKind(request: AskUserRequest): 'select' | 'input' {
  return request.options?.length && !request.freeText ? 'select' : 'input';
}

/** What the model reads back. A cancelled question never hands the model a made-up answer. */
export function questionResultText(request: AskUserRequest, answer: { approved: boolean; value?: string }): string {
  if (!answer.approved || !answer.value) {
    return 'The user did not answer this question. Do not invent an answer: continue with the safest reading, say what you assumed, and keep the work unblocked.';
  }
  return questionKind(request) === 'select'
    ? 'The user selected: ' + answer.value + '. Proceed with that option.'
    : 'The user replied: ' + answer.value;
}
