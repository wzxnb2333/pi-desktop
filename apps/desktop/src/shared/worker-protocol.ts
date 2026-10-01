import { z } from 'zod';
import { contextReferenceSchema } from './input-context.ts';
import { queueChangeSchema } from './composer.ts';
import { reviewSubmissionSchema } from './reviews.ts';
import { browserToolSchema } from './browser-tools.ts';
import { goalToolSchema } from './goals.ts';
import { automationToolSchema } from './automation-tools.ts';
import { askParentSchema, subtaskQuestionSchema, subtaskToolSchema } from './subtasks.ts';
import { desktopViewToolSchema, harnessApprovalsToolSchema, harnessArtifactsToolSchema, harnessAttachmentAddToolSchema, harnessAttachmentListToolSchema, harnessAttachmentRemoveToolSchema, harnessContextCatalogToolSchema, harnessContextListToolSchema, harnessContextRemoveToolSchema, harnessContextToolSchema, harnessDraftHistoryRestoreToolSchema, harnessDraftHistoryToolSchema, harnessDraftPreflightToolSchema, harnessDraftReplaceToolSchema, harnessDraftSendToolSchema, harnessDraftStateToolSchema, harnessDraftToolSchema, harnessFocusToolSchema, harnessMessageOptionsToolSchema, harnessMessageReadToolSchema, harnessQueueChangeToolSchema, harnessQueueClearToolSchema, harnessQueueToolSchema, harnessQuoteToolSchema, harnessToolSchema, projectActionRunToolSchema, projectActionsListToolSchema } from './harness-tools.ts';
import { toolResultSchema } from './tool-results.ts';
import { terminalToolSchema } from './terminal-tools.ts';
import { operationToolSchema } from './operation-tools.ts';
import {
  approvalSchema,
  mcpSchema,
  mcpStateSchema,
  modelProviderSchema,
  providerModelSchema,
  projectSchema,
  resourceLoadSchema,
  settingsSchema,
  threadSchema,
  timelineSchema,
} from './contracts.ts';

export const desktopToolSchema = z.union([browserToolSchema, goalToolSchema, automationToolSchema, subtaskToolSchema, askParentSchema, harnessToolSchema, harnessApprovalsToolSchema, harnessArtifactsToolSchema, harnessAttachmentAddToolSchema, harnessAttachmentListToolSchema, harnessAttachmentRemoveToolSchema, harnessContextCatalogToolSchema, harnessContextListToolSchema, harnessContextRemoveToolSchema, harnessMessageOptionsToolSchema, harnessMessageReadToolSchema, harnessQueueChangeToolSchema, harnessQueueClearToolSchema, harnessQueueToolSchema, harnessQuoteToolSchema, harnessContextToolSchema, harnessDraftHistoryRestoreToolSchema, harnessDraftHistoryToolSchema, harnessDraftPreflightToolSchema, harnessDraftReplaceToolSchema, harnessDraftSendToolSchema, harnessDraftStateToolSchema, harnessDraftToolSchema, desktopViewToolSchema, harnessFocusToolSchema, projectActionsListToolSchema, projectActionRunToolSchema, terminalToolSchema, operationToolSchema,
  z.object({ action: z.literal('sandbox.exec'), command: z.string().max(100000), timeout: z.number().positive().max(2147483).optional() }).strict(),
  z.object({ action: z.literal('memory.context') }).strict()]);
export type DesktopToolRequest = z.infer<typeof desktopToolSchema>;
export const workerConfigSchema = z
  .object({
    thread: threadSchema,
    agentDir: z.string(),
    trusted: z.boolean(),
    directories: projectSchema.shape.directories.unwrap().max(51).optional(),
    // The resolved model plus the connection it runs on; the key travels separately.
    model: providerModelSchema,
    modelProvider: modelProviderSchema,
    apiKey: z.string().optional(),
    settings: settingsSchema,
    mcp: z.array(z.object({ config: mcpSchema, secrets: z.record(z.string(), z.string()) })),
    testMode: z.boolean().default(false),
  })
  .strict();
export const workerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subtask.question'), id: z.uuid(), taskId: z.uuid(), question: subtaskQuestionSchema }).strict(),
  z.object({ type: z.literal('desktop.progress'), id: z.uuid(), data: z.string().max(2 * 1024 * 1024) }).strict(),
  z.object({ type: z.literal('desktop.result'), id: z.uuid(), result: toolResultSchema.optional(), error: z.string().optional() }).strict(),
  z.object({ type: z.literal('mcp.token.result'), id: z.uuid(), token: z.string().optional(), error: z.string().optional() }).strict(),
  z.object({ type: z.literal('init'), requestId: z.string(), config: workerConfigSchema }).strict(),
  z
    .object({
      type: z.literal('prompt'),
      requestId: z.string(),
      text: z.string(),
      attachments: z.array(z.string()),
      queue: z.enum(['steer', 'followUp']).optional(),
      context: z.array(contextReferenceSchema).max(20).optional(),
    })
    .strict(),
  z.object({ type: z.literal('stop'), requestId: z.string() }).strict(),
  z.object({ type: z.literal('compact'), requestId: z.string() }).strict(),
  z.object({ type: z.literal('queue.clear'), requestId: z.string(), expected: z.array(z.object({ id: z.string(), revision: z.number().int().nonnegative() }).strict()).max(100).optional() }).strict(),
  z.object({ type: z.literal('queue.change'), requestId: z.string(), change: queueChangeSchema }).strict(),
  z.object({ type: z.literal('fork'), requestId: z.string(), entryId: z.string().optional() }).strict(),
  z
    .object({
      type: z.literal('answer'),
      id: z.string(),
      approved: z.boolean(),
      value: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal('dispose'), requestId: z.string() }).strict(),
]);
export const workerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('desktop.call'), id: z.uuid(), request: desktopToolSchema }).strict(),
  z.object({ type: z.literal('desktop.cancel'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('mcp.token'), id: z.uuid(), serverId: z.string(), rejectedToken: z.string().optional() }).strict(),
  z.object({ type: z.literal('review'), result: reviewSubmissionSchema }).strict(),
  z.object({
    type: z.literal('ready'),
    requestId: z.string(),
    sessionFile: z.string().optional(),
    items: z.array(timelineSchema),
  }),
  z.object({
    type: z.literal('result'),
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
    sessionFile: z.string().optional(),
    items: z.array(timelineSchema).optional(),
    queue: threadSchema.shape.queue,
  }),
  z.object({ type: z.literal('item'), item: timelineSchema }),
  z.object({ type: z.literal('approval'), approval: approvalSchema }),
  z.object({ type: z.literal('approval.clear'), id: z.string() }),
  z.object({
    type: z.literal('status'),
    status: threadSchema.shape.status,
    error: z.string().optional(),
    sessionFile: z.string().optional(),
  }),
  z.object({ type: z.literal('plan'), steps: threadSchema.shape.plan }),
  z.object({ type: z.literal('artifact'), path: z.string() }),
  z.object({ type: z.literal('mcp'), connection: mcpStateSchema }),
  z.object({ type: z.literal('resources'), report: resourceLoadSchema }),
  z.object({ type: z.literal('queue'), queue: threadSchema.shape.queue.unwrap() }),
  z.object({ type: z.literal('usage'), usage: threadSchema.shape.usage.unwrap() }),
]);
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export type WorkerCommand = z.infer<typeof workerCommandSchema>;
export type WorkerEvent = z.infer<typeof workerEventSchema>;
