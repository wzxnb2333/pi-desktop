import { z } from 'zod';
import { thinkingSchema } from './contracts.ts';

/**
 * Wave 1 of the desktop tool surface: sessions (own and other), projects and the view. Every request is a
 * discriminated union with strict objects, so an unknown field is a hard error rather than a silent no-op.
 * Permission-plane fields (`policy`, `planMode`, …) are absent by construction — see `desktop-tools.ts`.
 */

const threadId = z.string().min(1).max(200);
const directoryId = z.string().min(1).max(200);
const query = z.string().max(300);

/** Cross-session reads: list, read one session, or search the workspace. */
export const readSessionsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sessions.list'), projectId: directoryId.optional(), query: query.default(''),
    pinned: z.boolean().optional(), archived: z.boolean().optional(), since: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).default(20) }).strict(),
  z.object({ action: z.literal('sessions.read'), threadId, roles: z.array(z.enum(['user', 'assistant'])).max(2).optional(),
    limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).max(10000).default(0),
    maxChars: z.number().int().min(200).max(20000).default(8000) }).strict(),
  z.object({ action: z.literal('sessions.search'), query: z.string().trim().min(1).max(300), projectId: directoryId.optional(),
    limit: z.number().int().min(1).max(200).default(50) }).strict(),
]);

/** The caller's own session, plus the one cross-session write the user approved: sending a message. */
export const manageSessionsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sessions.create'), projectId: directoryId, directoryId: directoryId.optional(),
    worktree: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('sessions.select'), threadId }).strict(),
  z.object({ action: z.literal('sessions.rename'), threadId, title: z.string().trim().min(1).max(300) }).strict(),
  z.object({ action: z.literal('sessions.pin'), threadId, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal('sessions.archive'), threadId, archived: z.boolean() }).strict(),
  z.object({ action: z.literal('sessions.markRead'), threadId, read: z.boolean() }).strict(),
  z.object({ action: z.literal('sessions.stop'), threadId }).strict(),
  z.object({ action: z.literal('sessions.resume'), threadId }).strict(),
  z.object({ action: z.literal('sessions.fork'), threadId, entryId: z.string().min(1).max(200).optional(),
    worktree: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal('sessions.delete'), threadId }).strict(),
  z.object({ action: z.literal('sessions.quickChat'), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('sessions.bindProject'), projectId: directoryId, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('sessions.keepSidechat'), threadId }).strict(),
  z.object({ action: z.literal('sessions.appendSidechat'), threadId, itemId: z.string().min(1).max(200) }).strict(),
]);

export const sendToSessionToolSchema = z.object({
  action: z.literal('sessions.send'), threadId, text: z.string().min(1).max(100000),
  queue: z.enum(['steer', 'followUp']).default('followUp'),
  requestId: z.uuid().optional(),
}).strict();

export const manageProjectsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('projects.list') }).strict(),
  z.object({ action: z.literal('projects.add'), path: z.string().min(1).max(2000).optional() }).strict(),
  z.object({ action: z.literal('projects.trust'), projectId: directoryId, trusted: z.boolean() }).strict(),
  z.object({ action: z.literal('projects.directoryAdd'), projectId: directoryId, path: z.string().min(1).max(2000).optional() }).strict(),
  z.object({ action: z.literal('projects.directoryRemove'), projectId: directoryId, directoryId }).strict(),
  z.object({ action: z.literal('projects.directoryUpdate'), projectId: directoryId, directoryId,
    trusted: z.boolean().optional(), primary: z.boolean().optional() }).strict(),
]);

/** View state only: no drafts, no permissions, no settings. */
export const manageUiToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('ui.collapseProject'), projectId: directoryId, collapsed: z.boolean() }).strict(),
  z.object({ action: z.literal('ui.summary'), open: z.boolean(), threadId: threadId.optional() }).strict(),
  z.object({ action: z.literal('ui.openPanel'), threadId: threadId.optional(),
    panel: z.enum(['changes', 'files', 'browser', 'sidechat', 'review', 'terminal', 'subtasks']) }).strict(),
  z.object({ action: z.literal('ui.closePanel'), threadId: threadId.optional() }).strict(),
  z.object({ action: z.literal('ui.selectFile'), threadId: threadId.optional(), path: z.string().max(2000) }).strict(),
  z.object({ action: z.literal('ui.selectDirectory'), threadId: threadId.optional(), directoryId: directoryId }).strict(),
  z.object({ action: z.literal('ui.openExternal'), url: z.url() }).strict(),
]);

/**
 * Wave 2: the caller's own conversation controls. Every action maps to a composer/timeline control in the
 * current chat — the schemas carry no threadId, so "your own chat only" holds by construction.
 */
export const manageMessagesToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('messages.copy'), itemId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('messages.revise'), itemId: z.string().min(1).max(200), kind: z.enum(['edit', 'regenerate']),
    text: z.string().max(100000).optional(), requestId: z.uuid().optional() }).strict()
    .superRefine((value, context) => {
      if (value.kind === 'edit' && !value.text?.trim()) context.addIssue({ code: 'custom', path: ['text'], message: '编辑消息需要 text' });
      if (value.kind === 'regenerate' && value.text !== undefined) context.addIssue({ code: 'custom', path: ['text'], message: '重新生成不接受 text' });
    }),
  z.object({ action: z.literal('messages.setModel'), modelId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('messages.setThinking'), thinking: thinkingSchema }).strict(),
  z.object({ action: z.literal('messages.createSidechat'), anchorItemId: z.string().min(1).max(200).optional() }).strict(),
]);

export type ReadSessionsToolRequest = z.input<typeof readSessionsToolSchema>;export type ManageSessionsToolRequest = z.input<typeof manageSessionsToolSchema>;
export type SendToSessionToolRequest = z.input<typeof sendToSessionToolSchema>;
export type ManageProjectsToolRequest = z.input<typeof manageProjectsToolSchema>;
export type ManageUiToolRequest = z.input<typeof manageUiToolSchema>;
export type ManageMessagesToolRequest = z.input<typeof manageMessagesToolSchema>;
export type DesktopSessionToolRequest = z.infer<typeof readSessionsToolSchema> | z.infer<typeof manageSessionsToolSchema>
  | z.infer<typeof sendToSessionToolSchema> | z.infer<typeof manageProjectsToolSchema> | z.infer<typeof manageUiToolSchema>
  | z.infer<typeof manageMessagesToolSchema>;
