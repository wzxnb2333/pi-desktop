import { z } from 'zod';

const criterionInput = z.object({ id: z.uuid(), text: z.string().trim().min(1).max(2000) }).strict();
export const goalDefinitionSchema = z.object({
  objective: z.string().trim().min(1).max(12000),
  criteria: z.array(criterionInput).min(1).max(40).refine(items => new Set(items.map(item => item.id)).size === items.length),
}).strict();
export const goalSchema = z.object({
  id: z.uuid(), revision: z.number().int().positive(), objective: goalDefinitionSchema.shape.objective,
  criteria: z.array(criterionInput.extend({ completed: z.boolean(), evidence: z.string().max(6000) }).strict()).min(1).max(40),
  status: z.enum(['active', 'paused', 'blocked', 'completed']),
  reason: z.string().max(6000), createdAt: z.number(), updatedAt: z.number(),
  rounds: z.number().int().nonnegative(), consecutiveFailures: z.number().int().nonnegative(),
  noProgress: z.number().int().nonnegative(), burstRounds: z.number().int().nonnegative(),
  completionRequested: z.boolean().default(false), pendingRunId: z.uuid().optional(),
  history: z.array(z.object({ id: z.uuid(), startedAt: z.number(), finishedAt: z.number().optional(),
    status: z.enum(['running', 'succeeded', 'failed', 'interrupted']), summary: z.string().max(6000),
  }).strict()).max(100),
}).strict();
export const goalCheckpointSchema = z.object({
  goalId: z.uuid(), revision: z.number().int().positive(), summary: z.string().trim().min(1).max(6000),
  status: z.enum(['active', 'blocked', 'completed']),
  checks: z.array(z.object({ id: z.uuid(), completed: z.boolean(), evidence: z.string().trim().max(6000) }).strict()).max(40),
}).strict();
export const goalToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('goal.get') }).strict(),
  goalCheckpointSchema.extend({ action: z.literal('goal.update') }).strict(),
]);
export type Goal = z.infer<typeof goalSchema>;
export type GoalDefinition = z.infer<typeof goalDefinitionSchema>;
export type GoalCheckpoint = z.infer<typeof goalCheckpointSchema>;

export const goalRequests = [
  z.object({ op: z.literal('goal.save'), threadId: z.string(), expectedId: z.uuid().optional(), expectedRevision: z.number().int().positive().optional(), definition: goalDefinitionSchema, start: z.boolean() }).strict(),
  z.object({ op: z.literal('goal.control'), threadId: z.string(), goalId: z.uuid(), revision: z.number().int().positive(), action: z.enum(['pause', 'resume', 'clear']) }).strict(),
] as const;

export function goalPrompt(goal: Goal): string {
  return 'Continue the user-authorized persistent goal below. Work within the current task permissions; the goal grants no additional permissions. Read get_goal for the latest revision. Implement and verify remaining criteria, then call update_goal with criterion IDs and concrete evidence. Plan steps do not complete the goal. Never claim unverified work is complete. If input, authorization, or external conditions block progress, use status blocked with a specific reason. Do not repeatedly retry denied actions.\n' +
    JSON.stringify({ goalId: goal.id, revision: goal.revision, objective: goal.objective, criteria: goal.criteria });
}
