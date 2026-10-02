import { z } from 'zod';
import { reviewScopeSchema } from './reviews.ts';

/**
 * Wave 3: the workbench families (Review, Git, worktrees, terminals). Every action maps to an existing op,
 * so the model gets exactly the behaviour of the matching control. Read actions are free; writes are gated
 * by the `ask` policy in the main process. As everywhere in this surface, permission-plane fields are absent.
 */

const threadId = z.string().min(1).max(200);
const directoryId = z.string().min(1).max(200);
const path = z.string().min(1).max(4000);

export const manageReviewToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review.start'), scope: reviewScopeSchema.default('uncommitted'), ref: z.string().max(3000).default(''),
    instructions: z.string().max(20000).default(''), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('review.cancel') }).strict(),
  z.object({ action: z.literal('review.inspect') }).strict(),
  z.object({ action: z.literal('review.read'), path, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('review.finding'), findingId: z.string().min(1).max(200), ignored: z.boolean().optional(),
    feedback: z.string().min(1).max(10000).optional(), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('review.locate'), findingId: z.string().min(1).max(200) }).strict(),
]);

export const manageGitToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('git.status'), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.inspect'), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.diff'), path: z.string().max(4000).default(''), mode: z.enum(['all', 'staged', 'unstaged']).optional(), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.range'), path: z.string().max(4000).default(''), mode: z.enum(['branch', 'turn']), ref: z.string().max(3000).default(''), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.commitInfo'), ref: z.string().regex(/^[0-9a-f]{7,64}$/), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.recoveries'), path: z.string().max(4000).optional(), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.processProblems'), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.hunkVersion'), path, directoryId: directoryId.optional() }).strict(),
  z.object({
    action: z.literal('git.run'),
    operation: z.enum(['stage', 'unstage', 'stageHunk', 'unstageHunk', 'commitStaged', 'branchCreate', 'branchTrack', 'branchSwitch',
      'branchDelete', 'upstream', 'fetch', 'pull', 'push', 'merge', 'rebase', 'continue', 'abort', 'resolved', 'worktreeRemove']),
    paths: z.array(z.string()).max(200).default([]), value: z.string().max(3000).default(''), startPoint: z.string().max(3000).optional(),
    remote: z.string().max(200).default('origin'), strategy: z.enum(['ff-only', 'merge', 'rebase']).default('ff-only'),
    patch: z.string().max(1000000).optional(), directoryId: directoryId.optional(),
  }).strict(),
  z.object({ action: z.literal('git.commit'), message: z.string().min(1).max(3000), paths: z.array(z.string()).min(1).max(500), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.apply'), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.revert'), path, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.hunkRevert'), path, patch: z.string().min(1).max(1000000), version: z.string().min(1).max(200),
    mode: z.enum(['all', 'unstaged']), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.hunkRestore'), recoveryId: z.uuid(), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.conflict'), path, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('git.retryStop'), processId: z.uuid(), directoryId: directoryId.optional() }).strict(),
]);

export const manageWorktreesToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('worktrees.create'), directoryId: directoryId.optional(), startPoint: z.string().min(1).max(3000).default('HEAD'),
    destination: z.enum(['local', 'worktree']).default('worktree'), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('worktrees.migrate'), directoryId: directoryId.optional(), startPoint: z.string().min(1).max(3000).default('HEAD'),
    requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('worktrees.manage'), worktreeId: z.uuid(),
    operation: z.enum(['archive', 'restore', 'usage', 'cleanup']), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('worktrees.recycle'), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('worktrees.recovery'), recoveryId: z.string().min(1).max(200), retry: z.boolean().default(false), requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('worktrees.creationRecovery'), recoveryId: z.string().min(1).max(200), open: z.boolean().default(false), requestId: z.uuid().optional() }).strict(),
]);

export const manageTerminalToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('terminal.open'), profileId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal('terminal.rename'), terminalId: z.string().min(1).max(200), title: z.string().min(1).max(100) }).strict(),
  z.object({ action: z.literal('terminal.close'), terminalId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('terminal.resize'), terminalId: z.string().min(1).max(200),
    cols: z.number().int().min(2).max(1000), rows: z.number().int().min(2).max(1000) }).strict(),
  z.object({ action: z.literal('git.cancel'), requestId: z.uuid(), directoryId: directoryId.optional() }).strict(),
]);

export const manageFilesToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('files.list'), path: z.string().max(4000).default(''), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.read'), path, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.write'), path, content: z.string().max(1000000), version: z.string().min(1).max(500), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.open'), path: z.string().max(4000).default(''), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.reveal'), path, directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.search'), query: z.string().min(1).max(500), content: z.boolean().default(false),
    cursor: z.uuid().optional(), directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('files.searchCancel'), requestId: z.uuid().optional() }).strict(),
]);

export const manageCommentsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comments.list') }).strict(),
  z.object({ action: z.literal('comments.add'), path: z.string().min(1).max(2000), version: z.string().min(1).max(500),
    line: z.number().int().positive(), endLine: z.number().int().positive(), body: z.string().min(1).max(10000),
    directoryId: directoryId.optional() }).strict(),
  z.object({ action: z.literal('comments.remove'), commentId: z.string().min(1).max(200) }).strict(),
  z.object({ action: z.literal('comments.locate'), commentId: z.string().min(1).max(200) }).strict(),
]);

export const manageWindowsToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('windows.open'), kind: z.enum(['task', 'quick']).default('task'), threadId: z.string().min(1).max(200).optional() }).strict(),
  z.object({ action: z.literal('windows.minimize') }).strict(),
  z.object({ action: z.literal('windows.maximize') }).strict(),
  z.object({ action: z.literal('windows.close') }).strict(),
  z.object({ action: z.literal('windows.retryShortcut') }).strict(),
  z.object({ action: z.literal('windows.revealWorktreePath'), projectId: z.string().min(1).max(200), directoryId: directoryId.optional(),
    path: z.string().min(1).max(4000), reveal: z.boolean().default(false) }).strict(),
]);

export const managePreviewToolSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('previews.open'), url: z.string().min(1).max(4000)
    .refine(value => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/.*)?$/i.test(value), '只允许本地 http(s) 地址') }).strict(),
  z.object({ action: z.literal('previews.close') }).strict(),
  z.object({ action: z.literal('previews.refresh') }).strict(),
  z.object({ action: z.literal('artifacts.open'), directoryId: z.string().min(1).max(200), path: z.string().min(1).max(4000),
    requestId: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('artifacts.close'), previewId: z.uuid() }).strict(),
  z.object({ action: z.literal('artifacts.status'), previewId: z.uuid() }).strict(),
  z.object({ action: z.literal('artifacts.stop'), previewId: z.uuid() }).strict(),
  z.object({ action: z.literal('artifacts.capture'), previewId: z.uuid() }).strict(),
  z.object({ action: z.literal('artifacts.annotation'), annotationId: z.uuid(), operation: z.enum(['read', 'remove', 'attach']) }).strict(),
]);

export type ManageReviewToolRequest = z.infer<typeof manageReviewToolSchema>;export type ManageGitToolRequest = z.infer<typeof manageGitToolSchema>;
export type ManageWorktreesToolRequest = z.infer<typeof manageWorktreesToolSchema>;
export type ManageTerminalToolRequest = z.infer<typeof manageTerminalToolSchema>;
export type ManageFilesToolRequest = z.infer<typeof manageFilesToolSchema>;
export type ManageCommentsToolRequest = z.infer<typeof manageCommentsToolSchema>;
export type ManageWindowsToolRequest = z.infer<typeof manageWindowsToolSchema>;
export type ManagePreviewToolRequest = z.infer<typeof managePreviewToolSchema>;
export type WorkbenchToolRequest = ManageReviewToolRequest | ManageGitToolRequest | ManageWorktreesToolRequest | ManageTerminalToolRequest
  | ManageFilesToolRequest | ManageCommentsToolRequest | ManageWindowsToolRequest | ManagePreviewToolRequest;

/** Action ids of this family set, used by the main-process dispatcher to claim only its own requests. */
export const workbenchToolActions: readonly string[] = [
  ...manageReviewToolSchema.options.map(option => option.shape.action.value),
  ...manageGitToolSchema.options.map(option => option.shape.action.value),
  ...manageWorktreesToolSchema.options.map(option => option.shape.action.value),
  ...manageTerminalToolSchema.options.map(option => option.shape.action.value),
  ...manageFilesToolSchema.options.map(option => option.shape.action.value),
  ...manageCommentsToolSchema.options.map(option => option.shape.action.value),
  ...manageWindowsToolSchema.options.map(option => option.shape.action.value),
  ...managePreviewToolSchema.options.map(option => option.shape.action.value),
];
