import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { askUserToolSchema, questionKind, questionResultText } from '../shared/user-question.ts';
import { modelResultContent } from '../shared/tool-results.ts';

/** The agent raises the question; the main process shows it as an approval and answers with the choice. */
export type UserQuestionAsker = (question: { kind: 'select' | 'input'; description: string; options?: string[] }) => Promise<{ approved: boolean; value?: string }>;

export function askUserTool(ask: UserQuestionAsker): ToolDefinition {
  return { name: 'ask_user', label: '向用户提问',
    description: 'Ask the user one direct question when a decision is genuinely ambiguous and guessing wrong would waste work. Pass 2-8 short options to make it one click, or leave them out (or pass freeText) when the answer must be open. The user may cancel; then you get no answer and must state your own assumption instead of inventing one. Ask one question at a time and wait for it. Do not use this to avoid work you can do yourself: read the files, search the project and run the tools you already have first. Works in plan mode and under any approval policy.',
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 2000 }),
      options: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 2, maxItems: 8 })),
      freeText: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, args, signal) => {
      const request = askUserToolSchema.parse(args);
      const kind = questionKind(request);
      const answer = await ask({ kind, description: request.question, options: kind === 'select' ? request.options : undefined });
      signal?.throwIfAborted();
      const text = questionResultText(request, answer);
      return {
        content: modelResultContent({ content: [{ type: 'text', text }] }),
        details: { toolResult: { content: [{ type: 'text', text }], structuredContent: { question: request.question, kind, answer } } },
      };
    },
  };
}
