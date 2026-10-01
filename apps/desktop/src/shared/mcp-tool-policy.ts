import { z } from 'zod';

export const mcpToolPolicySchema = z.object({ enabled: z.boolean().default(true), approval: z.enum(['inherit', 'ask', 'deny']).default('inherit'), timeoutMs: z.number().int().min(1000).max(600000).default(120000) }).strict();
export const mcpToolPoliciesSchema = z.record(z.string().min(1).max(300), z.record(z.string().min(1).max(300), mcpToolPolicySchema));
export type McpToolPolicy = z.infer<typeof mcpToolPolicySchema>;
export type McpToolPolicies = z.infer<typeof mcpToolPoliciesSchema>;

/** A tool setting may only restrict the task decision, never grant a wider capability. */
export function mcpToolDecision(taskDecision: 'allow' | 'ask' | 'review' | 'deny', policy?: McpToolPolicy): 'allow' | 'ask' | 'review' | 'deny' {
  if (taskDecision === 'deny' || policy?.enabled === false || policy?.approval === 'deny') return 'deny';
  return taskDecision === 'ask' || policy?.approval === 'ask' ? 'ask' : taskDecision;
}
