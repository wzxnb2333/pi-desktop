import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { askParentSchema, subtaskToolSchema } from '../shared/subtasks.ts';
import { modelResultContent } from '../shared/tool-results.ts';
import type { DesktopToolRunner } from './browser-tool.ts';

export function subtaskTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'manage_subtasks', label: '管理可选子任务',
    description: 'Manage your child agents when subagents are enabled. Actions subtasks.list/create/read/update/stop/reply/wait. A child runs on your own model and reasoning level unless you pass definition.modelId or definition.thinking, and you may only pass them when the user explicitly asked for a different model or reasoning level for that child. Use subtasks.update with the child id to change its model or reasoning level later; pass null to put it back on yours. Children use ask_parent for clarification. Read pending questions via list/read/wait and reply with child id, questionId and answer; replies never authorize more permissions. Call wait without a cursor for a snapshot, then with its returned cursor to wait for changes (default 30s, max 120s); use this instead of repeated polling. Keep working or waiting while children need you. An idle parent is not automatically restarted. Child actions retain sandbox and approval restrictions. Local children are read-only; modifications require an independent Worktree. Children cannot delegate. Inspect results through read; never assume completion before status succeeded. Restart does not replay uncertain work. The user only observes child chats.',
    parameters: Type.Object({ action: Type.Union(['subtasks.list', 'subtasks.create', 'subtasks.read', 'subtasks.update', 'subtasks.stop', 'subtasks.reply', 'subtasks.wait'].map(value => Type.Literal(value))), id: Type.Optional(Type.String()),
      questionId: Type.Optional(Type.String()), answer: Type.Optional(Type.String()), cursor: Type.Optional(Type.String()), timeoutMs: Type.Optional(Type.Integer({ minimum: 10, maximum: 120000 })),
      modelId: Type.Optional(Type.Union([Type.String({ description: 'Model id for subtasks.update. Pass null to inherit your own model again.' }), Type.Null()])),
      thinking: Type.Optional(Type.Union([...['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => Type.Literal(value)), Type.Null()])), definition: Type.Optional(Type.Object({
        title: Type.String(), prompt: Type.String(), environment: Type.Union([Type.Literal('local'), Type.Literal('worktree')]), startPoint: Type.String(), policy: Type.Union(['deny', 'ask', 'auto'].map(value => Type.Literal(value))), includeContext: Type.Boolean(),
        modelId: Type.Optional(Type.String({ description: 'Model id for the child. Omit to run on your own model.' })), thinking: Type.Optional(Type.Union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map(value => Type.Literal(value)))),
      })) }),
    execute: async (_id, args, signal) => { const result = await run(subtaskToolSchema.parse(args), signal ?? AbortSignal.timeout(180000)); return { content: modelResultContent(result.result), details: { toolResult: result } }; },
  };
}

export function askParentTool(run: DesktopToolRunner): ToolDefinition {
  return { name: 'ask_parent', label: '询问主代理',
    description: 'Ask your owning parent agent a focused clarification question and wait for its answer, without asking the user to operate your chat. Only child agents have this tool. No arbitrary recipient or permission changes. Default and maximum wait 120s. An expired/interrupted question has no answer; do not invent one or claim the blocked work is complete. The parent may already be idle. At most one pending question and 32 questions per subtask.',
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 4000 }), timeoutMs: Type.Optional(Type.Integer({ minimum: 10, maximum: 120000 })) }),
    execute: async (_id, args, signal) => {
      const request = askParentSchema.omit({ action: true }).parse(args);
      const result = await run({ ...request, action: 'subtasks.ask' }, signal ?? AbortSignal.timeout(150000));
      return { content: modelResultContent(result.result), details: { toolResult: result } };
    },
  };
}
