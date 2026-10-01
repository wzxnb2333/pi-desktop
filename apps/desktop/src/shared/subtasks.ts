import { z } from 'zod';

export const subtaskDefinitionSchema = z.object({
  title: z.string().trim().min(1).max(200), prompt: z.string().trim().min(1).max(20000),
  environment: z.enum(['local', 'worktree']).default('worktree'), startPoint: z.string().min(1).max(3000).default('HEAD'),
  policy: z.enum(['ask', 'auto', 'deny']).default('deny'), includeContext: z.boolean().default(true),
}).strict();
export const subtaskQuestionSchema = z.object({
  id: z.uuid(), question: z.string().trim().min(1).max(4000),
  status: z.enum(['pending', 'answered', 'expired', 'cancelled', 'interrupted']),
  createdAt: z.number(), settledAt: z.number().optional(), answer: z.string().trim().min(1).max(8000).optional(),
}).strict();
export const subtaskSchema = z.object({
  id: z.uuid(), parentThreadId: z.string(), childThreadId: z.string().optional(),
  parentItemId: z.string().optional(),
  definition: subtaskDefinitionSchema, context: z.string().max(60000),
  status: z.enum(['queued', 'preparing', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted']),
  stage: z.string(), createdAt: z.number(), startedAt: z.number().optional(), finishedAt: z.number().optional(),
  result: z.string().max(30000).optional(), error: z.string().optional(), deliveredAt: z.number().optional(),
  questions: z.array(subtaskQuestionSchema).max(32).optional(),
}).strict();
export const subtaskRequests = [
  z.object({ op: z.literal('subtask.create'), parentThreadId: z.string(), requestId: z.uuid(), definition: subtaskDefinitionSchema }).strict(),
  z.object({ op: z.literal('subtask.stop'), parentThreadId: z.string(), id: z.uuid().optional() }).strict(),
  z.object({ op: z.literal('subtask.deliver'), parentThreadId: z.string(), id: z.uuid() }).strict(),
] as const;
export const subtaskToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('subtasks.list') }).strict(),
  z.object({ action: z.literal('subtasks.create'), definition: subtaskDefinitionSchema }).strict(),
  z.object({ action: z.literal('subtasks.read'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('subtasks.stop'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('subtasks.reply'), id: z.uuid(), questionId: z.uuid(), answer: z.string().trim().min(1).max(8000) }).strict(),
  z.object({ action: z.literal('subtasks.wait'), cursor: z.string().regex(/^[a-f0-9]{64}$/).optional(), timeoutMs: z.number().int().min(10).max(120000).default(30000) }).strict(),
]);
export const askParentSchema = z.object({ action: z.literal('subtasks.ask'), question: z.string().trim().min(1).max(4000), timeoutMs: z.number().int().min(10).max(120000).default(120000) }).strict();
export type SubtaskQuestion = z.infer<typeof subtaskQuestionSchema>;
export type Subtask = z.infer<typeof subtaskSchema>;
export type SubtaskDefinition = z.infer<typeof subtaskDefinitionSchema>;
export type SubtaskToolRequest = z.infer<typeof subtaskToolSchema>;
export const activeSubtask = (task: Subtask) => ['queued', 'preparing', 'running'].includes(task.status);
