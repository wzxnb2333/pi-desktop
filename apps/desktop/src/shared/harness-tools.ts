import { z } from 'zod';
import { contextReferenceSchema } from './input-context.ts';

/** Tool names exposed through the Pi Desktop harness surface. */
export const harnessToolNames = [
  'get_harness', 'list_pending_approvals', 'list_artifacts', 'list_queued_messages',
  'list_context_options', 'list_message_options', 'read_message_context', 'list_project_actions',
  'run_project_action', 'append_to_draft', 'replace_draft_text', 'add_context_to_draft',
  'list_draft_context', 'list_draft_attachments', 'add_draft_attachments', 'remove_draft_attachment',
  'get_draft_state', 'preflight_draft', 'send_draft', 'remove_context_from_draft',
  'quote_message_to_draft', 'manage_queued_message', 'clear_queued_messages', 'list_draft_history',
  'restore_draft_history', 'open_in_pi', 'focus_in_pi', 'read_terminal', 'manage_operations',
] as const;

export function isHarnessToolName(toolName: string | undefined): boolean {
  return !!toolName && (harnessToolNames as readonly string[]).includes(toolName);
}

export const harnessToolSchema = z.object({
  action: z.literal('harness.inspect'),
  section: z.enum(['all', 'session', 'workspace', 'operations', 'view', 'desktop']).default('all'),
}).strict();
export type HarnessSection = z.infer<typeof harnessToolSchema>['section'];

export const harnessApprovalsToolSchema = z.object({ action: z.literal('harness.approvals') }).strict();
export const harnessArtifactsToolSchema = z.object({ action: z.literal('harness.artifacts') }).strict();
export const harnessDraftToolSchema = z.object({ action: z.literal('harness.draft'), text: z.string().trim().min(1).max(100000) }).strict();
export type HarnessDraftToolRequest = z.infer<typeof harnessDraftToolSchema>;
export const harnessContextToolSchema = z.object({
  action: z.literal('harness.context'),
  references: z.array(contextReferenceSchema).min(1).max(20),
}).strict();
export type HarnessContextToolRequest = z.infer<typeof harnessContextToolSchema>;
const harnessContextIdentitySchema = z.object({
  kind: z.enum(['file', 'folder', 'skill', 'tool', 'quote']),
  id: z.string().min(1).max(2000),
  directoryId: z.string().min(1).max(200).optional(),
  range: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }).strict().refine(value => value.end >= value.start).optional(),
  quote: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict().refine(value => value.end > value.start).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'quote' && !value.quote) context.addIssue({ code: 'custom', path: ['quote'], message: '引用消息需要 quote 范围' });
  if (value.kind !== 'quote' && value.quote) context.addIssue({ code: 'custom', path: ['quote'], message: '只有引用消息可以提供 quote 范围' });
});
export const harnessContextRemoveToolSchema = z.object({ action: z.literal('harness.contextRemove'), reference: harnessContextIdentitySchema }).strict();
export type HarnessContextRemoveToolRequest = z.infer<typeof harnessContextRemoveToolSchema>;
export const harnessContextListToolSchema = z.object({ action: z.literal('harness.contextList') }).strict();
export type HarnessContextListToolRequest = z.infer<typeof harnessContextListToolSchema>;
export const harnessAttachmentListToolSchema = z.object({ action: z.literal('harness.attachmentList') }).strict();
export type HarnessAttachmentListToolRequest = z.infer<typeof harnessAttachmentListToolSchema>;
const harnessAttachmentAddItemSchema = z.object({
  path: z.string().min(1).max(2000),
  directoryId: z.string().min(1).max(200).optional(),
}).strict();
export const harnessAttachmentAddToolSchema = z.object({
  action: z.literal('harness.attachmentAdd'),
  files: z.array(harnessAttachmentAddItemSchema).min(1).max(10),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HarnessAttachmentAddToolRequest = z.infer<typeof harnessAttachmentAddToolSchema>;
export const harnessAttachmentRemoveToolSchema = z.object({ action: z.literal('harness.attachmentRemove'), id: z.string().regex(/^[a-f0-9]{64}$/), revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type HarnessAttachmentRemoveToolRequest = z.infer<typeof harnessAttachmentRemoveToolSchema>;
export const harnessDraftPreflightToolSchema = z.object({ action: z.literal('harness.draftPreflight') }).strict();
export type HarnessDraftPreflightToolRequest = z.infer<typeof harnessDraftPreflightToolSchema>;
export const harnessDraftStateToolSchema = z.object({ action: z.literal('harness.draftState') }).strict();
export type HarnessDraftStateToolRequest = z.infer<typeof harnessDraftStateToolSchema>;
export const harnessDraftSendToolSchema = z.object({
  action: z.literal('harness.draftSend'),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  queue: z.enum(['steer', 'followUp']),
}).strict();
export type HarnessDraftSendToolRequest = z.infer<typeof harnessDraftSendToolSchema>;
export const harnessDraftReplaceToolSchema = z.object({
  action: z.literal('harness.draftReplace'),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().max(1000000),
}).strict();
export type HarnessDraftReplaceToolRequest = z.infer<typeof harnessDraftReplaceToolSchema>;
export const harnessDraftHistoryToolSchema = z.object({ action: z.literal('harness.draftHistory') }).strict();
export type HarnessDraftHistoryToolRequest = z.infer<typeof harnessDraftHistoryToolSchema>;
export const harnessDraftHistoryRestoreToolSchema = z.object({
  action: z.literal('harness.draftHistoryRestore'),
  snapshotId: z.string().min(1).max(200),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HarnessDraftHistoryRestoreToolRequest = z.infer<typeof harnessDraftHistoryRestoreToolSchema>;
export const harnessQueueClearToolSchema = z.object({
  action: z.literal('harness.queueClear'),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type HarnessQueueClearToolRequest = z.infer<typeof harnessQueueClearToolSchema>;
export const harnessContextCatalogToolSchema = z.object({ action: z.literal('harness.contextCatalog'), query: z.string().max(300).default('') }).strict();
export type HarnessContextCatalogToolRequest = z.infer<typeof harnessContextCatalogToolSchema>;
export const harnessMessageOptionsToolSchema = z.object({ action: z.literal('harness.messageOptions'), query: z.string().max(300).default('') }).strict();
export type HarnessMessageOptionsToolRequest = z.infer<typeof harnessMessageOptionsToolSchema>;
export const harnessMessageReadToolSchema = z.object({
  action: z.literal('harness.messageRead'),
  messageId: z.string().min(1).max(200),
  start: z.number().int().min(0).optional(),
  end: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if ((value.start === undefined) !== (value.end === undefined)) context.addIssue({ code: 'custom', path: ['start'], message: 'start 和 end 必须同时提供' });
  if (value.start !== undefined && value.end !== undefined) {
    if (value.end < value.start) context.addIssue({ code: 'custom', path: ['end'], message: 'end 不能小于 start' });
    if (value.end - value.start > 40000) context.addIssue({ code: 'custom', path: ['end'], message: '读取范围不能超过 40000 字符' });
  }
}).strict();
export type HarnessMessageReadToolRequest = z.infer<typeof harnessMessageReadToolSchema>;
export const harnessQuoteToolSchema = z.object({
  action: z.literal('harness.quote'),
  messageId: z.string().min(1).max(200),
  start: z.number().int().min(0).optional(),
  end: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if ((value.start === undefined) !== (value.end === undefined)) context.addIssue({ code: 'custom', path: ['start'], message: 'start 和 end 必须同时提供' });
  if (value.start !== undefined && value.end !== undefined) {
    if (value.end < value.start) context.addIssue({ code: 'custom', path: ['end'], message: 'end 不能小于 start' });
    if (value.end - value.start > 40000) context.addIssue({ code: 'custom', path: ['end'], message: '引用范围不能超过 40000 字符' });
  }
}).strict();
export type HarnessQuoteToolRequest = z.infer<typeof harnessQuoteToolSchema>;
export const harnessQueueToolSchema = z.object({ action: z.literal('harness.queue') }).strict();
export type HarnessQueueToolRequest = z.infer<typeof harnessQueueToolSchema>;
export const harnessQueueChangeToolSchema = z.object({
  action: z.literal('harness.queueChange'),
  id: z.string().min(1).max(200),
  revision: z.number().int().nonnegative(),
  change: z.enum(['edit', 'remove', 'up', 'down']),
  text: z.string().max(100000).optional(),
}).strict().superRefine((value, context) => {
  if (value.change === 'edit' && value.text === undefined) context.addIssue({ code: 'custom', path: ['text'], message: '编辑排队消息需要 text' });
  if (value.change !== 'edit' && value.text !== undefined) context.addIssue({ code: 'custom', path: ['text'], message: '只有编辑排队消息可以提供 text' });
}).strict();
export type HarnessQueueChangeToolRequest = z.infer<typeof harnessQueueChangeToolSchema>;
export const harnessApprovalSchema = z.object({
  id: z.string().min(1).max(200),
  tool: z.string().min(1).max(200),
  kind: z.enum(['action', 'confirm', 'input', 'select']),
  description: z.string().max(6000),
  review: z.object({ risk: z.enum(['high', 'uncertain']), reason: z.string().max(2000) }).strict().optional(),
  options: z.array(z.string().max(1000)).max(50).optional(),
}).strict();
export type HarnessApproval = z.infer<typeof harnessApprovalSchema>;
export const harnessArtifactSchema = z.object({
  path: z.string().min(1).max(2000),
  kind: z.enum(['pdf', 'html', 'unknown']),
  state: z.enum(['ready', 'missing', 'invalid']),
  size: z.number().int().nonnegative().max(50 * 1024 * 1024).optional(),
}).strict();
export type HarnessArtifact = z.infer<typeof harnessArtifactSchema>;
export const harnessAttachmentSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().min(1).max(255),
  path: z.string().min(1).max(2000),
  location: z.enum(['project', 'external', 'unknown']),
  state: z.enum(['ready', 'missing', 'invalid']),
  size: z.number().int().nonnegative().max(10 * 1024 * 1024).optional(),
}).strict();
export type HarnessAttachment = z.infer<typeof harnessAttachmentSchema>;

export const projectActionsListToolSchema = z.object({ action: z.literal('project.actions.list') }).strict();
export const projectActionRunToolSchema = z.object({
  action: z.literal('project.actions.run'),
  kind: z.enum(['initialization', 'cleanup', 'action']),
  actionId: z.string().min(1).max(100).optional(),
  command: z.string().min(1).max(8000),
}).strict().superRefine((value, context) => {
  if (value.kind === 'action' && !value.actionId) context.addIssue({ code: 'custom', path: ['actionId'], message: '常用项目动作需要 actionId' });
  if (value.kind !== 'action' && value.actionId) context.addIssue({ code: 'custom', path: ['actionId'], message: '初始化和清理不能带 actionId' });
});

export const desktopViewTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(2000), directoryId: z.string().min(1).max(200).optional(),
    line: z.number().int().positive().max(10000000).optional(), column: z.number().int().positive().max(1000000).optional(),
  }).strict().refine(target => target.column === undefined || target.line !== undefined, 'Column requires a line'),
  z.object({ kind: z.literal('artifact'), path: z.string().min(1).max(2000), directoryId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.enum(['changes', 'review', 'files']), directoryId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.enum(['summary', 'subtasks', 'terminal']) }).strict(),
  z.object({ kind: z.literal('browser'), tabId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal('sidechat'), sidechatId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal('subtask'), subtaskId: z.uuid() }).strict(),
]);
export const desktopViewToolSchema = z.object({ action: z.literal('harness.open'), target: desktopViewTargetSchema }).strict();
export type DesktopViewTarget = z.infer<typeof desktopViewTargetSchema>;

export const timelineFocusTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('composer') }).strict(),
  z.object({ kind: z.literal('message'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('approval'), id: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('plan'), turnKey: z.string().min(1).max(200), index: z.number().int().min(0).max(10000), text: z.string().max(10000) }).strict(),
]);
export type TimelineFocusTarget = z.infer<typeof timelineFocusTargetSchema>;

export const harnessFocusTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('composer') }).strict(),
  z.object({ kind: z.literal('latest') }).strict(),
  z.object({ kind: z.literal('message'), messageId: z.string().min(1).max(200) }).strict(),
  z.object({ kind: z.literal('approval'), approvalId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal('plan'), index: z.number().int().min(0).max(10000) }).strict(),
]);
export const harnessFocusToolSchema = z.object({ action: z.literal('harness.focus'), target: harnessFocusTargetSchema }).strict();
export type HarnessFocusTarget = z.infer<typeof harnessFocusTargetSchema>;
